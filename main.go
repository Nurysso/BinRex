//$GOROOT/bin/go run $0 $@ ; exit

package main

import (
	"encoding/json"
	"fmt"
	"io"

	// "io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Constants
const (
	MaxPath   = 512
	MaxCmd    = 1024
	MaxBuffer = 16384
	RepoURL   = "https://github.com/nurysso/binrex"
)

// Package represents a package in the manifest
type Package struct {
	Name              string   `json:"name"`
	RepoURL           string   `json:"repo_url"`
	BinFolder         string   `json:"bin_folder"`
	BinaryName        string   `json:"binary_name"`
	BinaryVersion     string   `json:"binary_version"`
	Description       string   `json:"description"`
	Keywords          []string `json:"keywords"`
	OSSupported       string   `json:"os_supported"`
	RequiredTools     string   `json:"required_tools"`
	TotalBinInstalled string   `json:"total_bin_installed"`
	BuildCommands     string   `json:"build_commands"`
	BuildDirExist     bool     `json:"build_bin_exist"`
	BuildDir          string   `json:"build_dir"`
	InstallSize       string   `json:"Install_size"`
}

// InstalledPackage represents an installed package
type InstalledPackage struct {
	Name          string   `json:"name"`
	Version       string   `json:"version"`
	BinaryPaths   []string `json:"binary_paths"`
	RepoPath      string   `json:"repo_path"`
	InstallDate   string   `json:"install_date"`
	TotalBinaries int      `json:"total_binaries"`
}

// Manifest represents the manifest.json structure
type Manifest struct {
	Packages []Package `json:"packages"`
}

// InstalledData represents installed.json structure
type InstalledData struct {
	Installed []InstalledPackage `json:"installed"`
}

// Binary represents a found binary file
type Binary struct {
	Name string
	Path string
}

// Global paths
var (
	configDir     string
	cacheDir      string
	binDir        string
	manifestPath  string
	installedPath string
	repoCache     string
)

// initPaths initializes all directory paths
func initPaths() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("could not determine HOME directory: %w", err)
	}

	configDir = filepath.Join(home, ".config", "binrex")
	cacheDir = filepath.Join(home, ".cache", "binrex", "repos")
	binDir = filepath.Join(home, ".local", "bin")
	manifestPath = filepath.Join(configDir, "manifest.json")
	installedPath = filepath.Join(configDir, "installed.json")
	repoCache = filepath.Join(cacheDir, "binrex-repo")

	return nil
}

// getOSName returns the current OS name
func getOSName() string {
	return strings.ToLower(runtime.GOOS)
}

// createDirectories creates necessary directories
func createDirectories() error {
	dirs := []string{
		configDir,
		filepath.Join(os.Getenv("HOME"), ".cache", "binrex"),
		cacheDir,
		binDir,
	}

	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("error creating %s: %w", dir, err)
		}
	}

	// Create empty installed.json if it doesn't exist
	if !fileExists(installedPath) {
		emptyData := InstalledData{Installed: []InstalledPackage{}}
		data, _ := json.MarshalIndent(emptyData, "", "  ")
		os.WriteFile(installedPath, data, 0644)
	}

	return nil
}

// fileExists checks if a file exists
func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// runCommand runs a shell command and prints output
func runCommand(cmd string) error {
	fmt.Printf("Running: %s\n", cmd)
	command := exec.Command("sh", "-c", cmd)
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	return command.Run()
}

// runCommandSilent runs a command silently
func runCommandSilent(cmd string) error {
	command := exec.Command("sh", "-c", cmd)
	return command.Run()
}

// checkToolExists checks if a tool is available
func checkToolExists(tool string) bool {
	cmd := fmt.Sprintf("which %s", tool)
	return runCommandSilent(cmd) == nil
}

// checkRequiredTools checks if all required tools are available
func checkRequiredTools(tools string) bool {
	toolsList := strings.Split(tools, ",")
	missing := false

	fmt.Println("Checking required tools...")
	for _, tool := range toolsList {
		tool = strings.TrimSpace(tool)
		if tool == "" {
			continue
		}

		if checkToolExists(tool) {
			fmt.Printf("  ✓ %s found\n", tool)
		} else {
			fmt.Printf("  ✗ %s NOT FOUND\n", tool)
			missing = true
		}
	}

	return !missing
}

// getCurrentDate returns current date in YYYY-MM-DD format
func getCurrentDate() string {
	return time.Now().Format("2006-01-02")
}

