const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');

const PORT = process.env.PORT || 4567;

// ---------- Storage mode ----------
// On Vercel the filesystem is ephemeral and per-instance, so files and metadata
// must live in durable services: Vercel Blob for media, Upstash/KV (or a Blob
// JSON fallback) for the metadata db. Local dev keeps the original disk-based
// behavior so daily use is unchanged.
const IS_CLOUD = !!process.env.VERCEL;
const HAS_REDIS = !!(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL);
const STORAGE_MODE = IS_CLOUD ? (HAS_REDIS ? 'redis' : 'blob') : 'local';

const LIB_DIR = process.env.LENS_LIBRARY || (
  IS_CLOUD
    ? path.join(os.tmpdir(), 'lens-library')
    : path.join(os.homedir(), 'Pictures', 'LensLibrary')
);
const ORIG_DIR = path.join(LIB_DIR, 'originals');
const THUMB_DIR = path.join(LIB_DIR, 'thumbs');
const TMP_DIR = path.join(LIB_DIR, 'tmp');
const DB_PATH = path.join(LIB_DIR, 'db.json');

if (!IS_CLOUD) {
  for (const dir of [LIB_DIR, ORIG_DIR, THUMB_DIR, TMP_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ---------- DB shape helpers ----------
function emptyDb() {
  return { items: [], collections: [], srefGroups: [] };
}

function normalizeDb(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  if (!Array.isArray(d.items)) d.items = [];
  if (!Array.isArray(d.collections)) d.collections = [];
  if (!Array.isArray(d.srefGroups)) d.srefGroups = [];
  for (const c of d.collections) if (typeof c.pinned !== 'boolean') c.pinned = false;
  for (const g of d.srefGroups) if (typeof g.pinned !== 'boolean') g.pinned = false;
  return d;
}

let db = emptyDb();
let hashIndex = new Map();
function rebuildHashIndex() {
  hashIndex = new Map(db.items.map((it) => [it.hash, it.id]));
}

// ---------- Cloud metadata store (Redis primary, Blob-JSON fallback) ----------
const DB_KEY = 'lens:db';
const DB_BLOB_PATH = 'lens-db/db.json';
let _redis = null;
let _dbBlobUrl = null;

function redis() {
  if (_redis) return _redis;
  const { Redis } = require('@upstash/redis');
  _redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
  });
  return _redis;
}

async function blobJsonGet() {
  // Fallback metadata store only. Note: Vercel Blob public URLs are CDN-cached,
  // so this is eventually consistent — prefer Redis (KV) for the live db.
  const { list } = require('@vercel/blob');
  const { blobs } = await list({ prefix: DB_BLOB_PATH, limit: 1 });
  const blob = blobs[0];
  if (!blob) return null;
  const r = await fetch(blob.downloadUrl || blob.url, { cache: 'no-store' });
  if (!r.ok) return null;
  return r.json();
}

async function blobJsonPut(data) {
  const { put } = require('@vercel/blob');
  const res = await put(DB_BLOB_PATH, JSON.stringify(data), {
    access: 'public',
    contentType: 'application/json',
    allowOverwrite: true,
    addRandomSuffix: false,
    cacheControlMaxAge: 0,
  });
  _dbBlobUrl = res.url;
}

async function cloudLoad() {
  const raw = HAS_REDIS ? await redis().get(DB_KEY) : await blobJsonGet();
  return normalizeDb(raw || emptyDb());
}

async function cloudSave(data) {
  if (HAS_REDIS) await redis().set(DB_KEY, data);
  else await blobJsonPut(data);
}

async function delBlobs(urls) {
  if (!IS_CLOUD) return;
  const targets = (urls || []).filter((u) => typeof u === 'string' && u.startsWith('http'));
  if (!targets.length) return;
  try {
    const { del } = require('@vercel/blob');
    await del(targets);
  } catch (err) {
    console.error('Blob delete failed:', err);
  }
}

// ---------- Unified load/save ----------
function loadLocalDb() {
  let raw = emptyDb();
  if (fs.existsSync(DB_PATH)) {
    try {
      raw = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    } catch (err) {
      const backup = DB_PATH + '.corrupt-' + Date.now();
      fs.copyFileSync(DB_PATH, backup);
      console.error(`db.json unreadable, backed up to ${backup}`, err);
    }
  }
  db = normalizeDb(raw);
  rebuildHashIndex();
}

let saveTimer = null;
function saveDb() {
  if (IS_CLOUD) return cloudSave(db);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_PATH);
  }, 150);
  return Promise.resolve();
}

