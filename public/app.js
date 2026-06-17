/* Lens v1 — local AI media library */
window.__lensVer = 25;

const HUE_BUCKETS = [
  { key: 'red', hex: '#D64545', range: [345, 15] },
  { key: 'orange', hex: '#E08A3C', range: [15, 45] },
  { key: 'yellow', hex: '#D9C13B', range: [45, 70] },
  { key: 'green', hex: '#4FA85C', range: [70, 160] },
  { key: 'cyan', hex: '#3FA8B8', range: [160, 200] },
  { key: 'blue', hex: '#4169C9', range: [200, 250] },
  { key: 'purple', hex: '#8A52C9', range: [250, 290] },
  { key: 'pink', hex: '#D4569E', range: [290, 345] },
  { key: 'white', hex: '#F5F5F5' },
  { key: 'gray', hex: '#9A9A9A' },
  { key: 'black', hex: '#262626' },
  { key: 'brown', hex: '#8A5A3B' },
];

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'tif', 'tiff']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'm4v']);

const state = {
  items: [],
  collections: [],
  srefGroups: [],
  selection: new Set(),       // ids of selected cards
  activeCollection: null,     // collection id being viewed, or null
  activeSref: null,           // sref value being viewed, or null
  cloud: false,               // true when the server stores media in Vercel Blob
  collectionOrganize: false,  // selection mode on single collection page
  libraryView: null,          // null | 'collections' | 'srefs' — full-page browse from "View all"
  filters: { q: '', colors: new Set(), pickedColor: null, types: new Set(), sources: new Set(), sizes: new Set(), tags: new Set(), favOnly: false },
  sort: 'added-desc',
  detailId: null,
  detailZoom: 100,
  collectMenuAnchor: null,
  srefMenuAnchor: null,
};

let suppressCollectionClick = false;
let suppressSrefClick = false;
let collectionClickTimer = null;
let suppressCollectionNavClick = false;
let suppressCollectionReorderClick = false;
let srefClickTimer = null;
let suppressSrefNavClick = false;

function itemSizeBucket(it) {
  const mp = it.width && it.height ? (it.width * it.height) / 1e6 : null;
  if (mp == null) return null;
  if (mp < 1) return 's';
  if (mp <= 4) return 'm';
  return 'l';
}

function formatSourceLabel(source) {
  if (source === 'midjourney') return 'Midjourney';
  if (source === 'other') return 'Other';
  return source.charAt(0).toUpperCase() + source.slice(1);
}

const $ = (id) => document.getElementById(id);

/* ---------- Filename parsing ---------- */

function parseFilename(name) {
  const base = name.replace(/\.[^.]+$/, '');
  const ext = (name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
  // Midjourney: username_prompt_words_<uuid>_<n>
  const mj = base.match(/^(.+)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_(\d+))?$/i);
  if (mj) {
    const head = mj[1];
    const firstUnderscore = head.indexOf('_');
    const prompt = (firstUnderscore > -1 ? head.slice(firstUnderscore + 1) : head).replace(/_/g, ' ').trim();
    return { prompt, mjId: mj[2].toLowerCase(), variantIndex: mj[3] != null ? Number(mj[3]) : null, source: 'midjourney', ext };
  }
  let source = 'other';
  if (/seedance/i.test(base)) source = 'seedance';
  else if (/nano.?banana/i.test(base)) source = 'nanobanana';
  else if (/^(dalle|gpt|chatgpt|openai)/i.test(base)) source = 'gpt';
  return { prompt: '', mjId: null, variantIndex: null, source, ext };
}

/* ---------- Color analysis ---------- */

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function hsvToHex(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    const c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return ('#' + f(5) + f(3) + f(1)).toUpperCase();
}

function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  return rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

// Loose perceptual match: same hue family + similar lightness
function colorClose(hexA, hexTarget) {
  const [h1, s1, l1] = hexToHsl(hexA);
  const [h2, s2, l2] = hexToHsl(hexTarget);
  if (s2 < 0.15) {
    // target is gray/white/black — match on lightness, ignore hue
    return s1 < 0.28 && Math.abs(l1 - l2) < 0.18;
  }
  const hueDiff = Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2));
  return s1 >= 0.10 && hueDiff <= 32 && Math.abs(l1 - l2) <= 0.28;
}

function bucketFor(h, s, l) {
  if (l > 0.88 && s < 0.25) return 'white';
  if (l < 0.12) return 'black';
  if (s < 0.13) return 'gray';
  // Brown: dark/desaturated orange territory
  if (h >= 15 && h < 50 && l < 0.45 && s < 0.65) return 'brown';
  for (const b of HUE_BUCKETS) {
    if (!b.range) continue;
    const [a, z] = b.range;
    if (a > z ? (h >= a || h < z) : (h >= a && h < z)) return b.key;
  }
  return 'gray';
}

function analyzeCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const quant = new Map();
  const buckets = new Map();
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    total++;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const q = quant.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    q.n++; q.r += r; q.g += g; q.b += b;
    quant.set(key, q);
    const [h, s, l] = rgbToHsl(r, g, b);
    const bk = bucketFor(h, s, l);
    buckets.set(bk, (buckets.get(bk) || 0) + 1);
  }
  if (!total) return { colors: [], hueBuckets: [] };
  const colors = [...quant.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 5)
    .map((q) => {
      const hex = '#' + [q.r, q.g, q.b].map((v) => Math.round(v / q.n).toString(16).padStart(2, '0')).join('').toUpperCase();
      return { hex, frac: +(q.n / total).toFixed(3) };
    });
  const hueBuckets = [...buckets.entries()]
    .filter(([, n]) => n / total >= 0.04)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
  return { colors, hueBuckets };
}

function loadImageMeta(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const { canvas: analysisCanvas } = drawScaled(img, img.naturalWidth, img.naturalHeight, 64);
        const { canvas: thumbCanvas } = drawScaled(img, img.naturalWidth, img.naturalHeight, 480);
        const analysis = analyzeCanvas(analysisCanvas);
        thumbCanvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          resolve({ width: img.naturalWidth, height: img.naturalHeight, thumb: blob, ...analysis });
        }, 'image/webp', 0.82);
      } catch (err) { URL.revokeObjectURL(url); reject(err); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Cannot decode image')); };
    img.src = url;
  });
}

function loadVideoMeta(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    const fail = () => { URL.revokeObjectURL(url); reject(new Error('Cannot decode video')); };
    video.onerror = fail;
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
    };
    video.onseeked = () => {
      try {
        const { canvas: analysisCanvas } = drawScaled(video, video.videoWidth, video.videoHeight, 64);
        const { canvas: thumbCanvas } = drawScaled(video, video.videoWidth, video.videoHeight, 480);
        const analysis = analyzeCanvas(analysisCanvas);
        thumbCanvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          resolve({ width: video.videoWidth, height: video.videoHeight, duration: video.duration, thumb: blob, ...analysis });
        }, 'image/webp', 0.82);
      } catch (err) { fail(); }
    };
    video.src = url;
  });
}

function drawScaled(source, w, h, maxDim) {
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return { canvas };
}

/* ---------- Import pipeline ---------- */

async function collectFiles(dataTransfer) {
  const files = [];
  const entries = [];
  for (const item of dataTransfer.items) {
    const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
    if (entry) entries.push(entry);
    else {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }
  async function walk(entry) {
    if (entry.isFile) {
      const f = await new Promise((res, rej) => entry.file(res, rej));
      files.push(f);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e);
      } while (batch.length);
    }
  }
  for (const e of entries) await walk(e);
  return files;
}

