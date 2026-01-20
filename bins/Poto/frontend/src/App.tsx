import { useState, useEffect } from 'react';
import { Folder, Search, FolderOpen, Image as ImageIcon, Video, X, Grid3x3, List, ChevronLeft, ChevronRight, Play, Sun, Moon, Filter, Loader2,Image, Sparkles, ChevronDown, FileImage, Maximize2, RotateCw, ZoomIn, ZoomOut, SortAsc,  HelpCircle,HardDrive, FileType, Calendar } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/select';
import HelpDialog from './components/HelpDialloge';

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
// let UpdateConfig: (config: main.Config) => Promise<void>;
let PlayWithMPV: (path: string) => Promise<void>;
// let AddScanDirectory: (dirPath: string) => Promise<void>;
// let RemoveScanDirectory: (dirPath: string) => Promise<void>;
// let AddFolderRule: (folderPath: string, rule: main.FolderRule) => Promise<void>;
// let RemoveFolderRule: (folderPath: string) => Promise<void>;
// let AddIgnorePattern: (pattern: string) => Promise<void>;
// let RemoveIgnorePattern: (pattern: string) => Promise<void>;
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
    toDate: ''
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
        // UpdateConfig = wailsApp.UpdateConfig;
        PlayWithMPV = wailsApp.PlayWithMPV;
        // AddScanDirectory = wailsApp.AddScanDirectory;
        // RemoveScanDirectory = wailsApp.RemoveScanDirectory;
        // AddFolderRule = wailsApp.AddFolderRule;
        // RemoveFolderRule = wailsApp.RemoveFolderRule;
        // AddIgnorePattern = wailsApp.AddIgnorePattern;
        // RemoveIgnorePattern = wailsApp.RemoveIgnorePattern;
        // FilterMedia = wailsApp.FilterMedia;
        // GetAllMedia = wailsApp.GetAllMedia;
        EventsOn = wailsRuntime.EventsOn;
        EventsOff = wailsRuntime.EventsOff;

        setWailsLoaded(true);

        const home = await GetHomeDirectory();
        setScanPath(home);

        const dirs = await GetCommonDirectories();
        setCommonDirs(dirs);

        const cfg = await GetConfig();
        setConfig(cfg);

        // Set up event listeners
        EventsOn('mediaFound', (batch: main.MediaFile[]) => {
          setMediaFiles(prev => {
            const pathSet = new Set(prev.map(m => m.path));
            const converted = batch.map(convertMediaFile);
            const uniqueNew = converted.filter(m => !pathSet.has(m.path));
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
      filtered = filtered.filter(m => m.type === filter);
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(m =>
        m.name.toLowerCase().includes(term) ||
        m.path.toLowerCase().includes(term)
      );
    }

    if (filterOptions.folderPath) {
      filtered = filtered.filter(m => m.path.startsWith(filterOptions.folderPath));
    }

    if (filterOptions.fromDate) {
      filtered = filtered.filter(m => new Date(m.modifiedTime) >= new Date(filterOptions.fromDate));
    }

    if (filterOptions.toDate) {
      filtered = filtered.filter(m => new Date(m.modifiedTime) <= new Date(filterOptions.toDate));
    }

    filtered.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'size') return b.size - a.size;
      if (sortBy === 'type') return a.type.localeCompare(b.type);
      if (sortBy === 'date') return new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime();
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
    const currentIndex = filteredFiles.findIndex(m => m.path === selectedMedia.path);
    if (currentIndex === -1) return;

    let newIndex = direction === 'prev'
      ? (currentIndex > 0 ? currentIndex - 1 : filteredFiles.length - 1)
      : (currentIndex < filteredFiles.length - 1 ? currentIndex + 1 : 0);

    setSelectedMedia(filteredFiles[newIndex]);
    if (isFullscreen) {
      setRotation(0);
      setZoom(1);
    }
  };

  const imageCount = mediaFiles.filter(m => m.type === 'image').length;
  const videoCount = mediaFiles.filter(m => m.type === 'video').length;

  const bg = isDark ? 'bg-gray-950' : 'bg-gray-50';
  const cardBg = isDark ? 'bg-gray-900' : 'bg-white';
  const border = isDark ? 'border-gray-800' : 'border-gray-200';
  const text = isDark ? 'text-gray-100' : 'text-gray-900';
  const textMuted = isDark ? 'text-gray-400' : 'text-gray-600';
  const hover = isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-100';
  const inputBg = isDark ? 'bg-gray-800' : 'bg-white';
  const inputBorder = isDark ? 'border-gray-700' : 'border-gray-300';

  return (
    <div className={`min-h-screen ${bg} ${text} transition-colors duration-300`}>
      {/* Header with Glassmorphism */}
      <div className={`${isDark ? 'bg-gray-900/95' : 'bg-white/95'} backdrop-blur-xl border-b ${border} sticky top-0 z-40`}>
              <div className="max-w-7xl mx-auto px-6 py-5">
                {/* Top Bar */}
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-2xl ${isDark ? 'bg-blue-600' : 'bg-blue-500'} flex items-center justify-center shadow-lg`}>
                      <Image size={24} className="text-white" />
                    </div>
                    <div>
                      <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        Poto Media Scanner
                      </h1>
                      <p className={`text-sm ${textMuted}`}>Discover and organize your media</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setTheme(isDark ? 'light' : 'dark')}
                      className={`p-3 rounded-xl ${cardBg} border ${border} ${hover} transition-all shadow-sm hover:shadow-md`}
                      title="Toggle theme"
                    >
                      {isDark ? <Sun size={20} /> : <Moon size={20} />}
                    </button>
                    <button
                      onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                      className={`p-3 rounded-xl ${cardBg} border ${border} ${hover} transition-all shadow-sm hover:shadow-md`}
                      title={viewMode === 'grid' ? 'List view' : 'Grid view'}
                    >
                      {viewMode === 'grid' ? <List size={20} /> : <Grid3x3 size={20} />}
                    </button>
                    <div>
                    <button
        onClick={() => setShowHelp(true)}
        className="p-3 rounded-xl bg-white border border-gray-200 hover:bg-gray-50"
        title="Help & Configuration"
      >
        <HelpCircle size={20} />
      </button>

      <HelpDialog
        isOpen={showHelp}
        onClose={() => setShowHelp(false)}
        isDark={isDark}
      />
      </div>
                  </div>
                </div>

                {/* Scan Controls */}
                <div className="flex gap-3">
                  <div className="flex-1 relative">
                    <FolderOpen className={`absolute left-4 top-1/2 transform -translate-y-1/2 ${textMuted}`} size={18} />
                    <input
                      type="text"
                      value={scanPath}
                      onChange={(e) => setScanPath(e.target.value)}
                      disabled={isScanning}
                      placeholder="Enter path to scan (e.g., /Users/john/Pictures)"
                      className={`w-full pl-12 pr-4 py-3.5 ${inputBg} border ${inputBorder} rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm disabled:opacity-60`}
                    />
                  </div>
                  <button
                    onClick={handleBrowseDirectory}
                    disabled={isScanning}
                    className={`px-5 py-3.5 ${cardBg} border ${border} ${hover} rounded-xl transition-all shadow-sm hover:shadow-md disabled:opacity-50 flex items-center gap-2 font-medium`}
                  >
                    Browse
                  </button>
                  {isScanning ? (
                    <button
                      onClick={handleStopScan}
                      className="px-6 py-3.5 bg-red-600 hover:bg-red-700 text-white rounded-xl transition-all shadow-md hover:shadow-lg flex items-center gap-2.5 font-semibold"
                    >
                      <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                      Stop Scan
                    </button>
                  ) : (
                    <button
                      onClick={handleStartScan}
                      disabled={!wailsLoaded}
                      className="px-6 py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2.5 font-semibold"
                    >
                      <Sparkles size={18} />
                      Start Scan
                    </button>
                  )}
                </div>
              </div>
            </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto p-6 space-y-6">
              {/* Progress Card */}
              {(isScanning || scanProgress.foundMedia > 0) && (
                <div className={`${cardBg} border ${border} rounded-2xl p-6 shadow-lg`}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${isScanning ? 'bg-blue-500 animate-pulse' : 'bg-green-500'}`} />
                        <span className={`text-sm ${textMuted}`}>Status</span>
                      </div>
                      {scanProgress.isComplete && (
                        <span className="px-3 py-1 bg-green-500/20 text-green-600 rounded-full text-xs font-semibold">
                          Scan Complete
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6 mb-4">
                    <div>
                      <div className={`text-xs font-medium ${textMuted} mb-1`}>Files Scanned</div>
                      <div className={`text-3xl font-bold ${text}`}>{scanProgress.scannedFiles.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className={`text-xs font-medium ${textMuted} mb-1`}>Media Found</div>
                      <div className="text-3xl font-bold text-blue-500">{scanProgress.foundMedia.toLocaleString()}</div>
                    </div>
                  </div>

                  {isScanning && (
                    <div className={`w-full ${isDark ? 'bg-gray-900' : 'bg-gray-200'} rounded-full h-2 overflow-hidden mb-3`}>
                      <div className="h-full bg-blue-500 rounded-full animate-pulse" style={{ width: '100%' }} />
                    </div>
                  )}

                  {scanProgress.currentPath && (
                    <div className={`text-xs ${textMuted} flex items-center gap-2`}>
                      <span className="font-medium">Current:</span>
                      <span className="truncate">{scanProgress.currentPath}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Filters & Search */}
              <div className={`${cardBg} border ${border} rounded-2xl p-6 shadow-lg`}>
                {/* Main Filter Bar */}
                <div className="flex gap-3 items-center flex-wrap mb-4">
                  <div className="relative flex-1 min-w-[300px]">
                    <Search className={`absolute left-4 top-1/2 transform -translate-y-1/2 ${textMuted}`} size={18} />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Search your media library..."
                      className={`w-full pl-12 pr-4 py-3.5 ${inputBg} border ${inputBorder} rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                    />
                  </div>

                  <Select
  value={sortBy}
  onValueChange={(value: unknown) => setSortBy(value as "name" | "size" | "type" | "date")}
>
  <SelectTrigger className="w-[180px] h-[50px] rounded-xl">
    <SelectValue placeholder="Sort by..." />
  </SelectTrigger>
  <SelectContent className="rounded-xl">
    <SelectItem value="name" className="cursor-pointer">
      <div className="flex items-center gap-2">
        <SortAsc size={16} className="text-gray-500" />
        <span>Name</span>
      </div>
    </SelectItem>
    <SelectItem value="size" className="cursor-pointer">
      <div className="flex items-center gap-2">
        <HardDrive size={16} className="text-gray-500" />
        <span>Size</span>
      </div>
    </SelectItem>
    <SelectItem value="type" className="cursor-pointer">
      <div className="flex items-center gap-2">
        <FileType size={16} className="text-gray-500" />
        <span>Type</span>
      </div>
    </SelectItem>
    <SelectItem value="date" className="cursor-pointer">
      <div className="flex items-center gap-2">
        <Calendar size={16} className="text-gray-500" />
        <span>Date</span>
      </div>
    </SelectItem>
  </SelectContent>
</Select>

                  <button
                    onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                    className={`px-5 py-3.5 ${showAdvancedFilters ? 'bg-blue-600 text-white' : `${cardBg} ${text}`} border ${border} ${!showAdvancedFilters && hover} rounded-xl text-sm flex items-center gap-2 transition-all shadow-sm font-medium`}
                  >
                    <Filter size={16} />
                    Advanced
                    <ChevronDown size={16} className={`transition-transform ${showAdvancedFilters ? 'rotate-180' : ''}`} />
                  </button>
                </div>

                {/* Filter Chips */}
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => setFilter('all')}
                    className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                      filter === 'all'
                        ? 'bg-blue-600 text-white shadow-md'
                        : `${cardBg} border ${border} ${hover} ${text}`
                    }`}
                  >
                    All <span className={`${filter === 'all' ? 'text-blue-100' : textMuted} ml-1`}>({mediaFiles.length})</span>
                  </button>
                  <button
                    onClick={() => setFilter('image')}
                    className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                      filter === 'image'
                        ? 'bg-blue-600 text-white shadow-md'
                        : `${cardBg} border ${border} ${hover} ${text}`
                    }`}
                  >
                    Images <span className={`${filter === 'image' ? 'text-blue-100' : textMuted} ml-1`}>({imageCount})</span>
                  </button>
                  <button
                    onClick={() => setFilter('video')}
                    className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                      filter === 'video'
                        ? 'bg-blue-600 text-white shadow-md'
                        : `${cardBg} border ${border} ${hover} ${text}`
                    }`}
                  >
                    Videos <span className={`${filter === 'video' ? 'text-blue-100' : textMuted} ml-1`}>({videoCount})</span>
                  </button>
                </div>

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
                          onChange={(e) => setFilterOptions({...filterOptions, folderPath: e.target.value})}
                          placeholder="/path/to/folder"
                          className={`w-full px-4 py-2.5 ${inputBg} border ${inputBorder} rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500`}
                        />
                      </div>
                      <div>
                        <label className={`block text-xs font-semibold mb-2 ${text}`}>From Date</label>
                        <input
                          type="date"
                          value={filterOptions.fromDate}
                          onChange={(e) => setFilterOptions({...filterOptions, fromDate: e.target.value})}
                          className={`w-full px-4 py-2.5 ${inputBg} border ${inputBorder} rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500`}
                        />
                      </div>
                      <div>
                        <label className={`block text-xs font-semibold mb-2 ${text}`}>To Date</label>
                        <input
                          type="date"
                          value={filterOptions.toDate}
                          onChange={(e) => setFilterOptions({...filterOptions, toDate: e.target.value})}
                          className={`w-full px-4 py-2.5 ${inputBg} border ${inputBorder} rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500`}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
{/* Media Display */}
        {filteredFiles.length > 0 ? (
          viewMode === 'grid' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {filteredFiles.map((media) => (
                <div
                  key={media.path}
                  className={`${cardBg} border ${border} rounded-xl overflow-hidden hover:border-blue-500 transition-all group relative cursor-pointer shadow-sm hover:shadow-xl transform hover:-translate-y-1`}
                  onClick={() => setSelectedMedia(media)}
                >
                  <div className={`aspect-square ${isDark ? 'bg-gray-800' : 'bg-gray-100'} flex items-center justify-center overflow-hidden relative`}>
                    {media.thumbnail ? (
                      <img
                        src={media.thumbnail}
                        alt={media.name}
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                      />
                    ) : media.type === 'image' ? (
                      <FileImage size={48} className={textMuted} />
                    ) : (
                      <Video size={48} className={textMuted} />
                    )}

                    {/* Overlay buttons */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                      {media.type === 'image' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openFullscreen(media);
                          }}
                          className="p-2 bg-white/90 hover:bg-white text-gray-900 rounded-lg transition-all shadow-lg transform hover:scale-110"
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
                          className="p-2 bg-white/90 hover:bg-white text-gray-900 rounded-lg transition-all shadow-lg transform hover:scale-110"
                          title="Play with MPV"
                        >
                          <Play size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="text-sm font-medium truncate mb-1" title={media.name}>
                      {media.name}
                    </div>
                    <div className={`text-xs ${textMuted}`}>
                      {formatSize(media.size)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={`${cardBg} border ${border} rounded-xl overflow-hidden shadow-lg`}>
              {filteredFiles.map((media, idx) => (
                <div
                  key={media.path}
                  className={`flex items-center gap-4 p-4 ${hover} transition-all cursor-pointer ${
                    idx !== filteredFiles.length - 1 ? `border-b ${border}` : ''
                  }`}
                  onClick={() => setSelectedMedia(media)}
                >
                  <div className={`w-16 h-16 ${isDark ? 'bg-gray-800' : 'bg-gray-100'} flex items-center justify-center rounded-xl flex-shrink-0 overflow-hidden`}>
                    {media.thumbnail ? (
                      <img src={media.thumbnail} alt={media.name} className="w-full h-full object-cover" />
                    ) : media.type === 'image' ? (
                      <FileImage size={28} className={textMuted} />
                    ) : (
                      <Video size={28} className={textMuted} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate mb-1">{media.name}</div>
                    <div className={`text-xs ${textMuted} truncate`}>{media.path}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    {media.type === 'image' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openFullscreen(media);
                        }}
                        className="p-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-all shadow-sm"
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
                        className="p-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-all shadow-sm"
                        title="Play with MPV"
                      >
                        <Play size={16} />
                      </button>
                    )}
                    <div className={`text-sm ${textMuted} flex-shrink-0 font-medium`}>
                      {formatSize(media.size)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : !isScanning && mediaFiles.length === 0 ? (
          <div className={`text-center py-32 ${textMuted}`}>
            <div className={`w-24 h-24 mx-auto mb-6 rounded-3xl ${isDark ? 'bg-gray-800' : 'bg-gray-100'} flex items-center justify-center`}>
              <Folder size={48} className="opacity-50" />
            </div>
            <p className="text-lg font-semibold mb-2">No media files found</p>
            <p className="text-sm">Click "Start Scan" to discover your media</p>
          </div>
        ) : null}

        {/* Regular Modal (for videos and general preview) */}
        {selectedMedia && !isFullscreen && (
          <div
            className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200"
            onClick={() => setSelectedMedia(null)}
          >
            <div
              className={`${cardBg} rounded-2xl max-w-5xl w-full max-h-[90vh] overflow-auto shadow-2xl`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={`sticky top-0 ${cardBg} border-b ${border} px-6 py-4 flex items-center justify-between z-10 backdrop-blur-xl bg-opacity-95`}>
                <div className="flex-1 min-w-0 mr-4">
                  <h2 className="text-lg font-bold truncate">{selectedMedia.name}</h2>
                  <p className={`text-sm ${textMuted}`}>
                    {filteredFiles.findIndex(m => m.path === selectedMedia.path) + 1} of {filteredFiles.length}
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
                <div className={`aspect-video ${isDark ? 'bg-gray-800' : 'bg-gray-100'} flex items-center justify-center rounded-xl mb-6 border ${border} overflow-hidden`}>
                  {selectedMedia.thumbnail ? (
                    <img
                      src={selectedMedia.thumbnail}
                      alt={selectedMedia.name}
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : selectedMedia.type === 'image' ? (
                    <FileImage size={64} className={textMuted} />
                  ) : (
                    <Video size={64} className={textMuted} />
                  )}
                </div>
                <div className={`space-y-3 text-sm ${isDark ? 'bg-gray-800' : 'bg-gray-50'} border ${border} rounded-xl p-4`}>
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
        )}

        {/* Fullscreen Image Viewer */}
        {isFullscreen && selectedMedia && selectedMedia.type === 'image' && (
          <div className="fixed inset-0 bg-black z-50 flex flex-col">
            {/* Top Controls */}
            <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/80 to-transparent p-4 z-10">
              <div className="max-w-7xl mx-auto flex items-center justify-between">
                <div className="flex-1 min-w-0 mr-4">
                  <h2 className="text-white text-lg font-bold truncate">{selectedMedia.name}</h2>
                  <p className="text-gray-300 text-sm">
                    {filteredFiles.findIndex(m => m.path === selectedMedia.path) + 1} of {filteredFiles.length}
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
                src={selectedMedia.thumbnail || selectedMedia.path}
                alt={selectedMedia.name}
                className="max-w-full max-h-full object-contain transition-transform duration-300"
                style={{
                  transform: `rotate(${rotation}deg) scale(${zoom})`,
                  transformOrigin: 'center'
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
        )}
        </div>
</div>
  )}

export default App