function ensureSrefGroupsFromItems() {
  let changed = false;
  const names = new Set(db.srefGroups.map((g) => g.name));
  for (const it of db.items) {
    const s = typeof it.sref === 'string' ? it.sref.trim() : '';
    if (s && !names.has(s)) {
      db.srefGroups.push({ id: crypto.randomUUID(), name: s, pinned: false, createdAt: Date.now() });
      names.add(s);
      changed = true;
    }
  }
  return changed;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

// Midjourney embeds the full prompt in the PNG `Description` text chunk —
// the filename only carries a truncated slice. Read it without extra deps.
function readPngDescription(absPath) {
  try {
    if (path.extname(absPath).toLowerCase() !== '.png') return null;
    const data = fs.readFileSync(absPath);
    if (data.length < 8 || data[0] !== 0x89 || data[1] !== 0x50) return null;
    const texts = {};
    let i = 8;
    while (i + 8 <= data.length) {
      const len = data.readUInt32BE(i);
      const type = data.toString('latin1', i + 4, i + 8);
      const start = i + 8;
      const end = start + len;
      if (end > data.length) break;
      const chunk = data.subarray(start, end);
      if (type === 'tEXt') {
        const nul = chunk.indexOf(0);
        if (nul > -1) texts[chunk.toString('latin1', 0, nul)] = chunk.toString('latin1', nul + 1);
      } else if (type === 'iTXt') {
        const nul = chunk.indexOf(0);
        if (nul > -1) {
          const key = chunk.toString('latin1', 0, nul);
          const compFlag = chunk[nul + 1];
          let p = nul + 3;
          const langEnd = chunk.indexOf(0, p); p = langEnd + 1;
          const transEnd = chunk.indexOf(0, p); p = transEnd + 1;
          const textBuf = chunk.subarray(p);
          let val = '';
          if (compFlag === 1) { try { val = zlib.inflateSync(textBuf).toString('utf8'); } catch { val = ''; } }
          else val = textBuf.toString('utf8');
          if (!texts[key]) texts[key] = val;
        }
      } else if (type === 'zTXt') {
        const nul = chunk.indexOf(0);
        if (nul > -1) {
          const key = chunk.toString('latin1', 0, nul);
          try { texts[key] = zlib.inflateSync(chunk.subarray(nul + 2)).toString('latin1'); } catch { /* ignore */ }
        }
      }
      if (type === 'IEND') break;
      i = end + 4; // skip 4-byte CRC
    }
    return texts.Description || texts.description || null;
  } catch {
    return null;
  }
}

// Strip the trailing "Job ID: <uuid>" that Midjourney appends to Description.
function promptFromDescription(desc) {
  if (!desc) return '';
  return String(desc).replace(/\s*Job ID:\s*[0-9a-f-]+\s*$/i, '').trim();
}

// One-time recovery of full prompts for already-imported PNGs (local only).
function backfillPromptsFromMetadata() {
  if (db.metaPromptBackfillV1) return;
  let updated = 0;
  for (const it of db.items) {
    if (it.type !== 'image' || it.ext !== 'png') continue;
    if (!it.fileUrl || !it.fileUrl.startsWith('/files/')) continue;
    const abs = path.join(LIB_DIR, it.fileUrl.replace('/files/', ''));
    if (!fs.existsSync(abs)) continue;
    const full = promptFromDescription(readPngDescription(abs));
    if (full && full.length > (it.prompt || '').length) {
      it.prompt = full;
      updated += 1;
    }
  }
  db.metaPromptBackfillV1 = true;
  saveDb();
  if (updated) console.log(`Recovered full prompts from metadata for ${updated} item(s)`);
}

let lastAddedAt = 0;
function nextAddedAt() {
  const now = Date.now();
  lastAddedAt = now > lastAddedAt ? now : lastAddedAt + 1;
  return lastAddedAt;
}

function buildItem({ id, hash, meta, fileUrl, thumbUrl, bytes }) {
  const ext = (meta.ext || (path.extname(meta.displayName || meta.originalName || '') || '.bin').slice(1) || 'bin')
    .toLowerCase().replace(/^\./, '');
  return {
    id,
    hash,
    mjId: typeof meta.mjId === 'string' ? meta.mjId : null,
    variantIndex: meta.variantIndex ?? null,
    originalName: meta.originalName || meta.displayName || '',
    displayName: meta.displayName || meta.originalName || '',
    prompt: meta.prompt || '',
    source: meta.source || 'other',
    type: meta.type === 'video' ? 'video' : 'image',
    ext,
    width: meta.width || null,
    height: meta.height || null,
    bytes: bytes || 0,
    colors: Array.isArray(meta.colors) ? meta.colors.slice(0, 6) : [],
    hueBuckets: Array.isArray(meta.hueBuckets) ? meta.hueBuckets : [],
    tags: [],
    sref: '',
    favorite: false,
    addedAt: nextAddedAt(),
    fileMtime: meta.fileMtime || null,
    fileUrl,
    thumbUrl: thumbUrl || fileUrl,
  };
}

const upload = multer({
  storage: multer.diskStorage({
    destination: TMP_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname)),
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
});

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));
app.use('/vendor/@paper-design/shaders', express.static(path.join(__dirname, 'node_modules/@paper-design/shaders/dist'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));
if (!IS_CLOUD) {
  app.use('/files', express.static(LIB_DIR));
}

// In cloud mode the metadata db lives in a shared store, so reload it before
// each API request (except the upload-token endpoint which doesn't touch it).
app.use('/api', async (req, res, next) => {
  if (!IS_CLOUD || req.path === '/blob-upload') return next();
  try {
    db = await cloudLoad();
    rebuildHashIndex();
    next();
  } catch (err) {
    console.error('Storage load failed:', err);
    res.status(500).json({ error: 'Storage unavailable' });
  }
});

app.get('/api/items', async (req, res) => {
  if (ensureSrefGroupsFromItems()) await saveDb();
  res.set('Cache-Control', 'no-store');
  res.json({
    items: db.items,
    collections: db.collections,
    srefGroups: db.srefGroups,
    libraryPath: LIB_DIR,
    storage: STORAGE_MODE,
    cloud: IS_CLOUD,
  });
});

// ---------- Collections ----------
app.post('/api/collections', async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  const collection = { id: crypto.randomUUID(), name, itemIds: [], pinned: false, createdAt: Date.now() };
  db.collections.push(collection);
  await saveDb();
  res.json({ collection });
});