function mediaType(file) {
  const ext = (file.name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
  if (IMAGE_EXTS.has(ext) || file.type.startsWith('image/')) return 'image';
  if (VIDEO_EXTS.has(ext) || file.type.startsWith('video/')) return 'video';
  return null;
}

// Lazily pull the Vercel Blob browser client (only needed in cloud mode).
let _blobClientPromise = null;
function loadBlobClient() {
  if (!_blobClientPromise) {
    _blobClientPromise = import('https://esm.sh/@vercel/blob@2/client');
  }
  return _blobClientPromise;
}

async function sha256Hex(file) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Local server: stream the file through the API to disk.
async function importViaServer(file, metaObj, thumbBlob) {
  const form = new FormData();
  form.append('meta', JSON.stringify(metaObj));
  form.append('file', file, file.name);
  if (thumbBlob) form.append('thumb', thumbBlob, 'thumb.webp');
  const res = await fetch('/api/import', { method: 'POST', body: form });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Import failed');
  return json;
}

// Cloud: upload bytes straight to Vercel Blob (bypassing the 4.5 MB function
// body limit), then record the metadata + resulting URLs via the API.
async function importViaBlob(file, metaObj, thumbBlob) {
  const { upload } = await loadBlobClient();
  const base = crypto.randomUUID();
  const ext = metaObj.ext || 'bin';
  const fileRes = await upload(`originals/${base}.${ext}`, file, {
    access: 'public',
    handleUploadUrl: '/api/blob-upload',
    contentType: file.type || undefined,
  });
  let thumbUrl = fileRes.url;
  if (thumbBlob) {
    const thumbRes = await upload(`thumbs/${base}.webp`, thumbBlob, {
      access: 'public',
      handleUploadUrl: '/api/blob-upload',
      contentType: 'image/webp',
    });
    thumbUrl = thumbRes.url;
  }
  const hash = await sha256Hex(file);
  const res = await fetch('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meta: metaObj, fileUrl: fileRes.url, thumbUrl, hash, bytes: file.size }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Import failed');
  return json;
}

async function importFiles(fileList) {
  const files = [...fileList].filter((f) => mediaType(f) && !f.name.startsWith('.'));
  if (!files.length) {
    toast('No images or videos found in drop.', 'error');
    return;
  }
  const progress = $('import-progress');
  const fill = $('progress-fill');
  progress.hidden = false;
  let done = 0, added = 0, skipped = 0, failed = 0;
  const importedIds = [];

  for (const file of files) {
    $('progress-label').textContent = `Importing ${file.name}`;
    $('progress-count').textContent = `${done + 1} / ${files.length}`;
    try {
      const type = mediaType(file);
      const parsed = parseFilename(file.name);
      const meta = type === 'image' ? await loadImageMeta(file) : await loadVideoMeta(file);

      const metaObj = {
        type,
        prompt: parsed.prompt,
        mjId: parsed.mjId,
        variantIndex: parsed.variantIndex,
        source: parsed.source,
        width: meta.width,
        height: meta.height,
        colors: meta.colors,
        hueBuckets: meta.hueBuckets,
        fileMtime: file.lastModified,
        displayName: file.name,
        originalName: file.name,
        ext: (file.name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase(),
      };

      const json = state.cloud
        ? await importViaBlob(file, metaObj, meta.thumb)
        : await importViaServer(file, metaObj, meta.thumb);
      if (json.skipped) skipped++;
      else { state.items.unshift(json.item); importedIds.push(json.item.id); added++; }
    } catch (err) {
      console.error('Import failed for', file.name, err);
      failed++;
    }
    done++;
    fill.style.width = `${Math.round((done / files.length) * 100)}%`;
    if (done % 10 === 0 || done === files.length) render();
  }

  progress.hidden = true;
  fill.style.width = '0%';

  const activeCid = state.activeCollection && !state.libraryView ? state.activeCollection : null;
  if (activeCid && importedIds.length) {
    const c = state.collections.find((x) => x.id === activeCid);
    if (c) {
      const { collection: updated } = await apiCollection('PATCH', '/' + c.id, { addItemIds: importedIds }) || {};
      if (updated) {
        const idx = state.collections.findIndex((x) => x.id === c.id);
        if (idx >= 0) state.collections[idx] = updated;
      }
    }
  }

  render();
  if (added > 0) {
    const c = activeCid ? state.collections.find((x) => x.id === activeCid) : null;
    const parts = [c ? `${added} added to “${c.name}”` : `${added} added to library`];
    if (skipped) parts.push(`${skipped} duplicate${skipped > 1 ? 's' : ''} skipped`);
    if (failed) parts.push(`${failed} failed`);
    showSnack(state.items[0], parts.join(' · '));
    if (failed) toast(`${failed} file${failed > 1 ? 's' : ''} failed to import`, 'error');
  } else {
    const parts = [];
    if (skipped) parts.push(`${skipped} duplicate${skipped > 1 ? 's' : ''} skipped`);
    if (failed) parts.push(`${failed} failed`);
    toast(parts.join(', ') || 'Nothing imported', failed ? 'error' : 'success');
  }
}

/* ---------- Filtering & sorting ---------- */

const VALID_SORTS = new Set(['added-desc', 'added-asc', 'name-asc', 'name-desc', 'random', 'manual']);

function normalizeSort() {
  if (!VALID_SORTS.has(state.sort)) state.sort = 'added-desc';
}

function syncSortUI() {
  const sortMenu = $('sort-menu');
  if (!sortMenu) return;
  normalizeSort();
  sortMenu.querySelectorAll('.sort-option').forEach((o) => {
    const active = o.dataset.value === state.sort;
    o.classList.toggle('active', active);
    if (active) $('sort-label').textContent = o.textContent;
  });
  if (state.sort === 'manual') {
    $('sort-label').textContent = 'Custom';
    sortMenu.querySelectorAll('.sort-option').forEach((o) => o.classList.remove('active'));
  }
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sortList(list, { date = () => 0, name = (x) => String(x), orderSource = null } = {}) {
  normalizeSort();
  if (state.sort === 'manual' && orderSource) {
    const orderMap = new Map(orderSource.map((x, i) => [x.id, i]));
    return list.slice().sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
  }
  if (state.sort === 'random') return shuffleArray(list);
  const [key, dir] = state.sort.split('-');
  const mul = dir === 'asc' ? 1 : -1;
  const out = list.slice();
  out.sort((a, b) => {
    if (key === 'added') return (date(a) - date(b)) * mul;
    return name(a).localeCompare(name(b), undefined, { sensitivity: 'base' }) * mul;
  });
  return out;
}

function applyPickedColorFilter(hex) {
  state.filters.pickedColor = hex;
  render();
}

// "More like this (sref)": focus the gallery on every item sharing this sref.
// Replaces any existing sref selection so it reads as a clean "show all with this sref".
function findSimilarBySref(id) {
  const it = state.items.find((i) => i.id === id);
  if (!it || !it.sref) return;
  state.activeSref = it.sref;
  state.activeCollection = null;
  state.filters.favOnly = false;
  state.libraryView = null;
  closeDetail();
  render();
}

// "More like this (color)": reuse the existing perceptual color filter with the item's
// dominant color (first entry of the top-5 swatches).
function findSimilarByColor(id) {
  const it = state.items.find((i) => i.id === id);
  if (!it || !it.colors || !it.colors.length) return;
  closeDetail();
  applyPickedColorFilter(it.colors[0].hex);
}

function applyFilters() {
  const f = state.filters;
  const q = f.q.trim().toLowerCase();
  let activeIds = null;
  if (state.activeCollection) {
    const c = state.collections.find((x) => x.id === state.activeCollection);
    activeIds = new Set(c ? c.itemIds : []);
  }
  let out = state.items.filter((it) => {
    if (activeIds && !activeIds.has(it.id)) return false;
    if (state.activeSref && it.sref !== state.activeSref) return false;
    if (f.favOnly && !it.favorite) return false;
    if (q) {
      const hay = `${it.displayName} ${it.originalName} ${it.prompt} ${it.tags.join(' ')} ${it.sref}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.colors.size && ![...f.colors].some((c) => it.hueBuckets.includes(c))) return false;
    if (f.pickedColor && !it.colors.some((c) => colorClose(c.hex, f.pickedColor))) return false;
    if (f.types.size && !f.types.has(it.type)) return false;
    if (f.sources.size && !f.sources.has(it.source)) return false;
    if (f.sizes.size) {
      const bucket = itemSizeBucket(it);
      if (!bucket || !f.sizes.has(bucket)) return false;
    }
    if (f.tags.size && ![...f.tags].every((t) => it.tags.includes(t))) return false;
    return true;
  });

  return sortList(out, {
    date: (it) => it.addedAt || 0,
    name: (it) => it.displayName,
  });
}

/* ---------- Rendering ---------- */

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render() {
  const browse = $('library-browse');
  const gridWrap = $('grid-wrap');
  if (state.libraryView) {
    if (browse) browse.hidden = false;
    if (gridWrap) gridWrap.hidden = true;
    renderLibraryBrowse();
    renderCollectionContext();
    updateNavChrome();
    renderSelectionBar();
    return;
  }
  if (browse) browse.hidden = true;
  if (gridWrap) gridWrap.hidden = false;

  renderCollectionContext();

  const visible = applyFilters();
  const grid = $('grid');
  grid.innerHTML = visible.map((it) => {
    const ratioPad = it.width && it.height ? ` style="aspect-ratio:${it.width}/${it.height}"` : '';
    const sel = state.selection.has(it.id);
    return `
    <div class="card${sel ? ' selected' : ''}" data-id="${it.id}" draggable="true" tabindex="0" role="button" aria-label="${esc(it.displayName)}">
      <img src="${it.thumbUrl}" alt="${esc(it.displayName)}" loading="lazy" draggable="false"${ratioPad} />
      ${it.type === 'video' ? '<span class="card-badge">video</span>' : ''}
      <button class="card-select${sel ? ' checked' : ''}" draggable="false" aria-label="${sel ? 'Deselect' : 'Select'}" aria-pressed="${sel}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></button>
      <button class="card-fav-btn${it.favorite ? ' faved' : ''}" draggable="false" aria-label="${it.favorite ? 'Unfavorite' : 'Favorite'}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg></button>
      ${it.sref ? `<button class="card-similar" draggable="false" aria-label="Find similar by sref" title="More like this — --sref ${esc(it.sref)}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg></button>` : ''}
      <div class="card-overlay">
        <div class="card-colors">${it.colors.slice(0, 5).map((c) => `<span class="card-dot" style="background:${esc(c.hex)}"></span>`).join('')}</div>
        <div class="card-name">${esc(it.displayName)}</div>
      </div>
    </div>`;
  }).join('');

  $('empty-state').hidden = visible.length > 0;
  if (!state.items.length) {
    $('empty-title').textContent = 'Drop your images here';
    $('empty-sub').innerHTML = 'Drag files or whole folders anywhere in this window.<br/>Midjourney prompts are read automatically from filenames.';
  } else if (!visible.length) {
    $('empty-title').textContent = 'No matches';
    $('empty-sub').textContent = 'Try removing a filter or clearing the search.';
  }

  $('count-all').textContent = state.items.length;
  $('count-fav').textContent = state.items.filter((i) => i.favorite).length;
  updateNavChrome();
  syncNavCollActiveStates();
  renderSelectionBar();
  renderDynamicFilters();
  renderActiveChips();
  if (state.detailId) {
    updateDetailCounter();
    updateDetailNavBar();
    const it = state.items.find((i) => i.id === state.detailId);
    if (it) {
      renderDetailCollections(it);
      renderDetailSrefs(it);
      renderSimilarThumbs(it);
    }
  }
}

function collectionFolderSvg(isOpen) {
  if (isOpen) {
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>';
  }
  return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M2 10h20"/></svg>';
}

const DELETE_X_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const PIN_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5Z"/><path d="M12 14v6" stroke-linecap="round"/></svg>';
const CONTEXT_RENAME_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5A5A5A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const CONTEXT_PIN_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5A5A5A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1Z"/></svg>';
const CONTEXT_DELETE_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

let browseContextTarget = null;

// 2x2 thumbnail mosaic used on the compact pinned collection cards
function navMosaicHtml(members) {
  let cells = '';
  for (let i = 0; i < 4; i++) {
    const it = members[i];
    cells += it
      ? `<span class="nav-mosaic-cell" style="background-image:url('${it.thumbUrl}')"></span>`
      : '<span class="nav-mosaic-cell is-empty"></span>';
  }
  return `<div class="nav-mosaic">${cells}</div>`;
}

// Fanned photo-stack cover for collection / sref cards
function navCoverHtml(members) {
  const m = members.slice(0, 3);
  if (!m.length) return '<div class="nav-coll-cover"><div class="cover-empty"></div></div>';
  const [hero, left, right] = m;
  let html = '';
  if (left) html += `<img class="cover-img cover-img-0" src="${left.thumbUrl}" alt="" draggable="false" loading="lazy" />`;
  if (right) html += `<img class="cover-img cover-img-1" src="${right.thumbUrl}" alt="" draggable="false" loading="lazy" />`;
  html += `<img class="cover-img cover-img-2" src="${hero.thumbUrl}" alt="" draggable="false" loading="lazy" />`;
  return `<div class="nav-coll-cover${m.length === 1 ? ' is-single' : ''}">${html}</div>`;
}

function collectionMembers(c) {
  return c.itemIds.map((id) => state.items.find((i) => i.id === id)).filter(Boolean);
}

function navListThumbHtml(members) {
  const hero = members[0];
  if (!hero) return '<span class="nav-list-thumb nav-list-thumb--empty" aria-hidden="true"></span>';
  return `<span class="nav-list-thumb" style="background-image:url('${hero.thumbUrl}')" aria-hidden="true"></span>`;
}

const BROWSE_PREVIEW_MAX = 4;

function navCollectionRowHtml(c) {
  const members = collectionMembers(c);
  const n = c.itemIds.length;
  const isActive = state.activeCollection === c.id;
  return `
    <div class="collection-item nav-list-row${isActive ? ' is-active' : ''}" data-cid="${c.id}" data-active="${isActive}">
      ${navListThumbHtml(members)}
      <span class="nav-list-name collection-name" title="Double-click to rename">${esc(c.name)}</span>
      <span class="nav-list-count">${n}</span>
    </div>`;
}

function updateCollectionsAllRow(shown, hiddenCount) {
  const allRow = $('collections-view-all');
  const thumbWrap = $('collections-all-thumb');
  const overlay = $('collections-all-overlay');
  if (!allRow || !thumbWrap) return;

  const thumbEl = thumbWrap.querySelector('.nav-list-thumb');
  const previewSource = shown[BROWSE_PREVIEW_MAX] || shown[shown.length - 1];
  const members = previewSource ? collectionMembers(previewSource) : [];
  const hero = members[0];

  if (thumbEl) {
    if (hero) {
      thumbEl.style.backgroundImage = `url('${hero.thumbUrl}')`;
      thumbEl.classList.remove('nav-list-thumb--empty');
    } else {
      thumbEl.style.backgroundImage = '';
      thumbEl.classList.add('nav-list-thumb--empty');
    }
  }

  if (overlay) {
    if (hiddenCount > 0) {
      overlay.textContent = `+${hiddenCount}`;
      overlay.hidden = false;
    } else {
      overlay.textContent = '';
      overlay.hidden = true;
    }
  }
}

function updateSrefsAllRow(shown, hiddenCount) {
  const allRow = $('srefs-view-all');
  const thumbWrap = $('srefs-all-thumb');
  const overlay = $('srefs-all-overlay');
  if (!allRow || !thumbWrap) return;

  const thumbEl = thumbWrap.querySelector('.nav-list-thumb');
  const previewSource = shown[BROWSE_PREVIEW_MAX] || shown[shown.length - 1];
  const members = previewSource ? srefMembers(previewSource) : [];
  const hero = members[0];

  if (thumbEl) {
    if (hero) {
      thumbEl.style.backgroundImage = `url('${hero.thumbUrl}')`;
      thumbEl.classList.remove('nav-list-thumb--empty');
    } else {
      thumbEl.style.backgroundImage = '';
      thumbEl.classList.add('nav-list-thumb--empty');
    }
  }

  if (overlay) {
    if (hiddenCount > 0) {
      overlay.textContent = `+${hiddenCount}`;
      overlay.hidden = false;
    } else {
      overlay.textContent = '';
      overlay.hidden = true;
    }
  }
}

function navSrefRowHtml(g) {
  const members = srefMembers(g);
  const n = members.length;
  const isActive = state.activeSref === g.name;
  return `
    <div class="sref-item nav-list-row${isActive ? ' is-active' : ''}" data-gid="${g.id}" data-sref="${esc(g.name)}" data-active="${isActive}">
      ${navListThumbHtml(members)}
      <span class="nav-list-name sref-name collection-name" title="Double-click to rename">${esc(g.name)}</span>
      <span class="nav-list-count">${n}</span>
    </div>`;
}

const BROWSE_NEW_PLUS_SVG = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M10 4V16M4 10H16" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round"/></svg>';
const EMPTY_COLLECTION_SPINNER_SVG = '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="11" cy="11" r="9" stroke="#D9D9D9" stroke-width="2.5"/><path d="M11 2a9 9 0 0 1 9 9" stroke="#9B9B9B" stroke-width="2.5" stroke-linecap="round"/></svg>';

function browseCoverHtml(members) {
  const hero = members[0];
  if (!hero) {
    return `<div class="browse-card-cover browse-card-cover--empty">${EMPTY_COLLECTION_SPINNER_SVG}</div>`;
  }
  return `<div class="browse-card-cover"><img src="${hero.thumbUrl}" alt="" loading="lazy" draggable="false" /></div>`;
}

function browseNewCollectionCardHtml() {
  return `
    <button type="button" class="browse-card browse-card--new" data-create-collection="1">
      <div class="browse-card-cover browse-card-cover--new" aria-hidden="true">
        <span class="browse-card-new-icon">${BROWSE_NEW_PLUS_SVG}</span>
      </div>
      <div class="browse-card-meta">
        <span class="browse-card-title">New collection</span>
        <span class="browse-card-subtitle">Group related elements</span>
      </div>
    </button>`;
}

function browseCollectionCardHtml(c, { reorderable = false } = {}) {
  const members = collectionMembers(c);
  const n = c.itemIds.length;
  const label = n === 1 ? '1 element' : `${n} elements`;
  return `
    <div class="browse-card browse-card--collection${reorderable ? ' is-reorderable' : ''}" data-cid="${c.id}" data-active="${state.activeCollection === c.id}"${reorderable ? ' draggable="true"' : ''}>
      ${browseCoverHtml(members)}
      <div class="browse-card-meta">
        <span class="browse-card-title collection-name" title="Double-click to rename">${esc(c.name)}</span>
        <span class="browse-card-subtitle">${label}</span>
      </div>
    </div>`;
}

function browseNewSrefCardHtml() {
  return `
    <button type="button" class="browse-card browse-card--new" data-create-sref="1">
      <div class="browse-card-cover browse-card-cover--new" aria-hidden="true">
        <span class="browse-card-new-icon">${BROWSE_NEW_PLUS_SVG}</span>
      </div>
      <div class="browse-card-meta">
        <span class="browse-card-title">New sref</span>
        <span class="browse-card-subtitle">Group by style reference</span>
      </div>
    </button>`;
}

function browseSrefCardHtml(g) {
  const members = srefMembers(g);
  const n = members.length;
  const label = n === 1 ? '1 element' : `${n} elements`;
  return `
    <div class="browse-card browse-card--sref" data-gid="${g.id}" data-sref="${esc(g.name)}" data-active="${state.activeSref === g.name}">
      ${browseCoverHtml(members)}
      <div class="browse-card-meta">
        <span class="browse-card-title sref-name collection-name" title="Double-click to rename">${esc(g.name)}</span>
        <span class="browse-card-subtitle">${label}</span>
      </div>
    </div>`;
}

function syncNavCollActiveStates() {
  document.querySelectorAll('.collection-item[data-cid]').forEach((el) => {
    const active = state.activeCollection === el.dataset.cid;
    el.dataset.active = String(active);
    el.classList.toggle('is-active', active);
  });
  document.querySelectorAll('.browse-card--collection[data-cid]').forEach((el) => {
    el.dataset.active = String(state.activeCollection === el.dataset.cid);
  });
  document.querySelectorAll('.browse-card--sref[data-gid]').forEach((el) => {
    el.dataset.active = String(state.activeSref === el.dataset.sref);
  });
  document.querySelectorAll('.sref-item[data-gid]').forEach((el) => {
    const active = state.activeSref === el.dataset.sref;
    el.dataset.active = String(active);
    el.classList.toggle('is-active', active);
  });
}

function renderCollections() {
  const list = $('collections-list');
  const allRow = $('collections-view-all');
  const q = ($('collections-search')?.value || '').trim().toLowerCase();
  const shown = sortList(
    q ? state.collections.filter((c) => c.name.toLowerCase().includes(q)) : state.collections,
    { date: (c) => c.createdAt || 0, name: (c) => c.name, orderSource: state.collections },
  );
  const isSearching = Boolean(q);
  const preview = isSearching ? shown : shown.slice(0, BROWSE_PREVIEW_MAX);
  const hiddenCount = isSearching ? 0 : Math.max(0, shown.length - BROWSE_PREVIEW_MAX);

  list.innerHTML = preview.map(navCollectionRowHtml).join('');

  if (allRow) {
    const showAllRow = !isSearching && shown.length > 0;
    allRow.hidden = !showAllRow;
    if (showAllRow) updateCollectionsAllRow(shown, hiddenCount);
  }

  const total = state.collections.length;
  const badge = $('collections-count-badge');
  if (badge) badge.textContent = String(total);
  $('collections-empty').hidden = shown.length > 0;
}

function getSrefGroupCount(name) {
  return state.items.filter((i) => i.sref === name).length;
}

function srefMembers(g) {
  return state.items.filter((i) => i.sref === g.name);
}

function renderSrefs() {
  const list = $('srefs-list');
  const allRow = $('srefs-view-all');
  const q = ($('srefs-search')?.value || '').trim().toLowerCase();
  const shown = sortList(
    q ? state.srefGroups.filter((g) => g.name.toLowerCase().includes(q)) : state.srefGroups,
    { date: (g) => g.createdAt || 0, name: (g) => g.name },
  );
  const isSearching = Boolean(q);
  const preview = isSearching ? shown : shown.slice(0, BROWSE_PREVIEW_MAX);
  const hiddenCount = isSearching ? 0 : Math.max(0, shown.length - BROWSE_PREVIEW_MAX);

  list.innerHTML = preview.map(navSrefRowHtml).join('');

  if (allRow) {
    const showAllRow = !isSearching && shown.length > 0;
    allRow.hidden = !showAllRow;
    if (showAllRow) updateSrefsAllRow(shown, hiddenCount);
  }

  const total = state.srefGroups.length;
  const badge = $('srefs-count-badge');
  if (badge) badge.textContent = String(total);
  $('srefs-empty').hidden = shown.length > 0;
}

function updateNavChrome() {
  const activeColl = state.activeCollection ? state.collections.find((c) => c.id === state.activeCollection) : null;
  const inBrowse = Boolean(state.libraryView);
  $('nav-all').dataset.active = String(!inBrowse && !state.filters.favOnly && !activeColl && !state.activeSref);
  $('nav-fav').dataset.active = String(!inBrowse && state.filters.favOnly && !activeColl && !state.activeSref);

  const countCollections = $('count-collections');
  if (countCollections) countCollections.textContent = state.collections.length;
  const countSrefs = $('count-srefs');
  if (countSrefs) countSrefs.textContent = state.srefGroups.length;
  const collTrigger = $('collections-trigger');
  if (collTrigger) collTrigger.dataset.active = String(inBrowse ? state.libraryView === 'collections' : Boolean(activeColl));
  const srefTrigger = $('srefs-trigger');
  if (srefTrigger) srefTrigger.dataset.active = String(inBrowse ? state.libraryView === 'srefs' : Boolean(state.activeSref));
  const f = state.filters;
  const filtersActive = f.types.size || f.sources.size || f.sizes.size || f.tags.size || f.pickedColor;
  const filtTrigger = $('filters-trigger');
  if (filtTrigger) filtTrigger.dataset.active = String(Boolean(filtersActive));
}

function openLibraryBrowse(view) {
  const searchId = view === 'collections' ? 'collections-search' : 'srefs-search';
  const search = $(searchId);
  if (search) search.value = '';
  state.activeCollection = null;
  state.activeSref = null;
  state.collectionOrganize = false;
  state.filters.favOnly = false;
  state.libraryView = view;
  closeNavPops();
  $('main')?.scrollTo(0, 0);
  render();
  if (view === 'collections') renderCollections();
  else renderSrefs();
}

function renderCollectionContext() {
  const ctx = $('collection-context');
  const gridWrap = $('grid-wrap');
  if (!ctx) return;

  const c = state.activeCollection
    ? state.collections.find((x) => x.id === state.activeCollection)
    : null;
  const show = Boolean(c) && !state.libraryView;

  ctx.hidden = !show;
  if (!show) {
    state.collectionOrganize = false;
    if (gridWrap) {
      gridWrap.classList.remove('grid-wrap--collection', 'grid-wrap--organizing');
    }
    return;
  }

  if (gridWrap) {
    gridWrap.classList.add('grid-wrap--collection');
    gridWrap.classList.toggle('grid-wrap--organizing', state.collectionOrganize);
  }

  const titleEl = $('collection-context-title');
  const actions = $('collection-context-actions');
  const isRenaming = Boolean(titleEl?.querySelector('.collection-name-input'));
  if (actions) actions.hidden = isRenaming;

  const label = c.name;
  if (titleEl && !isRenaming) {
    titleEl.textContent = label;
    titleEl.setAttribute('aria-label', `Collection ${label}`);
  }

  const organizeBtn = $('collection-action-organize');
  if (organizeBtn) organizeBtn.setAttribute('aria-pressed', String(state.collectionOrganize));
}

function wireCollectionContext() {
  $('collection-action-new')?.addEventListener('click', () => {
    $('file-input')?.click();
  });

  $('collection-action-organize')?.addEventListener('click', () => {
    state.collectionOrganize = !state.collectionOrganize;
    if (!state.collectionOrganize) state.selection.clear();
    render();
  });

  $('collection-action-more')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const cid = state.activeCollection;
    if (!cid) return;
    const btn = $('collection-action-more');
    const menu = $('collection-context-menu');
    if (!menu.hidden && browseContextTarget?.kind === 'collection' && browseContextTarget.id === cid) {
      closeBrowseContextMenu();
      return;
    }
    openBrowseContextMenu({ kind: 'collection', id: cid }, 0, 0, btn, 'below');
  });
}

function startContextHeaderRename() {
  if (state.activeCollection) startCollectionContextRename();
  else if (state.activeSref) startSrefContextRename();
}

function startCollectionContextRename() {
  const titleBtn = $('collection-context-title');
  const cid = state.activeCollection;
  if (!titleBtn || !cid || titleBtn.querySelector('.collection-name-input')) return;
  const c = state.collections.find((x) => x.id === cid);
  if (!c) return;

  const input = document.createElement('input');
  input.className = 'collection-name-input';
  input.value = c.name;
  input.setAttribute('aria-label', 'Rename collection');
  titleBtn.textContent = '';
  titleBtn.appendChild(input);
  input.focus();
  input.select();
  renderCollectionContext();

  let done = false;
  const commit = async () => {
    if (done) return;
    done = true;
    const name = input.value.trim() || c.name;
    if (name !== c.name) {
      const { collection } = await apiCollection('PATCH', '/' + cid, { name }) || {};
      if (collection) state.collections[state.collections.findIndex((x) => x.id === cid)] = collection;
    }
    render();
    renderCollections();
  };
  const onBlur = () => { void commit(); };
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') {
      ev.preventDefault();
      input.removeEventListener('blur', onBlur);
      void commit();
    }
    if (ev.key === 'Escape') {
      done = true;
      input.removeEventListener('blur', onBlur);
      render();
    }
  });
  input.addEventListener('blur', onBlur);
}

function startSrefContextRename() {
  const titleEl = $('collection-context-title');
  const srefName = state.activeSref;
  if (!titleEl || !srefName || titleEl.querySelector('.collection-name-input')) return;
  const g = state.srefGroups.find((x) => x.name === srefName);
  if (!g) return;

  const input = document.createElement('input');
  input.className = 'collection-name-input';
  input.value = g.name;
  input.setAttribute('aria-label', 'Rename sref');
  titleEl.textContent = '';
  titleEl.appendChild(input);
  input.focus();
  input.select();

  let done = false;
  const commit = async () => {
    if (done) return;
    done = true;
    const name = input.value.trim() || g.name;
    if (name !== g.name) {
      const prev = g.name;
      const { group } = await apiSrefGroup('PATCH', '/' + g.id, { name }) || {};
      if (group) {
        state.srefGroups[state.srefGroups.findIndex((x) => x.id === g.id)] = group;
        if (state.activeSref === prev) state.activeSref = group.name;
      }
    }
    render();
    renderSrefs();
  };
  const onBlur = () => { void commit(); };
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') {
      ev.preventDefault();
      input.removeEventListener('blur', onBlur);
      void commit();
    }
    if (ev.key === 'Escape') {
      done = true;
      input.removeEventListener('blur', onBlur);
      render();
    }
  });
  input.addEventListener('blur', onBlur);
}

function moveCollectionInList(dragId, targetId, list) {
  if (dragId === targetId) return false;
  const fromIdx = list.findIndex((c) => c.id === dragId);
  const toIdx = list.findIndex((c) => c.id === targetId);
  if (fromIdx < 0 || toIdx < 0) return false;
  const next = [...list];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  state.collections = next;
  return true;
}

function moveCollectionsInSection(dragId, targetId, isPinned) {
  if (dragId === targetId) return false;
  const pinned = state.collections.filter((c) => c.pinned);
  const unpinned = state.collections.filter((c) => !c.pinned);
  const section = isPinned ? pinned : unpinned;
  const fromIdx = section.findIndex((c) => c.id === dragId);
  const toIdx = section.findIndex((c) => c.id === targetId);
  if (fromIdx < 0 || toIdx < 0) return false;
  const [moved] = section.splice(fromIdx, 1);
  section.splice(toIdx, 0, moved);
  let pi = 0;
  let ui = 0;
  state.collections = state.collections.map((c) => (c.pinned ? pinned[pi++] : unpinned[ui++]));
  return true;
}

function openCollectionView(cid) {
  state.activeCollection = cid;
  state.activeSref = null;
  state.collectionOrganize = false;
  state.filters.favOnly = false;
  state.libraryView = null;
  state.selection.clear();
  $('main')?.scrollTo(0, 0);
  render();
}

function openSrefView(sref) {
  state.activeSref = sref;
  state.activeCollection = null;
  state.filters.favOnly = false;
  state.libraryView = null;
  $('main')?.scrollTo(0, 0);
  render();
}

function renderLibraryBrowse() {
  const browse = $('library-browse');
  const gridWrap = $('grid-wrap');
  if (!browse || !gridWrap) return;

  browse.hidden = false;
  gridWrap.hidden = true;

  const isColl = state.libraryView === 'collections';
  const crumb = $('library-browse-crumb');
  const title = $('library-browse-title');
  const countEl = $('library-browse-count');
  const allLabel = $('library-browse-all-label');
  const pinnedWrap = $('library-browse-pinned');
  const pinnedRow = $('library-browse-pinned-row');
  const grid = $('library-browse-grid');
  const empty = $('library-browse-empty');

  if (crumb) crumb.textContent = isColl ? 'Collections' : 'Srefs';
  if (title) title.textContent = isColl ? 'Collections' : 'Srefs';

  if (isColl) {
    browse.classList.add('library-browse--cards');
    const total = state.collections.length;
    const sorted = sortList(state.collections, {
      date: (c) => c.createdAt || 0,
      name: (c) => c.name,
      orderSource: state.collections,
    });
    if (countEl) countEl.textContent = String(total);
    if (pinnedWrap) pinnedWrap.hidden = true;
    if (allLabel) allLabel.hidden = true;
    if (grid) {
      grid.innerHTML = browseNewCollectionCardHtml()
        + sorted.map((c) => browseCollectionCardHtml(c, { reorderable: true })).join('');
    }
    if (empty) {
      empty.hidden = true;
    }
  } else {
    browse.classList.add('library-browse--cards');
    const total = state.srefGroups.length;
    const sorted = sortList(state.srefGroups, {
      date: (g) => g.createdAt || 0,
      name: (g) => g.name,
      orderSource: state.srefGroups,
    });
    if (countEl) countEl.textContent = String(total);
    if (pinnedWrap) pinnedWrap.hidden = true;
    if (allLabel) allLabel.hidden = true;
    if (grid) {
      grid.innerHTML = browseNewSrefCardHtml()
        + sorted.map((g) => browseSrefCardHtml(g)).join('');
    }
    if (empty) {
      empty.hidden = true;
    }
  }
}

async function deleteSrefById(gid) {
  const g = state.srefGroups.find((x) => x.id === gid);
  if (!g) return false;
  const n = getSrefGroupCount(g.name);
  const msg = n
    ? `Delete sref folder “${g.name}”? --sref will be cleared on ${n} image${n === 1 ? '' : 's'}.`
    : `Delete sref folder “${g.name}”?`;
  if (!confirm(msg)) return false;
  await apiSrefGroup('DELETE', '/' + gid);
  state.srefGroups = state.srefGroups.filter((x) => x.id !== gid);
  if (state.activeSref === g.name) state.activeSref = null;
  render();
  renderSrefs();
  return true;
}

async function deleteCollectionById(cid) {
  const c = state.collections.find((x) => x.id === cid);
  if (!c) return false;
  if (!confirm(`Delete collection “${c.name}”? The images stay in your library.`)) return false;
  await apiCollection('DELETE', '/' + cid);
  state.collections = state.collections.filter((x) => x.id !== cid);
  if (state.activeCollection === cid) state.activeCollection = null;
  render();
  renderCollections();
  return true;
}

function renderBrowseContextMenu() {
  const menu = $('collection-context-menu');
  if (!browseContextTarget || !menu) return;
  if (browseContextTarget.kind === 'collection') {
    const c = state.collections.find((x) => x.id === browseContextTarget.id);
    if (!c) return;
    const pinLabel = c.pinned ? 'Unpin from top' : 'Pin to top';
    menu.innerHTML = `
      <button type="button" class="collection-context-item" data-action="rename" role="menuitem">${CONTEXT_RENAME_SVG}<span>Rename</span></button>
      <button type="button" class="collection-context-item" data-action="pin" role="menuitem">${CONTEXT_PIN_SVG}<span>${esc(pinLabel)}</span></button>
      <div class="collection-context-divider" role="separator"></div>
      <button type="button" class="collection-context-item collection-context-item--danger" data-action="delete" role="menuitem">${CONTEXT_DELETE_SVG}<span>Delete</span></button>`;
    return;
  }
  const g = state.srefGroups.find((x) => x.id === browseContextTarget.id);
  if (!g) return;
  const pinLabel = g.pinned ? 'Unpin from top' : 'Pin to top';
  menu.innerHTML = `
    <button type="button" class="collection-context-item" data-action="rename" role="menuitem">${CONTEXT_RENAME_SVG}<span>Rename</span></button>
    <button type="button" class="collection-context-item" data-action="pin" role="menuitem">${CONTEXT_PIN_SVG}<span>${esc(pinLabel)}</span></button>
    <div class="collection-context-divider" role="separator"></div>
    <button type="button" class="collection-context-item collection-context-item--danger" data-action="delete" role="menuitem">${CONTEXT_DELETE_SVG}<span>Delete</span></button>`;
}

function closeBrowseContextMenu() {
  const menu = $('collection-context-menu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  browseContextTarget = null;
}

function positionBrowseContextMenu(menu, x, y, anchorEl = null, placement = 'right') {
  menu.hidden = false;
  menu.style.left = '0px';
  menu.style.top = '0px';
  const rect = menu.getBoundingClientRect();
  const margin = 8;
  let left = x;
  let top = y;

  if (anchorEl) {
    const rowRect = anchorEl.getBoundingClientRect();
    if (placement === 'below') {
      left = rowRect.left + (rowRect.width - rect.width) / 2;
      top = rowRect.bottom + 6;
    } else {
      left = rowRect.right + 6;
      top = rowRect.top;
      if (left + rect.width > window.innerWidth - margin) {
        left = rowRect.left - rect.width - 6;
      }
    }
  }

  if (left + rect.width > window.innerWidth - margin) left = window.innerWidth - rect.width - margin;
  if (top + rect.height > window.innerHeight - margin) top = window.innerHeight - rect.height - margin;
  left = Math.max(margin, left);
  top = Math.max(margin, top);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function openBrowseContextMenu(target, x, y, anchorEl = null, placement = 'right') {
  const menu = $('collection-context-menu');
  if (!menu) return;
  $('collect-menu').hidden = true;
  $('sref-menu').hidden = true;
  state.collectMenuAnchor = null;
  state.srefMenuAnchor = null;
  browseContextTarget = target;
  renderBrowseContextMenu();
  positionBrowseContextMenu(menu, x, y, anchorEl, placement);
  menu.querySelector('[data-action="rename"]')?.focus();
}

function findCollectionNameEl(cid) {
  return document.querySelector(`.collection-item[data-cid="${cid}"] .collection-name`)
    || document.querySelector(`.browse-card--collection[data-cid="${cid}"] .collection-name`);
}

function findSrefNameEl(gid) {
  return document.querySelector(`.sref-item[data-gid="${gid}"] .sref-name`)
    || document.querySelector(`.browse-card--sref[data-gid="${gid}"] .sref-name`);
}

function wireCollectionContextMenu() {
  const menu = $('collection-context-menu');
  if (!menu) return;

  const browse = $('library-browse');
  browse?.addEventListener('contextmenu', (e) => {
    if (state.libraryView === 'collections') {
      const card = e.target.closest('.browse-card--collection');
      if (!card || !e.target.closest('.browse-card-cover')) return;
      e.preventDefault();
      openBrowseContextMenu({ kind: 'collection', id: card.dataset.cid }, e.clientX, e.clientY);
      return;
    }
    if (state.libraryView === 'srefs') {
      const card = e.target.closest('.browse-card--sref');
      if (!card || !e.target.closest('.browse-card-cover')) return;
      e.preventDefault();
      openBrowseContextMenu({ kind: 'sref', id: card.dataset.gid }, e.clientX, e.clientY);
    }
  });

  const wireNavPopContextMenu = (pop, kind) => {
    if (!pop) return;
    pop.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('.nav-list-row');
      if (!row || row.classList.contains('nav-list-row--all')) return;
      e.preventDefault();
      e.stopPropagation();
      const id = kind === 'collection' ? row.dataset.cid : row.dataset.gid;
      if (!id) return;
      openBrowseContextMenu({ kind, id }, e.clientX, e.clientY, row);
    });
  };
  wireNavPopContextMenu($('collections-pop'), 'collection');
  wireNavPopContextMenu($('srefs-pop'), 'sref');

  menu.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    e.stopPropagation();
    const target = browseContextTarget;
    const action = btn.dataset.action;
    closeBrowseContextMenu();
    if (!target) return;
    if (target.kind === 'collection') {
      const cid = target.id;
      if (action === 'rename') {
        if (state.activeCollection === cid) startCollectionContextRename();
        else {
          const nameEl = findCollectionNameEl(cid);
          if (nameEl) startCollectionRename(nameEl);
        }
        return;
      }
      if (action === 'pin') {
        await toggleCollectionPin(cid);
        return;
      }
      if (action === 'delete') await deleteCollectionById(cid);
      return;
    }
    const gid = target.id;
    if (action === 'rename') {
      const nameEl = findSrefNameEl(gid);
      if (nameEl) startSrefRename(nameEl);
      return;
    }
    if (action === 'pin') {
      await toggleSrefPin(gid);
      return;
    }
    if (action === 'delete') await deleteSrefById(gid);
  });

  document.addEventListener('click', (e) => {
    if (!menu.hidden && !e.target.closest('#collection-context-menu')) closeBrowseContextMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) closeBrowseContextMenu();
  });
  browse?.addEventListener('scroll', closeBrowseContextMenu, { passive: true });
  $('collections-body')?.addEventListener('scroll', closeBrowseContextMenu, { passive: true });
  $('srefs-body')?.addEventListener('scroll', closeBrowseContextMenu, { passive: true });
  window.addEventListener('resize', closeBrowseContextMenu);
}

function wireLibraryBrowse() {
  const browse = $('library-browse');
  if (!browse) return;

  $('library-browse-back')?.addEventListener('click', () => {
    state.libraryView = null;
    render();
  });

  browse.addEventListener('click', async (e) => {
    if (e.target.closest('[data-create-collection]')) {
      $('new-collection')?.click();
      return;
    }
    if (e.target.closest('[data-create-sref]')) {
      $('new-sref')?.click();
      return;
    }

    const collItem = e.target.closest('.browse-card--collection') || e.target.closest('.collection-item');
    const srefItem = e.target.closest('.browse-card--sref') || e.target.closest('.sref-item');
    const item = collItem || srefItem;
    if (!item) return;

    if (state.libraryView === 'collections' && collItem) {
      if (suppressCollectionClick || suppressCollectionReorderClick) return;
      const cid = collItem.dataset.cid;
      if (e.target.closest('.collection-pin')) {
        e.stopPropagation();
        await toggleCollectionPin(cid);
        renderLibraryBrowse();
        renderCollections();
        return;
      }
      if (e.target.closest('.collection-del')) {
        await deleteCollectionById(cid);
        return;
      }
      if (e.target.closest('.collection-name-input')) return;
      if (collItem.classList.contains('browse-card--collection')) {
        openCollectionView(cid);
        return;
      }
      clearTimeout(collectionClickTimer);
      collectionClickTimer = setTimeout(() => {
        if (suppressCollectionNavClick) { suppressCollectionNavClick = false; return; }
        openCollectionView(cid);
      }, 220);
      return;
    }

    if (state.libraryView === 'srefs' && srefItem) {
      if (suppressSrefClick) return;
      const gid = srefItem.dataset.gid;
      const sref = srefItem.dataset.sref;
      if (e.target.closest('.collection-pin')) {
        e.stopPropagation();
        await toggleSrefPin(gid);
        renderLibraryBrowse();
        renderSrefs();
        return;
      }
      if (e.target.closest('.sref-del')) {
        await deleteSrefById(gid);
        return;
      }
      if (e.target.closest('.collection-name-input')) return;
      if (srefItem.classList.contains('browse-card--sref')) {
        openSrefView(sref);
        return;
      }
      clearTimeout(srefClickTimer);
      srefClickTimer = setTimeout(() => {
        if (suppressSrefNavClick) { suppressSrefNavClick = false; return; }
        openSrefView(sref);
      }, 220);
    }
  });

  browse.addEventListener('dblclick', (e) => {
    const nameEl = e.target.closest('.collection-name');
    if (!nameEl) return;
    e.stopPropagation();
    e.preventDefault();
    if (state.libraryView === 'collections') {
      clearTimeout(collectionClickTimer);
      suppressCollectionNavClick = true;
      startCollectionRename(nameEl);
    } else if (state.libraryView === 'srefs') {
      clearTimeout(srefClickTimer);
      suppressSrefNavClick = true;
      startSrefRename(nameEl);
    }
  });

  let collectionReorderDragId = null;

  browse.addEventListener('dragstart', (e) => {
    if (state.libraryView !== 'collections') return;
    const card = e.target.closest('.browse-card--collection.is-reorderable');
    if (!card || e.target.closest('button, input, textarea')) {
      e.preventDefault();
      return;
    }
    collectionReorderDragId = card.dataset.cid;
    card.classList.add('is-collection-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-lens-collection-reorder', collectionReorderDragId);
  });

  browse.addEventListener('dragend', (e) => {
    e.target.closest('.browse-card--collection')?.classList.remove('is-collection-dragging');
    browse.querySelectorAll('.browse-card.drop-target-reorder').forEach((el) => {
      el.classList.remove('drop-target-reorder');
    });
    collectionReorderDragId = null;
  });

  const gridContainer = $('library-browse-grid');
  if (gridContainer) {
    gridContainer.addEventListener('dragover', (e) => {
      if (!collectionReorderDragId || state.libraryView !== 'collections') return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      browse.querySelectorAll('.browse-card.drop-target-reorder').forEach((el) => {
        el.classList.remove('drop-target-reorder');
      });
      const card = e.target.closest('.browse-card--collection.is-reorderable');
      if (card && card.dataset.cid !== collectionReorderDragId) {
        card.classList.add('drop-target-reorder');
      }
    });
    gridContainer.addEventListener('dragleave', (e) => {
      const card = e.target.closest('.browse-card--collection');
      card?.classList.remove('drop-target-reorder');
    });
    gridContainer.addEventListener('drop', async (e) => {
      if (!collectionReorderDragId || state.libraryView !== 'collections') return;
      e.preventDefault();
      const target = e.target.closest('.browse-card--collection.is-reorderable');
      browse.querySelectorAll('.browse-card.drop-target-reorder').forEach((el) => {
        el.classList.remove('drop-target-reorder');
      });
      if (!target || target.dataset.cid === collectionReorderDragId) return;
      const sorted = sortList(state.collections, {
        date: (c) => c.createdAt || 0,
        name: (c) => c.name,
        orderSource: state.collections,
      });
      if (!moveCollectionInList(collectionReorderDragId, target.dataset.cid, sorted)) return;
      const json = await apiCollectionReorder(state.collections.map((c) => c.id));
      if (!json) return;
      if (json.collections) state.collections = json.collections;
      state.sort = 'manual';
      syncSortUI();
      suppressCollectionReorderClick = true;
      setTimeout(() => { suppressCollectionReorderClick = false; }, 300);
      renderLibraryBrowse();
      renderCollections();
    });
  }
}

function renderSelectionBar() {
  const bar = $('selection-bar');
  const n = state.selection.size;
  bar.hidden = n === 0;
  if (n) $('selection-count').textContent = `${n} Selected`;
  const inCollection = Boolean(state.activeCollection) && !state.libraryView;
  const bulkDeleteBtn = $('bulk-delete');
  if (bulkDeleteBtn) {
    bulkDeleteBtn.setAttribute('aria-label', inCollection ? 'Remove from collection' : 'Delete from library');
  }
  positionToastStack();
}

function renderDynamicFilters() {
  const sources = [...new Set(state.items.map((i) => i.source))].sort();
  $('source-filter').innerHTML = sources.map((s) => `
    <label class="filter-check-row">
      <input type="checkbox" class="filter-checkbox" data-value="${esc(s)}"${state.filters.sources.has(s) ? ' checked' : ''} />
      <span>${esc(formatSourceLabel(s))}</span>
    </label>`).join('');

  const tags = [...new Set(state.items.flatMap((i) => i.tags))].sort();
  $('tags-filter').innerHTML = tags.map((t) =>
    `<button class="pill${state.filters.tags.has(t) ? ' active' : ''}" data-value="${esc(t)}"><span>${esc(t)}</span></button>`).join('');
  $('tags-empty').hidden = tags.length > 0;

  document.querySelectorAll('#type-filter .filter-checkbox').forEach((cb) => {
    cb.checked = state.filters.types.has(cb.dataset.value);
  });
  document.querySelectorAll('#size-filter .filter-checkbox').forEach((cb) => {
    cb.checked = state.filters.sizes.has(cb.dataset.value);
  });
}

function renderActiveChips() {
  const f = state.filters;

  // picked color renders as one pill inside the search bar
  $('search-color-tags').innerHTML = f.pickedColor ? `
    <button class="search-color-tag" aria-label="Edit color filter">
      <span class="tag-dot" style="background:${esc(f.pickedColor)}" title="${esc(f.pickedColor)}"></span>
      <span class="tag-close" role="button" aria-label="Remove color filter">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="m5 5 14 14m0-14L5 19"/></svg>
      </span>
    </button>` : '';
  // SVG elements don't support the hidden property — use the attribute
  if (f.pickedColor) $('search-icon').setAttribute('hidden', '');
  else $('search-icon').removeAttribute('hidden');

  // Filter state lives in the sidebar only — no chips in the toolbar header
  $('active-chips').innerHTML = '';
}

/* ---------- Detail view ---------- */

function detailVisibleItems() {
  return applyFilters();
}

function updateDetailCounter() {
  const visible = detailVisibleItems();
  const idx = visible.findIndex((i) => i.id === state.detailId);
  $('detail-counter').textContent = idx >= 0 ? `${idx + 1} / ${visible.length}` : `— / ${visible.length}`;
}

function updateDetailNavBar() {
  const bar = $('detail-nav-bar');
  const prev = $('detail-prev');
  const next = $('detail-next');
  if (!bar || !prev || !next) return;
  const visible = detailVisibleItems();
  const idx = visible.findIndex((i) => i.id === state.detailId);
  const show = Boolean(state.detailId) && visible.length >= 2;
  bar.hidden = !show;
  if (!show) return;
  prev.disabled = idx <= 0;
  next.disabled = idx >= visible.length - 1;
}

function applyDetailZoom() {
  const pct = state.detailZoom;
  $('detail-zoom-value').textContent = `${pct}%`;
  $('detail-zoom').value = String(pct);
  const slider = $('detail-zoom');
  const fill = ((pct - Number(slider.min)) / (Number(slider.max) - Number(slider.min))) * 100;
  slider.style.setProperty('--zoom-fill', `${fill}%`);
  const media = $('detail-media');
  media.style.transform = pct === 100 ? '' : `scale(${pct / 100})`;
}

function getSimilarItems(it, limit = 4) {
  let similar = [];
  if (it.sref) {
    similar = state.items.filter((i) => i.id !== it.id && i.sref === it.sref);
  }
  if (similar.length < limit && it.colors?.length) {
    const dominant = it.colors[0].hex;
    const colorSimilar = state.items.filter((i) =>
      i.id !== it.id
      && !similar.some((s) => s.id === i.id)
      && i.colors.some((c) => colorClose(c.hex, dominant)));
    similar = [...similar, ...colorSimilar];
  }
  return similar.slice(0, limit);
}

function renderDetailCollections(it) {
  const memberOf = state.collections.filter((c) => c.itemIds.includes(it.id));
  const empty = $('detail-collections-empty');
  const container = $('detail-collections');
  container.querySelectorAll('.detail-collection-item').forEach((el) => el.remove());
  empty.hidden = memberOf.length > 0;
  const folder = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>';
  for (const c of memberOf) {
    const row = document.createElement('div');
    row.className = 'detail-collection-item';
    row.innerHTML = `${folder}<span>${esc(c.name)}</span><button type="button" class="detail-collection-remove" data-cid="${c.id}" aria-label="Remove from ${esc(c.name)}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>`;
    container.appendChild(row);
  }
}

function renderDetailSrefs(it) {
  const empty = $('detail-srefs-empty');
  const container = $('detail-srefs');
  container.querySelectorAll('.detail-sref-item').forEach((el) => el.remove());
  const sref = typeof it.sref === 'string' ? it.sref.trim() : '';
  const hasSref = Boolean(sref);
  const headerIcon = $('detail-sref-header-icon');
  if (headerIcon) headerIcon.innerHTML = collectionFolderSvg(hasSref);
  empty.hidden = hasSref;
  if (!hasSref) return;
  const folder = collectionFolderSvg(false);
  const row = document.createElement('div');
  row.className = 'detail-sref-item';
  row.innerHTML = `${folder}<span class="mono">${esc(sref)}</span><button type="button" class="detail-sref-remove" aria-label="Remove sref"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>`;
  container.appendChild(row);
}

function syncSimilarThumbsFade() {
  const wrap = document.querySelector('.similar-thumbs-scroll');
  const row = $('detail-similar');
  if (!wrap || !row || row.querySelector('.detail-empty')) {
    wrap?.classList.remove('can-scroll-left', 'can-scroll-right');
    return;
  }
  const sync = () => {
    const max = row.scrollWidth - row.clientWidth;
    wrap.classList.toggle('can-scroll-left', row.scrollLeft > 1);
    wrap.classList.toggle('can-scroll-right', max > 1 && row.scrollLeft < max - 1);
  };
  if (!row.dataset.fadeWired) {
    row.dataset.fadeWired = '1';
    row.addEventListener('scroll', sync, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(sync).observe(row);
    }
  }
  sync();
}

function renderSimilarThumbs(it) {
  const similar = getSimilarItems(it);
  const el = $('detail-similar');
  if (!similar.length) {
    el.innerHTML = '<div class="detail-empty">No similar items yet</div>';
    syncSimilarThumbsFade();
    return;
  }
  el.innerHTML = similar.map((s) =>
    `<button type="button" class="similar-thumb" data-id="${s.id}" aria-label="${esc(s.displayName)}"><img src="${s.thumbUrl}" alt="" loading="lazy" /></button>`).join('');
  syncSimilarThumbsFade();
}

function renderDetailMeta(it) {
  const mp = it.width && it.height ? ((it.width * it.height) / 1e6).toFixed(1) : null;
  const rows = [
    ['Original file', it.originalName, true],
    ['Source', it.source, false],
    ['Type', it.type, false],
    ['Dimensions', it.width ? `${it.width} × ${it.height}${mp ? ` (${mp} MP)` : ''}` : '—', false],
    ['File size', formatBytes(it.bytes), false],
    ['Added', new Date(it.addedAt).toLocaleDateString(), false],
    ['Job ID', it.mjId || '—', true],
  ];
  $('detail-meta').innerHTML = rows.map(([k, v, mono]) =>
    `<div class="meta-row"><span class="meta-key">${esc(k)}</span><span class="meta-val${mono ? ' mono' : ''}" title="${esc(v)}">${esc(v)}</span></div>`).join('');
}

// Render the prompt text, turning any `--sref <values>` tokens into clickable
// chips. Each value is a separate chip; the currently assigned sref is marked active.
function promptToHtml(prompt, activeSref) {
  const re = /--sref((?:\s+(?!--)\S+)+)/g;
  let html = '';
  let last = 0;
  let m;
  while ((m = re.exec(prompt)) !== null) {
    html += esc(prompt.slice(last, m.index));
    const values = m[1].trim().split(/\s+/);
    html += '--sref ';
    html += values.map((v) => {
      const active = activeSref && v === activeSref;
      const title = active ? 'Assigned to sref folder — click to remove' : 'Click to save to sref folders';
      return `<button type="button" class="prompt-sref-chip${active ? ' is-active' : ''}" data-sref="${esc(v)}" title="${title}">${esc(v)}</button>`;
    }).join(' ');
    last = m.index + m[0].length;
  }
  html += esc(prompt.slice(last));
  return html;
}

function renderDetailPrompt(it) {
  const pb = $('detail-prompt');
  if (!pb) return;
  const prompt = it && it.prompt ? it.prompt : '';
  pb.classList.toggle('empty', !prompt);
  if (!prompt) {
    pb.textContent = 'No prompt detected in filename';
    return;
  }
  pb.innerHTML = promptToHtml(prompt, it.sref || '');
}

function openDetail(id) {
  const it = state.items.find((i) => i.id === id);
  if (!it) return;
  state.detailId = id;
  state.detailZoom = 100;
  try {
    const viewed = [id, ...JSON.parse(localStorage.getItem('lens.recentViewed') || '[]').filter((v) => v !== id)].slice(0, 10);
    localStorage.setItem('lens.recentViewed', JSON.stringify(viewed));
  } catch { /* localStorage unavailable — skip tracking */ }

  $('detail-media').style.aspectRatio = it.width && it.height ? `${it.width} / ${it.height}` : '';
  $('detail-media').innerHTML = it.type === 'video'
    ? `<video src="${it.fileUrl}" controls autoplay loop poster="${it.thumbUrl}"></video>`
    : `<img src="${it.fileUrl}" alt="${esc(it.displayName)}" />`;

  $('detail-name').value = it.displayName;
  $('detail-colors').innerHTML = it.colors.map((c) =>
    `<button type="button" class="color-chip" style="background:${esc(c.hex)}" data-hex="${esc(c.hex)}" title="${esc(c.hex)} — filter gallery by this color" aria-label="Filter by ${esc(c.hex)}"></button>`).join('');

  renderDetailPrompt(it);
  $('copy-prompt').disabled = !it.prompt;

  renderTagEditor(it);
  renderDetailSrefs(it);
  renderDetailCollections(it);
  $('collection-input').value = '';
  $('sref-input').value = '';
  renderSimilarThumbs(it);
  renderDetailMeta(it);

  $('detail-open').href = it.fileUrl;
  $('detail-fav').classList.toggle('faved', it.favorite);
  $('detail-fav').setAttribute('aria-label', it.favorite ? 'Unfavorite' : 'Favorite');

  updateDetailCounter();
  applyDetailZoom();
  $('detail-info-popover').hidden = true;
  $('detail-info').setAttribute('aria-expanded', 'false');
  $('detail-scrim').hidden = false;
  updateDetailNavBar();
}

function navigateDetail(delta) {
  const visible = detailVisibleItems();
  const idx = visible.findIndex((i) => i.id === state.detailId);
  if (idx < 0) return;
  const next = visible[idx + delta];
  if (next) openDetail(next.id);
}

function closeDetail() {
  const video = document.querySelector('#detail-media video');
  if (video) video.pause();
  state.detailId = null;
  $('detail-scrim').hidden = true;
  updateDetailNavBar();
  $('detail-info-popover').hidden = true;
  state.collectMenuAnchor = null;
  state.srefMenuAnchor = null;
  $('collect-menu').hidden = true;
  $('sref-menu').hidden = true;
}

function renderTagEditor(it) {
  const chips = $('detail-tag-chips');
  chips.innerHTML = '';
  for (const tag of it.tags) {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    const label = tag.startsWith('#') ? tag : `#${tag}`;
    chip.innerHTML = `${esc(label)}<button type="button" aria-label="Remove tag ${esc(tag)}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>`;
    chip.querySelector('button').onclick = async () => {
      chip.classList.add('removing');
      await patchItem(it.id, { tags: it.tags.filter((t) => t !== tag) });
      const updated = state.items.find((i) => i.id === it.id);
      if (updated) renderTagEditor(updated);
      render();
    };
    chips.appendChild(chip);
  }
  $('tag-input').value = '';
}

/* ---------- API helpers ---------- */

async function patchItem(id, body) {
  const res = await fetch(`/api/items/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    toast('Save failed', 'error', state.items.find((i) => i.id === id)?.thumbUrl ?? null);
    return null;
  }
  const { item } = await res.json();
  const idx = state.items.findIndex((i) => i.id === id);
  if (idx > -1) state.items[idx] = item;
  return item;
}

function formatBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

let snackTimer = null;
function showSnack(item, text, actionLabel, onAction) {
  let snack = document.querySelector('.fav-snack');
  if (!snack) {
    snack = document.createElement('div');
    snack.className = 'fav-snack';
    snack.innerHTML = '<img alt="" /><span class="fav-snack-text"></span><button class="fav-snack-action"></button>';
    document.body.appendChild(snack);
  }
  snack.querySelector('img').src = item.thumbUrl;
  snack.querySelector('.fav-snack-text').textContent = text;
  const btn = snack.querySelector('.fav-snack-action');
  btn.hidden = !actionLabel;
  if (actionLabel) {
    btn.textContent = actionLabel;
    btn.onclick = () => { onAction(); snack.classList.remove('show'); };
  }
  // restart animation even if already visible
  snack.classList.remove('show');
  void snack.offsetHeight;
  snack.classList.add('show');
  requestAnimationFrame(positionToastStack);
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => snack.classList.remove('show'), 2600);
}

function showFavSnack(item, faved) {
  showSnack(item, faved ? 'Added to Favorites' : 'Removed from Favorites',
    faved ? 'View favorites' : null,
    () => { state.filters.favOnly = true; render(); });
}

const TOAST_ICON = {
  'heart-filled': '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" fill="#E5484D" stroke="#E5484D" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  'heart-outline': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>',
  trash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#E5484D" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
  tag: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r="0.6" fill="#1A1A1A"/></svg>',
  hash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/></svg>',
  copy: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  alert: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#E5484D" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>',
  check: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
};

/** @returns {{ type: 'icon', name: keyof typeof TOAST_ICON } | { type: 'image', url: string }} */
function resolveToastBadge(msg, kind, imageUrl) {
  const m = msg.toLowerCase();
  if (m.includes('favorited') && !m.includes('unfavorited')) return { type: 'icon', name: 'heart-filled' };
  if (m.includes('unfavorited')) return { type: 'icon', name: 'heart-outline' };
  if (m.includes('deleted') || m.includes('delete failed')) return { type: 'icon', name: 'trash' };
  if (m.includes('added') && m.includes(' to ')) return { type: 'icon', name: 'tag' };
  if (m.includes('sref')) return { type: 'icon', name: 'hash' };
  if (m.includes('copied')) return { type: 'icon', name: 'copy' };
  if (kind === 'error') return { type: 'icon', name: 'alert' };
  if (imageUrl) return { type: 'image', url: imageUrl };
  return { type: 'icon', name: 'check' };
}

/**
 * @param {string} msg
 * @param {'success'|'error'} [kind]
 * @param {string|null} [imageUrl] Optional item thumbnail URL
 */
function toast(msg, kind = 'success', imageUrl = null) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  const badge = document.createElement('div');
  badge.className = 'toast-badge';
  const resolved = resolveToastBadge(msg, kind, imageUrl);
  if (resolved.type === 'image') {
    const img = document.createElement('img');
    img.className = 'toast-badge-img';
    img.src = resolved.url;
    img.alt = '';
    badge.appendChild(img);
  } else {
    badge.innerHTML = TOAST_ICON[resolved.name];
  }
  el.appendChild(badge);
  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = msg;
  el.appendChild(text);
  $('toast-stack').appendChild(el);
  requestAnimationFrame(positionToastStack);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 250);
  }, 3500);
}

/* ---------- Event wiring ---------- */

function wire() {
  // Color picker popover (search bar) — sets state.filters.pickedColor (single color)
  const colorBtn = $('color-btn');
  const colorPop = $('color-pop');
  const pick = { h: 0, s: 0.42, v: 0.84 }; // default lands on #D57B7B territory

  const hexToHsv = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return { h, s: max ? d / max : 0, v: max };
  };

  let pickTimer;
  const syncPicker = (applyFilter) => {
    const hex = hsvToHex(pick.h, pick.s, pick.v);
    $('sv-area').style.backgroundColor = `hsl(${pick.h} 100% 50%)`;
    $('sv-thumb').style.left = `${pick.s * 100}%`;
    $('sv-thumb').style.top = `${(1 - pick.v) * 100}%`;
    $('sv-thumb').style.backgroundColor = hex;
    $('hue-thumb').style.left = `${(pick.h / 360) * 100}%`;
    $('hue-thumb').style.backgroundColor = `hsl(${pick.h} 100% 50%)`;
    $('hex-swatch').style.background = hex;
    $('hex-text').textContent = hex;
    if (applyFilter) {
      state.filters.pickedColor = hex;
      clearTimeout(pickTimer);
      pickTimer = setTimeout(render, 120);
    }
  };

  const dragify = (el, onMove) => {
    el.addEventListener('pointerdown', (e) => {
      if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
      e.preventDefault();
      onMove(e);
      const move = (ev) => {
        if (!Number.isFinite(ev.clientX) || !Number.isFinite(ev.clientY)) return;
        if (ev.buttons === 0) { up(); return; } // button released outside window
        onMove(ev);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  };

  dragify($('sv-area'), (e) => {
    const r = $('sv-area').getBoundingClientRect();
    pick.s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    pick.v = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    syncPicker(true);
  });

  dragify($('hue-slider'), (e) => {
    const r = $('hue-slider').getBoundingClientRect();
    pick.h = Math.min(359.9, Math.max(0, ((e.clientX - r.left) / r.width) * 360));
    syncPicker(true);
  });

  // × clears the color filter
  $('picker-clear').addEventListener('click', () => {
    state.filters.pickedColor = null;
    render();
  });

  // search-bar tag: click reopens the picker, × clears the filter
  $('search-color-tags').addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target.closest('.tag-close')) {
      state.filters.pickedColor = null;
      colorPop.hidden = true;
      colorBtn.setAttribute('aria-expanded', 'false');
      render();
      return;
    }
    if (!state.filters.pickedColor) return;
    Object.assign(pick, hexToHsv(state.filters.pickedColor));
    colorPop.hidden = false;
    colorBtn.setAttribute('aria-expanded', 'true');
    syncPicker(false);
    render();
  });

  const closePicker = () => {
    colorPop.hidden = true;
    colorBtn.setAttribute('aria-expanded', 'false');
    // remember picked color for the search panel's Colors section
    if (state.filters.pickedColor) {
      const c = state.filters.pickedColor;
      const stored = lsGet('lens.recentColors');
      lsSet('lens.recentColors', [c, ...stored.filter((x) => x !== c)].slice(0, 8));
    }
    render();
  };
  $('picker-done').addEventListener('click', closePicker);

  colorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!colorPop.hidden) { closePicker(); return; }
    if (state.filters.pickedColor) Object.assign(pick, hexToHsv(state.filters.pickedColor));
    colorPop.hidden = false;
    colorBtn.setAttribute('aria-expanded', 'true');
    syncPicker(false);
    render();
  });
  document.addEventListener('click', (e) => {
    if (!colorPop.hidden && !e.target.closest('.search-bar')) {
      colorPop.hidden = true;
      colorBtn.setAttribute('aria-expanded', 'false');
    }
  });

  const toggleCheckboxSet = (setName, containerId) => (e) => {
    const cb = e.target.closest('.filter-checkbox');
    if (!cb || !e.target.closest(`#${containerId}`)) return;
    const set = state.filters[setName];
    if (cb.checked) set.add(cb.dataset.value);
    else set.delete(cb.dataset.value);
    render();
  };
  $('type-filter').addEventListener('change', toggleCheckboxSet('types', 'type-filter'));
  $('size-filter').addEventListener('change', toggleCheckboxSet('sizes', 'size-filter'));
  $('source-filter').addEventListener('change', toggleCheckboxSet('sources', 'source-filter'));

  const toggleTagPill = (e) => {
    const pill = e.target.closest('.pill');
    if (!pill || !e.target.closest('#tags-filter')) return;
    const v = pill.dataset.value;
    const set = state.filters.tags;
    set.has(v) ? set.delete(v) : set.add(v);
    render();
  };
  $('tags-filter').addEventListener('click', toggleTagPill);

  // Collapsible sections
  document.querySelectorAll('.filter-header').forEach((h) => {
    h.addEventListener('click', () => {
      const section = h.closest('.filter-section');
      const collapsed = section.classList.toggle('collapsed');
      h.setAttribute('aria-expanded', String(!collapsed));
    });
  });

  wireNavPopovers();
  wireSizeSlider();

  // Search — live results + recent-searches dropdown (Cosmos-style)
  const searchInput = $('search');
  const searchPop = $('search-pop');
  let searchTimer;
  let popFocusIdx = -1;

  const lsGet = (k) => JSON.parse(localStorage.getItem(k) || '[]');
  const lsSet = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const getRecents = () => lsGet('lens.recentSearches');
  const saveRecent = (q) => {
    q = q.trim();
    if (!q) return;
    lsSet('lens.recentSearches', [q, ...getRecents().filter((r) => r !== q)].slice(0, 8));
  };

  const closeSearchPop = () => { searchPop.hidden = true; popFocusIdx = -1; };

  const openSearchPop = () => {
    if (searchInput.value) { closeSearchPop(); return; }
    const recents = getRecents();
    const recentColors = lsGet('lens.recentColors');
    const viewed = lsGet('lens.recentViewed')
      .map((id) => state.items.find((it) => it.id === id))
      .filter(Boolean);
    if (!recents.length && !recentColors.length && !viewed.length) { closeSearchPop(); return; }
    popFocusIdx = -1;

    const searchIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.34-4.34"/></svg>';
    let html = '';
    if (recents.length) {
      html += `<div class="pop-section">
        <div class="pop-section-head"><span class="pop-section-title">Recent</span><button class="pop-clear" data-clear="searches">Clear</button></div>
        <div class="pop-chip-scroll"><div class="pop-chip-row">${recents.map((r) =>
          `<button class="pop-chip search-pop-item" data-q="${esc(r)}">${searchIcon}<span>${esc(r)}</span></button>`).join('')}</div></div>
      </div>`;
    }
    if (recentColors.length) {
      html += `<div class="pop-section">
        <div class="pop-section-head"><span class="pop-section-title">Colors</span><button class="pop-clear" data-clear="colors">Clear</button></div>
        <div class="pop-chip-scroll"><div class="pop-chip-row">${recentColors.map((hex) =>
          `<button class="pop-chip" data-color="${esc(hex)}"><span class="chip-swatch" style="background:${esc(hex)}"></span><span class="chip-hex">${esc(hex)}</span></button>`).join('')}</div></div>
      </div>`;
    }
    if (viewed.length) {
      html += `<div class="pop-section">
        <div class="pop-section-head"><span class="pop-section-title">Recently viewed</span><button class="pop-clear" data-clear="viewed">Clear</button></div>
        <div class="pop-thumb-scroll"><div class="pop-thumb-row">${viewed.map((it) =>
          `<button class="pop-thumb" data-view="${it.id}" aria-label="${esc(it.displayName)}"><img src="${it.thumbUrl}" alt="" loading="lazy"/></button>`).join('')}</div></div>
      </div>`;
    }
    searchPop.innerHTML = html;
    searchPop.hidden = false;
    searchPop.querySelectorAll('.pop-chip-scroll, .pop-thumb-scroll').forEach((wrap) => {
      const row = wrap.firstElementChild;
      if (!row) return;
      const syncFade = () => {
        const max = row.scrollWidth - row.clientWidth;
        wrap.classList.toggle('can-scroll-left', row.scrollLeft > 1);
        wrap.classList.toggle('can-scroll-right', max > 1 && row.scrollLeft < max - 1);
      };
      row.addEventListener('scroll', syncFade, { passive: true });
      syncFade();
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(syncFade).observe(row);
      }
    });
  };

  const applySearch = (q, commit) => {
    searchInput.value = q;
    $('search-clear').hidden = !q;
    state.filters.q = q;
    if (commit) saveRecent(q);
    render();
  };

  searchInput.addEventListener('focus', openSearchPop);
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    $('search-clear').hidden = !e.target.value;
    if (e.target.value) closeSearchPop(); else openSearchPop();
    searchTimer = setTimeout(() => {
      state.filters.q = e.target.value;
      render();
    }, 300);
  });
  searchInput.addEventListener('keydown', (e) => {
    const items = [...searchPop.querySelectorAll('.search-pop-item')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (searchPop.hidden || !items.length) return;
      e.preventDefault();
      popFocusIdx = e.key === 'ArrowDown'
        ? (popFocusIdx + 1) % items.length
        : (popFocusIdx - 1 + items.length) % items.length;
      items.forEach((it, i) => it.classList.toggle('focused', i === popFocusIdx));
    } else if (e.key === 'Enter') {
      if (!searchPop.hidden && popFocusIdx > -1) {
        applySearch(items[popFocusIdx].dataset.q, true);
      } else {
        clearTimeout(searchTimer);
        applySearch(searchInput.value, true);
      }
      closeSearchPop();
    } else if (e.key === 'Escape') {
      closeSearchPop();
      if (searchInput.value) applySearch('', false);
      searchInput.blur();
    }
  });
  searchPop.addEventListener('click', (e) => {
    e.stopPropagation();
    const clear = e.target.closest('.pop-clear');
    if (clear) {
      const key = { searches: 'lens.recentSearches', colors: 'lens.recentColors', viewed: 'lens.recentViewed' }[clear.dataset.clear];
      localStorage.removeItem(key);
      openSearchPop();
      return;
    }
    const colorChip = e.target.closest('[data-color]');
    if (colorChip) {
      applyPickedColorFilter(colorChip.dataset.color);
      closeSearchPop();
      return;
    }
    const thumb = e.target.closest('[data-view]');
    if (thumb) {
      closeSearchPop();
      openDetail(thumb.dataset.view);
      return;
    }
    const item = e.target.closest('.search-pop-item');
    if (item) {
      applySearch(item.dataset.q, true);
      closeSearchPop();
    }
  });
  document.addEventListener('click', (e) => {
    if (!searchPop.hidden && !e.target.closest('.search-bar')) closeSearchPop();
  });

  $('search-clear').addEventListener('click', () => {
    applySearch('', false);
  });

  // Nav
  $('nav-all').addEventListener('click', () => {
    state.libraryView = null;
    state.activeCollection = null;
    state.activeSref = null;
    state.filters.favOnly = false;
    render();
  });
  $('nav-fav').addEventListener('click', () => {
    state.libraryView = null;
    state.activeCollection = null;
    state.activeSref = null;
    state.filters.favOnly = true;
    render();
  });

  wireLibraryBrowse();
  wireCollectionContextMenu();
  wireCollectionContext();

  wireCollections();
  wireSrefs();

  $('clear-filters').addEventListener('click', () => {
    state.activeSref = null;
    state.filters = { q: '', colors: new Set(), pickedColor: null, types: new Set(), sources: new Set(), sizes: new Set(), tags: new Set(), favOnly: false };
    $('search').value = '';
    $('search-clear').hidden = true;
    render();
  });

  // Sort dropdown
  const sortBtn = $('sort-btn');
  const sortMenu = $('sort-menu');
  syncSortUI();
  sortBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = sortMenu.hidden;
    sortMenu.hidden = !open;
    sortBtn.setAttribute('aria-expanded', String(open));
  });
  sortMenu.addEventListener('click', (e) => {
    const opt = e.target.closest('.sort-option');
    if (!opt) return;
    state.sort = opt.dataset.value;
    syncSortUI();
    sortMenu.hidden = true;
    sortBtn.setAttribute('aria-expanded', 'false');
    render();
    renderCollections();
    renderSrefs();
  });
  document.addEventListener('click', (e) => {
    if (!sortMenu.hidden && !e.target.closest('.sort-wrap')) {
      sortMenu.hidden = true;
      sortBtn.setAttribute('aria-expanded', 'false');
    }
  });

  // Import
  $('import-btn').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', (e) => {
    importFiles(e.target.files);
    e.target.value = '';
  });

  // Drag & drop — external files import; internal card drags go to collections
  const isFileDrag = (e) => Array.from(e.dataTransfer.types || []).includes('Files');
  let dragDepth = 0;
  document.addEventListener('dragenter', (e) => {
    if (!isFileDrag(e)) return; // ignore internal card drags
    e.preventDefault();
    if (++dragDepth === 1) $('drop-overlay').hidden = false;
  });
  document.addEventListener('dragleave', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    if (--dragDepth <= 0) { dragDepth = 0; $('drop-overlay').hidden = true; }
  });
  document.addEventListener('dragover', (e) => { if (isFileDrag(e)) e.preventDefault(); });
  document.addEventListener('drop', async (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth = 0;
    $('drop-overlay').hidden = true;
    const files = await collectFiles(e.dataTransfer);
    importFiles(files);
  });

  // Internal drag: cards → collection folders (multi-select moves the whole batch)
  let draggingIds = [];
  let dragGhost = null;

  const parseDragIds = (dt) => {
    const raw = dt.getData('application/x-lens-ids') || dt.getData('text/plain');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return raw.split(',').filter(Boolean);
    }
  };

  const clearDragBatchStyles = () => {
    document.querySelectorAll('.card.drag-batch').forEach((el) => el.classList.remove('drag-batch', 'drag-source'));
    document.querySelectorAll('.collection-item.drop-target').forEach((el) => el.classList.remove('drop-target'));
  };

  const dragIdsForCard = (id) => (
    state.selection.size > 0 && state.selection.has(id) ? [...state.selection] : [id]
  );

  $('grid').addEventListener('dragstart', (e) => {
    if (e.target.closest('.card-select, .card-fav-btn, .card-similar')) {
      e.preventDefault();
      return;
    }
    const card = e.target.closest('.card');
    if (!card) return;
    const id = card.dataset.id;
    draggingIds = dragIdsForCard(id);
    const payload = JSON.stringify(draggingIds);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/x-lens-ids', payload);
    e.dataTransfer.setData('text/plain', payload);

    draggingIds.forEach((dragId) => {
      const batchCard = $('grid').querySelector(`.card[data-id="${dragId}"]`);
      if (batchCard) {
        batchCard.classList.add('drag-batch');
        if (batchCard === card) batchCard.classList.add('drag-source');
      }
    });

    if (draggingIds.length > 1) {
      dragGhost = document.createElement('div');
      dragGhost.className = 'drag-ghost';
      dragGhost.textContent = `${draggingIds.length} images`;
      document.body.appendChild(dragGhost);
      e.dataTransfer.setDragImage(dragGhost, 48, 24);
    }

    document.body.classList.add('dragging-cards');
  });

  $('grid').addEventListener('dragend', () => {
    draggingIds = [];
    if (dragGhost) {
      dragGhost.remove();
      dragGhost = null;
    }
    document.body.classList.remove('dragging-cards');
    clearDragBatchStyles();
  });

  const collList = $('collections-body');
  collList.addEventListener('dragover', (e) => {
    const ids = draggingIds.length ? draggingIds : parseDragIds(e.dataTransfer);
    if (!ids.length) return;
    const item = e.target.closest('.collection-item');
    if (!item) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    document.querySelectorAll('.collection-item.drop-target').forEach((el) => {
      if (el !== item) el.classList.remove('drop-target');
    });
    item.classList.add('drop-target');
  });
  collList.addEventListener('dragleave', (e) => {
    const item = e.target.closest('.collection-item');
    if (item && !item.contains(e.relatedTarget)) item.classList.remove('drop-target');
  });
  collList.addEventListener('drop', async (e) => {
    const item = e.target.closest('.collection-item');
    const ids = draggingIds.length ? draggingIds : parseDragIds(e.dataTransfer);
    if (!item || !ids.length) return;
    e.preventDefault();
    e.stopPropagation();
    suppressCollectionClick = true;
    requestAnimationFrame(() => { suppressCollectionClick = false; });
    clearDragBatchStyles();
    const c = state.collections.find((x) => x.id === item.dataset.cid);
    if (!c) return;
    draggingIds = [];
    await addItemsToCollection(c, ids);
  });

  const srefList = $('srefs-body');
  srefList.addEventListener('dragover', (e) => {
    const ids = draggingIds.length ? draggingIds : parseDragIds(e.dataTransfer);
    if (!ids.length) return;
    const item = e.target.closest('.sref-item');
    if (!item) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    document.querySelectorAll('.sref-item.drop-target').forEach((el) => {
      if (el !== item) el.classList.remove('drop-target');
    });
    item.classList.add('drop-target');
  });
  srefList.addEventListener('dragleave', (e) => {
    const item = e.target.closest('.sref-item');
    if (item && !item.contains(e.relatedTarget)) item.classList.remove('drop-target');
  });
  srefList.addEventListener('drop', async (e) => {
    const item = e.target.closest('.sref-item');
    const ids = draggingIds.length ? draggingIds : parseDragIds(e.dataTransfer);
    if (!item || !ids.length) return;
    e.preventDefault();
    e.stopPropagation();
    suppressSrefClick = true;
    requestAnimationFrame(() => { suppressSrefClick = false; });
    clearDragBatchStyles();
    const sref = item.dataset.sref;
    draggingIds = [];
    await assignSrefToItems(sref, ids);
  });

  // Grid → select / favorite / detail
  $('grid').addEventListener('click', async (e) => {
    const similarBtn = e.target.closest('.card-similar');
    if (similarBtn) {
      e.stopPropagation();
      findSimilarBySref(similarBtn.closest('.card').dataset.id);
      return;
    }
    const selBtn = e.target.closest('.card-select');
    if (selBtn) {
      e.stopPropagation();
      toggleSelect(selBtn.closest('.card').dataset.id);
      return;
    }
    const favBtn = e.target.closest('.card-fav-btn');
    if (favBtn) {
      e.stopPropagation();
      const id = favBtn.closest('.card').dataset.id;
      const it = state.items.find((i) => i.id === id);
      const item = await patchItem(id, { favorite: !it.favorite });
      if (item) {
        render();
        showFavSnack(item, item.favorite);
      }
      return;
    }
    const card = e.target.closest('.card');
    if (!card) return;
    // while selecting or organizing, a plain click toggles selection instead of opening detail
    if (state.collectionOrganize || state.selection.size > 0 || e.metaKey || e.shiftKey) {
      toggleSelect(card.dataset.id);
      return;
    }
    openDetail(card.dataset.id);
  });
  $('grid').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const card = e.target.closest('.card');
      if (card) { e.preventDefault(); openDetail(card.dataset.id); }
    }
  });

  // Detail interactions
  $('detail-close').addEventListener('click', closeDetail);
  $('detail-back').addEventListener('click', closeDetail);
  $('detail-prev').addEventListener('click', () => navigateDetail(-1));
  $('detail-next').addEventListener('click', () => navigateDetail(1));
  $('detail-zoom').addEventListener('input', (e) => {
    state.detailZoom = Number(e.target.value);
    applyDetailZoom();
  });
  $('detail-info').addEventListener('click', (e) => {
    e.stopPropagation();
    const pop = $('detail-info-popover');
    const open = pop.hidden;
    pop.hidden = !open;
    $('detail-info').setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    const pop = $('detail-info-popover');
    if (!pop.hidden && !e.target.closest('#detail-info') && !e.target.closest('#detail-info-popover')) {
      pop.hidden = true;
      $('detail-info').setAttribute('aria-expanded', 'false');
    }
  });
  $('detail-srefs').addEventListener('click', async (e) => {
    if (!e.target.closest('.detail-sref-remove') || !state.detailId) return;
    await assignSrefToDetailItem('');
  });
  $('detail-collections').addEventListener('click', async (e) => {
    const btn = e.target.closest('.detail-collection-remove');
    if (!btn || !state.detailId) return;
    const c = state.collections.find((x) => x.id === btn.dataset.cid);
    if (!c) return;
    await apiCollection('PATCH', '/' + c.id, { removeItemIds: [state.detailId] });
    c.itemIds = c.itemIds.filter((id) => id !== state.detailId);
    renderDetailCollections(state.items.find((i) => i.id === state.detailId));
    render();
  });
  $('detail-similar').addEventListener('click', (e) => {
    const thumb = e.target.closest('.similar-thumb');
    if (!thumb) return;
    openDetail(thumb.dataset.id);
  });
  $('detail-auto-tag').addEventListener('click', () => {
    toast('Auto-tag coming soon', 'success');
  });
  document.addEventListener('keydown', (e) => {
    if ($('detail-scrim').hidden) return;
    const target = e.target;
    const inField = target instanceof HTMLElement
      && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (e.key === 'Escape') closeDetail();
    if (!inField && e.key === 'ArrowLeft') navigateDetail(-1);
    if (!inField && e.key === 'ArrowRight') navigateDetail(1);
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      $('search').focus();
    }
  });

  $('detail-name').addEventListener('change', async (e) => {
    if (!state.detailId) return;
    await patchItem(state.detailId, { displayName: e.target.value });
    render();
  });

  const tagInput = $('tag-input');
  const tagSuggest = $('tag-suggest');
  let tagFocusIdx = -1;

  const allTags = () => [...new Set(state.items.flatMap((i) => i.tags))].sort((a, b) => a.localeCompare(b));

  const addTag = async (value) => {
    const v = value.trim().replace(/^#+/, '');
    if (!v || !state.detailId) return;
    const it = state.items.find((i) => i.id === state.detailId);
    if (!it.tags.includes(v)) {
      await patchItem(state.detailId, { tags: [...it.tags, v] });
      renderTagEditor(state.items.find((i) => i.id === state.detailId));
      render();
    }
    tagInput.value = '';
    closeTagSuggest();
  };

  const closeTagSuggest = () => { tagSuggest.hidden = true; tagFocusIdx = -1; };

  const openTagSuggest = () => {
    if (!state.detailId) return closeTagSuggest();
    const it = state.items.find((i) => i.id === state.detailId);
    const q = tagInput.value.trim().toLowerCase();
    const applied = new Set(it.tags);
    const matches = allTags().filter((t) => !applied.has(t) && (!q || t.toLowerCase().includes(q)));
    const exactExists = matches.some((t) => t.toLowerCase() === q) || applied.has(tagInput.value.trim());
    if (!matches.length && !(q && !exactExists)) return closeTagSuggest();
    tagFocusIdx = -1;
    const tagIcon = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg>';
    const hi = (t) => q ? esc(t).replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i'), '<mark>$1</mark>') : esc(t);
    let html = matches.map((t) => `<button class="tag-suggest-item" data-tag="${esc(t)}">${tagIcon}<span>${hi(t)}</span></button>`).join('');
    if (q && !exactExists) {
      html += `<button class="tag-suggest-item" data-tag="${esc(tagInput.value.trim())}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg><span>${esc(tagInput.value.trim())}</span><span class="new-hint">New tag</span></button>`;
    }
    tagSuggest.innerHTML = html;
    tagSuggest.hidden = false;
  };

  tagInput.addEventListener('focus', openTagSuggest);
  tagInput.addEventListener('input', openTagSuggest);
  tagInput.addEventListener('keydown', (e) => {
    const items = [...tagSuggest.querySelectorAll('.tag-suggest-item')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (tagSuggest.hidden || !items.length) return;
      e.preventDefault();
      tagFocusIdx = e.key === 'ArrowDown'
        ? (tagFocusIdx + 1) % items.length
        : (tagFocusIdx - 1 + items.length) % items.length;
      items.forEach((it, i) => it.classList.toggle('focused', i === tagFocusIdx));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!tagSuggest.hidden && tagFocusIdx > -1) addTag(items[tagFocusIdx].dataset.tag);
      else addTag(tagInput.value);
    } else if (e.key === 'Escape') {
      if (!tagSuggest.hidden) { e.stopPropagation(); closeTagSuggest(); }
    }
  });
  tagSuggest.addEventListener('mousedown', (e) => {
    const item = e.target.closest('.tag-suggest-item');
    if (item) { e.preventDefault(); addTag(item.dataset.tag); }
  });
  tagInput.addEventListener('blur', () => setTimeout(closeTagSuggest, 120));

  const collectionInput = $('collection-input');
  const collectionSuggest = $('collection-suggest');
  let collectionFocusIdx = -1;
  const collectionFolderIcon = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>';

  const closeCollectionSuggest = () => { collectionSuggest.hidden = true; collectionFocusIdx = -1; };

  const assignCollectionToDetailItem = async (value) => {
    const v = value.trim();
    if (!v || !state.detailId) return;
    const memberOf = new Set(state.collections.filter((c) => c.itemIds.includes(state.detailId)).map((c) => c.id));
    const existing = state.collections.find((c) => c.name.toLowerCase() === v.toLowerCase());
    if (existing) {
      if (memberOf.has(existing.id)) {
        collectionInput.value = '';
        closeCollectionSuggest();
        return;
      }
      await addItemsToCollection(existing, [state.detailId], { clearSelection: false });
    } else {
      const { collection } = await apiCollection('POST', '', { name: v }) || {};
      if (!collection) return;
      state.collections.push(collection);
      await addItemsToCollection(collection, [state.detailId], { clearSelection: false });
    }
    const updated = state.items.find((i) => i.id === state.detailId);
    if (updated) renderDetailCollections(updated);
    collectionInput.value = '';
    closeCollectionSuggest();
  };

  const openCollectionSuggest = () => {
    if (!state.detailId) return closeCollectionSuggest();
    const memberOf = new Set(state.collections.filter((c) => c.itemIds.includes(state.detailId)).map((c) => c.name.toLowerCase()));
    const q = collectionInput.value.trim().toLowerCase();
    const matches = state.collections.filter((c) => !memberOf.has(c.name.toLowerCase()) && (!q || c.name.toLowerCase().includes(q)));
    const exactExists = state.collections.some((c) => c.name.toLowerCase() === q);
    const alreadyMember = memberOf.has(q);
    if (!matches.length && !(q && !exactExists && !alreadyMember)) return closeCollectionSuggest();
    collectionFocusIdx = -1;
    const hi = (t) => q ? esc(t).replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i'), '<mark>$1</mark>') : esc(t);
    let html = matches.map((c) =>
      `<button class="tag-suggest-item" data-collection="${esc(c.name)}">${collectionFolderIcon}<span>${hi(c.name)}</span></button>`).join('');
    if (q && !exactExists && !alreadyMember) {
      html += `<button class="tag-suggest-item" data-collection="${esc(collectionInput.value.trim())}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg><span>${esc(collectionInput.value.trim())}</span><span class="new-hint">New collection</span></button>`;
    }
    collectionSuggest.innerHTML = html;
    collectionSuggest.hidden = false;
  };

  collectionInput.addEventListener('focus', openCollectionSuggest);
  collectionInput.addEventListener('input', openCollectionSuggest);
  collectionInput.addEventListener('keydown', (e) => {
    const items = [...collectionSuggest.querySelectorAll('.tag-suggest-item')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (collectionSuggest.hidden || !items.length) return;
      e.preventDefault();
      collectionFocusIdx = e.key === 'ArrowDown'
        ? (collectionFocusIdx + 1) % items.length
        : (collectionFocusIdx - 1 + items.length) % items.length;
      items.forEach((it, i) => it.classList.toggle('focused', i === collectionFocusIdx));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!collectionSuggest.hidden && collectionFocusIdx > -1) assignCollectionToDetailItem(items[collectionFocusIdx].dataset.collection);
      else assignCollectionToDetailItem(collectionInput.value);
    } else if (e.key === 'Escape') {
      if (!collectionSuggest.hidden) { e.stopPropagation(); closeCollectionSuggest(); }
    }
  });
  collectionSuggest.addEventListener('mousedown', (e) => {
    const item = e.target.closest('.tag-suggest-item');
    if (item) { e.preventDefault(); assignCollectionToDetailItem(item.dataset.collection); }
  });
  collectionInput.addEventListener('blur', () => setTimeout(closeCollectionSuggest, 120));

  const srefInput = $('sref-input');
  const srefSuggest = $('sref-suggest');
  let srefFocusIdx = -1;
  const srefFolderIcon = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>';

  const closeSrefSuggest = () => { srefSuggest.hidden = true; srefFocusIdx = -1; };

  const addSrefFromInput = async (value) => {
    const v = value.trim();
    if (!v || !state.detailId) return;
    await assignSrefToDetailItem(v);
    srefInput.value = '';
    closeSrefSuggest();
  };

  const openSrefSuggest = () => {
    if (!state.detailId) return closeSrefSuggest();
    const q = srefInput.value.trim().toLowerCase();
    const matches = state.srefGroups.filter((g) => !q || g.name.toLowerCase().includes(q));
    const exactExists = state.srefGroups.some((g) => g.name.toLowerCase() === q);
    if (!matches.length && !(q && !exactExists)) return closeSrefSuggest();
    srefFocusIdx = -1;
    const hi = (t) => q ? esc(t).replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i'), '<mark>$1</mark>') : esc(t);
    let html = matches.map((g) =>
      `<button class="tag-suggest-item" data-sref="${esc(g.name)}">${srefFolderIcon}<span class="mono">${hi(g.name)}</span></button>`).join('');
    if (q && !exactExists) {
      html += `<button class="tag-suggest-item" data-sref="${esc(srefInput.value.trim())}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg><span class="mono">${esc(srefInput.value.trim())}</span><span class="new-hint">New sref</span></button>`;
    }
    srefSuggest.innerHTML = html;
    srefSuggest.hidden = false;
  };

  srefInput.addEventListener('focus', openSrefSuggest);
  srefInput.addEventListener('input', openSrefSuggest);
  srefInput.addEventListener('keydown', (e) => {
    const items = [...srefSuggest.querySelectorAll('.tag-suggest-item')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (srefSuggest.hidden || !items.length) return;
      e.preventDefault();
      srefFocusIdx = e.key === 'ArrowDown'
        ? (srefFocusIdx + 1) % items.length
        : (srefFocusIdx - 1 + items.length) % items.length;
      items.forEach((it, i) => it.classList.toggle('focused', i === srefFocusIdx));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!srefSuggest.hidden && srefFocusIdx > -1) addSrefFromInput(items[srefFocusIdx].dataset.sref);
      else addSrefFromInput(srefInput.value);
    } else if (e.key === 'Escape') {
      if (!srefSuggest.hidden) { e.stopPropagation(); closeSrefSuggest(); }
    }
  });
  srefSuggest.addEventListener('mousedown', (e) => {
    const item = e.target.closest('.tag-suggest-item');
    if (item) { e.preventDefault(); addSrefFromInput(item.dataset.sref); }
  });
  srefInput.addEventListener('blur', () => setTimeout(closeSrefSuggest, 120));

  $('detail-fav').addEventListener('click', async () => {
    if (!state.detailId) return;
    const it = state.items.find((i) => i.id === state.detailId);
    const item = await patchItem(state.detailId, { favorite: !it.favorite });
    if (item) {
      $('detail-fav').classList.toggle('faved', item.favorite);
      $('detail-fav').setAttribute('aria-label', item.favorite ? 'Unfavorite' : 'Favorite');
      render();
      showFavSnack(item, item.favorite);
    }
  });

  $('copy-prompt').addEventListener('click', async () => {
    const it = state.items.find((i) => i.id === state.detailId);
    if (!it || !it.prompt) return;
    await navigator.clipboard.writeText(it.prompt);
    toast('Prompt copied', 'success', it.thumbUrl);
  });

  // Click a `--sref` chip in the prompt to file the image into that sref folder
  // (or click the active one again to remove it).
  $('detail-prompt').addEventListener('click', async (e) => {
    const chip = e.target.closest('.prompt-sref-chip');
    if (!chip || !state.detailId) return;
    const value = chip.dataset.sref;
    const it = state.items.find((i) => i.id === state.detailId);
    const isActive = it && it.sref === value;
    await assignSrefToDetailItem(isActive ? '' : value);
    const updated = state.items.find((i) => i.id === state.detailId);
    if (updated) renderDetailPrompt(updated);
  });

  $('detail-colors').addEventListener('click', (e) => {
    const chip = e.target.closest('.color-chip');
    if (!chip) return;
    applyPickedColorFilter(chip.dataset.hex);
  });

  $('detail-delete').addEventListener('click', async () => {
    if (!state.detailId) return;
    const it = state.items.find((i) => i.id === state.detailId);
    if (!confirm(`Delete "${it.displayName}" from the library? The copied file will be removed.`)) return;
    const thumbUrl = it.thumbUrl;
    const res = await fetch(`/api/items/${state.detailId}`, { method: 'DELETE' });
    if (res.ok) {
      const delId = state.detailId;
      state.items = state.items.filter((i) => i.id !== delId);
      state.selection.delete(delId);
      for (const c of state.collections) c.itemIds = c.itemIds.filter((id) => id !== delId);
      closeDetail();
      render();
      toast('Deleted', 'success', thumbUrl);
    } else {
      toast('Delete failed', 'error', thumbUrl);
    }
  });
}

