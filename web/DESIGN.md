# Fluxion design system

A short, opinionated system so every screen reads as one premium product. Dark,
cinematic, and disciplined — **one** bold signature element per surface, every‑
thing else restrained.

## Principles

1. **One accent, used sparingly.** Electric violet (`--color-accent`) is the only
   brand hue. Node categories get their own low‑opacity tints, but the accent
   carries identity and primary actions.
2. **Atmosphere over decoration.** Depth comes from the `bloom`, `grain`, and
   `glass` utilities — ambient light, not borders and boxes.
3. **One signature per screen.** The editor canvas, the analytics charts, the
   landing product‑preview. Around the signature, keep it quiet.
4. **Motion is calm and purposeful**, and always yields to
   `prefers-reduced-motion` (see [Motion](#motion)).

## Tokens

All tokens live in [`src/index.css`](src/index.css) under `@theme` and are the
single source of truth. Never hard‑code a hex that a token already covers.

| Group | Tokens |
| --- | --- |
| Surfaces (elevation ladder) | `--color-void` → `--color-base` → `--color-surface` → `--color-surface-2` → `--color-raised` |
| Ink | `--color-ink`, `--color-muted`, `--color-faint` |
| Accent | `--color-accent`, `--color-accent-bright`, `--color-accent-deep` |
| Secondary glow (rare) | `--color-spark` |
| Node categories | `--color-cat-trigger/-action/-ai/-logic/-output` |
| Type | `--font-display` (Space Grotesk), `--font-sans` (Inter), `--font-mono` (JetBrains Mono) |

**Color usage rule:** derive states with `color-mix(in oklab, <token> N%, transparent)`
rather than introducing new colors. Status colors are fixed: success `#34d0a8`,
warning/running `#e0a33e`, error `#ff6b6b`.

## Typography

- **Display** (`font-display`) for headings, with `-0.02em` tracking. Page titles
  use `text-gradient`.
- **Sans** (`font-sans`) for body and UI text.
- **Mono** (`font-mono`) for ids, code, node types, log lines, and eyebrow labels
  (uppercase, wide tracking).
- Scale, by role: page title `28px`; section/hero up to `34–60px`; card title
  `15–18px`; body `13–15px`; meta/eyebrow `10–12px`.

## Spacing & radius

- Page chrome: `max-w-6xl`, `px-6`, content starts at `pt-10`.
- Card radius `rounded-2xl` (16px); pills/buttons `rounded-lg`/`rounded-xl`.
- Gaps: card grids `gap-3.5`/`gap-4`; inline clusters `gap-2`–`gap-3`.

## Components

Shared primitives — prefer these over hand‑rolling:

- **Buttons** — primary is the violet gradient; secondary is a hairline ghost
  (`border-white/8` + hover). [`components/ui/Button.tsx`](src/components/ui/Button.tsx).
- **Inputs** — `TextInput`, `TextArea`, `Select`, `Label`, `FieldShell`.
  [`components/Field.tsx`](src/components/Field.tsx).
- **Badge** — the dot‑pill, given any color. [`components/ui/Badge.tsx`](src/components/ui/Badge.tsx).
- **States** — `Skeleton`, `CardSkeletonGrid`, `LoadingState`, `EmptyState`,
  `ErrorState`. [`components/ui/states.tsx`](src/components/ui/states.tsx).
- **StatusBadge / JsonBlock** — run status pill and payload block.
  [`editor/RunBits.tsx`](src/editor/RunBits.tsx).

### Empty / loading / error — the three‑state rule

Every data‑backed screen renders exactly one of three states, so the app speaks
with one voice and **a failed fetch is never a silent blank**:

- **Loading** → `CardSkeletonGrid` (matches the real grid) or `LoadingState`.
- **Empty** → `EmptyState` (iconic badge + title + copy + optional actions).
- **Error** → `ErrorState` with a **retry** affordance.

## Iconography

One icon set — the line icons in [`components/icons.tsx`](src/components/icons.tsx),
1.6px stroke, `1em` sized so they scale with text. Node category icons live in
the node catalog. Don't mix in another icon library.

## Motion

Helpers in [`lib/motion.ts`](src/lib/motion.ts): `EASE`, `spring`, `riseIn`,
`stagger`, and `still` (the reduced‑motion no‑op). Every animated component reads
`useReducedMotion()` and swaps to `still`/static. Signature loops (canvas run
pulse, landing preview) freeze to their resolved state under reduced motion.

## The canvas

Nodes carry **category identity** (accent icon chip + top hairline) and four
explicit run states: idle, **running** (amber ring + breathing aura), **success**
(teal ring), **failed** (red ring). Selection uses the accent ring; a run status
ring always takes visual priority. React Flow is themed to the system in
`index.css` (handles, edges, controls, minimap, selection).

## The landing page

The public face ([`pages/LandingPage.tsx`](src/pages/LandingPage.tsx)) follows the
same tokens. Its **one signature element** is the looping product preview — a
miniature workflow that executes on a loop, nodes lighting up in topological
order. Reduced motion shows the final all‑green state. SEO/OG metadata lives in
[`index.html`](index.html) with the card at [`public/og.svg`](public/og.svg).