app.patch('/api/collections/:id', async (req, res) => {
  const collection = db.collections.find((c) => c.id === req.params.id);
  if (!collection) return res.status(404).json({ error: 'Not found' });
  if (typeof req.body.name === 'string' && req.body.name.trim()) {
    collection.name = req.body.name.trim();
  }
  if (typeof req.body.pinned === 'boolean') {
    collection.pinned = req.body.pinned;
  }
  if (Array.isArray(req.body.addItemIds)) {
    for (const id of req.body.addItemIds) {
      if (!collection.itemIds.includes(id) && db.items.some((it) => it.id === id)) {
        collection.itemIds.push(id);
      }
    }
  }
  if (Array.isArray(req.body.removeItemIds)) {
    collection.itemIds = collection.itemIds.filter((id) => !req.body.removeItemIds.includes(id));
  }
  await saveDb();
  res.json({ collection });
});

app.delete('/api/collections/:id', async (req, res) => {
  const idx = db.collections.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.collections.splice(idx, 1);
  await saveDb();
  res.json({ ok: true });
});

app.put('/api/collections/reorder', async (req, res) => {
  const ids = req.body && req.body.ids;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids required' });
  const byId = new Map(db.collections.map((c) => [c.id, c]));
  if (ids.length !== db.collections.length || ids.some((id) => !byId.has(id))) {
    return res.status(400).json({ error: 'ids must include every collection once' });
  }
  db.collections = ids.map((id) => byId.get(id));
  await saveDb();
  res.json({ collections: db.collections });
});