/* ---------- Selection & Collections ---------- */

function toggleSelect(id) {
  const on = !state.selection.has(id);
  on ? state.selection.add(id) : state.selection.delete(id);
  // update just this card (avoid re-rendering the whole grid on every toggle)
  const card = $('grid').querySelector(`.card[data-id="${id}"]`);
  if (card) {
    card.classList.toggle('selected', on);
    const btn = card.querySelector('.card-select');
    btn.classList.toggle('checked', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Deselect' : 'Select');
  }
  renderSelectionBar();
}

async function apiCollection(method, path, body) {
  const res = await fetch('/api/collections' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { toast('Collection action failed', 'error'); return null; }
  return res.status === 200 ? res.json() : {};
}

async function apiCollectionReorder(ids) {
  const res = await fetch('/api/collections/reorder', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) { toast('Could not save collection order', 'error'); return null; }
  return res.json();
}

async function apiSrefGroup(method, path, body) {
  const res = await fetch('/api/sref-groups' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { toast('Sref folder action failed', 'error'); return null; }
  return res.status === 200 ? res.json() : {};
}

async function addItemsToCollection(collection, ids, { clearSelection = true } = {}) {
  if (!ids.length) return false;
  const { collection: updated } = await apiCollection('PATCH', '/' + collection.id, { addItemIds: ids }) || {};
  if (!updated) return false;
  const idx = state.collections.findIndex((c) => c.id === collection.id);
  state.collections[idx] = updated;
  if (clearSelection) state.selection.clear();
  $('collect-menu').hidden = true;
  render();
  const first = state.items.find((it) => ids.includes(it.id));
  const countLabel = ids.length === 1 ? '1 image added' : `${ids.length} images added`;
  if (first) {
    showSnack(first, `${countLabel} to “${updated.name}”`, 'View', () => {
      state.activeCollection = updated.id;
      state.activeSref = null;
      state.filters.favOnly = false;
      render();
    });
  }
  return true;
}

async function assignSrefToDetailItem(srefValue) {
  if (!state.detailId) return false;
  const val = srefValue.trim();
  const item = await patchItem(state.detailId, { sref: val });
  if (!item) return false;
  if (val) await ensureSrefGroupForName(val);
  render();
  renderDetailSrefs(item);
  renderSimilarThumbs(item);
  toast(val ? `--sref set` : 'Sref cleared', 'success', item.thumbUrl);
  return true;
}

async function ensureSrefGroupForName(name) {
  const val = name.trim();
  if (!val || state.srefGroups.some((g) => g.name === val)) return;
  const { group } = await apiSrefGroup('POST', '', { name: val }) || {};
  if (group) state.srefGroups.push(group);
}

async function assignSrefToItems(srefValue, ids) {
  if (!ids.length) return false;
  const val = srefValue.trim();
  await Promise.all(ids.map((id) => patchItem(id, { sref: val })));
  if (val) await ensureSrefGroupForName(val);
  state.selection.clear();
  render();
  const first = state.items.find((it) => ids.includes(it.id));
  const label = val || 'cleared';
  toast(val ? `--sref set on ${countLabel(ids.length)}` : `--sref cleared on ${countLabel(ids.length)}`, 'success', first?.thumbUrl ?? null);
  return true;
}

async function addSelectionToCollection(collection) {
  const ids = [...state.selection];
  if (!ids.length) return;
  await addItemsToCollection(collection, ids);
  state.collectMenuAnchor = null;
}

/* ---------- Bulk actions on the current selection ---------- */

function selectedItems() {
  return state.items.filter((i) => state.selection.has(i.id));
}

function countLabel(n) {
  return `${n} item${n === 1 ? '' : 's'}`;
}

const TOOLBAR_POPOVER_GAP = 16;
const TOAST_STACK_GAP = 16;
const TOAST_STACK_BOTTOM_DEFAULT = 24;

/** Keep toast stack / fav-snack above the selection bar when it is visible. */
function positionToastStack() {
  const bar = $('selection-bar');
  if (!bar || bar.hidden) {
    document.documentElement.style.setProperty('--toast-stack-bottom', `${TOAST_STACK_BOTTOM_DEFAULT}px`);
    return TOAST_STACK_BOTTOM_DEFAULT;
  }
  const barRect = bar.getBoundingClientRect();
  const bottom = window.innerHeight - barRect.top + TOAST_STACK_GAP;
  document.documentElement.style.setProperty('--toast-stack-bottom', `${bottom}px`);
  return bottom;
}

function initToastStackPositioning() {
  positionToastStack();
  const bar = $('selection-bar');
  if (bar && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => positionToastStack()).observe(bar);
  }
  window.addEventListener('resize', positionToastStack);
}

/** Pin bulk prompts / collect menu 16px above the selection bar top edge. */
function positionToolbarPopover(el, { anchor = null, centerOnBar = false } = {}) {
  const bar = $('selection-bar');
  const fallbackBottom = 24 + 75 + TOOLBAR_POPOVER_GAP;
  if (!bar || bar.hidden) {
    document.documentElement.style.setProperty('--toolbar-popover-bottom', `${fallbackBottom}px`);
    positionToastStack();
    return fallbackBottom;
  }
  const barRect = bar.getBoundingClientRect();
  const bottom = window.innerHeight - barRect.top + TOOLBAR_POPOVER_GAP;
  document.documentElement.style.setProperty('--toolbar-popover-bottom', `${bottom}px`);
  positionToastStack();

  if (el?.id === 'collect-menu' || el?.id === 'sref-menu') {
    const anchorEl = anchor || $('add-to-collection');
    const margin = 8;
    const menuWidth = el.offsetWidth || el.getBoundingClientRect().width || 220;
    const anchorRect = anchorEl.getBoundingClientRect();
    let centerX = centerOnBar
      ? barRect.left + barRect.width / 2
      : anchorRect.left + anchorRect.width / 2;
    const half = menuWidth / 2;
    centerX = Math.max(margin + half, Math.min(centerX, window.innerWidth - margin - half));
    el.style.setProperty('--collect-left', `${centerX}px`);
    el.style.setProperty('--collect-shift', '-50%');
  }
  return bottom;
}

function positionCollectMenu() {
  const menu = $('collect-menu');
  if (menu.hidden) return;
  positionToolbarPopover(menu, { anchor: $('add-to-collection') });
}

/** In-app prompt — window.prompt() is blocked in embedded browsers (returns "" silently). */
function askPrompt({ title, placeholder = '', defaultValue = '', mono = false }) {
  return new Promise((resolve) => {
    const scrim = $('prompt-scrim');
    const dialog = $('prompt-dialog');
    const titleEl = $('prompt-title');
    const input = $('prompt-input');
    const cancelBtn = $('prompt-cancel');
    const submitBtn = $('prompt-submit');

    titleEl.textContent = title;
    input.placeholder = placeholder;
    input.value = defaultValue;
    input.classList.toggle('mono', mono);
    scrim.hidden = false;
    positionToolbarPopover(dialog, { centerOnBar: true });
    input.focus();
    input.select();

    const onResize = () => positionToolbarPopover(dialog, { centerOnBar: true });
    window.addEventListener('resize', onResize);

    const finish = (value) => {
      scrim.hidden = true;
      window.removeEventListener('resize', onResize);
      cancelBtn.removeEventListener('click', onCancel);
      submitBtn.removeEventListener('click', onSubmit);
      input.removeEventListener('keydown', onKey);
      scrim.removeEventListener('click', onScrim);
      resolve(value);
    };

    const onCancel = () => finish(null);
    const onSubmit = () => finish(input.value);
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); onSubmit(); }
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    const onScrim = (e) => { if (e.target === scrim) onCancel(); };

    cancelBtn.addEventListener('click', onCancel);
    submitBtn.addEventListener('click', onSubmit);
    input.addEventListener('keydown', onKey);
    scrim.addEventListener('click', onScrim);
  });
}

