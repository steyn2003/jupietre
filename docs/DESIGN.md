# Design System

Single-source-of-truth for how Jupietre's UI is built. **Theme-first, primitive-second, page-third.** Change a CSS var, the whole app re-themes — change a primitive, every page that uses it updates.

---

## 1. Architecture in one picture

```
app/globals.css          ← tokens (colors, radii, motion, fonts) — the only place hex values live
       │
       ▼
components/ui/*          ← primitives that consume tokens (Button, Card, Field, Badge, …)
       │
       ▼
components/layout/*      ← AppShell, TopNav (page chrome built from primitives)
       │
       ▼
app/**/page.tsx          ← pages assemble primitives + layout — no inline hex, no custom shadows
```

If you find yourself writing `bg-[#...]`, a custom `box-shadow`, or a one-off `cubic-bezier` in a page, stop. Add it to the token layer or the primitive layer instead.

---

## 2. Tokens (`app/globals.css`)

All defined as CSS custom properties on `:root`, then re-exposed via Tailwind v4's `@theme inline` so they're usable as utility classes (`bg-surface-1`, `text-fg-muted`, `rounded-2xl`, `font-mono`, …).

### Surfaces (depth comes from value, not shadow)

| Token | Use |
| --- | --- |
| `--bg` | Page background (off-black `#0b0b0c`, never pure black) |
| `--surface-1` | Card base |
| `--surface-2` | Hover / elevated card |
| `--surface-3` | Modals, highest elevation |

### Text

