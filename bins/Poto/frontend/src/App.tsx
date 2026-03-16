// Copyright (C) 2026 Dawood Khan
// SPDX-License-Identifier: GPL-3.0-or-later

// Maintainer Dawood (Nurysso) contact - nurysso [at] proton.me

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileImage,
  Filter,
  Folder,
  FolderOpen,
  Grid3x3,
  HelpCircle,
  Image,
  Image as ImageIcon,
  List,
  Maximize2,
  Moon,
  Play,
  RotateCw,
  Search,
  SortAsc,
  Sparkles,
  Sun,
  Video,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import HelpDialog from './components/HelpDialloge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/select';

// Import Wails types
import { main } from '../wailsjs/go/models';

// Wails imports - will be loaded dynamically
let StartScan: (path: string) => Promise<void>;
let StopScan: () => Promise<void>;
let GetHomeDirectory: () => Promise<string>;
let IsScanning: () => Promise<boolean>;
let SelectDirectory: () => Promise<string>;
let GetCommonDirectories: () => Promise<Record<string, string>>;
let GetConfig: () => Promise<main.Config>;
let GetGtkColors: () => Promise<Record<string, string>>;
let GetSudoMode: () => Promise<boolean>;
// let UpdateConfig: (config: main.Config) => Promise<void>;
let PlayWithMPV: (path: string) => Promise<void>;
// let FilterMedia: (filter: main.FilterOptions) => Promise<main.MediaFile[]>;
// let GetAllMedia: () => Promise<main.MediaFile[]>;
let EventsOn: (eventName: string, callback: (...args: any[]) => void) => void;
let EventsOff: (eventName: string) => void;

// UI-friendly interfaces
interface MediaFile {
  path: string;
  name: string;
  size: number;
  type: string;
  thumbnail?: string;
  modifiedTime: string;
  parentFolder: string;
}

interface ScanProgress {
  scannedFiles: number;
  foundMedia: number;
  currentPath: string;
  isComplete: boolean;
}

interface LocalFilterOptions {
  folderPath: string;
  mediaType: string;
  fromDate: string;
  toDate: string;
  searchTerm: string;
}