// Favorite all if any are unfavorited, otherwise unfavorite all.
async function bulkFavorite() {
  const items = selectedItems();
  if (!items.length) return;
  const makeFav = items.some((i) => !i.favorite);
  await Promise.all(items.map((i) => patchItem(i.id, { favorite: makeFav })));
  render();
  toast(`${countLabel(items.length)} ${makeFav ? 'favorited' : 'unfavorited'}`, 'success', items[0].thumbUrl);
}

async function bulkAddTag() {
  const items = selectedItems();
  if (!items.length) return;
  const raw = await askPrompt({
    title: `Add tag(s) to ${countLabel(items.length)}`,
    placeholder: 'Separate multiple with commas',
  });
  if (raw == null) return;
  const newTags = raw.split(',').map((t) => t.trim()).filter(Boolean);
  if (!newTags.length) return;
  await Promise.all(items.map((i) =>
    patchItem(i.id, { tags: [...new Set([...i.tags, ...newTags])] })));
  render();
  const tagLabel = newTags.length === 1 ? `"${newTags[0]}"` : `${newTags.length} tags`;
  toast(`Added ${tagLabel} to ${countLabel(items.length)}`, 'success', items[0].thumbUrl);
}

async function bulkSetSref() {
  const items = selectedItems();
  if (!items.length) return;
  const raw = await askPrompt({
    title: `Set --sref on ${countLabel(items.length)}`,
    placeholder: 'e.g. 1234567890',
    mono: true,
  });
  if (raw == null) return;
  const val = raw.trim();
  await Promise.all(items.map((i) => patchItem(i.id, { sref: val })));
  if (val) await ensureSrefGroupForName(val);
  render();
  toast(val ? `--sref set on ${countLabel(items.length)}` : `--sref cleared on ${countLabel(items.length)}`, 'success', items[0].thumbUrl);
}