// loadManifest loads the manifest.json file
func loadManifest() (*Manifest, error) {
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		return nil, err
	}

	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, err
	}

	return &manifest, nil
}

// loadInstalled loads the installed.json file
func loadInstalled() (*InstalledData, error) {
	data, err := os.ReadFile(installedPath)
	if err != nil {
		return &InstalledData{Installed: []InstalledPackage{}}, nil
	}

	var installed InstalledData
	if err := json.Unmarshal(data, &installed); err != nil {
		return &InstalledData{Installed: []InstalledPackage{}}, nil
	}

	return &installed, nil
}

// saveInstalled saves the installed.json file
func saveInstalled(data *InstalledData) error {
	jsonData, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(installedPath, jsonData, 0644)
}

// findPackage finds a package in the manifest by name
func findPackage(name string) (*Package, error) {
	manifest, err := loadManifest()
	if err != nil {
		return nil, err
	}

	for _, pkg := range manifest.Packages {
		if pkg.Name == name {
			return &pkg, nil
		}
	}

	return nil, fmt.Errorf("package '%s' not found", name)
}

// getRepoNameFromURL extracts repository name from GitHub URL
func getRepoNameFromURL(url string) string {
	url = strings.TrimRight(url, "/")
	if strings.HasSuffix(url, ".git") {
		url = url[:len(url)-4]
	}

	parts := strings.Split(url, "/")
	return parts[len(parts)-1]
}

// getRepoCachePath returns the cache directory path for a repository
func getRepoCachePath(repoURL string) string {
	repoName := getRepoNameFromURL(repoURL)
	return filepath.Join(cacheDir, repoName)
}

// cloneOrUpdateRepo clones or updates a repository
func cloneOrUpdateRepo(repoURL string) (string, error) {
	repoPath := getRepoCachePath(repoURL)

	if !fileExists(repoPath) {
		fmt.Printf("\nCloning repository from %s...\n", repoURL)
		cmd := fmt.Sprintf("git clone %s %s", repoURL, repoPath)
		if err := runCommand(cmd); err != nil {
			return "", fmt.Errorf("failed to clone repository: %w", err)
		}
	} else {
		fmt.Printf("\nUpdating repository at %s...\n", repoPath)
		cmd := fmt.Sprintf("cd %s && git pull", repoPath)
		runCommand(cmd)
	}

	return repoPath, nil
}

