const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');

const PORT = process.env.PORT || 4567;
const LIB_DIR = process.env.LENS_LIBRARY || path.join(os.homedir(), 'Pictures', 'LensLibrary');
const ORIG_DIR = path.join(LIB_DIR, 'originals');
const THUMB_DIR = path.join(LIB_DIR, 'thumbs');
const TMP_DIR = path.join(LIB_DIR, 'tmp');
const DB_PATH = path.join(LIB_DIR, 'db.json');

for (const dir of [LIB_DIR, ORIG_DIR, THUMB_DIR, TMP_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

let db = { items: [] };
if (fs.existsSync(DB_PATH)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (err) {
    // Corrupt db is preserved for manual recovery rather than overwritten
    const backup = DB_PATH + '.corrupt-' + Date.now();
    fs.copyFileSync(DB_PATH, backup);
    console.error(`db.json unreadable, backed up to ${backup}`, err);
  }
}
if (!Array.isArray(db.items)) db.items = [];
if (!Array.isArray(db.collections)) db.collections = [];
if (!Array.isArray(db.srefGroups)) db.srefGroups = [];
// Backfill the pinned flag on collections persisted before pinning existed
for (const c of db.collections) {
  if (typeof c.pinned !== 'boolean') c.pinned = false;
}
for (const g of db.srefGroups) {
  if (typeof g.pinned !== 'boolean') g.pinned = false;
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
  if (changed) saveDb();
}

const hashIndex = new Map(db.items.map((it) => [it.hash, it.id]));

let saveTimer = null;
function saveDb() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_PATH);
  }, 150);
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

// One-time recovery of full prompts for already-imported PNGs.
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

const upload = multer({
  storage: multer.diskStorage({
    destination: TMP_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname)),
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
});

const app = express();
app.use(express.json({ limit: '5mb' }));
// Dev server: never cache app shell assets so edits always show on reload
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));
app.use('/files', express.static(LIB_DIR));

app.get('/api/items', (req, res) => {
  ensureSrefGroupsFromItems();
  res.json({ items: db.items, collections: db.collections, srefGroups: db.srefGroups, libraryPath: LIB_DIR });
});

// ---------- Collections ----------
app.post('/api/collections', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  const collection = { id: crypto.randomUUID(), name, itemIds: [], pinned: false, createdAt: Date.now() };
  db.collections.push(collection);
  saveDb();
  res.json({ collection });
});

app.patch('/api/collections/:id', (req, res) => {
  const collection = db.collections.find((c) => c.id === req.params.id);
  if (!collection) return res.status(404).json({ error: 'Not found' });
  if (typeof req.body.name === 'string' && req.body.name.trim()) {
    collection.name = req.body.name.trim();
  }
  if (typeof req.body.pinned === 'boolean') {
    collection.pinned = req.body.pinned;
  }
  // add and/or remove members in one call
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
  saveDb();
  res.json({ collection });
});

app.delete('/api/collections/:id', (req, res) => {
  const idx = db.collections.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.collections.splice(idx, 1);
  saveDb();
  res.json({ ok: true });
});

app.put('/api/collections/reorder', (req, res) => {
  const ids = req.body && req.body.ids;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids required' });
  const byId = new Map(db.collections.map((c) => [c.id, c]));
  if (ids.length !== db.collections.length || ids.some((id) => !byId.has(id))) {
    return res.status(400).json({ error: 'ids must include every collection once' });
  }
  db.collections = ids.map((id) => byId.get(id));
  saveDb();
  res.json({ collections: db.collections });
});

// ---------- Sref groups (sidebar folders) ----------
app.post('/api/sref-groups', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  const group = { id: crypto.randomUUID(), name, pinned: false, createdAt: Date.now() };
  db.srefGroups.push(group);
  saveDb();
  res.json({ group });
});

app.patch('/api/sref-groups/:id', (req, res) => {
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
  saveDb();
  res.json({ group });
});

app.delete('/api/sref-groups/:id', (req, res) => {
  const group = db.srefGroups.find((g) => g.id === req.params.id);
  if (!group) return res.status(404).json({ error: 'Not found' });
  for (const it of db.items) {
    if (it.sref === group.name) it.sref = '';
  }
  db.srefGroups = db.srefGroups.filter((g) => g.id !== group.id);
  saveDb();
  res.json({ ok: true });
});

app.post('/api/import', upload.fields([{ name: 'file', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]), async (req, res) => {
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

    const item = {
      id,
      hash,
      mjId,
      variantIndex: meta.variantIndex ?? null,
      originalName: fileUpload.originalname,
      displayName: meta.displayName || fileUpload.originalname,
      prompt: promptValue,
      source: meta.source || 'other',
      type: meta.type === 'video' ? 'video' : 'image',
      ext: ext.slice(1),
      width: meta.width || null,
      height: meta.height || null,
      bytes: fileUpload.size,
      colors: Array.isArray(meta.colors) ? meta.colors.slice(0, 6) : [],
      hueBuckets: Array.isArray(meta.hueBuckets) ? meta.hueBuckets : [],
      tags: [],
      sref: '',
      favorite: false,
      addedAt: Date.now(),
      fileMtime: meta.fileMtime || null,
      fileUrl: '/files/originals/' + storedName,
      thumbUrl: thumbName ? '/files/thumbs/' + thumbName : '/files/originals/' + storedName,
    };

    db.items.unshift(item);
    hashIndex.set(hash, id);
    saveDb();
    res.json({ item });
  } catch (err) {
    cleanup();
    console.error('Import failed:', err);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/items/:id', (req, res) => {
  const item = db.items.find((it) => it.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const { displayName, tags, sref, favorite } = req.body;
  if (typeof displayName === 'string' && displayName.trim()) item.displayName = displayName.trim();
  if (Array.isArray(tags)) item.tags = tags.map((t) => String(t).trim()).filter(Boolean);
  if (typeof sref === 'string') item.sref = sref.trim();
  if (typeof favorite === 'boolean') item.favorite = favorite;
  saveDb();
  res.json({ item });
});

app.delete('/api/items/:id', (req, res) => {
  const idx = db.items.findIndex((it) => it.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const [item] = db.items.splice(idx, 1);
  hashIndex.delete(item.hash);
  for (const c of db.collections) {
    c.itemIds = c.itemIds.filter((id) => id !== item.id);
  }
  for (const url of [item.fileUrl, item.thumbUrl]) {
    if (url && url.startsWith('/files/')) {
      fs.rm(path.join(LIB_DIR, url.replace('/files/', '')), { force: true }, () => {});
    }
  }
  saveDb();
  res.json({ ok: true });
});

backfillPromptsFromMetadata();

app.listen(PORT, () => {
  console.log(`Lens running at http://localhost:${PORT}`);
  console.log(`Library: ${LIB_DIR}`);
});
