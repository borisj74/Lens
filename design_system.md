# Bojo-CMS Design System
**Version:** 1.3 — Light Mode Only
**Product:** Headless CMS
**Author:** Boris Jov Design Studio
**Color source:** [Bojo CMS — Paper](https://app.paper.design/file/01KT917ZB87514VFJY2289KRJ3/1-0)

---

## 1. Colors

### Philosophy
Bojo-CMS uses a clean, light-first palette built on warm neutral grays with a teal accent. Primary CTAs use a near-black fill (`#1C1C1C`); teal (`#0D988A`) is reserved for interactive highlights, links, secondary actions, and active navigation — never as a large surface fill. All neutrals derive from the same gray family (`#171717`, `#737373`, `#E6E6E6`). Never mix unrelated gray families.

---

### Backgrounds

| Token | Hex | Usage |
|---|---|---|
| `bg-base` | `#FBFBFA` | App root, page canvas |
| `bg-surface` | `#FBFBFA` | Sidebar, toolbar, panels |
| `bg-raised` | `#FFFFFF` | Cards, modals, dropdowns, main content panels |
| `bg-overlay` | `#E6F0EF` | Hover states, selected rows, button hover fills |
| `bg-muted` | `rgba(245,245,245,0.40)` | Code blocks, subdued inset areas |
| `bg-scrim` | `rgba(0,0,0,0.40)` | Modal backdrop overlay |

---

### Borders

| Token | Hex | Usage |
|---|---|---|
| `border-subtle` | `#E6E6E6` | Dividers, card outlines, section separators |
| `border-default` | `#E8E8E8` | Input borders, panel edges |
| `border-accent` | `rgba(13,152,138,0.20)` (`#0D988A33`) | Accent-tinted borders on secondary controls |
| `border-strong` | `#5FA096` | Focus rings, focus-adjacent states |
| `border-pressed` | `#74CEC0` | Pressed secondary button borders |

---

### Text

| Token | Hex | Usage |
|---|---|---|
| `text-primary` | `#171717` | Headings, primary labels, body copy |
| `text-secondary` | `#737373` | Descriptions, metadata, supporting text |
| `text-muted` | `#979797` | Placeholders, disabled labels, section headers |
| `text-inverse` | `#FAFAFA` | Text on dark or destructive-filled surfaces |
| `text-inverse-muted` | `#EEEEEE` | Text on primary (dark) button default state |

---

### Accent — Teal

| Token | Hex | Usage |
|---|---|---|
| `accent-subtle` | `rgba(11,152,138,0.10)` (`#0B988A1A`) | Active nav backgrounds, selected item tints |
| `accent-muted` | `#E6F0EF` | Hover tints, light accent surfaces |
| `accent-soft` | `#C1DFDA` | Decorative accent fills, swatch highlights |
| `accent-default` | `#0D988A` | Links, secondary buttons, active nav text, interactive highlights |
| `accent-strong` | `#006C61` | Pressed/active states, accent text on light surfaces |
| `accent-outline` | `rgba(13,152,138,0.51)` (`#0D988A82`) | Active nav item outlines |

---

### Action — Primary CTA (Dark)

| Token | Hex | Usage |
|---|---|---|
| `action-default` | `#1C1C1C` | Primary button backgrounds, save actions |
| `action-hover` | `#E6F0EF` | Primary button hover background |
| `action-pressed` | `#006C61` | Primary button pressed background |
| `action-disabled` | `#EEEEEE` | Disabled button background |
| `action-foreground` | `#EEEEEE` | Text on `action-default` and `action-pressed` |
| `action-foreground-hover` | `#0D988A` | Text on `action-hover` and focus states |

---

### Semantic

| Token | Hex | Usage |
|---|---|---|
| `success` | `#16A34A` | Import complete, confirmations |
| `success-subtle` | `#DCFCE7` | Success background tint |
| `warning` | `#D97706` | Watched folder alerts, warnings |
| `warning-subtle` | `#FEF3C7` | Warning background tint |
| `destructive` | `#DC2828` | Delete actions, errors, danger zone labels |
| `destructive-subtle` | `#FEE2E2` | Error background tint |

---

### Color Usage Rules
- Never use `accent-default` as a fill for large surface areas — it is an accent, not a background
- Primary CTAs use `action-default` (`#1C1C1C`), not teal — reserve teal for interactive highlights and secondary actions
- Keep all neutrals in the same gray family (`#171717`, `#737373`, `#979797`, `#E6E6E6`, `#FBFBFA`)
- Never apply gradients to small elements or text — reserve for hero backgrounds and premium feature cards
- Always provide focus rings on interactive elements: `1px solid #5FA096`, `1px offset`
- Don't use drop shadows for depth — use background differentiation and borders instead

---

## 2. Typography

### Font Loading
All fonts loaded from Google Fonts. Include in `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet" />
```

### Font Families

| Role | Family | Fallback |
|---|---|---|
| Display | `Geist` | `-apple-system, BlinkMacSystemFont, sans-serif` |
| Body | `Geist` | `-apple-system, BlinkMacSystemFont, sans-serif` |
| Code / Mono | `Geist Mono` | `'Courier New', Courier, monospace` |

---

### Type Scale

| Token | Size | Weight | Line Height | Letter Spacing | Usage |
|---|---|---|---|---|---|
| `text-display-lg` | 48px | 700 | 1.1 | -0.03em | Hero headlines |
| `text-display-md` | 36px | 700 | 1.15 | -0.02em | Section headers |
| `text-display-sm` | 28px | 600 | 1.2 | -0.02em | Modal headers, card titles |
| `text-heading-lg` | 22px | 600 | 1.3 | -0.01em | View titles, panel headers |
| `text-heading-md` | 18px | 600 | 1.4 | -0.01em | Subsection headers |
| `text-heading-sm` | 15px | 600 | 1.4 | 0 | Component labels, sidebar sections |
| `text-body-lg` | 16px | 400 | 1.6 | 0 | Primary body text |
| `text-body-md` | 14px | 400 | 1.6 | 0 | Default body, descriptions |
| `text-body-sm` | 13px | 400 | 1.5 | 0 | Secondary info, captions |
| `text-label-lg` | 14px | 500 | 1.4 | 0.01em | Button labels, strong labels |
| `text-label-md` | 12px | 500 | 1.4 | 0.02em | Section headers, metadata keys |
| `text-label-sm` | 11px | 500 | 1.3 | 0.04em | Badges, timestamps, uppercase labels |
| `text-code-md` | 13px | 400 | 1.6 | 0 | File paths, hex values, inline code |
| `text-code-sm` | 12px | 400 | 1.5 | 0 | Code annotations |

### Typography Rules
- Never use more than two type sizes in a single component
- Uppercase labels (`text-label-sm`) always use `letter-spacing: 0.04em` and `text-transform: uppercase`
- Hex color values always render in `Geist Mono`
- File paths render in `Geist Mono`, truncated with middle ellipsis: `~/Downloads/.../filename.png`
- Never use font-size below 11px

---

## 3. Icons

### Library
Always use **[Lucide](https://lucide.dev)** for icons. Do not use custom SVGs, other icon sets, or emoji as UI icons unless a Lucide equivalent does not exist.

```bash
npm install lucide-react
```

```tsx
import { Search } from 'lucide-react';

<Search size={16} strokeWidth={1.5} aria-hidden="true" />
```

### Stroke Width
All Lucide icons use **`strokeWidth={1.5}`** — never the Lucide default of `2`. Apply globally via a shared icon wrapper or set on every instance.

### Sizes

| Token | Size | Usage |
|---|---|---|
| `icon-xs` | 12px | Chevrons, chip remove (×), compact indicators |
| `icon-sm` | 16px | Buttons, nav items, inputs, list items, checkboxes |
| `icon-md` | 20px | Toolbar actions, empty states |
| `icon-lg` | 24px | Feature highlights, marketing callouts |

### Color
Icons inherit color from their parent text token — never hardcode icon fill colors independently.

| Context | Color token |
|---|---|
| Default / inactive | `text-secondary` (`#737373`) |
| Active nav / accent | `accent-default` (`#0D988A`) |
| On primary button | `action-foreground` (`#EEEEEE`) |
| On destructive button | `text-inverse` (`#FAFAFA`) |
| Disabled | `text-muted` (`#979797`) |

### Icon Rules
- Icon-only buttons require `aria-label` — never rely on the icon alone for accessibility
- Pair icons with labels in navigation and primary actions; icon-only is acceptable only in toolbars with tooltips
- Maintain consistent gap between icon and label: `8px` in buttons, `10px` in sidebar nav items
- Don't mix filled and stroke icon styles — Lucide stroke icons only

---

## 4. Elevation

Elevation is expressed through background differentiation and subtle borders — not drop shadows.

| Level | Background | Border | Usage |
|---|---|---|---|
| 0 — Base | `#FBFBFA` | none | App root, sidebar |
| 1 — Surface | `#FFFFFF` | `1px solid #E8E8E8` | Main content panels |
| 2 — Raised | `#FFFFFF` | `1px solid #E6E6E6` | Cards, popovers, dropdowns, KPI cards |
| 3 — Overlay | `#FFFFFF` | `1px solid #5FA096` | Floating menus, focused panels |
| 4 — Modal | `#FFFFFF` | `1px solid #E8E8E8` + `box-shadow: 0 8px 32px rgba(23,23,23,0.12)` | Modals, detail overlays |
| 5 — Toast | `#FFFFFF` | `1px solid #E8E8E8` + `box-shadow: 0 4px 16px rgba(23,23,23,0.10)` | Toasts, notifications |

---

## 5. Border Radius

| Value | Usage |
|---|---|
| `2px` | Divider accents, micro-indicators |
| `4px` | Badges, inline code tags, table cells, color swatches |
| `6px` | Buttons, inputs, chips, dropdown menus, progress bars |
| `8px` | Tooltips, small panels, image card thumbnails, notification bars |
| `12px` | Cards, modals, code blocks, larger panels |
| `16px` | Drop zone areas, feature highlight cards |
| `9999px` | Pill badges, avatar circles, toggle switches, range thumbs |

---

## 6. Spacing

### Base Unit
`8px` — all spacing values are multiples of 4px, biased toward 8px increments.

### Scale

| Token | Value | Usage |
|---|---|---|
| `space-1` | 4px | Icon padding, tight inline gaps |
| `space-2` | 8px | Between related items, icon-to-label gap |
| `space-3` | 12px | Compact component padding |
| `space-4` | 16px | Standard component padding |
| `space-6` | 24px | Card padding, modal padding |
| `space-8` | 32px | Between subsections, toolbar height |
| `space-12` | 48px | Hero section padding, large breathing room |
| `space-16` | 64px | Section separation (internal) |
| `space-20` | 80px | Between major page sections |
| `space-30` | 120px | Large hero vertical padding |

### Layout

| Context | Value |
|---|---|
| Component padding (standard) | 16px |
| Card padding | 24px |
| Modal padding | 24px |
| Hero section padding | 48px vertical |
| Between major page sections | 80px |
| Between subsections | 32px |
| Container max width (documentation) | 1080px |
| Container max width (marketing) | 1200px |
| Container side margins | 24px |
| Feature grid gap | 24px |
| Pricing grid gap | 16px |
| Gallery card gap | 8px |
| Sidebar width | 240px |
| Detail panel width | 40% of window |

---

## 7. Animations

### Philosophy
Animations are functional, not decorative. Every motion communicates a state change, guides attention, or confirms an action. Keep durations short and easing natural. Never block interaction with animation.

### Easing Tokens

| Token | Value | Usage |
|---|---|---|
| `ease-default` | `cubic-bezier(0.16, 1, 0.3, 1)` | General transitions — fast out, gentle settle |
| `ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Elements leaving the screen |
| `ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | Elements entering the screen |
| `ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Subtle overshoot — selections, confirmations |
| `ease-linear` | `linear` | Progress bars, loading spinners |

### Duration Tokens

| Token | Value | Usage |
|---|---|---|
| `duration-instant` | 80ms | Hover color changes, focus rings |
| `duration-fast` | 150ms | Button press, chip selection, toggle |
| `duration-default` | 200ms | Modal open/close, panel expand, dropdown |
| `duration-slow` | 300ms | Page transitions, large panel animations |
| `duration-deliberate` | 500ms | Progress completions, success states |

### Motion Patterns

#### Fade In (entering elements)
```css
opacity: 0 → 1;
duration: 200ms;
easing: ease-out;
```

#### Scale + Fade (modals, popovers)
```css
opacity: 0 → 1;
transform: scale(0.96) → scale(1);
duration: 200ms;
easing: ease-out;
```

#### Slide Up + Fade (toasts, bottom sheets)
```css
opacity: 0 → 1;
transform: translateY(8px) → translateY(0);
duration: 200ms;
easing: ease-out;
```

#### Collapse / Expand (filter sections, accordions)
```css
max-height: 0 → 400px;
opacity: 0 → 1;
duration: 200ms;
easing: ease-default;
overflow: hidden;
```

#### Image Card Hover
```css
transform: scale(1.02);
box-shadow: 0 4px 16px rgba(23,23,23,0.10);
duration: 150ms;
easing: ease-out;
```

#### Selection Ring
```css
box-shadow: 0 0 0 2px #0D988A;
duration: 80ms;
easing: ease-spring;
```

#### Color Swatch "Copied" Feedback
```css
transform: scale(1) → scale(0.92) → scale(1);
duration: 150ms total;
easing: ease-spring;
```

### Reduced Motion
Always respect `prefers-reduced-motion`:
```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 8. Components

---

### 8.1 Buttons

#### Variants

**Primary**
- Background: `#1C1C1C`
- Text: `#EEEEEE`
- Border: none
- Hover: `#E6F0EF` background, text `#0D988A`
- Pressed: `#006C61` background, text `#EEEEEE`
- Active: `translateY(0)` + `scale(0.98)`
- Focus: `#E6F0EF` background, text `#0D988A`, `outline: 1px solid #5FA096; outline-offset: 1px`
- Disabled: `#EEEEEE` background, text `#979797`, `cursor: not-allowed`

**Secondary**
- Background: `#EAEAEA`
- Text: `#0D988A`
- Border: `0.5px solid #C5D9D7`
- Hover: `#E6F0EF` background, text `#0D988A`
- Pressed: `#E6F0EF` background, border `#74CEC0`, text `#006C61`
- Focus: `#FFFFFF` background, `outline: 1px solid #5FA096; outline-offset: 1px`, text `#0D988A`
- Disabled: `#EEEEEE` background, border `#EEEEEE`, text `#979797`

**Ghost**
- Background: transparent
- Text: `#737373`
- Border: none
- Hover: `#E6F0EF` background, text `#171717`

**Destructive**
- Background: `#DC2828`
- Text: `#FAFAFA`
- Hover: darker red background + `translateY(-1px)`

**Link**
- Background: transparent
- Text: `#0D988A`
- Underline on hover

#### Sizes

| Size | Height | Padding H | Font token |
|---|---|---|---|
| `sm` | 28px | 10px | `text-label-md` (12px/500) |
| `md` | 36px | 14px | `text-label-lg` (14px/500) |
| `lg` | 44px | 20px | `text-body-lg` (16px/500) |
| `icon-sm` | 28px | 8px | — |
| `icon-md` | 36px | 10px | — |

#### Rules
- Border radius: `6px` always
- Icons inside buttons: Lucide, 16px (`icon-sm`), `strokeWidth={1.5}`, 6px gap to label
- Loading state: replace label with spinner, maintain same width to prevent layout shift
- Transition: `background 150ms ease-default, transform 150ms ease-default, box-shadow 150ms ease-default`

---

### 8.2 Cards

#### Image Card (Gallery)
- Background: `#FFFFFF`
- Border: `1px solid #E6E6E6`
- Border radius: `8px`
- Overflow: hidden
- Padding: 0
- Thumbnail: `object-fit: cover`, fills card width, variable height (masonry)
- Hover: `transform: scale(1.02)`, `box-shadow: 0 4px 16px rgba(23,23,23,0.10)`, `duration-fast`
- Selected: `box-shadow: 0 0 0 2px #0D988A`
- Hover overlay: gradient from `rgba(23,23,23,0.5)` bottom 40% → transparent, shows filename + date

**Color strip** (shown when color filter is active)
- 5 circles, 8px diameter, 2px gap, bottom-left corner, 6px padding

#### Content Card
- Background: `#FFFFFF`
- Border: `1px solid #E6E6E6`
- Border radius: `12px`
- Padding: `24px`
- Hover: border becomes `#5FA096`, `duration-fast`

#### Modal Card
- Background: `#FFFFFF`
- Border: `1px solid #E8E8E8`
- Border radius: `12px`
- Padding: `24px`
- Box shadow: `0 8px 32px rgba(23,23,23,0.12)`
- Max width: 480px (import modal), 640px (detail panel)

---

### 8.3 Inputs

#### Text Input
- Height: 36px
- Padding: `0 12px`
- Background: `#FFFFFF`
- Border: `1px solid #E6E6E6`
- Border radius: `6px`
- Font: `text-body-md` (14px/400), color `#171717`
- Placeholder: `#737373`
- Focus: border `#5FA096`, `outline: 1px solid #5FA096; outline-offset: 1px`
- Error: border `#DC2828`, `box-shadow: 0 0 0 3px rgba(220,40,40,0.12)`
- Disabled: background `#EEEEEE`, opacity `0.6`, `cursor: not-allowed`
- Transition: `border-color 150ms ease-default, box-shadow 150ms ease-default`

#### Search Input
- Same as text input, plus:
- Left icon: magnifier, 16px, `#737373`
- Padding left: `36px`
- Clear button (×): appears on non-empty value, right side, `#737373`
- Keyboard shortcut badge: `⌘F`, right-aligned when unfocused, hidden on focus

#### Tag Input
- Same as text input
- Existing tags render as chips inside the field, left of cursor

---

### 8.4 Chips / Tags

#### Default Chip
- Background: `#EAEAEA`
- Border: `1px solid #E6E6E6`
- Text: `#737373`, `text-body-sm` (13px/400)
- Border radius: `6px`
- Padding: `2px 8px`
- Height: 24px

#### Removable Chip (Tags)
- Same as default + × icon (12px) on right, 4px gap
- × hover: color `#DC2828`
- Remove animation: `scale(0.8) + opacity(0)`, `duration-fast`

#### Active / Filter Chip
- Background: `rgba(11,152,138,0.10)`
- Border: `1px solid rgba(13,152,138,0.20)`
- Text: `#006C61`, `text-label-md` (12px/500)

#### Color Chip
- Circular, 24px (sidebar) / 40px (detail view) / 48px (pitch deck)
- Border radius: `9999px`
- Border: `1px solid #E6E6E6`
- Hover: `scale(1.1)`, ring `2px solid #E8E8E8`
- Selected: ring `0 0 0 2px #FFFFFF, 0 0 0 4px #0D988A`
- Click feedback: spring scale animation + "Copied!" tooltip

---

### 8.5 Lists

#### Sidebar List Item
- Height: 36px
- Padding: `8px 16px`
- Border radius: `6px`
- Font: `text-body-md` (14px/400), color `#737373`
- Icon: 16px, left, 10px gap to label, color `#737373`
- Count badge: right-aligned, `text-label-sm`, `#737373`
- Hover: background `#ECEAEA`, border `0.5px solid rgba(13,152,138,0.20)`, text `#171717`
- Active: background `rgba(11,152,138,0.10)`, border `0.5px solid rgba(13,152,138,0.20)`, outline `0.5px solid rgba(13,152,138,0.51)`, text `#0D988A`
- Transition: `background 80ms ease-default`

#### File List Item (Source Folders)
- Height: 36px
- Folder icon: 16px, `#737373`
- Name: `text-body-md`, truncated, `#171717`
- Count: right-aligned, `text-label-sm`, `#737373`
- Hover: background `#E6F0EF`, show remove icon (×) right
- Sub-folders: +16px left padding

#### Metadata List (Detail Panel)
- Two-column: key left (40%), value right (60%)
- Row height: 28px
- Key: `text-label-md` (12px/500), `#737373`, uppercase
- Value: `text-body-md` (14px/400), `#171717`
- Row separator: `1px solid #E6E6E6` (last row omitted)

---

### 8.6 Tooltips
- Background: `#171717` (always dark regardless of app theme)
- Text: `#FAFAFA`, `text-label-md` (12px/500)
- Padding: `6px 10px`
- Border radius: `8px`
- Max width: 240px
- Arrow: 5px triangle, same background
- Show delay: 400ms
- Hide delay: 0ms
- Animation: `opacity 0→1 + translateY(2px)→0`, `duration-fast`
- Placement: prefer top, collision-aware fallback

---

### 8.7 Filter Sections (Sidebar)

#### Filter Section Container
- Header: label `text-label-sm` uppercase `#737373` + chevron right (12px)
- Header height: 32px, full-width clickable
- Chevron: rotates `0°→90°` on expand, `duration-default`
- Content: `max-height` animated expand, `duration-default`

#### Date Filter
- Preset pills: "Today" / "This Week" / "This Month"
  - Default: `#EAEAEA` bg, `#E6E6E6` border, `text-body-sm`
  - Active: `rgba(11,152,138,0.10)` bg, `#0D988A` border, `#006C61` text
- Custom range: two date inputs separated by "→"

#### Color Filter
- Swatch grid: 6 columns, 4px gap
- Each swatch: 20px circle
- Selected: `box-shadow: 0 0 0 2px #FFFFFF, 0 0 0 4px #0D988A`

#### Range Slider (File Size, Dimensions)
- Track: 4px height, `#E6E6E6`, `border-radius: 9999px`
- Fill: `#0D988A`
- Thumb: 16px circle, `#FFFFFF`, `box-shadow: 0 1px 4px rgba(23,23,23,0.15)`
- Thumb hover: `scale(1.2)`, `duration-instant`
- Labels: `text-label-sm`, `#737373`

---

### 8.8 Checkboxes
- Size: 16×16px
- Border: `1.5px solid #E8E8E8`
- Border radius: `4px`
- Background: `#FFFFFF` (unchecked), `#0D988A` (checked)
- Check icon: `#FAFAFA`, 10px SVG
- Check animation: `scale(0)→scale(1)`, `duration-fast`, `ease-spring`
- Indeterminate: `#0D988A` bg, minus icon `#FAFAFA`
- Focus: `outline: 1px solid #5FA096; outline-offset: 1px`
- Label: `text-body-md`, 8px left gap
- Disabled: `opacity: 0.4`

---

### 8.9 Navigation (Sidebar)

#### Structure
```
[Logo + App Name]          ← 48px header
[Search Input]             ← 36px, 12px vertical margin
─────────────────────────  ← border-subtle divider
FILTERS                    ← text-label-sm, uppercase, text-muted
  Date
  Color
  File Size
  Dimensions
  Format
─────────────────────────
LIBRARY
  Source Folders
  Collections
  Favorites
─────────────────────────
[Avatar] [Email] [⚙]     ← 48px footer
```

#### Collapsed Sidebar
- Width: 48px (icon-only)
- Hover on icon: tooltip with label
- Collapse toggle: chevron at sidebar bottom
- Collapse animation: `width 200ms ease-default`

#### Active State Rules
- One active item per section at a time
- Active: `rgba(11,152,138,0.10)` background + `0.5px` teal border + `0.5px` teal outline, text `#0D988A`
- Section labels: never interactive, never active

---

### 8.10 Search

See **8.3 Inputs — Search Input** for base component.

#### Behavior
- Debounce: 300ms
- Min characters: 1
- Results highlight: matched text in `#0D988A`, weight 600
- No results: "No images match '{query}'" centered, with "Clear search" link in `#0D988A`
- Recent searches: dropdown on focus (empty field), max 5 items, keyboard navigable
- Keyboard: `↑/↓` navigate, `Enter` confirm, `Escape` close + clear

---

## 9. Do's and Don'ts

### Do ✅
- Pair code examples with every API/technical feature — transparency builds trust
- Maintain generous whitespace — premium products breathe, they don't crowd
- Provide focus rings on all interactive elements: `1px solid #5FA096`, `1px offset`
- Use `Geist Mono` for hex values, file paths, file sizes, and inline code
- Use Lucide for all icons with `strokeWidth={1.5}` — no other icon libraries
- Keep all neutrals in the same gray family (`#171717`, `#737373`, `#E6E6E6`, `#FBFBFA`)
- Use `#1C1C1C` for primary CTAs and `#0D988A` for interactive highlights — don't conflate the two
- Use subtle `scale(1.02)` and a light shadow on card hover to signal interactivity
- Show color strips on image cards when a color filter is active
- Truncate long strings with middle ellipsis (`file...name.png`), not end truncation
- Animate exits as well as entrances — elements leaving should fade or slide out
- Test all UI states: empty, loading, error, single item, large (10k+ images)

### Don't ❌
- Don't apply gradients to small elements or text — hero backgrounds and premium cards only
- Don't use more than two type sizes in a single component
- Don't use `#0D988A` (accent) as a fill for large surface areas
- Don't mix unrelated gray families — stay within the neutral palette
- Don't block interactions with animation — no `pointer-events: none` during transitions
- Don't truncate hex color values — always show the full 6-digit form (`#0D988A` not `#0D9…`)
- Don't use `px` for font sizes in media queries — use `rem`
- Don't animate `opacity` and `transform` in separate `transition` declarations — combine them
- Don't show tooltips on touch devices — design tap targets to be self-explanatory
- Don't use font sizes below 11px anywhere in the UI
- Don't use icons from libraries other than Lucide, or Lucide's default `strokeWidth` of `2`

---

## 10. Accessibility

- **Focus rings:** `outline: 1px solid #5FA096; outline-offset: 1px` on all interactive elements
- **Color contrast:** All text meets WCAG AA minimum (4.5:1 for body, 3:1 for large text)
- **Motion:** All animations respect `prefers-reduced-motion: reduce`
- **Font sizes:** Minimum 11px (`text-label-sm`) — never go smaller
- **Touch targets:** Minimum 44×44px on any touch surface
- **ARIA:** Icon-only buttons require `aria-label`. Modals use `role="dialog"` + `aria-modal="true"`. Filter sections use `aria-expanded`
- **Keyboard:** Full keyboard support — Tab, Shift+Tab, Enter, Space, Arrow keys, Escape all function as expected across all components

---

*Bojo-CMS Design System v1.3 — Light Mode — Boris Jov Design Studio — June 2026*