// findBinariesInBuildPath finds all binary files in the build directory
func findBinariesInBuildPath(buildPath string, pkg *Package) []Binary {
	var binaries []Binary
	foundBinariesMap := make(map[string]Binary)

	// Common locations where binaries might be
	searchPaths := []string{
		filepath.Join(buildPath, "target", "release"),
		filepath.Join(buildPath, "target", "debug"),
		filepath.Join(buildPath, "build"),
		filepath.Join(buildPath, "build", "bin"),
		filepath.Join(buildPath, "bin"),
		filepath.Join(buildPath, "dist"),
		buildPath,
	}

	// Get expected binary names from manifest
	expectedNames := []string{}
	if pkg.BinaryName != "" {
		for _, name := range strings.Split(pkg.BinaryName, ",") {
			expectedNames = append(expectedNames, strings.TrimSpace(name))
		}
	}

	fmt.Printf("DEBUG: Looking for binaries: %v\n", expectedNames)

	for _, searchPath := range searchPaths {
		if !fileExists(searchPath) {
			fmt.Printf("DEBUG: Path does not exist: %s\n", searchPath)
			continue
		}

		fmt.Printf("DEBUG: Searching in %s\n", searchPath)

		entries, err := os.ReadDir(searchPath)
		if err != nil {
			fmt.Printf("DEBUG: Error reading directory: %v\n", err)
			continue
		}

		fmt.Printf("DEBUG: Found %d items in directory\n", len(entries))

		for _, entry := range entries {
			if entry.IsDir() {
				fmt.Printf("DEBUG: %s is a directory (skipping)\n", entry.Name())
				continue
			}

			itemPath := filepath.Join(searchPath, entry.Name())
			info, err := entry.Info()
			if err != nil {
				continue
			}

			isExecutable := info.Mode()&0111 != 0

			fmt.Printf("DEBUG: Checking %s - executable: %v, in expected: %v\n",
				entry.Name(), isExecutable, contains(expectedNames, entry.Name()))

			if isExecutable {
				// Skip common build artifacts
				skipPatterns := []string{".d", ".rlib", ".so", ".a", ".o", ".dylib", ".dll"}
				skip := false
				for _, pattern := range skipPatterns {
					if strings.HasSuffix(entry.Name(), pattern) {
						skip = true
						break
					}
				}
				if skip {
					fmt.Printf("DEBUG: Skipping %s (build artifact)\n", entry.Name())
					continue
				}

				// Skip hidden files and build scripts
				if strings.HasPrefix(entry.Name(), ".") ||
					entry.Name() == "build" ||
					entry.Name() == "Makefile" ||
					entry.Name() == "CMakeLists.txt" {
					fmt.Printf("DEBUG: Skipping %s (hidden/build file)\n", entry.Name())
					continue
				}

				// If expected names are specified, only include those
				if len(expectedNames) > 0 {
					if contains(expectedNames, entry.Name()) {
						if _, exists := foundBinariesMap[entry.Name()]; !exists {
							fmt.Printf("DEBUG: ✓ Found expected binary: %s\n", entry.Name())
							foundBinariesMap[entry.Name()] = Binary{
								Name: entry.Name(),
								Path: itemPath,
							}
						}
					} else {
						fmt.Printf("DEBUG: ✗ Skipping %s (not in expected list)\n", entry.Name())
					}
				} else {
					// No expected names, include all executables
					if _, exists := foundBinariesMap[entry.Name()]; !exists {
						fmt.Printf("DEBUG: Found binary: %s\n", entry.Name())
						foundBinariesMap[entry.Name()] = Binary{
							Name: entry.Name(),
							Path: itemPath,
						}
					}
				}
			}
		}
	}

	// Convert map to slice
	for _, binary := range foundBinariesMap {
		binaries = append(binaries, binary)
	}

	fmt.Printf("DEBUG: Total binaries found: %d\n", len(binaries))
	fmt.Printf("DEBUG: Expected to find: %d\n", len(expectedNames))
	for _, binary := range binaries {
		fmt.Printf("DEBUG:   - %s at %s\n", binary.Name, binary.Path)
	}

	// Warn if we didn't find all expected binaries
	foundNames := make(map[string]bool)
	for _, b := range binaries {
		foundNames[b.Name] = true
	}
	for _, expected := range expectedNames {
		if !foundNames[expected] {
			fmt.Printf("WARNING: Expected binary not found: %s\n", expected)
		}
	}

	return binaries
}

// contains checks if a slice contains a string
func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

// syncManifest syncs the manifest from GitHub
func syncManifest() error {
	fmt.Println("Syncing manifest from GitHub...")

	manifestURL := fmt.Sprintf("%s/raw/main/manifest.json", RepoURL)

	resp, err := http.Get(manifestURL)
	if err != nil {
		return fmt.Errorf("failed to download manifest: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to download manifest: HTTP %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read manifest: %w", err)
	}

	if err := os.WriteFile(manifestPath, data, 0644); err != nil {
		return fmt.Errorf("failed to save manifest: %w", err)
	}

	fmt.Println("Manifest synced successfully!")
	return nil
}

