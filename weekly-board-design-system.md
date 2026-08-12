# The Weekly Board — Design System

Reference for building any new feature onto this app. Direction: Dawn Glass — frosted glass cards over a cool water-toned gradient. Modern, relaxing, restrained. Reference implementation: `weekly-board-v2.html`.

## Color

### Core tokens (locked — do not redefine these)
```css
--ink:#2A3B4C;              /* primary text */
--ink-soft:#5C6B7A;         /* secondary text */
--ink-faint:#8B9AA8;        /* labels, captions, timestamps */
--glass:rgba(255,255,255,0.55);
--glass-strong:rgba(255,255,255,0.78);
--glass-border:rgba(255,255,255,0.65);
--teal:#2F8F8A;              /* primary accent — buttons, active states, links */
--teal-dark:#236b67;         /* hover/pressed state for teal */
--white:#ffffff;
```

### Background gradient (locked)
```css
background: linear-gradient(160deg,#CFE0EC 0%,#BFE6E0 45%,#EAF4E6 100%);
```
Sky blue → aqua → seafoam. Any new full-page view uses this same gradient as its base — don't introduce a different background per feature.

### Status colors
```css
--status-proven:#3D8B86;    /* positive / confirmed / good */
--status-new:#C98A3E;       /* new / untested / pending */
--status-caution:#C15A4A;   /* negative / needs attention */
```
These three cover most status needs (good / neutral-new / bad). If a future feature genuinely needs a 4th status, it must:
- stay in the same muted, cool-leaning "water" family (no saturated primary colors, no pastels lighter than the glass tint)
- be legible on both `--glass` and `--white` backgrounds
- get added to this table with a name and purpose, not just used ad hoc

Palette is otherwise **open** — new features can introduce new accent colors beyond status (e.g. a category color for a new tracker), but they should follow the same desaturated, water-adjacent logic as `--teal`, not clash with it. When in doubt, test a new accent against the existing gradient before committing to it.

## Typography

- **Headers**: Sora (weight 600), fallback to system sans (`-apple-system, 'Helvetica Neue', Arial`) with `letter-spacing:-0.01em`
- **Body**: Plus Jakarta Sans, fallback to system sans (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial`)
- **Utility/data** (labels, timestamps, quantities, small caps tags): JetBrains Mono, fallback `ui-monospace, 'SF Mono', 'Roboto Mono', Consolas`

**Important**: load fonts via `<link>` in `<head>`, not `@import` inside `<style>`. If the target environment can't guarantee network access (e.g. an embedded/offline preview), fall back to the system stack only — don't make any feature depend on an external font request to render at all. This caused a real blank-page bug during development; the fallback stack should always be functional on its own.

## Layout & structure

- **Any new top-level feature reuses the tab + glass-card structure** — don't introduce a different page shell. Add a new tab to the existing tab bar rather than a separate navigation pattern.
- Card radius: `18px` for content cards, `12px` for compact elements (scoreboard strip, badges), `10-12px` for buttons/pills.
- Glass card pattern (the base building block for nearly everything):
```css
background: var(--glass);
backdrop-filter: blur(12px);
-webkit-backdrop-filter: blur(12px);
border: 1px solid var(--glass-border);
border-radius: 18px;
```
- Max content width: `640px`, centered, `16px` side padding on mobile.

## Components

- **Tab bar**: pill-shaped container (`border-radius:16px`) holding flex tab buttons; active tab gets solid white background + `--teal-dark` text + soft shadow.
- **Status glow**: 9px dot, positioned top-right of a card, colored by status token, with a soft matching `box-shadow` for the glow effect. Use for any at-a-glance status on a card.
- **Stamp/toggle buttons** (e.g. the Yes/Mostly/No pattern): pill-shaped, transparent by default, colored border+text+faint background fill when selected. Reuse this pattern for any future single-select quick-tap choice.
- **Primary button**: solid `--teal` fill, white text, `12px` radius, `--teal-dark` on hover.
- **Checkbox list item**: native checkbox with `accent-color: var(--teal)`, label flush right.
- **Scoreboard/metric strip**: compact glass pill summarizing counts or status at the top of a view.

## Icons

Standardize on **Tabler icons** (outline style) — free, wide coverage, matches the restrained aesthetic. Load via CDN (`cdnjs.cloudflare.com`) rather than inlining SVGs by hand.
- Icons are supporting, not decorative-for-its-own-sake — use them to label actions/categories (e.g. a cart icon for shopping, a book icon for recipes), not to fill empty space.
- Size 16-20px inline with text, 24px max for standalone/decorative use.
- Icon color inherits from surrounding text color (`--ink`, `--ink-soft`, or a status color) — don't hardcode icon colors separately.

## Motion

Keep it restrained. No page-load animation sequences, no scroll-triggered reveals. Acceptable:
- Tab switch: instant or a very quick fade (≤150ms)
- Hover/tap states on buttons and cards: subtle background/shadow transitions (~150ms ease)
- Respect `prefers-reduced-motion: reduce` — disable all transitions when set (already implemented in the reference file; carry this rule into any new CSS)

## Copy / voice

Plain and functional. Name the action, not the feeling: "Copy list," "Kids ate it," not "Yay, copied!" or playful phrasing. Sentence case, no exclamation points, no filler words. This matches the existing labels throughout the app and should hold for anything new (buttons, empty states, error messages).

## Accessibility baseline

- Visible focus rings on all interactive elements: `outline: 3px solid var(--teal)` (or a status color where relevant), `outline-offset: 2px`.
- Don't drop below 11px font size anywhere.
- Maintain readable contrast for text on glass — `--ink` and `--ink-soft` are calibrated for the current gradient; if a new background is introduced, re-check contrast rather than assuming it holds.
- Every new interactive control needs a real focus-visible state — don't rely on default browser outlines, but don't remove focus indication either.

## Extending this system

When Claude Code builds something new:
1. Reuse the tab + glass-card shell rather than inventing a new page structure.
2. Reuse existing color tokens first; only add new ones if genuinely needed, and follow the water-palette logic above.
3. Reuse existing component patterns (stamps, status glow, buttons, checkboxes) rather than creating new interaction patterns for the same kind of action.
4. Icons: pull from Tabler, keep them functional.
5. Keep motion minimal and keep copy plain.
6. Don't reintroduce external font/network dependencies without a working fallback.
