# Lens — Engineering Handoff

Local-first library for AI-generated images & videos (Midjourney, Seedance, NanoBanana, GPT). Solves "I made it, now I can't find it." See [SPEC.md](SPEC.md) for product decisions and [design_system.md](design_system.md) for the visual system (Bojo light theme, Geist, teal `#0D988A`).

Status: working v1, in daily use (60 items, 4 collections as of handoff). No auth, no cloud — runs on the user's Mac.

---

## Run it

```bash
npm install        # express + multer (+ nodemon & pm2 dev tooling)
```

- Port `4567` (override with `PORT` env).
- Library lives at `~/Pictures/LensLibrary` (override with `LENS_LIBRARY`).
- `.claude/launch.json` defines the `lens` dev-server config used by the preview tooling.

### Running the server

Three ways to run it — pick based on what you're doing:

| Command | What it does | Use when |
|---|---|---|
| `npm start` | `node server.js` in the foreground. Dies on crash or when you close the terminal. | Quick one-off. |
| `npm run dev` | **nodemon** in the foreground — auto-restarts on every `server.js` save. | Editing backend code. |
| `npm run start:daemon` | **pm2** background daemon — survives terminal close, auto-restarts on crash. | You just want Lens always up (no more `ERR_CONNECTION_REFUSED`). |

**Daemon (recommended for daily use):**

```bash
npm run start:daemon     # start pm2-managed "lens" on http://localhost:4567
npm run status:daemon    # pm2 list — see if it's online
npm run logs             # tail the lens logs (Ctrl-C to stop tailing, daemon keeps running)
npm run restart:daemon   # restart after backend edits
npm run stop:daemon      # stop it
npm run delete:daemon    # remove it from pm2 entirely
```

The pm2 process is defined in `ecosystem.config.js` (app name `lens`, `PORT=4567`, `autorestart: true`). It keeps running across crashes and terminal closes. To also relaunch on Mac reboot/login, run `npx pm2 startup` once and follow the printed instructions, then `npx pm2 save`.

- **server.js is not hot-reloaded under `npm start` or pm2** — use `npm run dev` while editing the backend, or `npm run restart:daemon` after a backend edit. Frontend (`public/*`) changes never need a server restart — just refresh the browser (nodemon is configured to ignore `public/`).
- If you hit a port conflict, find the stray process with `lsof -iTCP:4567 -sTCP:LISTEN` and `kill` it (or `npm run delete:daemon` if pm2 owns it).

---

## Layout

```
server.js              Express API + static host (222 lines)
public/
  index.html           Single page, no build step (301)
  app.js               All client logic, vanilla JS, no framework (1404)
  style.css            All styles, CSS vars from design_system.md (1521)
SPEC.md                Product spec + interview decisions
design_system.md       Bojo design system (colors, type, components)
~/Pictures/LensLibrary/
  db.json              Source of truth: { items:[], collections:[] }
  originals/<id>.<ext> Copied source files
  thumbs/<id>.webp     480px WebP thumbnails (client-generated on import)
  tmp/                 Multer upload scratch
```

No bundler, no TypeScript, no test suite. Intentionally minimal.

---

## Data model (db.json)

**item**: `id, hash (sha256), mjId (MJ job UUID|null), variantIndex, originalName, displayName, prompt, source (midjourney|seedance|nanobanana|gpt|other), type (image|video), ext, width, height, bytes, colors:[{hex,frac}] (top 5), hueBuckets:[string], tags:[], sref, favorite, addedAt, fileMtime, fileUrl, thumbUrl`

**collection**: `id, name, itemIds:[], createdAt`

`db.json` is written atomically (tmp file + rename), debounced 150ms. Corrupt file is backed up, not overwritten.

---