// installPackage installs a package
func installPackage(name string) error {
	fmt.Printf("Installing package: %s\n", name)

	// Check if manifest exists
	if !fileExists(manifestPath) {
		fmt.Fprintf(os.Stderr, "Error: manifest.json not found at %s\n", manifestPath)
		fmt.Fprintln(os.Stderr, "Run 'binrex sync' to download the manifest.")
		return fmt.Errorf("manifest not found")
	}

	// Find package in manifest
	pkg, err := findPackage(name)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: Package '%s' not found in manifest\n", name)
		return err
	}

	fmt.Printf("\nPackage: %s\n", pkg.Name)
	fmt.Printf("Version: %s\n", pkg.BinaryVersion)
	fmt.Printf("Description: %s\n", pkg.Description)
	fmt.Printf("Repository: %s\n", pkg.RepoURL)
	fmt.Printf("OS: %s\n", pkg.OSSupported)
	fmt.Printf("Required tools: %s\n", pkg.RequiredTools)
	fmt.Printf("Total binaries: %s\n", pkg.TotalBinInstalled)
	if len(pkg.Keywords) > 0 {
		fmt.Printf("Keywords: %s\n", strings.Join(pkg.Keywords, ", "))
	}
	fmt.Println()

	// Check OS compatibility
	currentOS := getOSName()
	if !strings.Contains(pkg.OSSupported, currentOS) && pkg.OSSupported != "all" {
		fmt.Fprintf(os.Stderr, "Error: Package not supported on %s\n", currentOS)
		fmt.Fprintf(os.Stderr, "Supported OS: %s\n", pkg.OSSupported)
		return fmt.Errorf("unsupported OS")
	}

	// Check required tools
	if !checkRequiredTools(pkg.RequiredTools) {
		fmt.Fprintln(os.Stderr, "\nError: Missing required tools!")
		fmt.Fprintln(os.Stderr, "Please install the required tools using your system package manager.")
		return fmt.Errorf("missing required tools")
	}

	// Check if already installed
	installedData, _ := loadInstalled()
	for _, instPkg := range installedData.Installed {
		if instPkg.Name == name {
			fmt.Printf("Package '%s' is already installed. Use 'update' to update it.\n", name)
			return nil
		}
	}

	// Clone or update the package's repository
	repoPath, err := cloneOrUpdateRepo(pkg.RepoURL)
	if err != nil {
		return err
	}

	// Determine build path
	buildPath := repoPath
	if pkg.BuildDir != "" {
		buildPath = filepath.Join(repoPath, pkg.BuildDir)
	} else if pkg.BinFolder != "" {
		buildPath = filepath.Join(repoPath, pkg.BinFolder)
	}

	// Remove any mv commands from build_commands
	buildCmd := pkg.BuildCommands
	if strings.Contains(buildCmd, "mv") && strings.Contains(buildCmd, binDir) {
		parts := strings.Split(buildCmd, "&&")
		if len(parts) > 0 {
			buildCmd = strings.TrimSpace(parts[0])
		}
	}

	// Clean before building (if cargo project)
	if strings.Contains(buildCmd, "cargo") {
		fmt.Println("Cleaning previous build...")
		cleanCmd := fmt.Sprintf("cd %s && cargo clean", buildPath)
		runCommandSilent(cleanCmd)
	}

	fmt.Println("Building...")
	cmd := fmt.Sprintf("cd %s && %s", buildPath, buildCmd)
	if err := runCommand(cmd); err != nil {
		fmt.Fprintln(os.Stderr, "Error: Build failed")
		return err
	}

	if !fileExists(buildPath) {
		fmt.Fprintf(os.Stderr, "Error: Build path not found: %s\n", buildPath)
		return fmt.Errorf("build path not found")
	}

	fmt.Printf("\nBuild path: %s\n", buildPath)
	fmt.Println("Building package...")

	// Find all binaries in the build directory
	fmt.Println("\nSearching for built binaries...")
	foundBinaries := findBinariesInBuildPath(buildPath, pkg)

	// Check BuildDirExist - if false, we expect binaries to be found
	// if true, the install script handles binary placement
	if !pkg.BuildDirExist {
		if len(foundBinaries) == 0 {
			fmt.Fprintln(os.Stderr, "Error: No binaries found after build")
			fmt.Fprintf(os.Stderr, "Searched in: %s\n", buildPath)
			return fmt.Errorf("no binaries found")
		}

		fmt.Printf("Found %d binary file(s):\n", len(foundBinaries))
		for _, binary := range foundBinaries {
			fmt.Printf("  - %s at %s\n", binary.Name, binary.Path)
		}

		// Copy all binaries to bin_dir
		fmt.Printf("\nInstalling binaries to %s...\n", binDir)
		var installedBinaries []string

		fmt.Printf("DEBUG: About to install %d binaries\n", len(foundBinaries))

		for i, binary := range foundBinaries {
			src := binary.Path
			dst := filepath.Join(binDir, binary.Name)

			fmt.Printf("DEBUG: [%d/%d] Copying %s -> %s\n", i+1, len(foundBinaries), src, dst)

			if !fileExists(src) {
				fmt.Fprintf(os.Stderr, "ERROR: Source file does not exist: %s\n", src)
				continue
			}

			// Copy file
			if err := copyFile(src, dst); err != nil {
				fmt.Fprintf(os.Stderr, "Warning: Failed to install %s: %v\n", binary.Name, err)
				continue
			}

			// Make executable
			if err := os.Chmod(dst, 0755); err != nil {
				fmt.Fprintf(os.Stderr, "Warning: Failed to make %s executable: %v\n", binary.Name, err)
			}

			installedBinaries = append(installedBinaries, dst)
			fmt.Printf("✓ Installed: %s\n", dst)
		}

		fmt.Printf("\nDEBUG: Final installed_binaries count: %d\n", len(installedBinaries))

		if len(installedBinaries) == 0 {
			fmt.Fprintln(os.Stderr, "Error: No binaries were installed")
			return fmt.Errorf("no binaries installed")
		}

		// Update installed.json
		date := getCurrentDate()
		installedData, _ = loadInstalled()

		newEntry := InstalledPackage{
			Name:          name,
			Version:       pkg.BinaryVersion,
			BinaryPaths:   installedBinaries,
			RepoPath:      repoPath,
			InstallDate:   date,
			TotalBinaries: len(installedBinaries),
		}

		installedData.Installed = append(installedData.Installed, newEntry)

		if err := saveInstalled(installedData); err != nil {
			fmt.Fprintln(os.Stderr, "Warning: Failed to update installed.json")
		}

		fmt.Printf("\n✓ Successfully installed %s!\n", name)
		fmt.Printf("  Version: %s\n", pkg.BinaryVersion)
		fmt.Printf("  Repository: %s\n", pkg.RepoURL)
		fmt.Printf("  Binaries installed: %d\n", len(installedBinaries))
		for _, binary := range installedBinaries {
			fmt.Printf("    - %s\n", binary)
		}
	} else {
		// BuildDirExist is true - install script handles binary installation
		fmt.Println("\nNote: This package uses an install script for binary placement.")
		fmt.Println("Binaries should be installed by the build script.")

		// Update installed.json without binary paths
		date := getCurrentDate()
		installedData, _ = loadInstalled()

		newEntry := InstalledPackage{
			Name:          name,
			Version:       pkg.BinaryVersion,
			BinaryPaths:   []string{}, // Empty as install script handles it
			RepoPath:      repoPath,
			InstallDate:   date,
			TotalBinaries: 0,
		}

		installedData.Installed = append(installedData.Installed, newEntry)

		if err := saveInstalled(installedData); err != nil {
			fmt.Fprintln(os.Stderr, "Warning: Failed to update installed.json")
		}

		fmt.Printf("\n✓ Successfully installed %s!\n", name)
		fmt.Printf("  Version: %s\n", pkg.BinaryVersion)
		fmt.Printf("  Repository: %s\n", pkg.RepoURL)
		fmt.Println("  Note: Binaries managed by install script")
	}

	return nil
}

