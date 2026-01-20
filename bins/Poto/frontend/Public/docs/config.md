# Poto Media Scanner - Configuration Guide

## 📍 Configuration File Location

Your configuration file should be placed at:

- **Linux/Mac**: `~/.config/Poto/config.toml`
- **Windows**: `%USERPROFILE%\.config\Poto\config.toml`

---

## 🔧 Configuration Sections

### Scanner Settings

Configure how Poto scans your media files.

```toml
[scanner]
# Default directories to scan (when no path is specified)
scan_directories = [
    "/home/username/Pictures",
    "/home/username/Videos",
]

# Folders to skip entirely (case-insensitive)
excluded_directories = [
    "node_modules",
    ".git",
    "cache",
    "tmp",
    "temp",
    ".trash",
    "Trash"
]

# File/folder patterns to ignore (supports wildcards)
ignore_patterns = [
    "*.tmp",
    "*.cache",
    "*backup*",
    ".*"  # Hidden files starting with dot
]

# Skip hidden files and directories
ignore_hidden = true
```

**Options Explained:**
- `scan_directories`: Directories that will be scanned when you click "Start Scan" without specifying a path
- `excluded_directories`: Folder names that will be completely skipped during scanning
- `ignore_patterns`: Wildcard patterns to ignore (use `*` for any characters, `?` for single character)
- `ignore_hidden`: Whether to skip hidden files/folders (starting with `.`)

---

### Per-Folder Rules

Fine-grained control over specific directories.

```toml
[scanner.per_folder_rules."/home/username/Personal/go"]
# Only scan these specific subfolders (empty = scan all)
allowed_subfolders = ["walls", "videos", "archive"]

# Explicitly block these subfolders
blocked_subfolders = ["temp", "build"]

# Scan subdirectories recursively
scan_recursively = true
```

**Example: Non-recursive Downloads scan**
```toml
[scanner.per_folder_rules."/home/username/Downloads"]
allowed_subfolders = []
blocked_subfolders = ["torrents", "incomplete"]
scan_recursively = false  # Only scan top level
```

---

### Preview Settings

Control thumbnail quality and generation.

```toml
[preview]
# Thumbnail quality: "low" (512px), "medium" (1200px), "high" (2400px)
quality = "high"

# JPEG compression quality (1-100)
# Recommended: 85-95 for good balance
jpeg_quality = 95

# Generate thumbnails for videos (requires ffmpeg)
video_thumbnails = true

# Video thumbnail time offset (in seconds)
video_thumbnail_offset = 1.0
```

**Quality Guide:**
- **Low (512px)**: Fastest, least memory, suitable for quick browsing
- **Medium (1200px)**: Balanced quality and performance
- **High (2400px)**: Best quality, more memory usage

---

### Video Player Integration

Configure MPV video player.

```toml
[video]
# Enable MPV integration
enable_mpv = true

# Path to MPV executable (leave empty to use system PATH)
mpv_path = ""

# MPV command-line arguments
mpv_args = [
    "--force-window=yes",
    "--keep-open=yes",
    "--ontop"
]
```

**Useful MPV Arguments:**
```toml
mpv_args = [
    "--volume=50",        # Default volume 50%
    "--fullscreen",       # Start fullscreen
    "--loop",             # Loop playback
    "--start=10",         # Start 10 seconds in
    "--hwdec=auto",       # Hardware decoding
]
```

**Platform-specific MPV paths:**
- Linux: `"/usr/bin/mpv"`
- Mac: `"/usr/local/bin/mpv"`
- Windows: `"C:\\Program Files\\mpv\\mpv.exe"`

---

### Performance Tuning

Optimize scanning performance.

```toml
[performance]
# Number of worker threads
# Recommended: Number of CPU cores (4-8)
worker_threads = 4

# Batch size for UI updates
# Larger = fewer updates but better performance
batch_size = 20

# Max thumbnail file size in MB
# Prevents memory issues with huge files
max_thumbnail_size = 100
```

