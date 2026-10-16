export const SUPPORTED_TEXT_FILE_TYPES = {
  // LaTeX files
  'text/x-tex': ['.tex', '.ltx', '.dtx', '.ins'],
  'text/x-bibtex': ['.bib', '.bst', '.bbx', '.cbx', '.lbx'],
  'text/x-latex': ['.sty', '.cls', '.def', '.ldf', '.fd', '.cfg', '.clo'],
  // Markup & docs
  'text/markdown': ['.md', '.markdown'],
  'text/plain': ['.txt', '.log', '.aux', '.toc', '.lof', '.lot', '.out', '.nav', '.snm', '.vrb'],
  'text/csv': ['.csv', '.tsv'],
  'text/x-rst': ['.rst'],
  // Config files
  'application/json': ['.json'],
  'application/x-yaml': ['.yaml', '.yml'],
  'application/toml': ['.toml'],
  'text/x-ini': ['.ini', '.cfg', '.conf'],
  // Programming languages
  'text/javascript': ['.js', '.mjs', '.cjs', '.jsx'],
  'text/typescript': ['.ts', '.tsx'],
  'text/x-python': ['.py', '.pyw'],
  'text/x-java': ['.java'],
  'text/x-c++src': ['.cpp', '.cxx', '.cc', '.hpp', '.hxx', '.h'],
  'text/x-c': ['.c'],
  'text/x-lua': ['.lua'],
  'text/x-r': ['.r', '.R'],
  'text/x-matlab': ['.m'],
  'text/x-sh': ['.sh', '.bash', '.zsh'],
  'text/x-bat': ['.bat', '.cmd'],
  'text/x-sql': ['.sql'],
  // Web files
  'text/html': ['.html', '.htm'],
  'text/css': ['.css', '.scss', '.sass', '.less'],
  'application/xml': ['.xml', '.xsl', '.xslt'],
  // Graphics source files
  'text/x-tikz': ['.tikz', '.pgf'],
  'text/x-asymptote': ['.asy'],
  'text/x-metapost': ['.mp'],
  'text/x-gnuplot': ['.gp', '.gnuplot'],
};

export const SUPPORTED_TEXT_FILE_EXTENSIONS = [
  // LaTeX
  '.tex', '.ltx', '.dtx', '.ins',
  '.bib', '.bst', '.bbx', '.cbx', '.lbx',
  '.sty', '.cls', '.def', '.ldf', '.fd', '.cfg', '.clo',
  '.aux', '.toc', '.lof', '.lot', '.out', '.nav', '.snm', '.vrb',
  // Markup & docs
  '.txt', '.log', '.md', '.markdown', '.rst',
  '.csv', '.tsv',
  // Config
  '.json', '.yaml', '.yml', '.toml', '.ini', '.conf',
  // Programming
  '.js', '.mjs', '.cjs', '.jsx',
  '.ts', '.tsx',
  '.py', '.pyw',
  '.java',
  '.cpp', '.cxx', '.cc', '.hpp', '.hxx', '.h', '.c',
  '.lua', '.r', '.R', '.m',
  '.sh', '.bash', '.zsh', '.bat', '.cmd',
  '.sql',
  // Web
  '.html', '.htm',
  '.css', '.scss', '.sass', '.less',
  '.xml', '.xsl', '.xslt',
  // Graphics source
  '.tikz', '.pgf', '.asy', '.mp', '.gp', '.gnuplot',
];