// installAll installs all the package available in manifest.json
func installAll() error {
	fmt.Println("Installing all packages from manifest...")

	// Check if manifest exists
	if !fileExists(manifestPath) {
		fmt.Fprintf(os.Stderr, "Error: manifest.json not found at %s\n", manifestPath)
		fmt.Fprintln(os.Stderr, "Run 'binrex sync' to download the manifest.")
		return fmt.Errorf("manifest not found")
	}

	// Load manifest
	manifest, err := loadManifest()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: Failed to load manifest: %v\n", err)
		return err
	}

	// Get already installed packages
	installedData, _ := loadInstalled()
	installedMap := make(map[string]bool)
	for _, pkg := range installedData.Installed {
		installedMap[pkg.Name] = true
	}

	// Filter packages to install
	var toInstall []Package
	currentOS := getOSName()

	for _, pkg := range manifest.Packages {
		// Skip if already installed
		if installedMap[pkg.Name] {
			fmt.Printf("Skipping %s (already installed)\n", pkg.Name)
			continue
		}

		// Skip if OS not supported
		if !strings.Contains(pkg.OSSupported, currentOS) && pkg.OSSupported != "all" {
			fmt.Printf("Skipping %s (not supported on %s)\n", pkg.Name, currentOS)
			continue
		}

		// Check required tools
		if !checkRequiredTools(pkg.RequiredTools) {
			fmt.Printf("Skipping %s (missing required tools: %s)\n", pkg.Name, pkg.RequiredTools)
			continue
		}

		toInstall = append(toInstall, pkg)
	}

	if len(toInstall) == 0 {
		fmt.Println("No packages to install.")
		return nil
	}

	fmt.Printf("\nFound %d package(s) to install:\n", len(toInstall))
	for _, pkg := range toInstall {
		fmt.Printf("  - %s (%s)\n", pkg.Name, pkg.BinaryVersion)
	}
	fmt.Println()

	// Install each package by recursively calling installPackage
	successCount := 0
	failCount := 0

	for i, pkg := range toInstall {
		fmt.Printf("\n[%d/%d] Installing %s...\n", i+1, len(toInstall), pkg.Name)
		fmt.Println(strings.Repeat("=", 60))

		// Recursively call installPackage for each package in manifest
		if err := installPackage(pkg.Name); err != nil {
			fmt.Fprintf(os.Stderr, "✗ Failed to install %s: %v\n", pkg.Name, err)
			failCount++
		} else {
			successCount++
		}
	}

	// Summary
	fmt.Println("\n" + strings.Repeat("=", 60))
	fmt.Println("Installation Summary:")
	fmt.Printf("  ✓ Successfully installed: %d\n", successCount)
	if failCount > 0 {
		fmt.Printf("  ✗ Failed: %d\n", failCount)
	}

	if failCount > 0 {
		return fmt.Errorf("some packages failed to install")
	}

	return nil
}

