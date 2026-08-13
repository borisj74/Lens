# Lens — Settings Page

Suggestions for a Lens settings screen: what to include, what exists today, and what belongs in V2.

Related: [V2.md](V2.md) (roadmap), [SPEC.md](SPEC.md) (v1 decisions), [design_system.md](design_system.md) (visual system). Paper wireframes: **Lens — Settings wireframe** and **Settings — IA map**.

**Entry point (proposed):** gear icon in top nav → full-page settings at `/#settings`

---

## Page shell

- Settings entry point (nav icon or profile menu)
- Page title + back/close
- Section headings with short descriptions
- Auto-save for most preferences (no heavy “Save” button unless needed)
- Danger zone styling for destructive actions

---

## Account (V2 — hosted / Clerk)

- Sign-in status
- Email + password change
- Google account link / unlink
- Sign out
- Delete account (with confirmation)

*Not in local `npm start` mode — auth optional/off per V2 plan.*

---

## Library & storage

**Exists or partially exists today:**

- Library path (read-only) — `~/Pictures/LensLibrary` or `LENS_LIBRARY`
- Storage mode badge — `local` / `redis` / `blob`
- Library stats — image count, video count, collections, SREFs, total disk usage
- Open library folder in Finder
- Duplicate handling info — SHA256 + MJ job UUID dedupe (read-only explanation)

**Planned (V2):**

- Change library location (with migration wizard)
- Cloud vs local mode selector (if unified)

---

## Import & watched folders (V2 — Phase 2)

- Watched folders list
- Add / remove watched folder
- Auto-import toggle
- Import debounce / quiet-hours behavior (optional)
- Default import target — All library / active collection / active SREF
- Midjourney web pull — connect / sync / disconnect (Phase 3)

---

## Import & media (maintenance / policy)

- Thumbnail quality / size (today: 480px WebP, client-generated on import)
- Rebuild missing thumbnails
- Re-extract MJ prompts from PNG metadata (local backfill — server supports this)
- Video import limits / supported formats (read-only help text)

---

## Gallery & browsing defaults

**Good candidates to centralize** (some live in the toolbar today):

- Default sort — Newest / Oldest / Name A–Z / Z–A / Random
- Default thumbnail size — slider (persisted in `localStorage` as `lens.thumbSize`)
- Default detail zoom — today resets to 100% each open
- Browse preview count — today hardcoded (`BROWSE_PREVIEW_MAX = 5`)
- Open last view on launch — URL hash / history largely handles this now
- Show color chips on cards — on/off
- Show filenames on cards — on/off (if added)

---

## Search & filters

- Clear recent searches (`lens.recentSearches`)
- Clear recent colors (`lens.recentColors`)
- Clear recently viewed (`lens.recentViewed`)
- Clear all search history (single action)
- Color match sensitivity — planned tuning (V2 Phase 4)
- Default filter state on “Reset” — which filters clear vs. persist

---

## Collections & SREFs

- Default collection sort — pinned / date / name
- Default SREF sort — same
- Pin behavior explanation (read-only)
- Auto-create SREF folder when assigning `--sref` — on/off (today always on)
- Empty SREF folder cleanup — maintenance action

---

## Detail view

- Default zoom level
- Similar images section — show/hide
- Copy prompt format — plain / with `--sref` / MJ-style
- Auto-advance after delete — on/off
- Keyboard shortcuts reference

---

## Behavior (confirmations & feedback)

- Confirm before delete — single item / bulk
- Confirm before delete collection / SREF folder
- Import completion style — count-only (current) vs. verbose
- Toast duration (optional)
- Show import skip report — duplicates skipped count

---

## Privacy & data (hosted V2)

- Who can see my library — private (post-auth)
- Media URL privacy — public CDN vs. authenticated proxy
- Export my data
- Download metadata JSON
- Wipe hosted library (danger zone)

---

## Maintenance & danger zone

**Maintenance:**

- Repair duplicate SREF groups (server dedupes on load; manual “Run” optional)
- Reindex / rebuild `db.json` from files
- Export full backup (`db.json` + note about originals)
- Import backup

**Danger zone:**

- Delete entire library — typed confirmation
- Reset app to factory state (optional)
- Clear all favorites / tags (niche, probably skip for v1)

---

## Appearance & accessibility

- Theme — light only today; dark mode slot for later
- Reduced motion — respect `prefers-reduced-motion`
- Keyboard shortcuts panel
- High-contrast / focus visibility (a11y)

---

## About & support

- App version (`window.__lensVer`)
- Library schema version
- Server status — online / storage healthy
- Documentation links — SPEC, HANDOFF, shortcuts
- Report a bug / feedback link

---

## Billing (V2 Phase 5 — hosted only)

- Current plan
- Storage used vs. included (Blob)
- Transfer usage estimate
- Upgrade / manage billing (Clerk + Vercel portal)
- Cost notes — see [V2.md — Hosting costs](V2.md#hosting-costs)

---

## Suggested v1 MVP settings

Smallest useful page before V2 auth:

1. **Library** — path, stats, open in Finder
2. **Defaults** — sort, thumbnail size
3. **Search history** — clear recent searches / colors / viewed
4. **Behavior** — confirm before delete
5. **Maintenance** — rebuild thumbs, re-extract prompts, export backup, repair SREF dupes
6. **About** — version, server status
7. **Danger zone** — delete library

Defer to V2: Account, watched folders, MJ web pull, billing, cloud privacy controls.

---

## Section order (wireframe)

1. Library & storage — v1
2. Gallery defaults — v1
3. Search & history — v1
4. Import & watched folders — V2
5. Behavior — v1
6. Maintenance — v1
7. Account — V2
8. About — v1
9. Danger zone — v1

---

## Local storage keys (today)

| Key | Purpose |
|-----|---------|
| `lens.thumbSize` | Default thumbnail slider value |
| `lens.recentSearches` | Search panel recent queries |
| `lens.recentColors` | Color picker history |
| `lens.recentViewed` | Recently viewed item IDs |

---

## Server / env (read-only in settings)

| Item | Source |
|------|--------|
| Library path | `LENS_LIBRARY` or `~/Pictures/LensLibrary` |
| Storage mode | `local` / `redis` / `blob` from `server.js` |
| Port | `PORT` or `4567` |