## API (server.js)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/items` | `{ items, collections, libraryPath }` |
| POST | `/api/import` | multipart `file` + `thumb` + `meta` JSON. Dedupes by sha256 and by `mjId`+`variantIndex`; returns `{skipped}` or `{item}`. |
| PATCH | `/api/items/:id` | `{displayName, tags, sref, favorite}` |
| DELETE | `/api/items/:id` | Removes file, thumb, and membership in all collections |
| POST | `/api/collections` | `{name}` → `{collection}` |
| PATCH | `/api/collections/:id` | `{name, addItemIds, removeItemIds}` (any subset) |
| DELETE | `/api/collections/:id` | Images stay in library |

`/files/*` statically serves the library dir (originals + thumbs).

---

## Key behaviors / where they live (app.js)

- **Import pipeline** (`importFiles`, `collectFiles`): drag files/folders or click Import. Client extracts dimensions, 5 dominant colors + hue buckets (`analyzeCanvas`), generates the WebP thumb, parses the Midjourney filename (`parseFilename` → prompt + job UUID + source). Server copies into library and dedupes.
- **Filename parsing**: MJ pattern is `username_prompt_words_<uuid>_<n>.png` → prompt and job id are recovered for free text search + dedupe. `--sref` is NOT in MJ metadata; it's a manual field.
- **Color search**: search-bar color wheel (HSV area + hue slider, built from Paper design) sets `filters.pickedColor` (single color). Perceptual match via `colorClose` (hue family ± lightness), not exact pixel. Sidebar swatches are a separate coarse `hueBuckets` filter (`filters.colors`, multi).
- **Search panel** (Cosmos-style): focus the empty search field → Recent searches, Colors (recently used picker colors), Recently viewed thumbnails. Backed by `localStorage` keys `lens.recentSearches`, `lens.recentColors`, `lens.recentViewed`.
- **Selection + Collections**: hover checkbox (top-left) or click-while-selecting/Cmd/Shift-click to multi-select → bottom selection bar → "Add to collection" (existing or new). Cards are `draggable`; drop onto a sidebar collection to add. Rename a collection via double-click (inline input); delete via hover ×.
- **Tags**: detail panel tag input autocompletes from all existing tags (`allTags`), highlights matches, offers "New tag" for novel input; ↑/↓ + Enter or click.
- **Detail modal**: media fills edge-to-edge (container adopts each item's aspect ratio — no letterboxing). Copy prompt, copy color hex, rename, sref, favorite, open original, delete.
- **Cards**: masonry via CSS `columns`. Color swatches then title stacked at the bottom overlay. Favorite heart top-right, select checkbox top-left.
- **Drag scoping**: import overlay only appears for external file drags (`dataTransfer.types` includes `"Files"`); internal card drags never trigger it.

---

## Conventions

- State lives in one `state` object at the top of app.js; `render()` is the single re-render. `toggleSelect` patches one card in place to avoid full re-renders during selection.
- All colors/spacing/type come from CSS variables defined in `:root` (mirrors design_system.md). Don't hardcode hexes.
- Popovers (sort, color, search, collect-menu) follow the same pattern: toggle `hidden`, `menu-in` animation, close on outside click.
- SVG elements: use `setAttribute('hidden','')` not `.hidden` (the property is HTML-only).

---

## Not built (deliberately deferred)

Auth / accounts, payments, cloud sync, Midjourney website pull, folder watching (re-dragging Downloads is the current refresh path; dedupe makes it safe), variant grouping, video scrubbing, retouch.

## Known risks (from SPEC.md)

1. Color bucketing may not match the user's memory → buckets kept broad, items match multiple.
2. Import friction → library goes stale. v2 fix is folder watching.
3. Premature monetization scope — keep v1 local and selfish until PMF.

## Likely next steps

- Folder watching for auto-import (biggest retention lever).
- Move heavy color analysis off the main thread (Web Worker) for large batches.
- Server-side thumbnail generation as a fallback (currently client-only; a headless import wouldn't get thumbs).
- Pagination/virtualization of the grid past a few thousand items.
