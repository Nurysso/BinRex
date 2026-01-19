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
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/BurntSushi/toml"
	"golang.org/x/image/bmp"
	"golang.org/x/image/webp"
	"golang.org/x/image/tiff"
	"github.com/nfnt/resize"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type ScannerConfig struct {
	ScanDirectories     []string          `toml:"scan_directories" json:"scan_directories"`
	ExcludedDirectories []string          `toml:"excluded_directories" json:"excluded_directories"`
	IgnorePatterns      []string          `toml:"ignore_patterns" json:"ignore_patterns"`
	IgnoreHidden        bool              `toml:"ignore_hidden" json:"ignore_hidden"`
	PerFolderRules      map[string]FolderRule `toml:"per_folder_rules" json:"per_folder_rules"`
}

type FolderRule struct {
	AllowedSubfolders   []string `toml:"allowed_subfolders" json:"allowed_subfolders"`
	BlockedSubfolders   []string `toml:"blocked_subfolders" json:"blocked_subfolders"`
	ScanRecursively     bool     `toml:"scan_recursively" json:"scan_recursively"`
}

type PreviewConfig struct {
	Quality              string  `toml:"quality" json:"quality"`
	JpegQuality          int     `toml:"jpeg_quality" json:"jpeg_quality"`
	VideoThumbnails      bool    `toml:"video_thumbnails" json:"video_thumbnails"`
	VideoThumbnailOffset float64 `toml:"video_thumbnail_offset" json:"video_thumbnail_offset"`
}

type VideoConfig struct {
	EnableMPV bool     `toml:"enable_mpv" json:"enable_mpv"`
	MPVPath   string   `toml:"mpv_path" json:"mpv_path"`
	MPVArgs   []string `toml:"mpv_args" json:"mpv_args"`
}

type PerformanceConfig struct {
	WorkerThreads    int `toml:"worker_threads" json:"worker_threads"`
	BatchSize        int `toml:"batch_size" json:"batch_size"`
	MaxThumbnailSize int `toml:"max_thumbnail_size" json:"max_thumbnail_size"`
}

type Config struct {
	Scanner     ScannerConfig     `toml:"scanner" json:"scanner"`
	Preview     PreviewConfig     `toml:"preview" json:"preview"`
	Video       VideoConfig       `toml:"video" json:"video"`
	Performance PerformanceConfig `toml:"performance" json:"performance"`
	Look		LookConfig		`toml:"look" json:"look"`
}

type LookConfig struct {
	Theme	string				`toml:"theme" json:"theme"`
}

type App struct {
	ctx      context.Context
	mu       sync.RWMutex
	scanning atomic.Bool
	cancelFn context.CancelFunc
	config   Config

	// Optimized data structures
	mediaDB      map[string]*MediaFile  // path -> media (O(1) lookup)
	folderIndex  map[string][]string    // folder -> [paths] (O(1) folder lookup)
	typeIndex    map[string][]string    // type -> [paths] (O(1) type lookup)
	dateIndex    []string               // sorted by date (binary search)
	dbMu         sync.RWMutex

	autoScanDone atomic.Bool
}