function App() {
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [filteredFiles, setFilteredFiles] = useState<MediaFile[]>([]);
  const [scanProgress, setScanProgress] = useState<ScanProgress>({
    scannedFiles: 0,
    foundMedia: 0,
    currentPath: '',
    isComplete: false,
  });
  const [showHelp, setShowHelp] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanPath, setScanPath] = useState('');
  const [filter, setFilter] = useState<'all' | 'image' | 'video'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [commonDirs, setCommonDirs] = useState<Record<string, string>>({});
  const [selectedMedia, setSelectedMedia] = useState<MediaFile | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'type' | 'date'>('name');
  const [config, setConfig] = useState<main.Config | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filterOptions, setFilterOptions] = useState({
    folderPath: '',
    fromDate: '',
    toDate: '',
  });
  const [newScanDir, setNewScanDir] = useState('');
  const [newIgnorePattern, setNewIgnorePattern] = useState('');
  const [selectedFolder, setSelectedFolder] = useState('');
  const [folderRule, setFolderRule] = useState<main.FolderRule>({
    allowed_subfolders: [],
    blocked_subfolders: [],
    scan_recursively: true,
  });
  const [wailsLoaded, setWailsLoaded] = useState(false);
  const [sudoMode, setSudoMode] = useState(false);

  // Full-screen image viewer states
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);

  const isDark = theme === 'dark';

  // Helper function to convert Wails MediaFile to UI MediaFile
  const convertMediaFile = (wailsMedia: main.MediaFile): MediaFile => ({
    path: wailsMedia.path,
    name: wailsMedia.name,
    size: wailsMedia.size,
    type: wailsMedia.type,
    thumbnail: wailsMedia.thumbnail,
    modifiedTime: wailsMedia.modifiedTime?.toString() || '',
    parentFolder: wailsMedia.parentFolder,
  });

  // Load Wails bindings
  useEffect(() => {
    const loadWails = async () => {
      try {
        const wailsApp = await import('../wailsjs/go/main/App.js');
        const wailsRuntime = await import('../wailsjs/runtime/runtime.js');

        StartScan = wailsApp.StartScan;
        StopScan = wailsApp.StopScan;
        GetHomeDirectory = wailsApp.GetHomeDirectory;
        IsScanning = wailsApp.IsScanning;
        SelectDirectory = wailsApp.SelectDirectory;
        GetCommonDirectories = wailsApp.GetCommonDirectories;
        GetConfig = wailsApp.GetConfig;
        // @ts-ignore
        GetGtkColors = wailsApp.GetGtkColors;
        // @ts-ignore
        GetSudoMode = wailsApp.GetSudoMode;

        try {
          if (GetGtkColors) {
            const colors = await GetGtkColors();
            if (colors && Object.keys(colors).length > 0) {
              Object.entries(colors).forEach(([key, value]) => {
                document.documentElement.style.setProperty(
                  `--gtk-${key.replace(/_/g, '-')}`,
                  value as string
                );
              });
            }
          }
        } catch (e) {
          console.error('Failed to load GTK colors from Wails:', e);
        }

        // UpdateConfig = wailsApp.UpdateConfig;
        PlayWithMPV = wailsApp.PlayWithMPV;
        EventsOn = wailsRuntime.EventsOn;
        EventsOff = wailsRuntime.EventsOff;

        setWailsLoaded(true);

        const home = await GetHomeDirectory();
        setScanPath(home);

        const dirs = await GetCommonDirectories();
        setCommonDirs(dirs);

        const cfg = await GetConfig();
        setConfig(cfg);

        const sudo = await GetSudoMode();
        setSudoMode(sudo);

        // Set up event listeners
        EventsOn('mediaFound', (batch: main.MediaFile[]) => {
          setMediaFiles((prev) => {
            const pathSet = new Set(prev.map((m) => m.path));
            const converted = batch.map(convertMediaFile);
            const uniqueNew = converted.filter((m) => !pathSet.has(m.path));
            return [...prev, ...uniqueNew];
          });
        });

        EventsOn('scanProgress', (progress: ScanProgress) => {
          setScanProgress(progress);
          if (progress.isComplete) {
            setIsScanning(false);
          }
        });

        EventsOn('scanError', (error: string) => {
          console.error('Scan error:', error);
          alert(`Scan error: ${error}`);
        });

        const scanning = await IsScanning();
        setIsScanning(scanning);
      } catch (err) {
        console.error('Failed to load Wails:', err);
      }
    };

    loadWails();

    return () => {
      if (EventsOff) {
        EventsOff('mediaFound');
        EventsOff('scanProgress');
        EventsOff('scanError');
      }
    };
  }, []);

  // Filter and sort media
  useEffect(() => {
    let filtered = [...mediaFiles];

    if (filter !== 'all') {
      filtered = filtered.filter((m) => m.type === filter);
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (m) => m.name.toLowerCase().includes(term) || m.path.toLowerCase().includes(term)
      );
    }

    if (filterOptions.folderPath) {
      filtered = filtered.filter((m) => m.path.startsWith(filterOptions.folderPath));
    }

    if (filterOptions.fromDate) {
      filtered = filtered.filter(
        (m) => new Date(m.modifiedTime) >= new Date(filterOptions.fromDate)
      );
    }

    if (filterOptions.toDate) {
      filtered = filtered.filter((m) => new Date(m.modifiedTime) <= new Date(filterOptions.toDate));
    }

    filtered.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'size') return b.size - a.size;
      if (sortBy === 'type') return a.type.localeCompare(b.type);
      if (sortBy === 'date')
        return new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime();
      return 0;
    });

    setFilteredFiles(filtered);
  }, [mediaFiles, filter, searchTerm, sortBy, filterOptions]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedMedia && !isFullscreen) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateMedia('prev');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigateMedia('next');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (isFullscreen) {
          setIsFullscreen(false);
          setRotation(0);
          setZoom(1);
        } else {
          setSelectedMedia(null);
        }
      } else if (e.key === 'r' && isFullscreen) {
        e.preventDefault();
        setRotation((prev) => (prev + 90) % 360);
      } else if (e.key === '+' && isFullscreen) {
        e.preventDefault();
        setZoom((prev) => Math.min(prev + 0.25, 3));
      } else if (e.key === '-' && isFullscreen) {
        e.preventDefault();
        setZoom((prev) => Math.max(prev - 0.25, 0.5));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedMedia, filteredFiles, isFullscreen]);

  const handleStartScan = async () => {
    if (!wailsLoaded || !StartScan) return;

    try {
      setMediaFiles([]);
      setScanProgress({ scannedFiles: 0, foundMedia: 0, currentPath: '', isComplete: false });
      setIsScanning(true);
      await StartScan(scanPath);

      const scanning = await IsScanning();
      setIsScanning(scanning);
    } catch (err) {
      console.error('Failed to start scan:', err);
      alert('Failed to start scan: ' + err);
      setIsScanning(false);
    }
  };

  const handleStopScan = async () => {
    if (!wailsLoaded || !StopScan) return;

    try {
      await StopScan();
      setIsScanning(false);
    } catch (err) {
      console.error('Failed to stop scan:', err);
    }
  };

  const handleBrowseDirectory = async () => {
    if (!wailsLoaded || !SelectDirectory) return;

    try {
      const path = await SelectDirectory();
      if (path) setScanPath(path);
    } catch (err) {
      console.error('Failed to browse directory:', err);
    }
  };

  const handlePlayWithMPV = async (media: MediaFile) => {
    if (!wailsLoaded || !PlayWithMPV || !config?.video.enable_mpv) return;

    try {
      await PlayWithMPV(media.path);
    } catch (err) {
      console.error('Failed to play with MPV:', err);
      alert('Failed to play with MPV. Make sure MPV is installed and configured.');
    }
  };

  const openFullscreen = (media: MediaFile) => {
    if (media.type === 'image') {
      setSelectedMedia(media);
      setIsFullscreen(true);
      setRotation(0);
      setZoom(1);
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (dateStr: string): string => {
    return new Date(dateStr).toLocaleDateString();
  };

  const navigateMedia = (direction: 'prev' | 'next') => {
    if (!selectedMedia) return;
    const currentIndex = filteredFiles.findIndex((m) => m.path === selectedMedia.path);
    if (currentIndex === -1) return;

    let newIndex =
      direction === 'prev'
        ? currentIndex > 0
          ? currentIndex - 1
          : filteredFiles.length - 1
        : currentIndex < filteredFiles.length - 1
          ? currentIndex + 1
          : 0;

    setSelectedMedia(filteredFiles[newIndex]);
    if (isFullscreen) {
      setRotation(0);
      setZoom(1);
    }
  };

  const imageCount = mediaFiles.filter((m) => m.type === 'image').length;
  const videoCount = mediaFiles.filter((m) => m.type === 'video').length;

  const bg = 'bg-gtk-window-bg';
  const cardBg = 'bg-gtk-card-bg';
  const border = isDark ? 'border-white/10' : 'border-black/10';
  const text = 'text-gtk-window-fg';
  const textMuted = 'text-gtk-window-fg/70';
  const hover = isDark ? 'hover:bg-white/10' : 'hover:bg-black/5';
  const inputBg = 'bg-gtk-view-bg';
  const inputBorder = isDark ? 'border-white/20' : 'border-black/20';

  return (
    <>
    <div
      className={`h-screen flex items-stretch ${bg} ${text} overflow-hidden transition-colors duration-300 font-sans`}
    >
      {/* Sidebar (Left) */}
      <div
        className={`w-72 flex-shrink-0 flex flex-col bg-gtk-headerbar-bg border-r ${border} shadow-lg z-20`}
      >
        {/* Logo and Title */}
        <div className="flex items-center gap-3 px-5 py-6">
          <div
            className={`w-10 h-10 rounded-xl bg-gtk-accent-bg flex items-center justify-center shadow-md`}
          >
            <Image size={20} className="text-gtk-accent-fg" />
          </div>
          <h1 className={`text-xl font-bold text-gtk-headerbar-fg tracking-tight`}>Poto Scanner</h1>
        </div>

        {/* Primary Navigation (Filters) */}
        <div className="px-4 mb-8 space-y-1">
          <button
            onClick={() => setFilter('all')}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${filter === 'all'
              ? 'bg-black/10 dark:bg-white/10 text-gtk-headerbar-fg'
              : 'text-gtk-headerbar-fg/70 hover:bg-black/5 dark:hover:bg-white/5 hover:text-gtk-headerbar-fg'
              }`}
          >
            <div className="flex items-center gap-2.5">
              <Grid3x3 size={18} className={filter === 'all' ? 'text-gtk-accent-bg' : ''} />
              <span>All Media</span>
            </div>
            <span className="text-xs font-semibold bg-black/10 dark:bg-white/10 px-2 py-0.5 rounded-full">
              {mediaFiles.length}
            </span>
          </button>

          <button
            onClick={() => setFilter('image')}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${filter === 'image'
              ? 'bg-black/10 dark:bg-white/10 text-gtk-headerbar-fg'
              : 'text-gtk-headerbar-fg/70 hover:bg-black/5 dark:hover:bg-white/5 hover:text-gtk-headerbar-fg'
              }`}
          >
            <div className="flex items-center gap-2.5">
              <ImageIcon size={18} className={filter === 'image' ? 'text-gtk-accent-bg' : ''} />
              <span>Images</span>
            </div>
            <span className="text-xs font-semibold bg-black/10 dark:bg-white/10 px-2 py-0.5 rounded-full">
              {imageCount}
            </span>
          </button>

          <button
            onClick={() => setFilter('video')}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${filter === 'video'
              ? 'bg-black/10 dark:bg-white/10 text-gtk-headerbar-fg'
              : 'text-gtk-headerbar-fg/70 hover:bg-black/5 dark:hover:bg-white/5 hover:text-gtk-headerbar-fg'
              }`}
          >
            <div className="flex items-center gap-2.5">
              <Video size={18} className={filter === 'video' ? 'text-gtk-accent-bg' : ''} />
              <span>Videos</span>
            </div>
            <span className="text-xs font-semibold bg-black/10 dark:bg-white/10 px-2 py-0.5 rounded-full">
              {videoCount}
            </span>
          </button>
        </div>

        {/* Scan Controls Box */}
        <div className="px-4 mb-4 flex-1">
          <div className="bg-black/5 dark:bg-white/5 rounded-2xl p-4 shadow-inner border border-black/5 dark:border-white/5">
            <h2 className="text-xs font-bold text-gtk-headerbar-fg/50 uppercase tracking-wider mb-3 px-1">
              Scanner
            </h2>

            <div className="space-y-3">
              {sudoMode ||
                (config &&
                  config.scanner.scan_directories &&
                  config.scanner.scan_directories.length === 0) ? (
                // Sudo Mode OR No Restrictions: Free entry + Browse via standard input
                <div className="space-y-2">
                  <div className="relative group">
                    <FolderOpen
                      className={`absolute left-3 top-1/2 transform -translate-y-1/2 text-gtk-headerbar-fg/40`}
                      size={16}
                    />
                    <input
                      type="text"
                      value={scanPath}
                      onChange={(e) => setScanPath(e.target.value)}
                      disabled={isScanning}
                      title={scanPath}
                      placeholder="Enter path..."
                      className={`w-full pl-9 pr-3 py-2 bg-white/10 dark:bg-black/20 border border-black/10 dark:border-white/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gtk-accent-bg transition-all disabled:opacity-60 text-gtk-headerbar-fg`}
                    />
                  </div>
                  <button
                    onClick={handleBrowseDirectory}
                    disabled={isScanning}
                    className="w-full py-2 bg-white/10 dark:bg-black/20 hover:bg-white/20 dark:hover:bg-black/40 border border-black/10 dark:border-white/10 rounded-lg text-sm font-medium transition-all disabled:opacity-50 text-gtk-headerbar-fg"
                  >
                    Browse Folder...
                  </button>
                </div>
              ) : (
                // Restricted Mode: Show allowed directories as a dropdown/select
                <div className="space-y-2">
                  <p className="text-xs text-gtk-headerbar-fg/60 px-1">
                    Restricted mode: select from allowed folders.
                  </p>
                  <Select value={scanPath} onValueChange={setScanPath} disabled={isScanning}>
                    <SelectTrigger className="w-full bg-white/10 dark:bg-black/20 border-black/10 dark:border-white/10 text-gtk-headerbar-fg rounded-lg h-9">
                      <SelectValue placeholder="Select folder..." />
                    </SelectTrigger>
                    <SelectContent className="bg-gtk-popover-bg border-gtk-window-bg shadow-xl rounded-xl z-50">
                      {config?.scanner.scan_directories.map((dir) => (
                        <SelectItem
                          key={dir}
                          value={dir}
                          className="hover:bg-gtk-hover-bg focus:bg-gtk-hover-bg rounded-lg cursor-pointer text-sm"
                        >
                          {dir}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Action Button */}
              {isScanning ? (
                <button
                  onClick={handleStopScan}
                  className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-all flex items-center justify-center gap-2 text-sm font-semibold shadow-md mt-4"
                >
                  <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                  Stop Scan
                </button>
              ) : (
                <button
                  onClick={handleStartScan}
                  disabled={!wailsLoaded || !scanPath}
                  className="w-full py-2.5 bg-gtk-accent-bg hover:opacity-90 text-gtk-accent-fg rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm font-semibold shadow-md mt-4"
                >
                  <Sparkles size={16} />
                  Start Scan
                </button>
              )}
            </div>

            {sudoMode && (
              <div className="mt-4 flex items-center justify-center gap-1.5 text-xs font-semibold text-yellow-500 bg-yellow-500/10 py-1.5 rounded-md px-2">
                <Sparkles size={12} />
                Running in Sudo Mode
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Footer (Settings / Contexts) */}
        <div className="p-4 border-t border-black/10 dark:border-white/10 flex justify-between">
          <button
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className={`p-2.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-all text-gtk-headerbar-fg/80 hover:text-gtk-headerbar-fg`}
            title="Toggle Theme"
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          <button
            onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
            className={`p-2.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-all text-gtk-headerbar-fg/80 hover:text-gtk-headerbar-fg`}
            title={viewMode === 'grid' ? 'Switch to List View' : 'Switch to Grid View'}
          >
            {viewMode === 'grid' ? <List size={18} /> : <Grid3x3 size={18} />}
          </button>

          <button
            onClick={() => setShowHelp(true)}
            className={`p-2.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-all text-gtk-headerbar-fg/80 hover:text-gtk-headerbar-fg`}
            title="Help & Configuration"
          >
            <HelpCircle size={18} />
          </button>
          <HelpDialog isOpen={showHelp} onClose={() => setShowHelp(false)} isDark={isDark} />
        </div>
      </div>

      {/* Main View Area (Right) */}
      <div className="flex-1 flex flex-col min-h-0 bg-gtk-window-bg relative">
        {/* Top Header of Main View */}
        <div
          className={`px-6 py-4 flex items-center justify-between z-10 sticky top-0 bg-gtk-window-bg/80 backdrop-blur-md border-b ${border}`}
        >
          {/* Central Search */}
          <div className="flex-1 max-w-lg relative">
            <Search
              className={`absolute left-3 top-1/2 transform -translate-y-1/2 text-gtk-window-fg/50`}
              size={16}
            />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by name or path..."
              className={`w-full pl-9 pr-4 py-2 bg-gtk-view-bg border border-black/10 dark:border-white/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gtk-accent-bg transition-all shadow-sm`}
            />
          </div>

          <div className="flex items-center gap-3">
            {/* Sort Select */}
            <div className="flex items-center gap-2">
              <SortAsc size={16} className="text-gtk-window-fg/50 mr-1" />
              <Select value={sortBy} onValueChange={(val: any) => setSortBy(val)}>
                <SelectTrigger className="w-[130px] bg-gtk-view-bg border-black/10 dark:border-white/10 rounded-lg text-sm h-9">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent className="bg-gtk-popover-bg border-gtk-window-bg shadow-xl rounded-xl z-50">
                  <SelectItem
                    value="name"
                    className="hover:bg-gtk-hover-bg rounded-lg cursor-pointer"
                  >
                    Name
                  </SelectItem>
                  <SelectItem
                    value="date"
                    className="hover:bg-gtk-hover-bg rounded-lg cursor-pointer"
                  >
                    Date
                  </SelectItem>
                  <SelectItem
                    value="size"
                    className="hover:bg-gtk-hover-bg rounded-lg cursor-pointer"
                  >
                    Size
                  </SelectItem>
                  <SelectItem
                    value="type"
                    className="hover:bg-gtk-hover-bg rounded-lg cursor-pointer"
                  >
                    Type
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Adv. Filter Reveal */}
            <button
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${showAdvancedFilters
                ? 'bg-gtk-accent-bg text-gtk-accent-fg'
                : 'bg-black/5 dark:bg-white/5 text-gtk-window-fg/70 hover:bg-black/10 dark:hover:bg-white/10'
                }`}
            >
              <Filter size={16} />
              <span>Filters</span>
              <ChevronDown
                size={14}
                className={`transform transition-transform duration-300 ${showAdvancedFilters ? 'rotate-180' : ''
                  }`}
              />
            </button>
          </div>
        </div>

        {/* Main Content Scrolling Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Advanced Filters */}
          {showAdvancedFilters && (
            <div className={`mt-6 pt-6 border-t ${border}`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className={`text-sm font-semibold ${text}`}>Advanced Filters</h3>
                <button
                  onClick={() => setFilterOptions({ folderPath: '', fromDate: '', toDate: '' })}
                  className={`text-xs ${textMuted} hover:text-red-500 transition-colors flex items-center gap-1`}
                >
                  <X size={14} />
                  Clear All
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className={`block text-xs font-semibold mb-2 ${text}`}>Folder Path</label>
                  <input
                    type="text"
                    value={filterOptions.folderPath}
                    onChange={(e) =>
                      setFilterOptions({ ...filterOptions, folderPath: e.target.value })
                    }
                    placeholder="/path/to/folder"
                    className={`w-full px-4 py-2.5 ${inputBg} border ${inputBorder} rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  />
                </div>
                <div>
                  <label className={`block text-xs font-semibold mb-2 ${text}`}>From Date</label>
                  <input
                    type="date"
                    value={filterOptions.fromDate}
                    onChange={(e) =>
                      setFilterOptions({ ...filterOptions, fromDate: e.target.value })
                    }
                    className={`w-full px-4 py-2.5 ${inputBg} border ${inputBorder} rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  />
                </div>
                <div>
                  <label className={`block text-xs font-semibold mb-2 ${text}`}>To Date</label>
                  <input
                    type="date"
                    value={filterOptions.toDate}
                    onChange={(e) => setFilterOptions({ ...filterOptions, toDate: e.target.value })}
                    className={`w-full px-4 py-2.5 ${inputBg} border ${inputBorder} rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Media Display */}
          {filteredFiles.length > 0 ? (
            viewMode === 'grid' ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {filteredFiles.map((media) => (
                  <div
                    key={media.path}
                    className={`${cardBg} rounded-2xl overflow-hidden hover:ring-2 hover:ring-gtk-accent-bg transition-all duration-300 group relative cursor-pointer shadow-sm hover:shadow-xl transform hover:-translate-y-1`}
                    onClick={() => setSelectedMedia(media)}
                  >
                    <div
                      className={`aspect-square ${isDark ? 'bg-black/20' : 'bg-black/5'} flex items-center justify-center overflow-hidden relative`}
                    >
                      {media.thumbnail ? (
                        <img
                          src={media.thumbnail}
                          alt={media.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
                        />
                      ) : media.type === 'image' ? (
                        <FileImage size={40} className="text-gtk-window-fg/30" />
                      ) : (
                        <Video size={40} className="text-gtk-window-fg/30" />
                      )}

                      {/* GNOME style Overlay buttons */}
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center gap-3 backdrop-blur-[2px]">
                        {media.type === 'image' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openFullscreen(media);
                            }}
                            className="p-3 bg-white/20 hover:bg-white/30 text-white rounded-full transition-all shadow-lg backdrop-blur-md transform hover:scale-110 active:scale-95"
                            title="View fullscreen"
                          >
                            <Maximize2 size={18} />
                          </button>
                        )}
                        {media.type === 'video' && config?.video.enable_mpv && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlayWithMPV(media);
                            }}
                            className="p-3 bg-white/20 hover:bg-white/30 text-white rounded-full transition-all shadow-lg backdrop-blur-md transform hover:scale-110 active:scale-95"
                            title="Play with MPV"
                          >
                            <Play size={18} className="ml-0.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="px-4 py-3 border-t border-black/5 dark:border-white/5">
                      <div
                        className="text-sm font-semibold truncate text-gtk-window-fg/90 mb-0.5"
                        title={media.name}
                      >
                        {media.name}
                      </div>
                      <div className="text-xs font-medium text-gtk-window-fg/50">
                        {formatSize(media.size)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div
                className={`${cardBg} rounded-2xl overflow-hidden shadow-sm border border-black/5 dark:border-white/5`}
              >
                <div className="divide-y divide-black/5 dark:divide-white/5">
                  {filteredFiles.map((media) => (
                    <div
                      key={media.path}
                      className={`flex items-center gap-4 p-3 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer group`}
                      onClick={() => setSelectedMedia(media)}
                    >
                      <div
                        className={`w-14 h-14 bg-black/5 dark:bg-white/5 flex items-center justify-center rounded-xl flex-shrink-0 overflow-hidden relative shadow-inner`}
                      >
                        {media.thumbnail ? (
                          <img
                            src={media.thumbnail}
                            alt={media.name}
                            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                          />
                        ) : media.type === 'image' ? (
                          <FileImage size={24} className="text-gtk-window-fg/40" />
                        ) : (
                          <Video size={24} className="text-gtk-window-fg/40" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0 py-1">
                        <div className="text-sm font-semibold truncate text-gtk-window-fg/90 mb-0.5">
                          {media.name}
                        </div>
                        <div className="text-xs font-medium text-gtk-window-fg/50 truncate flex items-center gap-1.5">
                          <span className="truncate">{media.path}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 px-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        {media.type === 'image' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openFullscreen(media);
                            }}
                            className="p-2.5 bg-gtk-window-bg hover:bg-black/10 dark:hover:bg-white/10 text-gtk-window-fg rounded-full transition-colors shadow-sm"
                            title="View fullscreen"
                          >
                            <Maximize2 size={16} />
                          </button>
                        )}
                        {media.type === 'video' && config?.video.enable_mpv && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlayWithMPV(media);
                            }}
                            className="p-2.5 bg-gtk-window-bg hover:bg-black/10 dark:hover:bg-white/10 text-gtk-window-fg rounded-full transition-colors shadow-sm"
                            title="Play with MPV"
                          >
                            <Play size={16} className="ml-0.5" />
                          </button>
                        )}
                      </div>

                      <div
                        className={`text-sm text-gtk-window-fg/60 flex-shrink-0 font-medium pr-2 w-20 text-right`}
                      >
                        {formatSize(media.size)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          ) : !isScanning && mediaFiles.length === 0 ? (
            <div className="text-center py-32 flex flex-col items-center justify-center max-w-sm mx-auto">
              <div className="relative mb-6">
                <div
                  className={`w-32 h-32 rounded-[2rem] bg-black/5 dark:bg-white/5 flex items-center justify-center transform -rotate-6 shadow-sm`}
                >
                  <div
                    className={`w-24 h-24 rounded-3xl bg-black/5 dark:bg-white/10 flex items-center justify-center transform rotate-12 backdrop-blur-sm`}
                  >
                    <Folder size={40} className="text-gtk-window-fg/30" />
                  </div>
                </div>
              </div>
              <h3 className="text-xl font-bold text-gtk-window-fg/90 mb-2 tracking-tight">
                No Media Found
              </h3>
              <p className="text-sm text-gtk-window-fg/60 leading-relaxed text-center">
                Select a folder path above and click the{' '}
                <span className="font-semibold text-gtk-window-fg/80">Scan</span> button to start
                building your library.
              </p>
            </div>
          ) : null}
        </div>

      </div>
    </div> 

    {/* Regular Modal (for videos and general preview) - rendered at root level to avoid overflow clipping */ }
  {
    selectedMedia && !isFullscreen && (
      <div
        className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200"
        onClick={() => setSelectedMedia(null)}
      >
        <div
          className={`${cardBg} rounded-2xl max-w-5xl w-full max-h-[90vh] overflow-auto shadow-2xl`}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className={`sticky top-0 ${cardBg} border-b ${border} px-6 py-4 flex items-center justify-between z-10 backdrop-blur-xl bg-opacity-95`}
          >
            <div className="flex-1 min-w-0 mr-4">
              <h2 className="text-lg font-bold truncate">{selectedMedia.name}</h2>
              <p className={`text-sm ${textMuted}`}>
                {filteredFiles.findIndex((m) => m.path === selectedMedia.path) + 1} of{' '}
                {filteredFiles.length}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {selectedMedia.type === 'image' && (
                <button
                  onClick={() => openFullscreen(selectedMedia)}
                  className="p-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl transition-all shadow-sm"
                  title="Fullscreen"
                >
                  <Maximize2 size={18} />
                </button>
              )}
              {selectedMedia.type === 'video' && config?.video.enable_mpv && (
                <button
                  onClick={() => handlePlayWithMPV(selectedMedia)}
                  className="p-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl transition-all shadow-sm"
                  title="Play with MPV"
                >
                  <Play size={18} />
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigateMedia('prev');
                }}
                className={`p-2.5 rounded-xl ${hover} transition-all`}
                title="Previous (←)"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigateMedia('next');
                }}
                className={`p-2.5 rounded-xl ${hover} transition-all`}
                title="Next (→)"
              >
                <ChevronRight size={18} />
              </button>
              <button
                onClick={() => setSelectedMedia(null)}
                className={`p-2.5 rounded-xl ${hover} transition-all`}
                title="Close (Esc)"
              >
                <X size={18} />
              </button>
            </div>
          </div>
          <div className="p-6">
            <div
              className={`aspect-video ${isDark ? 'bg-gray-800' : 'bg-gray-100'} flex items-center justify-center rounded-xl mb-6 border ${border} overflow-hidden`}
            >
              {selectedMedia.thumbnail ? (
                <img
                  src={`file://${selectedMedia.thumbnail}`}
                  alt={selectedMedia.name}
                  className="max-w-full max-h-full object-contain"
                />
              ) : selectedMedia.type === 'image' ? (
                <FileImage size={64} className={textMuted} />
              ) : (
                <Video size={64} className={textMuted} />
              )}
            </div>
            <div
              className={`space-y-3 text-sm ${isDark ? 'bg-gray-800' : 'bg-gray-50'} border ${border} rounded-xl p-4`}
            >
              <div className="flex">
                <span className="font-bold w-28">Path:</span>
                <span className={`${textMuted} break-all`}>{selectedMedia.path}</span>
              </div>
              <div className="flex">
                <span className="font-bold w-28">Size:</span>
                <span className={textMuted}>{formatSize(selectedMedia.size)}</span>
              </div>
              <div className="flex">
                <span className="font-bold w-28">Type:</span>
                <span className={`${textMuted} capitalize`}>{selectedMedia.type}</span>
              </div>
              <div className="flex">
                <span className="font-bold w-28">Modified:</span>
                <span className={textMuted}>{formatDate(selectedMedia.modifiedTime)}</span>
              </div>
            </div>
            <div className={`mt-4 text-xs ${textMuted} text-center font-medium`}>
              Use arrow keys to navigate • Press Esc to close
              {selectedMedia.type === 'image' && ' • Click fullscreen for rotation controls'}
            </div>
          </div>
        </div>
      </div>
    )
  }

  {/* Fullscreen Image Viewer - rendered at root level to avoid overflow clipping */ }
  {
    isFullscreen && selectedMedia && selectedMedia.type === 'image' && (
      <div className="fixed inset-0 bg-black z-50 flex flex-col">
        {/* Top Controls */}
        <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/80 to-transparent p-4 z-10">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex-1 min-w-0 mr-4">
              <h2 className="text-white text-lg font-bold truncate">{selectedMedia.name}</h2>
              <p className="text-gray-300 text-sm">
                {filteredFiles.findIndex((m) => m.path === selectedMedia?.path) + 1} of{' '}
                {filteredFiles.length}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setRotation((prev) => (prev - 90) % 360)}
                className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-all backdrop-blur-sm"
                title="Rotate left"
              >
                <RotateCw size={20} className="transform -scale-x-100" />
              </button>
              <button
                onClick={() => setRotation((prev) => (prev + 90) % 360)}
                className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-all backdrop-blur-sm"
                title="Rotate right (R)"
              >
                <RotateCw size={20} />
              </button>
              <button
                onClick={() => setZoom((prev) => Math.max(prev - 0.25, 0.5))}
                className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-all backdrop-blur-sm"
                title="Zoom out (-)"
              >
                <ZoomOut size={20} />
              </button>
              <button
                onClick={() => setZoom((prev) => Math.min(prev + 0.25, 3))}
                className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-all backdrop-blur-sm"
                title="Zoom in (+)"
              >
                <ZoomIn size={20} />
              </button>
              <div className="px-3 py-2 bg-white/10 text-white rounded-xl backdrop-blur-sm text-sm font-semibold min-w-[60px] text-center">
                {Math.round(zoom * 100)}%
              </div>
              <button
                onClick={() => {
                  setIsFullscreen(false);
                  setRotation(0);
                  setZoom(1);
                }}
                className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-all backdrop-blur-sm"
                title="Exit fullscreen (Esc)"
              >
                <X size={20} />
              </button>
            </div>
          </div>
        </div>

        {/* Image Container */}
        <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
          <img
            src={`file://${selectedMedia.path}`}
            alt={selectedMedia.name}
            className="max-w-full max-h-full object-contain transition-transform duration-300"
            style={{
              transform: `rotate(${rotation}deg) scale(${zoom})`,
              transformOrigin: 'center',
            }}
          />
        </div>

        {/* Bottom Navigation */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6 z-10">
          <div className="max-w-7xl mx-auto flex items-center justify-center gap-4">
            <button
              onClick={() => navigateMedia('prev')}
              className="p-4 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-all backdrop-blur-sm"
              title="Previous (←)"
            >
              <ChevronLeft size={24} />
            </button>
            <div className="px-6 py-3 bg-white/10 text-white rounded-xl backdrop-blur-sm text-sm font-medium">
              Use arrow keys to navigate • R to rotate • +/- to zoom • Esc to exit
            </div>
            <button
              onClick={() => navigateMedia('next')}
              className="p-4 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-all backdrop-blur-sm"
              title="Next (→)"
            >
              <ChevronRight size={24} />
            </button>
          </div>
        </div>
      </div>
    )
  }
    </>
  );
}

export default App;
