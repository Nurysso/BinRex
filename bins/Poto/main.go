// poto - Fast and simple Gallery app for linux (part of BinRex)
// Copyright (C) 2026 Dawood Khan
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.
// Maintainer Dawood (Nurysso) contact - nurysso [at] proton.me
package main

import (
	"embed"
	"flag"
	"fmt"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

const version = "0.2.4"

func main() {
	// Define flags
	showVersion := flag.Bool("v", false, "Show version information")
	showHelp := flag.Bool("h", false, "Show help message")
	sudoMode := flag.Bool("sudo", false, "Ignore config restrictions and scan any folder")

	// Parse flags
	flag.Parse()

	// Handle version flag
	if *showVersion {
		fmt.Printf("Poto v%s\n", version)
		os.Exit(0)
	}

	// Handle help flag
	if *showHelp {
		fmt.Println("Poto - Fast and simple Gallery app for Linux")
		fmt.Println("\nUsage:")
		fmt.Println("  poto [OPTIONS]")
		fmt.Println("\nOptions:")
		fmt.Println("  -h       Show this help message")
		fmt.Println("  -v       Show version information")
		fmt.Println("  --sudo   Ignore config folder restrictions and allow scanning any path")
		// fmt.Println("\nMaintainer: Dawood (Nurysso) <nurysso@proton.me>")
		os.Exit(0)
	}

	// Start the application
	app := NewApp(*sudoMode)
	err := wails.Run(&options.App{
		Title:  "Poto",
		Width:  1200,
		Height: 800,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		Bind: []interface{}{
			app,
		},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}