type MediaFile struct {
	Path         string    `json:"path"`
	Name         string    `json:"name"`
	Size         int64     `json:"size"`
	Type         string    `json:"type"`
	Thumbnail    string    `json:"thumbnail,omitempty"`
	ModifiedTime time.Time `json:"modifiedTime"`
	ParentFolder string    `json:"parentFolder"`
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

type FilterOptions struct {
	FolderPath string    `json:"folderPath"`
	MediaType  string    `json:"mediaType"`
	FromDate   time.Time `json:"fromDate"`
	ToDate     time.Time `json:"toDate"`
	SearchTerm string    `json:"searchTerm"`
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
	app := &App{
		mediaDB:     make(map[string]*MediaFile),
		folderIndex: make(map[string][]string),
		typeIndex:   make(map[string][]string),
		dateIndex:   make([]string, 0),
	}
	app.loadConfig()
	return app
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// Auto-start scan on startup if directories are configured
	if len(a.config.Scanner.ScanDirectories) > 0 && !a.autoScanDone.Load() {
		a.autoScanDone.Store(true)

		// Small delay to let UI initialize
		go func() {
			time.Sleep(500 * time.Millisecond)
			a.StartScan("")
		}()
	}
}

func (a *App) loadConfig() {
	homeDir, _ := os.UserHomeDir()
	configPath := filepath.Join(homeDir, ".config", "Poto", "config.toml")

	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		configPath = "config.toml"
	}

	// Set defaults
	a.config.Preview.Quality = "medium"
	a.config.Preview.JpegQuality = 85
	a.config.Preview.VideoThumbnails = true
	a.config.Preview.VideoThumbnailOffset = 1.0
	a.config.Performance.WorkerThreads = 8
	a.config.Performance.BatchSize = 50
	a.config.Performance.MaxThumbnailSize = 100
	a.config.Look.Theme = "light"
	a.config.Video.EnableMPV = true
	a.config.Video.MPVArgs = []string{"--force-window=yes", "--keep-open=yes", "--ontop"}
	a.config.Scanner.IgnoreHidden = true
	a.config.Scanner.PerFolderRules = make(map[string]FolderRule)

	if _, err := toml.DecodeFile(configPath, &a.config); err != nil {
		fmt.Printf("Warning: Could not load config file (%v), using defaults\n", err)
		a.saveDefaultConfig(configPath)
	}
}

func (a *App) saveDefaultConfig(path string) {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		fmt.Printf("Warning: Could not create config directory: %v\n", err)
		return
	}

	f, err := os.Create(path)
	if err != nil {
		return
	}
	defer f.Close()

	encoder := toml.NewEncoder(f)
	encoder.Encode(a.config)
}

func (a *App) GetConfig() Config {
	return a.config
}

func (a *App) UpdateConfig(config Config) error {
	a.config = config

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return err
	}

	configPath := filepath.Join(homeDir, ".config", "Poto", "config.toml")

	dir := filepath.Dir(configPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	f, err := os.Create(configPath)
	if err != nil {
		return err
	}
	defer f.Close()

	encoder := toml.NewEncoder(f)
	return encoder.Encode(config)
}

func (a *App) AddScanDirectory(dirPath string) error {
	a.config.Scanner.ScanDirectories = append(a.config.Scanner.ScanDirectories, dirPath)
	return a.UpdateConfig(a.config)
}

func (a *App) RemoveScanDirectory(dirPath string) error {
	dirs := make([]string, 0)
	for _, d := range a.config.Scanner.ScanDirectories {
		if d != dirPath {
			dirs = append(dirs, d)
		}
	}
	a.config.Scanner.ScanDirectories = dirs
	return a.UpdateConfig(a.config)
}

func (a *App) AddFolderRule(folderPath string, rule FolderRule) error {
	if a.config.Scanner.PerFolderRules == nil {
		a.config.Scanner.PerFolderRules = make(map[string]FolderRule)
	}
	a.config.Scanner.PerFolderRules[folderPath] = rule
	return a.UpdateConfig(a.config)
}

func (a *App) RemoveFolderRule(folderPath string) error {
	delete(a.config.Scanner.PerFolderRules, folderPath)
	return a.UpdateConfig(a.config)
}

func (a *App) AddIgnorePattern(pattern string) error {
	a.config.Scanner.IgnorePatterns = append(a.config.Scanner.IgnorePatterns, pattern)
	return a.UpdateConfig(a.config)
}

func (a *App) RemoveIgnorePattern(pattern string) error {
	patterns := make([]string, 0)
	for _, p := range a.config.Scanner.IgnorePatterns {
		if p != pattern {
			patterns = append(patterns, p)
		}
	}
	a.config.Scanner.IgnorePatterns = patterns
	return a.UpdateConfig(a.config)
}