async function bulkRemoveFromCollection() {
  const cid = state.activeCollection;
  const c = state.collections.find((x) => x.id === cid);
  const ids = [...state.selection];
  if (!c || !ids.length) return;
  const n = ids.length;
  if (!confirm(`Remove ${countLabel(n)} from “${c.name}”? The images stay in your library.`)) return;
  const thumbUrl = state.items.find((it) => ids.includes(it.id))?.thumbUrl ?? null;
  const { collection: updated } = await apiCollection('PATCH', '/' + cid, { removeItemIds: ids }) || {};
  if (updated) {
    const idx = state.collections.findIndex((x) => x.id === cid);
    if (idx >= 0) state.collections[idx] = updated;
    ids.forEach((id) => state.selection.delete(id));
    render();
    toast(`${countLabel(n)} removed from collection`, 'success', thumbUrl);
  } else {
    toast('Could not remove from collection', 'error', thumbUrl);
  }
}

async function bulkDelete() {
  if (state.activeCollection && !state.libraryView) {
    await bulkRemoveFromCollection();
    return;
  }
  const items = selectedItems();
  if (!items.length) return;
  const n = items.length;
  if (!confirm(`Delete ${countLabel(n)} from the library? The copied files will be removed.`)) return;
  const thumbUrl = items[0].thumbUrl;
  const results = await Promise.all(items.map((i) =>
    fetch(`/api/items/${i.id}`, { method: 'DELETE' })
      .then((r) => (r.ok ? i.id : null))
      .catch(() => null)));
  const deleted = new Set(results.filter(Boolean));
  if (deleted.size) {
    state.items = state.items.filter((i) => !deleted.has(i.id));
    for (const id of deleted) state.selection.delete(id);
    for (const c of state.collections) c.itemIds = c.itemIds.filter((id) => !deleted.has(id));
    if (state.detailId && deleted.has(state.detailId)) closeDetail();
    render();
  }
  const failed = n - deleted.size;
  if (failed) toast(`${deleted.size} deleted, ${failed} failed`, 'error', thumbUrl);
  else toast(`${countLabel(deleted.size)} deleted`, 'success', thumbUrl);
}

