# Poto - Modern Media Scanner

Poto is a fast, lightweight, and modern media scanner built with Go (Wails) and React. It features a sleek, Adwaita/GNOME-inspired user interface and provides powerful tools to organize and browse your local images and videos.

## Features

- **Blazing Fast Scanning**: Quickly indexes your media directories.
- **GNOME-like UI**: Beautiful, clean interface that feels native to modern Linux desktop environments.
- **Sudo Mode**: Support for an unrestricted `--sudo` mode to bypass configuration-defined folder restrictions.
- **Advanced Filtering**: Filter your media by name, type, size, date, and specific folder paths.
- **Integrated Viewers**:
  - Fullscreen image viewer with rotation and zoom controls.
  - Video playback integration (supports MPV if configured).
- **Customizable**: Adapts to your system's GTK theme colors for a seamless experience.

## Getting Started

### Prerequisites

- [Go](https://go.dev/) (1.18+)
- [Node.js](https://nodejs.org/) and npm
- [Wails CLI](https://wails.io/docs/gettingstarted/installation)

### Installation

1. Clone the repository and navigate to the project directory:
   ```bash
   cd BinRex/bins/Poto
   ```

2. Build the application using Wails:
   ```bash
   wails build
   ```

3. The built binary will be located in the `build/bin/` directory.

### Usage

Run the compiled binary:
```bash
./build/bin/Poto
```

To run in sudo mode (unrestricted directory access):
```bash
./build/bin/Poto --sudo
```

## Configuration

Poto looks for its configuration file. You can configure scan directories and video player preferences via the built-in Help & Settings dialog.

## License

MIT License