func (a *App) StartScan(startPath string) error {
	if a.scanning.Load() {
		return fmt.Errorf("scan already in progress")
	}

	// Clear previous database
	a.dbMu.Lock()
	a.mediaDB = make(map[string]*MediaFile)
	a.folderIndex = make(map[string][]string)
	a.typeIndex = make(map[string][]string)
	a.dateIndex = make([]string, 0)
	a.dbMu.Unlock()

	if startPath == "" {
		if len(a.config.Scanner.ScanDirectories) > 0 {
			a.scanning.Store(true)
			scanCtx, cancel := context.WithCancel(a.ctx)
			a.mu.Lock()
			a.cancelFn = cancel
			a.mu.Unlock()

			go a.performMultiScan(scanCtx, a.config.Scanner.ScanDirectories)
			return nil
		} else {
			home, err := os.UserHomeDir()
			if err != nil {
				return err
			}
			startPath = home
		}
	} else {
		// Validate against allowed directories
		allowed := false
		if len(a.config.Scanner.ScanDirectories) == 0 {
			allowed = true
		} else {
			for _, allowedDir := range a.config.Scanner.ScanDirectories {
				if startPath == allowedDir || strings.HasPrefix(startPath, allowedDir+string(os.PathSeparator)) {
					allowed = true
					break
				}
			}
		}

		if !allowed {
			return fmt.Errorf("directory not in allowed scan directories")
		}
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

func (a *App) performMultiScan(ctx context.Context, directories []string) {
	defer a.scanning.Store(false)

	for _, dir := range directories {
		select {
		case <-ctx.Done():
			return
		default:
			a.scanDirectory(ctx, dir)
		}
	}

	runtime.EventsEmit(a.ctx, "scanProgress", ScanProgress{
		IsComplete: true,
	})
}

func (a *App) performScan(ctx context.Context, startPath string) {
	defer a.scanning.Store(false)
	a.scanDirectory(ctx, startPath)

	runtime.EventsEmit(a.ctx, "scanProgress", ScanProgress{
		IsComplete: true,
	})
}

func (a *App) scanDirectory(ctx context.Context, startPath string) {
	var scannedFiles, foundMedia atomic.Int32
	pathChan := make(chan string, 200)
	mediaChan := make(chan *MediaFile, 100)

	workerCount := a.config.Performance.WorkerThreads
	var wg sync.WaitGroup

	// Start workers
	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			a.worker(ctx, pathChan, mediaChan, &scannedFiles, &foundMedia)
		}()
	}

	// Media collector (adds to indexes)
	go func() {
		batch := make([]*MediaFile, 0, a.config.Performance.BatchSize)
		emitBatch := func() {
			if len(batch) == 0 {
				return
			}

			// Convert to slice for JSON
			jsonBatch := make([]MediaFile, len(batch))
			for i, m := range batch {
				jsonBatch[i] = *m
			}

			runtime.EventsEmit(a.ctx, "mediaFound", jsonBatch)
			batch = make([]*MediaFile, 0, a.config.Performance.BatchSize)
		}

		for media := range mediaChan {
			// Add to database with indexes
			a.addToDatabase(media)

			batch = append(batch, media)
			if len(batch) >= a.config.Performance.BatchSize {
				emitBatch()
			}
		}
		emitBatch()
	}()

	// Build exclusion maps
	excludedDirs := make(map[string]bool)
	for _, dir := range a.config.Scanner.ExcludedDirectories {
		excludedDirs[strings.ToLower(dir)] = true
	}

	err := filepath.WalkDir(startPath, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}

		select {
		case <-ctx.Done():
			return filepath.SkipAll
		default:
		}

		if d.IsDir() {
			if a.config.Scanner.IgnoreHidden && d.Name() != "" && d.Name()[0] == '.' {
				return filepath.SkipDir
			}

			if excludedDirs[strings.ToLower(d.Name())] {
				return filepath.SkipDir
			}

			for _, pattern := range a.config.Scanner.IgnorePatterns {
				if matched, _ := filepath.Match(pattern, d.Name()); matched {
					return filepath.SkipDir
				}
			}

			// Per-folder rules
			parentDir := filepath.Dir(path)
			if rule, exists := a.config.Scanner.PerFolderRules[parentDir]; exists {
				if len(rule.AllowedSubfolders) > 0 {
					allowed := false
					for _, allowed_sf := range rule.AllowedSubfolders {
						if d.Name() == allowed_sf {
							allowed = true
							break
						}
					}
					if !allowed {
						return filepath.SkipDir
					}
				}

				for _, blocked_sf := range rule.BlockedSubfolders {
					if d.Name() == blocked_sf {
						return filepath.SkipDir
					}
				}

				if !rule.ScanRecursively {
					relPath, _ := filepath.Rel(parentDir, path)
					if strings.Count(relPath, string(os.PathSeparator)) > 0 {
						return filepath.SkipDir
					}
				}
			}
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

func (a *App) worker(ctx context.Context, pathChan <-chan string, mediaChan chan<- *MediaFile, scannedFiles, foundMedia *atomic.Int32) {
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
		media := &MediaFile{
			Path:         path,
			Name:         filepath.Base(path),
			Size:         info.Size(),
			Type:         mediaType,
			ModifiedTime: info.ModTime(),
			ParentFolder: filepath.Dir(path),
		}

		// Generate thumbnails
		if mediaType == "image" {
			if thumb := a.generateImageThumbnail(path); thumb != "" {
				media.Thumbnail = thumb
			}
		} else if mediaType == "video" && a.config.Preview.VideoThumbnails {
			if thumb := a.generateVideoThumbnail(path); thumb != "" {
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

// Optimized database operations
func (a *App) addToDatabase(media *MediaFile) {
	a.dbMu.Lock()
	defer a.dbMu.Unlock()

	// Add to main database
	a.mediaDB[media.Path] = media

	// Index by folder
	a.folderIndex[media.ParentFolder] = append(a.folderIndex[media.ParentFolder], media.Path)

	// Index by type
	a.typeIndex[media.Type] = append(a.typeIndex[media.Type], media.Path)

	// Insert into date index (keep sorted)
	a.dateIndex = append(a.dateIndex, media.Path)
}

// Optimized filtering with indexes
func (a *App) FilterMedia(filter FilterOptions) []MediaFile {
	a.dbMu.RLock()

	// Use indexes for fast filtering
	var candidatePaths []string

	// Start with the most restrictive filter
	if filter.FolderPath != "" {
		// O(1) folder lookup
		candidatePaths = a.folderIndex[filter.FolderPath]
	} else if filter.MediaType != "" && filter.MediaType != "all" {
		// O(1) type lookup
		candidatePaths = a.typeIndex[filter.MediaType]
	} else {
		// All media
		candidatePaths = make([]string, 0, len(a.mediaDB))
		for path := range a.mediaDB {
			candidatePaths = append(candidatePaths, path)
		}
	}

	// Copy candidate media
	candidates := make([]*MediaFile, 0, len(candidatePaths))
	for _, path := range candidatePaths {
		if media, exists := a.mediaDB[path]; exists {
			candidates = append(candidates, media)
		}
	}

	a.dbMu.RUnlock()

	// Apply remaining filters
	filtered := make([]MediaFile, 0, len(candidates))

	for _, media := range candidates {
		// Folder filter (if type was primary filter)
		if filter.FolderPath != "" && !strings.HasPrefix(media.Path, filter.FolderPath) {
			continue
		}

		// Type filter (if folder was primary filter)
		if filter.MediaType != "" && filter.MediaType != "all" && media.Type != filter.MediaType {
			continue
		}

		// Date filters
		if !filter.FromDate.IsZero() && media.ModifiedTime.Before(filter.FromDate) {
			continue
		}
		if !filter.ToDate.IsZero() && media.ModifiedTime.After(filter.ToDate) {
			continue
		}

		// Search term
		if filter.SearchTerm != "" {
			searchLower := strings.ToLower(filter.SearchTerm)
			nameLower := strings.ToLower(media.Name)
			pathLower := strings.ToLower(media.Path)

			if !strings.Contains(nameLower, searchLower) && !strings.Contains(pathLower, searchLower) {
				continue
			}
		}

		filtered = append(filtered, *media)
	}

	return filtered
}

func (a *App) GetMediaByFolder(folderPath string) []MediaFile {
	return a.FilterMedia(FilterOptions{
		FolderPath: folderPath,
		MediaType:  "all",
	})
}

func (a *App) GetMediaByType(mediaType string) []MediaFile {
	return a.FilterMedia(FilterOptions{
		MediaType: mediaType,
	})
}

func (a *App) GetMediaByDateRange(fromDate, toDate time.Time) []MediaFile {
	return a.FilterMedia(FilterOptions{
		FromDate: fromDate,
		ToDate:   toDate,
	})
}

func (a *App) GetAllMedia() []MediaFile {
	a.dbMu.RLock()
	defer a.dbMu.RUnlock()

	result := make([]MediaFile, 0, len(a.mediaDB))
	for _, media := range a.mediaDB {
		result = append(result, *media)
	}
	return result
}

func (a *App) generateImageThumbnail(imagePath string) string {
	file, err := os.Open(imagePath)
	if err != nil {
		return ""
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(imagePath))
	maxSize := int64(a.config.Performance.MaxThumbnailSize) * 1024 * 1024
	limitedReader := io.LimitReader(file, maxSize)

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

	defer func() {
		if r := recover(); r != nil {
			// Corrupted image
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

	maxDimension := 512
	switch a.config.Preview.Quality {
	case "low":
		maxDimension = 512
	case "medium":
		maxDimension = 1200
	case "high":
		maxDimension = 2400
	}

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
	opts := &jpeg.Options{Quality: a.config.Preview.JpegQuality}
	if err := jpeg.Encode(&buf, thumbnail, opts); err != nil {
		return ""
	}

	encoded := base64.StdEncoding.EncodeToString(buf.Bytes())
	return "data:image/jpeg;base64," + encoded
}

func (a *App) generateVideoThumbnail(videoPath string) string {
	ffmpegPath := "ffmpeg"
	if _, err := exec.LookPath(ffmpegPath); err != nil {
		return ""
	}

	tmpFile, err := os.CreateTemp("", "thumb_*.jpg")
	if err != nil {
		return ""
	}
	tmpPath := tmpFile.Name()
	tmpFile.Close()
	defer os.Remove(tmpPath)

	offset := fmt.Sprintf("%.1f", a.config.Preview.VideoThumbnailOffset)

	cmd := exec.Command(ffmpegPath,
		"-ss", offset,
		"-i", videoPath,
		"-vframes", "1",
		"-q:v", "2",
		tmpPath,
	)

	if err := cmd.Run(); err != nil {
		return ""
	}

	data, err := os.ReadFile(tmpPath)
	if err != nil {
		return ""
	}

	encoded := base64.StdEncoding.EncodeToString(data)
	return "data:image/jpeg;base64," + encoded
}

func (a *App) PlayWithMPV(filePath string) error {
	if !a.config.Video.EnableMPV {
		return fmt.Errorf("MPV playback is disabled in config")
	}

	mpvPath := a.config.Video.MPVPath
	if mpvPath == "" {
		mpvPath = "mpv"
	}

	if _, err := exec.LookPath(mpvPath); err != nil {
		return fmt.Errorf("MPV not found: %v", err)
	}

	args := append(a.config.Video.MPVArgs, filePath)
	cmd := exec.Command(mpvPath, args...)

	return cmd.Start()
}

func (a *App) GetHomeDirectory() (string, error) {
	return os.UserHomeDir()
}

func (a *App) IsScanning() bool {
	return a.scanning.Load()
}

func (a *App) BrowseDirectory(path string) (DirectoryInfo, error) {
	info := DirectoryInfo{
		Path:     path,
		Children: []string{},
	}

	parent := filepath.Dir(path)
	if parent != path {
		info.Parent = parent
	}

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

func (a *App) SelectDirectory() (string, error) {
	path, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Directory to Scan",
	})
	return path, err
}

func (a *App) GetCommonDirectories() (map[string]string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}

	dirs := map[string]string{
		"home":      home,
		"documents": filepath.Join(home, "Documents"),
		"pictures":  filepath.Join(home, "Pictures"),
		"videos":    filepath.Join(home, "Videos"),
		"downloads": filepath.Join(home, "Downloads"),
		"desktop":   filepath.Join(home, "Desktop"),
	}

	return dirs, nil
}