// copyFile copies a file from src to dst
func copyFile(src, dst string) error {
	sourceFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer sourceFile.Close()

	destFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer destFile.Close()

	if _, err := io.Copy(destFile, sourceFile); err != nil {
		return err
	}

	// Copy permissions
	srcInfo, err := os.Stat(src)
	if err != nil {
		return err
	}

	return os.Chmod(dst, srcInfo.Mode())
}

// removePackage removes an installed package
func removePackage(name string) error {
	fmt.Printf("Removing package: %s\n", name)

	installedData, _ := loadInstalled()
	var pkgToRemove *InstalledPackage
	var remainingPackages []InstalledPackage

	for i, pkg := range installedData.Installed {
		if pkg.Name == name {
			pkgToRemove = &installedData.Installed[i]
		} else {
			remainingPackages = append(remainingPackages, pkg)
		}
	}

	if pkgToRemove == nil {
		fmt.Fprintf(os.Stderr, "Package '%s' is not installed\n", name)
		return fmt.Errorf("package not installed")
	}

	// Remove all binaries
	removedCount := 0
	for _, binaryPath := range pkgToRemove.BinaryPaths {
		if fileExists(binaryPath) {
			if err := os.Remove(binaryPath); err != nil {
				fmt.Fprintf(os.Stderr, "Error removing binary %s: %v\n", binaryPath, err)
			} else {
				fmt.Printf("✓ Removed binary: %s\n", binaryPath)
				removedCount++
			}
		} else {
			fmt.Printf("Binary not found: %s\n", binaryPath)
		}
	}

	// Update installed.json
	installedData.Installed = remainingPackages
	if err := saveInstalled(installedData); err != nil {
		fmt.Fprintln(os.Stderr, "Warning: Failed to update installed.json")
	} else {
		fmt.Printf("\n✓ Package '%s' removed successfully.\n", name)
		fmt.Printf("  Binaries removed: %d/%d\n", removedCount, len(pkgToRemove.BinaryPaths))
	}

	return nil
}

// listPackages lists all installed packages
func listPackages() {
	fmt.Println("Installed packages:")
	fmt.Println("-------------------")

	installedData, _ := loadInstalled()

	if len(installedData.Installed) == 0 {
		fmt.Println("  (none)")
	} else {
		for _, pkg := range installedData.Installed {
			fmt.Printf("  • %s (v%s)\n", pkg.Name, pkg.Version)
			fmt.Printf("    Binaries: %d\n", pkg.TotalBinaries)
			fmt.Printf("    Installed: %s\n", pkg.InstallDate)
			fmt.Printf("    Repo: %s\n", pkg.RepoPath)

			if len(pkg.BinaryPaths) > 0 {
				for _, bp := range pkg.BinaryPaths {
					fmt.Printf("      - %s\n", bp)
				}
			}
		}
	}

	fmt.Printf("\nTotal: %d package(s)\n", len(installedData.Installed))
}