| Token | Use |
| --- | --- |
| `--fg` | Primary text (titles, body) |
| `--fg-muted` | Secondary (descriptions, captions) |
| `--fg-subtle` | Tertiary (eyebrows, timestamps, dividers' labels) |

### Borders

| Token | Use |
| --- | --- |
| `--border-hairline` | 1px subtle dividers (rgba alpha — works on any surface) |
| `--border-strong` | Visible borders on hover |
| `--border-focus` | Focus ring tint |

### Brand & status

Each has a strong color **and** a `*-soft` variant (≈14% alpha) for backgrounds:

`--accent`, `--success`, `--warning`, `--danger` → swap `--accent` to re-brand.

### Motion

| Token | Curve | Use |
| --- | --- | --- |
| `--ease-spring` | `cubic-bezier(0.32, 0.72, 0, 1)` | Apple-style — buttons, nav pill, layout transitions |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Smooth out — entry animations, fades |

For Framer Motion springs, the project standard is `{ type: "spring", stiffness: 380, damping: 32 }` for layout transitions, `{ stiffness: 500, damping: 30 }` for tap feedback.

### Radius scale

`--radius-xs` (6) → `--radius-sm` (8) → `--radius-md` (12) → `--radius-lg` (16) → `--radius-xl` (22) → `--radius-2xl` (28). Buttons use `rounded-xl`/`rounded-2xl`, cards use `rounded-2xl`, pills use `rounded-full`.

### Fonts

- `--font-sans` → Geist (wired via `next/font` in `app/layout.tsx`)
- `--font-mono` → Geist Mono — used for **all numbers, IDs, paths, code, model names**

OpenType features `ss01`, `cv11`, `cv02` enabled globally. `tnum` (tabular figures) on `.font-mono` so columns of numbers align.

### Shadows

| Token | Use |
| --- | --- |
| `--shadow-soft` | Default elevation (diffused, tinted) |
| `--shadow-pop` | Higher elevation (modals, primary CTA) |
| `--shadow-inset-hi` | 1px inner top highlight on dark cards (the "double-bezel" effect) |

**Never** use Tailwind's stock `shadow-md` / `shadow-lg` — they're harsh black.

### Legacy aliases

`--color-background`, `--color-foreground`, `--color-muted`, `--color-border`, `--color-card`, `--color-accent-foreground` exist purely so older `bg-card` / `text-muted` references keep compiling. **New code uses the new tokens** (`bg-surface-1`, `text-fg-muted`, etc.).

---

## 3. Primitives (`components/ui/`)

Every primitive is small, typed, and consumes tokens — no inline hex.

### `Button` (and `IconButton`)

- Variants: `primary` (accent fill) · `secondary` (surface + hairline) · `ghost` · `danger`
- Sizes: `sm` · `md` · `lg`
- Tactile feedback via Framer `whileTap` spring (no `useState`)
- **Trailing icon** renders inside its own circular pill (the "button-in-button" pattern) and translates diagonally on hover
- `loading` state replaces children with a centered spinner, keeps button width stable
- `IconButton` requires `aria-label`

### `Card`

- **Default**: double-bezel — outer `ring-1` shell + inner core with concentric radius and inset highlight. Looks like glass set in metal.
- `flat` — single-surface card for low-emphasis groupings
- `bare` — skip inner padding (for cards that contain their own padded sections)
- `elevated` — adds diffused soft shadow

### `Field` / `Input` / `Textarea` / `Select`

- Label sits **above** input, helper or error text below
- Accent focus ring with soft glow halo (`focus:ring-accent-soft`)
- `Select` has a custom inline-SVG chevron (no native dropdown arrow)
- `Textarea` defaults to vertical resize, min-height 80px
- `invalid` prop swaps to danger tone

### `Badge` + `Eyebrow`

- 5 tones: `neutral` · `accent` · `success` · `warning` · `danger`
- 2 sizes: `sm` · `md`
- Optional leading status `dot`
- `Eyebrow` is the small-caps `tracking-[0.18em]` tag that precedes major page titles

### `StatRow`

- Replaces 3-up StatCard grids
- Single rounded card divided by hairlines (vertical on desktop, horizontal on mobile)
- Mono tabular numbers, `text-2xl` value, uppercase tracked label

### `EmptyState`

- Icon in a small surface tile (with inset highlight) + title + description + optional CTA
- Used everywhere instead of the dashed-border placeholder

### `Skeleton`

- Shimmer keyframes live in `globals.css`
- Match dimensions to the real content's bounding box — never use a generic spinner where structure is known

### Utility

- `cn(...)` — minimal class-merger (no `clsx`/`tailwind-merge` bloat)

---

## 4. Layout (`components/layout/`)

### `TopNav`

Floating glass pill, `sticky top-3`, `backdrop-blur-xl`, hairline ring, diffused shadow. Brand mark + nav items with Phosphor icons. The active-route indicator is a single `motion.span` with `layoutId="nav-pill"` — Framer animates it from one item to the next when you navigate.

### `AppShell`

Wraps every authenticated page:

```tsx
<AppShell
  email={session.email}
  eyebrow="Workspace"
  title="Sessions"
  description="…"
  back={{ href: "/", label: "Sessions" }}   // optional
  action={<Button>New session</Button>}      // optional
  fluid                                       // wider container (1180 vs 920)
>
  {children}
</AppShell>
```

Public surfaces (`/login`, `/invite/[token]`) **don't** use `AppShell` — they get a centered ambient-glow layout with the brand mark on top.

---

## 5. Conventions

### Spacing

Sections breathe. Default page padding is `pt-6 pb-16`. Stack sections with `space-y-8`. Inside cards use `p-5` (or `p-6` for breathing room). Form fields `gap-4`-`gap-5`.

### Typography hierarchy

- Page title: `text-[28px] sm:text-[32px] font-medium tracking-tight leading-[1.1]` (managed by `AppShell`)
- Section title: `text-[14px] font-medium tracking-tight`
- Eyebrow: handled by `<Eyebrow>` primitive (`text-[10px] uppercase tracking-[0.18em]`)
- Body: `text-[14px]`
- Caption: `text-[12px] text-fg-muted`
- Micro: `text-[11px] text-fg-subtle` (timestamps, units)

Headings use `font-medium`, **not** `font-semibold` or `font-bold`. Hierarchy comes from size + color, not weight.

### Numbers, IDs, paths

Always wrap in `font-mono tabular-nums` (or use the `Stat` value slot which does this for you). Spend, dates, slugs, model names, file paths, hashes — all mono.

### Lists

The default list pattern: rounded card with hairline ring + `divide-y divide-hairline`. Each row hovers to `bg-surface-2/60` with a 150ms color transition. **No** card-per-row.

### Status

Use `StatusDot` pattern (small filled circle, optionally pulsing) + `Badge` with `dot` for inline labels. Tone maps:

| Status | Tone |
| --- | --- |
| running | `accent` (with pulse) |
| complete | `success` |
| error | `danger` |
| idle / paused | `neutral` |

### Motion intensity

Project baseline: **6/10**. Tactile button springs, layout transitions on lists/nav, entry fade-up on chat bubbles. **No** auto-playing infinite micro-animations beyond the typing indicator and status pulse — this is a dashboard, not a marketing site.

### Density

Project baseline: **6/10** — Linear/Vercel-core, not airy gallery. Forms can pack more (multi-column grids); marketing surfaces (login) breathe more (`p-6`+ on cards, larger headings).

### Icons

- `@phosphor-icons/react` (`weight="regular"` standard, `weight="bold"` for chevrons/arrows in tight UI, `weight="fill"` for status indicators)
- For server components: import from `@phosphor-icons/react/dist/ssr`
- Standard size: `h-4 w-4` for inline, `h-3.5 w-3.5` for trailing-button slots, `h-5 w-5` for empty-state icons

### Forbidden patterns

- Pure `#000` / `#fff` — use `--bg` / `--fg`
- Inter font, Lucide icons, Tailwind stock shadows (`shadow-md`, etc.)
- 3-equal-card grids — use divided lists or asymmetric layouts
- Centered hero text on dashboard pages
- Inline hex values in pages
- Native radio/checkbox styling (use the form's custom toggle pills + checkbox renders)
- `useState` for hover/tap animation (use Framer `whileTap`, `whileHover`)
- Animating `width`, `height`, `top`, `left` (transform/opacity only)

---

## 6. Re-theming

To change the brand:

```css
/* app/globals.css */
:root {
  --accent: #34d399;                                /* was #5b8def */
  --accent-soft: rgba(52, 211, 153, 0.14);
  --accent-strong: #4be0a8;
}
```

That's it. Buttons, badges, focus rings, status dots, sparklines, the active nav pill — all update.

To change density or radius scale, edit `--radius-*` in `@theme inline`. To change motion personality, edit `--ease-spring` and the spring stiffness/damping values used in `Button.tsx` and `TopNav.tsx`.

---

## 7. Adding a new page — checklist

- [ ] Wrap in `<AppShell>` with `eyebrow` + `title` + (optional) `description` + `back` + `action`
- [ ] Use `<Card>` for grouped content, divided list pattern for collections
- [ ] Forms: `<Field>` + `<Input>` / `<Textarea>` / `<Select>` (never raw `<input>`)
- [ ] Empty state: `<EmptyState>` with icon + CTA (never the dashed-border placeholder)
- [ ] Loading: `<Skeleton>` matching real content dimensions (never a centered spinner)
- [ ] Numbers: `font-mono tabular-nums`
- [ ] Status indicators: `<Badge tone>` + optional `dot`
- [ ] Icons: Phosphor, regular weight, sized via parent `[&_svg]:h-4` or explicit `h-4 w-4`
- [ ] Zero inline hex values, zero inline `box-shadow`, zero `cubic-bezier` literals