async function createCollectionWithSelection(name) {
  const { collection } = await apiCollection('POST', '', { name }) || {};
  if (!collection) return;
  state.collections.push(collection);
  const ids = [...state.selection];
  if (ids.length) await addItemsToCollection(collection, ids);
  state.collectMenuAnchor = null;
  $('collect-menu').hidden = true;
  render();
}

function renderSrefMenu() {
  const menu = $('sref-menu');
  const plus = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
  const folder = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>';
  let html = `<button class="collect-option create" data-create="1">${plus}New sref</button>`;
  if (state.srefGroups.length) {
    html += '<div class="collect-menu-label">Assign</div>';
    html += state.srefGroups.map((g) =>
      `<button class="collect-option" data-sref="${esc(g.name)}">${folder}<span class="mono">${esc(g.name)}</span><span class="count">${getSrefGroupCount(g.name)}</span></button>`).join('');
  }
  menu.innerHTML = html;
}

function renderSrefMenuNewInput() {
  const menu = $('sref-menu');
  menu.innerHTML = '<div class="collect-new-row"><input class="collect-new-input mono" placeholder="Sref code, Enter to assign" /></div>';
  const input = menu.querySelector('.collect-new-input');
  input.focus();
  requestAnimationFrame(() => positionToolbarPopover(menu, { anchor: $('add-to-collection') }));
  input.addEventListener('keydown', async (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const name = input.value.trim();
      if (name && state.detailId) await assignSrefToDetailItem(name);
      menu.hidden = true;
      state.srefMenuAnchor = null;
    } else if (e.key === 'Escape') {
      menu.hidden = true;
      state.srefMenuAnchor = null;
    }
  });
}