// ---------- Sref groups (sidebar folders) ----------
app.post('/api/sref-groups', async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  const group = { id: crypto.randomUUID(), name, pinned: false, createdAt: Date.now() };
  db.srefGroups.push(group);
  await saveDb();
  res.json({ group });
});

app.patch('/api/sref-groups/:id', async (req, res) => {
  const group = db.srefGroups.find((g) => g.id === req.params.id);
  if (!group) return res.status(404).json({ error: 'Not found' });
  if (typeof req.body.pinned === 'boolean') {
    group.pinned = req.body.pinned;
  }
  const nextName = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (nextName && nextName !== group.name) {
    const prevName = group.name;
    group.name = nextName;
    for (const it of db.items) {
      if (it.sref === prevName) it.sref = nextName;
    }
  }
  await saveDb();
  res.json({ group });
});

app.delete('/api/sref-groups/:id', async (req, res) => {
  const group = db.srefGroups.find((g) => g.id === req.params.id);
  if (!group) return res.status(404).json({ error: 'Not found' });
  for (const it of db.items) {
    if (it.sref === group.name) it.sref = '';
  }
  db.srefGroups = db.srefGroups.filter((g) => g.id !== group.id);
  await saveDb();
  res.json({ ok: true });
});

// ---------- Blob client-upload token endpoint (cloud only) ----------
async function blobUpload(req, res) {
  const { handleUpload } = require('@vercel/blob/client');
  try {
    const json = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: [
          'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif',
          'image/bmp', 'image/tiff', 'video/mp4', 'video/quicktime', 'video/webm',
          'application/octet-stream',
        ],
        maximumSizeInBytes: 2 * 1024 * 1024 * 1024,
        addRandomSuffix: true,
      }),
      onUploadCompleted: async () => { /* no-op: metadata is recorded by /api/import */ },
    });
    res.json(json);
  } catch (err) {
    console.error('Blob upload token failed:', err);
    res.status(400).json({ error: err.message });
  }
}

// ---------- Import: cloud (metadata only) vs local (multipart to disk) ----------
async function importCloud(req, res) {
  try {
    const meta = req.body && req.body.meta && typeof req.body.meta === 'object' ? req.body.meta : {};
    const fileUrl = req.body && req.body.fileUrl;
    const thumbUrl = req.body && req.body.thumbUrl;
    const hash = req.body && req.body.hash;
    const bytes = req.body && req.body.bytes;
    if (!fileUrl || !hash) {
      await delBlobs([fileUrl, thumbUrl]);
      return res.status(400).json({ error: 'Missing fileUrl or hash' });
    }
    if (hashIndex.has(hash)) {
      await delBlobs([fileUrl, thumbUrl]);
      return res.json({ skipped: true, reason: 'duplicate', existingId: hashIndex.get(hash) });
    }
    const mjId = typeof meta.mjId === 'string' ? meta.mjId : null;
    if (mjId && db.items.some((it) => it.mjId === mjId && it.variantIndex === meta.variantIndex)) {
      await delBlobs([fileUrl, thumbUrl]);
      return res.json({ skipped: true, reason: 'duplicate-job-id' });
    }
    const id = crypto.randomUUID();
    const item = buildItem({ id, hash, meta, fileUrl, thumbUrl, bytes });
    db.items.unshift(item);
    hashIndex.set(hash, id);
    await saveDb();
    res.json({ item });
  } catch (err) {
    console.error('Import (cloud) failed:', err);
    res.status(500).json({ error: err.message });
  }
}

