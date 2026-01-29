# Poto

> Fast and simple Gallery app for Linux (part of BinRex)

A lightweight, fast media gallery application built with Wails that lets you browse your photos and videos with style.

It exists cause I hate existing gallery apps that exists for
linux they either are too complicated or too restrictive.

## Features

- 🚀 **Fast scanning** - Multi-threaded media file discovery
- 🖼️ **High-quality thumbnails** - Configurable preview generation
- 🎬 **Video support** - Thumbnail generation and MPV player integration
- ⚙️ **Highly configurable** - Fine-tune scanning, performance, and appearance
- 🎨 **Modern UI** - Clean, responsive interface with dark/light themes
- 🔍 **Smart filtering** - Exclude unwanted directories and file patterns

## Quick Start

```bash
# Run Poto
./poto

# Show version
./poto -v

# Show help
./poto -h
```

## Installation

### From Binary

```
binrex install Poto
```

### Build from Source

```bash
git clone https://github.com/Nurysso/binrex.git
cd binrex/bins/Poto
wails build
```

## Configuration

Poto can be configured via `~/.config/Poto/config.toml`

### Quick Config Example

```toml
[scanner]
scan_directories = [
    "/home/username/Pictures",
    "/home/username/Videos",
]
ignore_hidden = true

[preview]
quality = "high"  # Options: "low", "medium", "high"
jpeg_quality = 95

[video]
enable_mpv = true

[performance]
worker_threads = 4
batch_size = 20
```

### Configuration Options

| Section       | Description                            |
| ------------- | -------------------------------------- |
| `scanner`     | Scan directories, exclusions, patterns |
| `preview`     | Thumbnail quality and video settings   |
| `video`       | MPV player integration                 |
| `performance` | Threading and memory optimization      |
| `look`        | Theme and appearance                   |

**Full configuration guide**: [CONFIG.md](./doc/config.md)

## Supported Formats

**Images**: JPG, PNG, GIF, BMP, WebP, SVG, TIFF, HEIC
**Videos**: MP4, AVI, MKV, MOV, WMV, WebM, MPG, FLV

## Requirements

- **Linux** (tested on Ubuntu, Fedora, Arch)
- **Optional**: `ffmpeg` for video thumbnails
- **Optional**: `mpv` for video playback

## License

Copyright (C) 2026 Dawood Khan

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

See [LICENSE](../../LICENSE) for details.

## Maintainer

**Dawood (Nurysso)**
nurysso [at] proton.me

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgments

Built with [Wails](https://wails.io/) - Go + Web frontends made easy

---

**⭐ If you like Poto, give it a star!**