export const BINARY_FILE_EXTENSIONS = [
  // Images - common
  '.eps',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.tiff',
  '.tif',
  '.pdf',
  '.ps',
  '.svg',
  '.webp',
  '.ico',
  '.heic',
  '.heif',
  '.avif',
  '.psd',
  '.ai',
  // Images - additional formats
  '.raw',
  '.cr2',   // Canon RAW
  '.nef',   // Nikon RAW
  '.dng',   // Adobe Digital Negative
  '.exr',   // OpenEXR HDR
  '.hdr',   // HDR
  '.jfif',  // JPEG variant
  '.jp2',   // JPEG 2000
  '.jpx',   // JPEG 2000 extended
  '.jxr',   // JPEG XR
  '.pgm',   // Portable Graymap
  '.ppm',   // Portable Pixmap
  '.pbm',   // Portable Bitmap
  '.pcx',   // PC Paintbrush
  '.tga',   // Targa
  '.dds',   // DirectDraw Surface
  '.emf',   // Enhanced Metafile
  '.wmf',   // Windows Metafile
  // Fonts - TrueType, OpenType, Web fonts
  '.ttf',
  '.ttc',   // TrueType Collection (multiple fonts in one file)
  '.otf',
  '.otc',   // OpenType Collection
  '.woff',
  '.woff2',
  '.eot',
  '.fon',   // Windows bitmap font
  '.fnt',   // Windows font
  '.dfont', // Mac data fork font
  // Fonts - PostScript Type 1
  '.pfb',
  '.pfa',
  '.afm',
  '.pfm',
  // TeX fonts and binaries
  '.tfm',
  '.vf',
  '.pk',
  '.gf',
  '.mf',
  '.fmt',   // TeX format files
  '.base',  // MetaFont base
  '.mem',   // MetaPost mem
  // SyncTeX (compressed binary)
  '.synctex',
  '.synctex.gz',
  // Archives
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.bz2',
  '.tbz',
  '.tbz2',
  '.xz',
  '.txz',
  '.7z',
  '.rar',
  '.lz',
  '.lzma',
  '.lz4',
  '.zst',
  // Documents (binary office formats)
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
  '.rtf',
  // Audio/Video
  '.mp3',
  '.mp4',
  '.wav',
  '.ogg',
  '.webm',
  '.mov',
  '.avi',
  '.flac',
  '.aac',
  '.m4a',
  '.mkv',
  '.flv',
  // 3D/CAD (rare but possible)
  '.stl',
  '.obj',
  '.fbx',
  '.blend',
  '.3ds',
  // Database files
  '.db',
  '.sqlite',
  '.sqlite3',
  // Compiled/binary code
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.dat',
  '.o',
  '.a',
  '.class',
  '.pyc',
  '.pyo',
  // Other binary
  '.swf',
  '.iso',
  '.dmg',
  '.img',
  '.msi',
  '.deb',
  '.rpm',
  '.apk',
  '.ipa',
] as const;

export const MAX_TEXT_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_BINARY_FILE_SIZE = 50 * 1024 * 1024;

export const IMAGE_FILE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.bmp',
  '.ico',
] as const;

export const SUPPORTED_BINARY_FILE_TYPES = {
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/gif': ['.gif'],
  'image/svg+xml': ['.svg'],
  'image/webp': ['.webp'],
  'image/bmp': ['.bmp'],
  'image/x-icon': ['.ico'],
};

export const ALL_SUPPORTED_FILE_TYPES = {
  ...SUPPORTED_TEXT_FILE_TYPES,
  ...SUPPORTED_BINARY_FILE_TYPES,
};

export const ALL_SUPPORTED_FILE_EXTENSIONS = [
  ...SUPPORTED_TEXT_FILE_EXTENSIONS,
  '.pdf',
  ...IMAGE_FILE_EXTENSIONS,
];

export function isBinaryFile(filename: string): boolean {
  const lowerName = filename.toLowerCase();
  return BINARY_FILE_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
}

export function isImageFile(filename: string): boolean {
  const lowerName = filename.toLowerCase();
  return IMAGE_FILE_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
}

export function isPDFFile(filename: string): boolean {
  return filename.toLowerCase().endsWith('.pdf');
}

export function isTextFile(filename: string): boolean {
  const lowerName = filename.toLowerCase();
  return SUPPORTED_TEXT_FILE_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
}

const BINARY_FILE_MIME_TYPES: Record<string, string> = {
  // Images
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.eps': 'application/postscript',
  '.ps': 'application/postscript',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.avif': 'image/avif',
  '.psd': 'image/vnd.adobe.photoshop',
  '.ai': 'application/illustrator',
  // Fonts - TrueType, OpenType, Web
  '.ttf': 'font/ttf',
  '.ttc': 'font/collection', // TrueType Collection
  '.otf': 'font/otf',
  '.otc': 'font/collection', // OpenType Collection
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.eot': 'application/vnd.ms-fontobject',
  '.fon': 'application/x-font',
  '.fnt': 'application/x-font',
  '.dfont': 'application/x-dfont',
  // Fonts - PostScript Type 1
  '.pfb': 'application/x-font-type1',
  '.pfa': 'application/x-font-type1',
  '.afm': 'application/x-font-afm',
  // TeX fonts
  '.tfm': 'application/x-tex-tfm',
  '.fmt': 'application/x-tex-fmt',
  // Archives
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.bz2': 'application/x-bzip2',
  '.xz': 'application/x-xz',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  // Audio/Video
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
};

export function getContentTypeByFilename(filename: string): string {
  const extension = filename.substring(filename.lastIndexOf('.')).toLowerCase();

  for (const [contentType, extensions] of Object.entries(
    SUPPORTED_TEXT_FILE_TYPES
  )) {
    if (extensions.includes(extension)) {
      return contentType;
    }
  }

  if (BINARY_FILE_MIME_TYPES[extension]) {
    return BINARY_FILE_MIME_TYPES[extension];
  }

  return 'application/octet-stream';
}
