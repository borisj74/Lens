const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'tif', 'tiff']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'm4v']);

function extFromPath(filePath) {
  return (filePath.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
}

function mediaTypeFromPath(filePath) {
  const ext = extFromPath(filePath);
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return null;
}

function isMediaPath(filePath) {
  const base = require('path').basename(filePath);
  if (base.startsWith('.')) return false;
  return Boolean(mediaTypeFromPath(filePath));
}

module.exports = { IMAGE_EXTS, VIDEO_EXTS, extFromPath, mediaTypeFromPath, isMediaPath };
