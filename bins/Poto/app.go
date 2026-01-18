package main

import (
	"context"
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"image/draw"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"

	"golang.org/x/image/bmp"
	"golang.org/x/image/webp"
	"golang.org/x/image/tiff"
	"github.com/nfnt/resize"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx      context.Context
	mu       sync.RWMutex
	scanning atomic.Bool
	cancelFn context.CancelFunc
}

type MediaFile struct {
	Path      string `json:"path"`
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	Type      string `json:"type"`
	Thumbnail string `json:"thumbnail,omitempty"`
}

type ScanProgress struct {
	ScannedFiles int    `json:"scannedFiles"`
	FoundMedia   int    `json:"foundMedia"`
	CurrentPath  string `json:"currentPath"`
	IsComplete   bool   `json:"isComplete"`
}

type DirectoryInfo struct {
	Path     string   `json:"path"`
	Parent   string   `json:"parent"`
	Children []string `json:"children"`
}

var (
	imageExts = map[string]bool{
		".jpg": true, ".jpeg": true, ".png": true, ".gif": true,
		".bmp": true, ".webp": true, ".svg": true, ".ico": true,
		".tiff": true, ".tif": true, ".heic": true, ".heif": true,
	}
	videoExts = map[string]bool{
		".mp4": true, ".avi": true, ".mkv": true, ".mov": true,
		".wmv": true, ".flv": true, ".webm": true, ".m4v": true,
		".mpg": true, ".mpeg": true, ".3gp": true, ".ogv": true,
	}
)

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) StartScan(startPath string) error {
	if a.scanning.Load() {
		return fmt.Errorf("scan already in progress")
	}

	if startPath == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		startPath = home
	}

	a.scanning.Store(true)
	scanCtx, cancel := context.WithCancel(a.ctx)
	a.mu.Lock()
	a.cancelFn = cancel
	a.mu.Unlock()

	go a.performScan(scanCtx, startPath)
	return nil
}

func (a *App) StopScan() {
	a.mu.Lock()
	if a.cancelFn != nil {
		a.cancelFn()
		a.cancelFn = nil
	}
	a.mu.Unlock()
	a.scanning.Store(false)
}

func (a *App) performScan(ctx context.Context, startPath string) {
	defer a.scanning.Store(false)

	var scannedFiles, foundMedia atomic.Int32
	pathChan := make(chan string, 100)
	mediaChan := make(chan MediaFile, 50)

	workerCount := 4
	var wg sync.WaitGroup

	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			a.worker(ctx, pathChan, mediaChan, &scannedFiles, &foundMedia)
		}()
	}

	go func() {
		batch := make([]MediaFile, 0, 20)
		for media := range mediaChan {
			batch = append(batch, media)
			if len(batch) >= 20 {
				runtime.EventsEmit(a.ctx, "mediaFound", batch)
				batch = make([]MediaFile, 0, 20)
			}
		}
		if len(batch) > 0 {
			runtime.EventsEmit(a.ctx, "mediaFound", batch)
		}
	}()

	err := filepath.WalkDir(startPath, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}

		select {
		case <-ctx.Done():
			return filepath.SkipAll
		default:
		}

		if d.Name() != "" && d.Name()[0] == '.' {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		if scannedFiles.Load()%100 == 0 {
			runtime.EventsEmit(a.ctx, "scanProgress", ScanProgress{
				ScannedFiles: int(scannedFiles.Load()),
				FoundMedia:   int(foundMedia.Load()),
				CurrentPath:  filepath.Dir(path),
				IsComplete:   false,
			})
		}

		if !d.IsDir() {
			select {
			case pathChan <- path:
			case <-ctx.Done():
				return filepath.SkipAll
			}
		}
		return nil
	})

	close(pathChan)
	wg.Wait()
	close(mediaChan)

	runtime.EventsEmit(a.ctx, "scanProgress", ScanProgress{
		ScannedFiles: int(scannedFiles.Load()),
		FoundMedia:   int(foundMedia.Load()),
		IsComplete:   true,
	})

	if err != nil && err != filepath.SkipAll {
		runtime.EventsEmit(a.ctx, "scanError", err.Error())
	}
}

func (a *App) worker(ctx context.Context, pathChan <-chan string, mediaChan chan<- MediaFile, scannedFiles, foundMedia *atomic.Int32) {
	for path := range pathChan {
		select {
		case <-ctx.Done():
			return
		default:
		}

		scannedFiles.Add(1)
		ext := strings.ToLower(filepath.Ext(path))
		mediaType := ""

		if imageExts[ext] {
			mediaType = "image"
		} else if videoExts[ext] {
			mediaType = "video"
		} else {
			continue
		}

		info, err := os.Stat(path)
		if err != nil {
			continue
		}

		foundMedia.Add(1)
		media := MediaFile{
			Path: path,
			Name: filepath.Base(path),
			Size: info.Size(),
			Type: mediaType,
		}

		// Generate thumbnail for images
		if mediaType == "image" {
			if thumb := a.generateThumbnail(path); thumb != "" {
				media.Thumbnail = thumb
			}
		}

		select {
		case mediaChan <- media:
		case <-ctx.Done():
			return
		}
	}
}

