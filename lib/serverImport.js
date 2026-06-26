const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { parseFilename } = require('./parseFilename');
const { mediaTypeFromPath, extFromPath } = require('./mediaTypes');

const THUMB_MAX = 480;

/**
 * @param {string} sourcePath absolute path to file on disk
 * @param {object} ctx
 * @returns {Promise<{ skipped?: boolean, reason?: string, existingId?: string, item?: object }>}
 */
async function importFileFromPath(sourcePath, ctx) {
  const {
    ORIG_DIR,
    THUMB_DIR,
    db,
    hashIndex,
    buildItem,
    sha256File,
    readPngDescription,
    promptFromDescription,
    saveDb,
  } = ctx;

  if (!fs.existsSync(sourcePath)) {
    return { skipped: true, reason: 'missing' };
  }

  const type = mediaTypeFromPath(sourcePath);
  if (!type) return { skipped: true, reason: 'unsupported' };

  const originalName = path.basename(sourcePath);
  const hash = await sha256File(sourcePath);
  if (hashIndex.has(hash)) {
    return { skipped: true, reason: 'duplicate', existingId: hashIndex.get(hash) };
  }

  const parsed = parseFilename(originalName);
  const mjId = typeof parsed.mjId === 'string' ? parsed.mjId : null;
  if (mjId && db.items.some((it) => it.mjId === mjId && it.variantIndex === parsed.variantIndex)) {
    return { skipped: true, reason: 'duplicate-job-id' };
  }

  const id = crypto.randomUUID();
  const ext = '.' + (extFromPath(sourcePath) || 'bin');
  const storedName = id + ext;
  const destPath = path.join(ORIG_DIR, storedName);
  fs.copyFileSync(sourcePath, destPath);

  let width = null;
  let height = null;
  let thumbName = null;

  if (type === 'image') {
    try {
      const meta = await sharp(destPath).rotate().metadata();
      width = meta.width || null;
      height = meta.height || null;
      thumbName = id + '.webp';
      await sharp(destPath)
        .rotate()
        .resize(THUMB_MAX, THUMB_MAX, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(path.join(THUMB_DIR, thumbName));
    } catch (err) {
      console.error('Thumb generation failed for', originalName, err.message);
      thumbName = null;
    }
  }

  let promptValue = parsed.prompt || '';
  if (ext === '.png' && readPngDescription && promptFromDescription) {
    const full = promptFromDescription(readPngDescription(destPath));
    if (full && full.length > promptValue.length) promptValue = full;
  }

  let fileMtime = null;
  try {
    fileMtime = fs.statSync(sourcePath).mtimeMs;
  } catch { /* ignore */ }

  const item = buildItem({
    id,
    hash,
    meta: {
      type,
      prompt: promptValue,
      mjId: parsed.mjId,
      variantIndex: parsed.variantIndex,
      source: parsed.source,
      width,
      height,
      colors: [],
      hueBuckets: [],
      fileMtime,
      displayName: originalName,
      originalName,
      ext: ext.slice(1),
    },
    fileUrl: '/files/originals/' + storedName,
    thumbUrl: thumbName ? '/files/thumbs/' + thumbName : '/files/originals/' + storedName,
    bytes: fs.statSync(destPath).size,
  });

  db.items.unshift(item);
  hashIndex.set(hash, id);
  await saveDb();
  return { item };
}

module.exports = { importFileFromPath };
