# Logo assets

The mark is a chat bubble with a lightning bolt knocked out of it — the live
spark inside a durable conversation. It matches the in-app `LogoMark` component
in [`src/client/App.tsx`](../../src/client/App.tsx) and the favicon data URI in
[`src/client/index.html`](../../src/client/index.html).

Two variants:

- **`icon.svg`** and `icon-{16,32,64,128,256,512,1024}.png` — rounded tile.
  Use wherever the image is rendered as-is: README, docs, favicons, link previews.
- **`icon-square.svg`** and `icon-square-{128,256,512,1024}.png` — full-bleed
  square for platforms that apply their own corner mask. The glyph stays clear
  of a circular crop.

Where to upload what:

| Target | File |
| --- | --- |
| GitHub app / org avatar (needs ≥ 200 px) | `icon-square-1024.png` |
| Stripe branding icon (needs ≥ 128 px square) | `icon-square-512.png` |
| Favicon | already inlined in `index.html`; use `icon-16.png` / `icon-32.png` where a file is required |
| Social cards, app directories | `icon-1024.png` |

## Regenerating the PNGs

The PNGs are rendered from the SVGs with [resvg](https://github.com/linebender/resvg).
From a scratch directory with `@resvg/resvg-js` installed (`bun add @resvg/resvg-js`):

```ts
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "fs";

for (const { svg, prefix, sizes } of [
  { svg: "icon.svg", prefix: "icon", sizes: [16, 32, 64, 128, 256, 512, 1024] },
  { svg: "icon-square.svg", prefix: "icon-square", sizes: [128, 256, 512, 1024] },
]) {
  const source = readFileSync(svg, "utf8");
  for (const size of sizes) {
    const png = new Resvg(source, { fitTo: { mode: "width", value: size } })
      .render()
      .asPng();
    writeFileSync(`${prefix}-${size}.png`, png);
  }
}
```