func (a *App) generateThumbnail(imagePath string) string {
	file, err := os.Open(imagePath)
	if err != nil {
		return ""
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(imagePath))
	limitedReader := io.LimitReader(file, 100*1024*1024)

	var img image.Image

	switch ext {
	case ".jpg", ".jpeg":
		img, err = jpeg.Decode(limitedReader)
	case ".png":
		img, err = png.Decode(limitedReader)
	case ".gif":
		img, err = gif.Decode(limitedReader)
	case ".bmp":
		img, err = bmp.Decode(limitedReader)
	case ".tiff", ".tif":
		img, err = tiff.Decode(limitedReader)
	case ".webp":
		img, err = webp.Decode(limitedReader)
	default:
		img, _, err = image.Decode(limitedReader)
	}

	if err != nil {
		return ""
	}

	// Convert paletted images (like GIF) to RGBA immediately after decoding
	// This prevents palette-related panics during resizing and encoding
	// Use defer/recover to handle corrupted images gracefully
	defer func() {
		if r := recover(); r != nil {
			// Corrupted image, return empty thumbnail
		}
	}()

	if _, isPaletted := img.(*image.Paletted); isPaletted {
		rgbaImg := image.NewRGBA(img.Bounds())
		draw.Draw(rgbaImg, rgbaImg.Bounds(), img, img.Bounds().Min, draw.Src)
		img = rgbaImg
	}

	bounds := img.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()

	// Even larger for high-DPI displays - 1200x1200
	maxDimension := 1200
	var newWidth, newHeight uint

	if width > height {
		if width > maxDimension {
			newWidth = uint(maxDimension)
			newHeight = uint(float64(height) * float64(maxDimension) / float64(width))
		} else {
			newWidth = uint(width)
			newHeight = uint(height)
		}
	} else {
		if height > maxDimension {
			newHeight = uint(maxDimension)
			newWidth = uint(float64(width) * float64(maxDimension) / float64(height))
		} else {
			newWidth = uint(width)
			newHeight = uint(height)
		}
	}

	thumbnail := resize.Resize(newWidth, newHeight, img, resize.Lanczos3)

	var buf bytes.Buffer

	// Higher JPEG quality for premium results
	opts := &jpeg.Options{Quality: 95}
	if err := jpeg.Encode(&buf, thumbnail, opts); err != nil {
		return ""
	}

	encoded := base64.StdEncoding.EncodeToString(buf.Bytes())
	return "data:image/jpeg;base64," + encoded
}

func (a *App) GetHomeDirectory() (string, error) {
	return os.UserHomeDir()
}

func (a *App) IsScanning() bool {
	return a.scanning.Load()
}

// New function to browse directories
func (a *App) BrowseDirectory(path string) (DirectoryInfo, error) {
	info := DirectoryInfo{
		Path:     path,
		Children: []string{},
	}

	// Get parent directory
	parent := filepath.Dir(path)
	if parent != path {
		info.Parent = parent
	}

	// Read directory contents
	entries, err := os.ReadDir(path)
	if err != nil {
		return info, err
	}

	for _, entry := range entries {
		if entry.IsDir() && !strings.HasPrefix(entry.Name(), ".") {
			info.Children = append(info.Children, filepath.Join(path, entry.Name()))
		}
	}

	return info, nil
}

// Open file dialog for directory selection
func (a *App) SelectDirectory() (string, error) {
	path, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Directory to Scan",
	})
	return path, err
}

// Get common directories for quick access
// func (a *App) GetCommonDirectories() (map[string]string, error) {
// 	home, err := os.UserHomeDir()
// 	if err != nil {
// 		return nil, err
// 	}

// 	dirs := map[string]string{
// 		"home":      home,
// 		"documents": filepath.Join(home, "Documents"),
// 		"pictures":  filepath.Join(home, "Pictures"),
// 		"videos":    filepath.Join(home, "Videos"),
// 		"downloads": filepath.Join(home, "Downloads"),
// 		"desktop":   filepath.Join(home, "Desktop"),
// 	}

// 	return dirs, nil
// }

// Helper function to encode JPEG (you'll need to import "image/jpeg")
func encodeJPEG(w io.Writer, img image.Image) error {
	return jpeg.Encode(w, img, &jpeg.Options{Quality: 95})
}