**Hardware-based Recommendations:**

| Storage Type | worker_threads | batch_size |
|--------------|----------------|------------|
| SSD          | 8-16           | 50-100     |
| HDD          | 2-4            | 20-30      |

| RAM Available | quality  | max_thumbnail_size | video_thumbnails |
|---------------|----------|-------------------|------------------|
| < 8GB         | "low"    | 50                | false            |
| 8-16GB        | "medium" | 100               | true             |
| 16GB+         | "high"   | 200               | true             |

---

### Appearance

```toml
[look]
# Theme: "light" or "dark"
theme = "dark"
```

---

## 📋 Configuration Examples

### Photo Collection Scanner
Optimized for large photo libraries.

```toml
[scanner]
scan_directories = ["/home/username/Photos"]
ignore_hidden = true

[preview]
quality = "high"
jpeg_quality = 90

[performance]
worker_threads = 8
batch_size = 50
```

### Video Library Scanner
Optimized for video collections with MPV playback.

```toml
[scanner]
scan_directories = ["/mnt/movies", "/mnt/tv"]

[preview]
quality = "medium"
video_thumbnails = true
video_thumbnail_offset = 30.0

[video]
enable_mpv = true
mpv_args = ["--fullscreen", "--keep-open=yes"]
```

### Fast Scanning (Performance Priority)
Minimal thumbnail generation for maximum speed.

```toml
[preview]
quality = "low"
jpeg_quality = 75
video_thumbnails = false

[performance]
worker_threads = 16
batch_size = 100
max_thumbnail_size = 50
```

### Selective Project Scanning
Only scan specific project folders.

```toml
[scanner.per_folder_rules."/home/username/Work"]
allowed_subfolders = ["client_a", "client_b"]
blocked_subfolders = ["archive", "old"]
scan_recursively = true
```

---

## 🎨 Supported File Formats

### Images
`.jpg`, `.jpeg`, `.png`, `.gif`, `.bmp`, `.webp`, `.svg`, `.ico`, `.tiff`, `.tif`, `.heic`, `.heif`

### Videos
`.mp4`, `.avi`, `.mkv`, `.mov`, `.wmv`, `.flv`, `.webm`, `.m4v`, `.mpg`, `.mpeg`, `.3gp`, `.ogv`

---

## 🐛 Troubleshooting

### Scan is too slow
- Reduce `worker_threads`
- Disable `video_thumbnails`
- Lower `quality` to "low" or "medium"

### High memory usage
- Lower `max_thumbnail_size`
- Reduce `quality`
- Decrease `batch_size`

### Missing thumbnails
- Check if files exceed `max_thumbnail_size`
- Verify file permissions
- Ensure files are in supported formats

### Video thumbnails not generating
- Ensure `ffmpeg` is installed and in PATH
- Check `video_thumbnail_offset` value
- Verify video file is not corrupted

### MPV not launching
- Set correct `mpv_path`
- Verify MPV is installed
- Check file permissions on MPV executable

### Hidden folders being scanned
- Set `ignore_hidden = true`
- Add folder names to `excluded_directories`

---

## 💡 Tips & Best Practices

1. **Start with defaults** - Don't modify the config until you understand your needs
2. **Monitor performance** - Watch CPU and memory usage while scanning
3. **Test incrementally** - Change one setting at a time
4. **Backup your config** - Save your working configuration
5. **Use per-folder rules** - For complex directory structures
6. **Platform differences** - Use forward slashes (`/`) even on Windows in TOML strings

---

## 📖 Additional Resources

- [TOML Documentation](https://toml.io/)
- [FFmpeg Installation Guide](https://ffmpeg.org/download.html)
- [MPV Player](https://mpv.io/)

---

**Need help?** Check the [GitHub Issues](https://github.com/yourrepo/poto) or create a new issue.
