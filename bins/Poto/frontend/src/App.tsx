import { useState, useEffect } from 'react';
import { Home, Folder, Search, FolderOpen, FileImage, Video, X, Grid3x3, List, SortAsc } from 'lucide-react';

interface MediaFile {
  path: string;
  name: string;
  size: number;
  type: 'image' | 'video';
  thumbnail?: string;
}

interface ScanProgress {
  scannedFiles: number;
  foundMedia: number;
  currentPath: string;
  isComplete: boolean;
}

let StartScan: (path: string) => Promise<void>;
let StopScan: () => Promise<void>;
let GetHomeDirectory: () => Promise<string>;
let IsScanning: () => Promise<boolean>;
let SelectDirectory: () => Promise<string>;
// let GetCommonDirectories: () => Promise<Record<string, string>>;
let EventsOn: (eventName: string, callback: (...args: any[]) => void) => void;
let EventsOff: (eventName: string) => void;

function App() {
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [scanProgress, setScanProgress] = useState<ScanProgress>({
    scannedFiles: 0,
    foundMedia: 0,
    currentPath: '',
    isComplete: false,
  });
  const [isScanning, setIsScanning] = useState(false);
  const [scanPath, setScanPath] = useState('');
  const [filter, setFilter] = useState<'all' | 'image' | 'video'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [wailsLoaded, setWailsLoaded] = useState(false);
//   const [commonDirs, setCommonDirs] = useState<Record<string, string>>({});
  const [selectedMedia, setSelectedMedia] = useState<MediaFile | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'type'>('name');

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
        // GetCommonDirectories = wailsApp.GetCommonDirectories;
        EventsOn = wailsRuntime.EventsOn;
        EventsOff = wailsRuntime.EventsOff;

        setWailsLoaded(true);

        const home = await GetHomeDirectory();
        setScanPath(home);

        // const dirs = await GetCommonDirectories();
        // setCommonDirs(dirs);

        EventsOn('mediaFound', (batch: MediaFile[]) => {
          setMediaFiles(prev => [...prev, ...batch]);
        });

        EventsOn('scanProgress', (progress: ScanProgress) => {
          setScanProgress(progress);
        });

        EventsOn('scanError', (error: string) => {
          console.error('Scan error:', error);
        });
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

  const handleStartScan = async () => {
    if (!wailsLoaded || !StartScan) return;
    setMediaFiles([]);
    setScanProgress({ scannedFiles: 0, foundMedia: 0, currentPath: '', isComplete: false });
    setIsScanning(true);
    await StartScan(scanPath);
    const scanning = await IsScanning();
    setIsScanning(scanning);
  };

  const handleStopScan = async () => {
    if (!wailsLoaded || !StopScan) return;
    await StopScan();
    setIsScanning(false);
  };

  const handleBrowseDirectory = async () => {
    if (!wailsLoaded || !SelectDirectory) return;
    const path = await SelectDirectory();
    if (path) setScanPath(path);
  };

  const handleQuickNav = (path: string) => {
    setScanPath(path);
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const filteredMedia = mediaFiles
    .filter(m => {
      const matchesType = filter === 'all' || m.type === filter;
      const matchesSearch = searchTerm === '' ||
        m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.path.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesType && matchesSearch;
    })
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'size') return b.size - a.size;
      if (sortBy === 'type') return a.type.localeCompare(b.type);
      return 0;
    });

  const imageCount = mediaFiles.filter(m => m.type === 'image').length;
  const videoCount = mediaFiles.filter(m => m.type === 'video').length;

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900">
      <div className="bg-gradient-to-b from-gray-200 to-gray-300 border-b border-gray-400 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-xl font-semibold text-gray-800">Poto</h1>
            <div className="flex gap-2">
              <button
                onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                className="p-2 rounded hover:bg-gray-400/30 transition-colors"
                title={viewMode === 'grid' ? 'List view' : 'Grid view'}
              >
                {viewMode === 'grid' ? <List size={18} /> : <Grid3x3 size={18} />}
              </button>
            </div>
          </div>

          {/* <div className="flex flex-wrap gap-1 mb-3">
            {Object.entries(commonDirs).map(([key, path]) => (
              <button
                key={key}
                onClick={() => handleQuickNav(path)}
                disabled={isScanning}
                className="px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 rounded shadow-sm text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {key === 'home' && <Home size={12} />}
                {key === 'pictures' && <FileImage size={12} />}
                {key === 'videos' && <Video size={12} />}
                {key !== 'home' && key !== 'pictures' && key !== 'videos' && <Folder size={12} />}
                <span className="capitalize">{key}</span>
              </button>
            ))}
          </div> */}

          <div className="flex gap-2">
            <input
              type="text"
              value={scanPath}
              onChange={(e) => setScanPath(e.target.value)}
              disabled={isScanning}
              placeholder="Enter scan path..."
              className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            />

            <button
              onClick={handleBrowseDirectory}
              disabled={isScanning}
              className="px-3 py-2 bg-white border border-gray-300 hover:bg-gray-50 rounded shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <FolderOpen size={16} />
              <span className="text-sm">Browse</span>
            </button>

            {isScanning ? (
              <button
                onClick={handleStopScan}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded shadow-sm transition-colors flex items-center gap-2"
              >
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span className="text-sm font-medium">Stop</span>
              </button>
            ) : (
              <button
                onClick={handleStartScan}
                disabled={!wailsLoaded}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="text-sm font-medium">Start Scan</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4">
        {(isScanning || scanProgress.foundMedia > 0) && (
          <div className="mb-4 bg-white border border-gray-300 rounded shadow-sm p-3">
            <div className="flex flex-wrap gap-4 text-xs items-center mb-2">
              <span className="text-gray-600">
                Files scanned: <span className="text-gray-900 font-semibold">{scanProgress.scannedFiles.toLocaleString()}</span>
              </span>
              <span className="text-gray-600">
                Media found: <span className="text-gray-900 font-semibold">{scanProgress.foundMedia.toLocaleString()}</span>
              </span>
              {scanProgress.isComplete && (
                <span className="text-green-600 font-semibold">✓ Complete</span>
              )}
            </div>
            {isScanning && (
              <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                <div className="h-full bg-blue-500 animate-pulse" style={{ width: '100%' }} />
              </div>
            )}
            {!scanProgress.isComplete && scanProgress.currentPath && (
              <div className="mt-2 text-xs text-gray-500 truncate flex items-center gap-1">
                <Folder size={12} />
                {scanProgress.currentPath}
              </div>
            )}
          </div>
        )}

        <div className="mb-4 bg-white border border-gray-300 rounded shadow-sm p-3">
          <div className="flex gap-3 items-center flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search files..."
                className="w-full pl-8 pr-3 py-1.5 bg-white border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div className="flex gap-1">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  filter === 'all'
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                All ({mediaFiles.length})
              </button>
              <button
                onClick={() => setFilter('image')}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  filter === 'image'
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                Images ({imageCount})
              </button>
              <button
                onClick={() => setFilter('video')}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  filter === 'video'
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                Videos ({videoCount})
              </button>
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'name' | 'size' | 'type')}
              className="px-3 py-1.5 bg-white border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="name">Sort by Name</option>
              <option value="size">Sort by Size</option>
              <option value="type">Sort by Type</option>
            </select>
          </div>
        </div>

        {filteredMedia.length > 0 ? (
          viewMode === 'grid' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
              {filteredMedia.map((media) => (
                <div
                  key={media.path}
                  onClick={() => setSelectedMedia(media)}
                  className="bg-white border border-gray-300 rounded shadow-sm hover:shadow-md hover:border-blue-400 transition-all cursor-pointer group"
                >
                  <div className="aspect-square bg-gray-100 flex items-center justify-center overflow-hidden rounded-t">
                    {media.type === 'image' && media.thumbnail ? (
                      <img
                        src={media.thumbnail}
                        alt={media.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    ) : media.type === 'image' ? (
                      <FileImage size={40} className="text-gray-400" />
                    ) : (
                      <Video size={40} className="text-gray-400" />
                    )}
                  </div>
                  <div className="p-2">
                    <div className="text-xs text-gray-900 truncate mb-0.5" title={media.name}>
                      {media.name}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatSize(media.size)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white border border-gray-300 rounded shadow-sm">
              {filteredMedia.map((media, idx) => (
                <div
                  key={media.path}
                  onClick={() => setSelectedMedia(media)}
                  className={`flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer transition-colors ${
                    idx !== filteredMedia.length - 1 ? 'border-b border-gray-200' : ''
                  }`}
                >
                  <div className="w-12 h-12 bg-gray-100 flex items-center justify-center rounded flex-shrink-0">
                    {media.type === 'image' && media.thumbnail ? (
                      <img src={media.thumbnail} alt={media.name} className="w-full h-full object-cover rounded" />
                    ) : media.type === 'image' ? (
                      <FileImage size={24} className="text-gray-400" />
                    ) : (
                      <Video size={24} className="text-gray-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{media.name}</div>
                    <div className="text-xs text-gray-500 truncate">{media.path}</div>
                  </div>
                  <div className="text-xs text-gray-500 flex-shrink-0">
                    {formatSize(media.size)}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : !isScanning && mediaFiles.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <Folder size={64} className="mx-auto mb-4 opacity-50" />
            <p className="text-base">No media files found. Click "Start Scan" to begin.</p>
          </div>
        ) : null}

        {selectedMedia && (
          <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
            onClick={() => setSelectedMedia(null)}
          >
            <div
              className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-auto shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 bg-gradient-to-b from-gray-200 to-gray-300 border-b border-gray-400 px-4 py-3 flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-800 truncate">{selectedMedia.name}</h2>
                <button
                  onClick={() => setSelectedMedia(null)}
                  className="p-1.5 rounded hover:bg-gray-400/30 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="p-4">
                {selectedMedia.type === 'image' && selectedMedia.thumbnail && (
                  <img
                    src={selectedMedia.thumbnail}
                    alt={selectedMedia.name}
                    className="w-full rounded mb-4 border border-gray-300"
                  />
                )}
                <div className="space-y-2 text-sm bg-gray-50 border border-gray-300 rounded p-3">
                  <div className="flex">
                    <span className="font-semibold text-gray-700 w-20">Path:</span>
                    <span className="text-gray-600 break-all">{selectedMedia.path}</span>
                  </div>
                  <div className="flex">
                    <span className="font-semibold text-gray-700 w-20">Size:</span>
                    <span className="text-gray-600">{formatSize(selectedMedia.size)}</span>
                  </div>
                  <div className="flex">
                    <span className="font-semibold text-gray-700 w-20">Type:</span>
                    <span className="text-gray-600 capitalize">{selectedMedia.type}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
