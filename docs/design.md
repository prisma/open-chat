# Design

## Overview

Open Chat uses a restrained product interface. The physical scene is a well-lit developer workbench: pure white surface, graphite structure, ochre active signals, and teal live-status cues. The visual system should make repeated chat work feel calm and fast while keeping stream state legible.

## Color Palette

```css
:root {
  --bg: oklch(1 0 0);
  --surface: oklch(0.975 0.003 60);
  --surface-strong: oklch(0.94 0.006 60);
  --ink: oklch(0.18 0.012 60);
  --muted: oklch(0.46 0.012 60);
  --line: oklch(0.88 0.006 60);
  --primary: oklch(0.55 0.124 60);
  --primary-strong: oklch(0.48 0.13 58);
  --primary-soft: oklch(0.92 0.052 62);
  --accent: oklch(0.42 0.095 190);
  --accent-soft: oklch(0.92 0.035 190);
  --danger: oklch(0.55 0.16 25);
}
```

## Typography

Use the system UI stack. Keep type sizes fixed in rem units. The app uses compact product hierarchy rather than hero typography.

## Components

- Sidebar: persistent desktop rail, collapsible mobile drawer.
- Chat rows: 8px radius, selected state via primary-soft background and primary text.
- Buttons: consistent 8px radius, icons from lucide-react, filled primary only for commands that create or send.
- Inputs: bordered, white or surface background, visible focus ring.
- Transcript: unframed main surface with message bubbles only where message ownership benefits from grouping.
- Model picker: searchable list with text-capable models surfaced first.
- Stream state: small status pill that reports idle, connecting, live, error, or complete.

## Motion

Use 150 to 220 ms transitions for hover, selection, drawer open, and status changes. Honor reduced motion by removing transitions.

## Responsive Layout

Desktop uses a fixed 320px sidebar and flexible transcript. Mobile collapses the sidebar behind a toolbar button and keeps the composer sticky at the bottom.