// updatePackage updates an installed package
func updatePackage(name string) error {
	fmt.Printf("Updating package: %s\n", name)

	installedData, _ := loadInstalled()
	found := false

	for _, pkg := range installedData.Installed {
		if pkg.Name == name {
			found = true
			break
		}
	}

	if !found {
		fmt.Fprintf(os.Stderr, "Package '%s' is not installed. Installing new...\n", name)
		return installPackage(name)
	}

	// Get package info from manifest
	manifestPkg, err := findPackage(name)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: Package '%s' not found in manifest\n", name)
		return err
	}

	// Remove old version
	fmt.Println("Removing old version...")
	removePackage(name)

	// Update repository
	repoPath := getRepoCachePath(manifestPkg.RepoURL)
	if fileExists(repoPath) {
		cmd := fmt.Sprintf("cd %s && git pull", repoPath)
		fmt.Println("\nPulling latest changes...")
		runCommand(cmd)
	}

	// Install new version
	fmt.Println("\nInstalling updated version...")
	return installPackage(name)
}

// searchPackages searches for packages in the manifest
func searchPackages(keyword string) {
	fmt.Printf("Searching for: %s\n", keyword)
	fmt.Println("-------------------")

	if !fileExists(manifestPath) {
		fmt.Fprintln(os.Stderr, "Error: manifest.json not found")
		fmt.Fprintln(os.Stderr, "Run 'binrex sync' first")
		return
	}

	manifest, err := loadManifest()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error loading manifest: %v\n", err)
		return
	}

	keywordLower := strings.ToLower(keyword)
	count := 0

	for _, pkg := range manifest.Packages {
		searchText := strings.ToLower(fmt.Sprintf("%s %s %s",
			pkg.Name, pkg.Description, strings.Join(pkg.Keywords, " ")))

		if strings.Contains(searchText, keywordLower) {
			fmt.Printf("  • %s", pkg.Name)
			if pkg.Description != "" {
				fmt.Printf(" - %s", pkg.Description)
			}
			if pkg.BinaryVersion != "" {
				fmt.Printf(" (v%s)", pkg.BinaryVersion)
			}
			fmt.Println()

			if len(pkg.Keywords) > 0 {
				fmt.Printf("    Keywords: %s\n", strings.Join(pkg.Keywords, ", "))
			}
			count++
		}
	}

	if count == 0 {
		fmt.Println("  (none found)")
	}

	fmt.Printf("\nFound: %d package(s)\n", count)
}

// printUsage prints usage information
func printUsage(prog string) {
	fmt.Println("Binrex - Simple Binary Package Manager\n")
	fmt.Printf("Usage: %s <command> [package_name]\n\n", prog)
	fmt.Println("Commands:")
	fmt.Println("  sync            - Sync manifest from GitHub")
	fmt.Println("  install <name>  - Install a package")
	fmt.Println("  install -a  - Installs all packages in manifest.json")
	fmt.Println("  remove <name>   - Remove a package")
	fmt.Println("  list            - List installed packages")
	fmt.Println("  update <name>   - Update a package")
	fmt.Println("  search <query>  - Search for packages")
	fmt.Println("  help            - Show this help")
}

func main() {
	exitCode := run()
	os.Exit(exitCode)
}

func run() int {
	if len(os.Args) < 2 {
		printUsage(os.Args[0])
		return 1
	}

	if err := initPaths(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		return 1
	}

	if err := createDirectories(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		return 1
	}

	cmd := os.Args[1]

	switch cmd {
	case "sync":
		if err := syncManifest(); err != nil {
			return 1
		}
		return 0
	case "version":
		fmt.Println("0.1.4")
	case "install":
		if len(os.Args) < 3 {
			fmt.Fprintln(os.Stderr, "Error: package name required")
			return 1
		}
		if os.Args[2] == "-a" {
			installAll()
		}
		if err := installPackage(os.Args[2]); err != nil {
			return 1
		}
		return 0
	case "remove":
		if len(os.Args) < 3 {
			fmt.Fprintln(os.Stderr, "Error: package name required")
			return 1
		}
		if err := removePackage(os.Args[2]); err != nil {
			return 1
		}
		return 0
	case "list":
		listPackages()
		return 0
	case "update":
		if len(os.Args) < 3 {
			fmt.Fprintln(os.Stderr, "Error: package name required")
			return 1
		}
		if err := updatePackage(os.Args[2]); err != nil {
			return 1
		}
		return 0
	case "search":
		if len(os.Args) < 3 {
			fmt.Fprintln(os.Stderr, "Error: search keyword required")
			return 1
		}
		searchPackages(os.Args[2])
		return 0
	case "help":
		printUsage(os.Args[0])
		return 0
	default:
		fmt.Fprintf(os.Stderr, "Unknown command: %s\n", cmd)
		printUsage(os.Args[0])
		return 1
	}

	return 0
}
