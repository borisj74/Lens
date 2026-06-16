# Lens — v1 Spec

Local library for AI-generated images & videos (Midjourney, Seedance, NanoBanana, GPT). Solves: "I made it, now I can't find it" — 30min–2hr hunts through Downloads and the Midjourney Organize tab.

## Decisions (from interview, 2026-06-12)

| Question | Decision |
|---|---|
| Source of files | Local only for v1. Drag-drop files or folders. Midjourney web pull = v2. |
| Scale | 100s–1000s items |
| Storage model | **Copy** into own library (`~/Pictures/LensLibrary`). Downloads become disposable. |
| Duplicates | Exact dupes (sha256 + MJ job UUID) detected and skipped, reported. No variant grouping. |
| --sref | Not in MJ metadata → manual tag field per item. Tags over folders. |
| Search behavior | User searches mostly by **visual memory** (look/color/style), sometimes prompt keywords. Gallery optimized for fast visual scanning; color filter is core, not gimmick. |
| Prompt data | MJ filenames carry truncated prompt + job UUID (`user_prompt_words_<uuid>_N.png`) → free text search + dedupe. |
| Rename | Display name editable; original filename/prompt preserved and searchable. |
| After finding | Copy prompt, copy file, open original. (Social posting, sref reuse, print prep.) |
| Video | Yes, minimal: import, thumbnail, play on click. No scrubbing. |
| Platform | Local web app (Node + browser). No auth, no cloud in v1 — monetization later, after PMF on own pain. |
| Killer feature | Everything in one place + filter sidebar. |
| Design | `design_system.md` (Bojo light theme, Geist, teal accent). |

## v1 Features
1. Drag-drop import (files/folders), copy to library, dedupe, progress + report.
2. Auto-metadata: MJ filename parse (prompt, job id, source), dominant colors (image & video first frame), dimensions, size, date.
3. Masonry gallery; card = thumbnail + name + top color chips. Detail view: full media, prompt, metadata, copy prompt.
4. Sidebar filters (combinable): text search (name+prompt), color hue swatches, type, source, size, tags, --sref. Sort: date/name/size.
5. Curation: rename, sref field, tags, favorite, delete.

## Out of v1
Auth/payments, MJ website pull, cloud sync, watch folders, variant grouping, retouch, video scrubbing.

## Top failure risks
1. Color bucketing mismatch user memory → broad buckets, multi-bucket membership.
2. Import friction → stale library. Re-drag is safe (dedupe); v2 = folder watching.
3. Premature monetization scope. v1 stays local + selfish.
