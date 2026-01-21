#! /bin/bash

echo -e "Start running the script..."
echo -e "Current Go version: \c"
go version
echo -e "Install the Wails command line tool..."
go install github.com/wailsapp/wails/v2/cmd/wails@latest
echo -e "Successfully installed deps!"
echo -e "Start running the script..."
echo -e "Start building the app..."
wails build --clean

echo -e "End running the script!"