async function importLocal(req, res) {
  const fileUpload = req.files && req.files.file && req.files.file[0];
  const thumbUpload = req.files && req.files.thumb && req.files.thumb[0];
  const cleanup = () => {
    for (const f of [fileUpload, thumbUpload]) {
      if (f) fs.rm(f.path, { force: true }, () => {});
    }
  };

  try {
    if (!fileUpload) {
      cleanup();
      return res.status(400).json({ error: 'No file provided' });
    }
    let meta = {};
    try {
      meta = JSON.parse(req.body.meta || '{}');
    } catch {
      meta = {};
    }

    const hash = await sha256File(fileUpload.path);
    if (hashIndex.has(hash)) {
      cleanup();
      return res.json({ skipped: true, reason: 'duplicate', existingId: hashIndex.get(hash) });
    }
    const mjId = typeof meta.mjId === 'string' ? meta.mjId : null;
    if (mjId && db.items.some((it) => it.mjId === mjId && it.variantIndex === meta.variantIndex)) {
      cleanup();
      return res.json({ skipped: true, reason: 'duplicate-job-id' });
    }

    const id = crypto.randomUUID();
    const ext = (path.extname(fileUpload.originalname) || '.bin').toLowerCase();
    const storedName = id + ext;
    fs.renameSync(fileUpload.path, path.join(ORIG_DIR, storedName));

    let thumbName = null;
    if (thumbUpload) {
      thumbName = id + '.webp';
      fs.renameSync(thumbUpload.path, path.join(THUMB_DIR, thumbName));
    }

    // Prefer the full prompt embedded in PNG metadata over the truncated filename slice.
    let promptValue = meta.prompt || '';
    if (ext === '.png') {
      const full = promptFromDescription(readPngDescription(path.join(ORIG_DIR, storedName)));
      if (full && full.length > promptValue.length) promptValue = full;
    }

    const item = buildItem({
      id,
      hash,
      meta: { ...meta, ext: ext.slice(1), originalName: fileUpload.originalname, prompt: promptValue },
      fileUrl: '/files/originals/' + storedName,
      thumbUrl: thumbName ? '/files/thumbs/' + thumbName : '/files/originals/' + storedName,
      bytes: fileUpload.size,
    });

    db.items.unshift(item);
    hashIndex.set(hash, id);
    await saveDb();
    res.json({ item });
  } catch (err) {
    cleanup();
    console.error('Import failed:', err);
    res.status(500).json({ error: err.message });
  }
}

if (IS_CLOUD) {
  app.post('/api/blob-upload', blobUpload);
  app.post('/api/import', importCloud);
} else {
  app.post('/api/import', upload.fields([{ name: 'file', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]), importLocal);
}

app.patch('/api/items/:id', async (req, res) => {
  const item = db.items.find((it) => it.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const { displayName, tags, sref, favorite, prompt } = req.body;
  if (typeof displayName === 'string' && displayName.trim()) item.displayName = displayName.trim();
  if (typeof prompt === 'string' && prompt.trim()) item.prompt = prompt.trim();
  if (Array.isArray(tags)) item.tags = tags.map((t) => String(t).trim()).filter(Boolean);
  if (typeof sref === 'string') item.sref = sref.trim();
  if (typeof favorite === 'boolean') item.favorite = favorite;
  await saveDb();
  res.json({ item });
});

async function deleteItemsById(ids) {
  const idSet = new Set(ids);
  const removed = [];
  db.items = db.items.filter((it) => {
    if (!idSet.has(it.id)) return true;
    removed.push(it);
    hashIndex.delete(it.hash);
    return false;
  });
  for (const c of db.collections) {
    c.itemIds = c.itemIds.filter((id) => !idSet.has(id));
  }
  if (IS_CLOUD) {
    await delBlobs(removed.flatMap((it) => [it.fileUrl, it.thumbUrl]));
  } else {
    for (const item of removed) {
      for (const url of [item.fileUrl, item.thumbUrl]) {
        if (url && url.startsWith('/files/')) {
          fs.rm(path.join(LIB_DIR, url.replace('/files/', '')), { force: true }, () => {});
        }
      }
    }
  }
  if (removed.length) await saveDb();
  return removed;
}

app.post('/api/items/batch-delete', async (req, res) => {
  const ids = req.body && req.body.ids;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids required' });
  const unique = [...new Set(ids.map(String))];
  const removed = await deleteItemsById(unique);
  if (!removed.length) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true, deleted: removed.map((it) => it.id) });
});

app.delete('/api/items/:id', async (req, res) => {
  const removed = await deleteItemsById([req.params.id]);
  if (!removed.length) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

if (!IS_CLOUD) {
  loadLocalDb();
  backfillPromptsFromMetadata();
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Lens running at http://localhost:${PORT}`);
    console.log(`Library: ${LIB_DIR}  (storage: ${STORAGE_MODE})`);
  });
}

module.exports = app;