function renderCollectMenu() {
  const menu = $('collect-menu');
  const plus = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
  const folder = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>';
  let html = `<button class="collect-option create" data-create="1">${plus}New collection</button>`;
  if (state.collections.length) {
    html += '<div class="collect-menu-label">Add to</div>';
    html += state.collections.map((c) =>
      `<button class="collect-option" data-cid="${c.id}">${folder}<span>${esc(c.name)}</span><span class="count">${c.itemIds.length}</span></button>`).join('');
  }
  menu.innerHTML = html;
}

/* ---------- Top-nav dropdown popovers ---------- */

const NAV_POP_KEYS = ['collections', 'srefs', 'filters'];

// Keep browse dropdown triggers in sync — only one may be expanded at a time.
function syncNavPopTriggers(openKey) {
  NAV_POP_KEYS.forEach((k) => {
    const t = $(`${k}-trigger`);
    if (t) t.setAttribute('aria-expanded', String(k === openKey));
  });
}

function hideNavPop(pop) {
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  pop.style.opacity = '';
}

function closeNavPops(except) {
  NAV_POP_KEYS.forEach((key) => {
    if (key === except) return;
    hideNavPop($(`${key}-pop`));
  });
  if (!except) syncNavPopTriggers(null);
}

// Measure where a popover should sit under its trigger (left-aligned).
function computeNavPopPos(triggerEl, popEl) {
  const r = triggerEl.getBoundingClientRect();
  const prevHidden = popEl.hidden;
  popEl.style.visibility = 'hidden';
  popEl.hidden = false;
  const pw = popEl.offsetWidth;
  if (prevHidden) popEl.hidden = true;
  popEl.style.visibility = '';
  let left = r.left;
  const maxLeft = window.innerWidth - pw - 12;
  if (left > maxLeft) left = Math.max(12, maxLeft);
  return { left: Math.round(left), top: Math.round(r.bottom + 8) };
}

function positionNavPop(triggerEl, popEl) {
  const { left, top } = computeNavPopPos(triggerEl, popEl);
  popEl.style.left = `${left}px`;
  popEl.style.top = `${top}px`;
}

function wireNavPopovers() {
  NAV_POP_KEYS.forEach((key) => {
    const trigger = $(`${key}-trigger`);
    const pop = $(`${key}-pop`);
    if (!trigger || !pop) return;
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = pop.hidden;
      if (!willOpen) {
        hideNavPop(pop);
        syncNavPopTriggers(null);
        return;
      }

      const searchEl = pop.querySelector('.nav-pop-search input');
      if (searchEl && searchEl.value) { searchEl.value = ''; }
      if (key === 'collections') renderCollections();
      if (key === 'srefs') renderSrefs();

      syncNavPopTriggers(null);
      closeNavPops(key);
      syncNavPopTriggers(key);

      const target = computeNavPopPos(trigger, pop);
      pop.style.opacity = '';
      pop.style.left = `${target.left}px`;
      pop.style.top = `${target.top}px`;
      pop.hidden = false;

      if (searchEl) requestAnimationFrame(() => searchEl.focus());
    });
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('.nav-pop') || e.target.closest('.nav-icon-btn--expand')) return;
    closeNavPops();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeNavPops();
  });
  window.addEventListener('resize', () => closeNavPops());

  // Collections footer "View all" opens full-page browse
  const viewAll = $('collections-view-all');
  if (viewAll) viewAll.addEventListener('click', (e) => {
    e.stopPropagation();
    openLibraryBrowse('collections');
  });
  // Srefs footer "View all" opens full-page browse
  const srefsViewAll = $('srefs-view-all');
  if (srefsViewAll) srefsViewAll.addEventListener('click', (e) => {
    e.stopPropagation();
    openLibraryBrowse('srefs');
  });

  // In-dropdown search filters the card grid live
  const collSearch = $('collections-search');
  if (collSearch) collSearch.addEventListener('input', renderCollections);
  const srefSearch = $('srefs-search');
  if (srefSearch) srefSearch.addEventListener('input', renderSrefs);
}

function wireSizeSlider() {
  const slider = $('size-slider');
  if (!slider) return;
  const MIN = 160;
  const MAX = 360;
  const raw = localStorage.getItem('lens.thumbSize');
  const saved = raw === null || raw === '' ? NaN : Number(raw);
  const initial = Number.isFinite(saved) && saved >= 0 && saved <= 100 ? saved : 50;
  const apply = (val) => {
    const col = Math.round(MIN + (MAX - MIN) * (val / 100));
    document.documentElement.style.setProperty('--lens-col', `${col}px`);
    slider.style.setProperty('--fill', `${val}%`);
  };
  slider.value = String(initial);
  apply(initial);
  slider.addEventListener('input', () => {
    apply(Number(slider.value));
    localStorage.setItem('lens.thumbSize', slider.value);
  });
}

async function toggleCollectionPin(cid) {
  const c = state.collections.find((x) => x.id === cid);
  if (!c) return;
  const next = !c.pinned;
  const { collection } = await apiCollection('PATCH', '/' + cid, { pinned: next }) || {};
  const idx = state.collections.findIndex((x) => x.id === cid);
  if (collection) state.collections[idx] = collection;
  else state.collections[idx] = { ...c, pinned: next };
  renderCollections();
  if (state.libraryView === 'collections') renderLibraryBrowse();
}

function startCollectionRename(nameEl) {
  const item = nameEl.closest('.collection-item, .browse-card--collection');
  if (!item || item.querySelector('.collection-name-input')) return;
  const cid = item.dataset.cid;
  const c = state.collections.find((x) => x.id === cid);
  if (!c) return;
  const input = document.createElement('input');
  input.className = 'collection-name-input';
  input.value = c.name;
  input.setAttribute('aria-label', 'Rename collection');
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  const commit = async () => {
    const name = input.value.trim();
    if (name && name !== c.name) {
      const { collection } = await apiCollection('PATCH', '/' + cid, { name }) || {};
      if (collection) state.collections[state.collections.findIndex((x) => x.id === cid)] = collection;
    }
    render();
    renderCollections();
  };
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
    if (ev.key === 'Escape') { input.value = c.name; input.blur(); }
  });
  input.addEventListener('click', (ev) => ev.stopPropagation());
  input.addEventListener('dblclick', (ev) => ev.stopPropagation());
  input.addEventListener('blur', commit, { once: true });
}

function wireCollections() {
  const collBody = $('collections-body');
  // click to view, pin to (un)pin, × to delete, double-click name to rename
  collBody.addEventListener('click', async (e) => {
    if (suppressCollectionClick) return;
    const item = e.target.closest('.collection-item');
    if (!item) return;
    const cid = item.dataset.cid;
    if (e.target.closest('.collection-name-input')) return;
    clearTimeout(collectionClickTimer);
    collectionClickTimer = setTimeout(() => {
      if (suppressCollectionNavClick) { suppressCollectionNavClick = false; return; }
      state.activeCollection = state.activeCollection === cid ? null : cid;
      state.activeSref = null;
      state.filters.favOnly = false;
      state.libraryView = null;
      render();
    }, 220);
  });

  collBody.addEventListener('dblclick', (e) => {
    const nameEl = e.target.closest('.collection-name');
    if (!nameEl) return;
    e.stopPropagation();
    e.preventDefault();
    clearTimeout(collectionClickTimer);
    suppressCollectionNavClick = true;
    startCollectionRename(nameEl);
  });

  // new collection from collections popover + (creates empty, then inline-rename)
  $('new-collection').addEventListener('click', async (e) => {
    e.stopPropagation();
    const { collection } = await apiCollection('POST', '', { name: 'Untitled collection' }) || {};
    if (!collection) return;
    state.collections.push(collection);
    render();
    renderCollections();
    const item = $('library-browse-grid')?.querySelector(`[data-cid="${collection.id}"] .collection-name`)
      || $('collections-list')?.querySelector(`[data-cid="${collection.id}"] .collection-name`);
    if (item) item.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });

  // selection bar
  $('selection-clear').addEventListener('click', () => { state.selection.clear(); render(); });
  $('bulk-favorite').addEventListener('click', bulkFavorite);
  $('bulk-tag').addEventListener('click', bulkAddTag);
  $('bulk-sref').addEventListener('click', bulkSetSref);
  $('bulk-delete').addEventListener('click', bulkDelete);

  const collectMenu = $('collect-menu');
  const srefMenu = $('sref-menu');
  $('add-to-collection').addEventListener('click', (e) => {
    e.stopPropagation();
    srefMenu.hidden = true;
    state.srefMenuAnchor = null;
    if (!collectMenu.hidden) { collectMenu.hidden = true; state.collectMenuAnchor = null; return; }
    state.collectMenuAnchor = 'selection';
    renderCollectMenu();
    collectMenu.hidden = false;
    requestAnimationFrame(positionCollectMenu);
  });
  collectMenu.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (e.target.closest('[data-create]')) {
      collectMenu.hidden = true;
      state.collectMenuAnchor = null;
      const name = await askPrompt({
        title: 'New collection',
        placeholder: 'Collection name',
      });
      if (name?.trim()) createCollectionWithSelection(name.trim());
      return;
    }
    const opt = e.target.closest('[data-cid]');
    if (opt) {
      const c = state.collections.find((x) => x.id === opt.dataset.cid);
      addSelectionToCollection(c);
    }
  });
  srefMenu.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (e.target.closest('[data-create]')) {
      renderSrefMenuNewInput();
    }
  });
  document.addEventListener('click', (e) => {
    if (!collectMenu.hidden
      && !e.target.closest('.collect-wrap')
      && !e.target.closest('#collect-menu')) {
      collectMenu.hidden = true;
      state.collectMenuAnchor = null;
    }
    if (!srefMenu.hidden
      && !e.target.closest('#sref-menu')) {
      srefMenu.hidden = true;
      state.srefMenuAnchor = null;
    }
  });
  window.addEventListener('resize', () => {
    if (!collectMenu.hidden) positionCollectMenu();
  });
}

async function toggleSrefPin(gid) {
  const g = state.srefGroups.find((x) => x.id === gid);
  if (!g) return;
  const next = !g.pinned;
  const { group } = await apiSrefGroup('PATCH', '/' + gid, { pinned: next }) || {};
  const idx = state.srefGroups.findIndex((x) => x.id === gid);
  if (group) state.srefGroups[idx] = group;
  else state.srefGroups[idx] = { ...g, pinned: next };
  renderSrefs();
  if (state.libraryView === 'srefs') renderLibraryBrowse();
}

function startSrefRename(nameEl) {
  const item = nameEl.closest('.sref-item, .browse-card--sref');
  if (!item || item.querySelector('.collection-name-input')) return;
  const gid = item.dataset.gid;
  const g = state.srefGroups.find((x) => x.id === gid);
  if (!g) return;
  const input = document.createElement('input');
  input.className = 'collection-name-input';
  input.value = g.name;
  input.setAttribute('aria-label', 'Rename sref');
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  const commit = async () => {
    const name = input.value.trim();
    if (name && name !== g.name) {
      const prev = g.name;
      const { group } = await apiSrefGroup('PATCH', '/' + gid, { name }) || {};
      if (group) {
        state.srefGroups[state.srefGroups.findIndex((x) => x.id === gid)] = group;
        if (state.activeSref === prev) state.activeSref = group.name;
      }
    }
    render();
    renderSrefs();
  };
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
    if (ev.key === 'Escape') { input.value = g.name; input.blur(); }
  });
  input.addEventListener('click', (ev) => ev.stopPropagation());
  input.addEventListener('dblclick', (ev) => ev.stopPropagation());
  input.addEventListener('blur', commit, { once: true });
}

function wireSrefs() {
  const srefBody = $('srefs-body');
  srefBody.addEventListener('click', async (e) => {
    if (suppressSrefClick) return;
    const item = e.target.closest('.sref-item');
    if (!item) return;
    const sref = item.dataset.sref;
    if (e.target.closest('.collection-name-input')) return;
    clearTimeout(srefClickTimer);
    srefClickTimer = setTimeout(() => {
      if (suppressSrefNavClick) { suppressSrefNavClick = false; return; }
      state.activeSref = state.activeSref === sref ? null : sref;
      state.activeCollection = null;
      state.filters.favOnly = false;
      state.libraryView = null;
      render();
    }, 220);
  });

  srefBody.addEventListener('dblclick', (e) => {
    const nameEl = e.target.closest('.sref-name');
    if (!nameEl) return;
    e.stopPropagation();
    e.preventDefault();
    clearTimeout(srefClickTimer);
    suppressSrefNavClick = true;
    startSrefRename(nameEl);
  });

  $('new-sref').addEventListener('click', async (e) => {
    e.stopPropagation();
    const { group } = await apiSrefGroup('POST', '', { name: 'Untitled sref' }) || {};
    if (!group) return;
    state.srefGroups.push(group);
    render();
    renderSrefs();
    const nameEl = $('library-browse-grid')?.querySelector(`[data-gid="${group.id}"] .sref-name`)
      || $('srefs-list').querySelector(`[data-gid="${group.id}"] .sref-name`)
      || $('srefs-list')?.querySelector(`[data-gid="${group.id}"] .sref-name`);
    if (nameEl) nameEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });

  initToastStackPositioning();
}

/* ---------- Boot ---------- */

async function boot() {
  wire();
  try {
    const res = await fetch('/api/items');
    const json = await res.json();
    state.items = json.items || [];
    state.collections = json.collections || [];
    state.srefGroups = json.srefGroups || [];
    state.cloud = Boolean(json.cloud);
  } catch (err) {
    toast('Cannot reach the Lens server', 'error');
  }
  render();
}

boot();
