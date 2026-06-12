// Optimized serving for the built client (index-<hash>.js/.css + index.html).
//
// In a deployed bundle, `bun build --target=bun` emits the HTML import's
// client files next to the compiled server — but the deploy pipeline runs
// that build without `--minify`, and Bun.serve's built-in asset serving
// adds no compression and no Cache-Control. On a ~2 MB unminified React
// bundle that costs seconds of load time on every visit. Handing Bun.serve
// the HTML import alongside our own asset routes doesn't help either: the
// bundle registers its own internal routes for its assets, which win.
//
// So in production we serve the client entirely ourselves. At startup each
// emitted asset is minified, gzipped, and held in memory, then served with
// immutable cache headers — safe because the file names are content-hashed,
// so every deploy that changes an asset also changes its URL.
//
// In local dev no emitted assets exist next to this module (Bun's dev
// server bundles the HTML import on the fly), so this returns null and the
// plain HTML import route serves everything, hot reload included.

import { join } from "node:path";
import { brotliCompressSync } from "node:zlib";

const CONTENT_TYPES: Record<string, string> = {
  js: "text/javascript;charset=utf-8",
  css: "text/css;charset=utf-8",
};

// Images the client imports (e.g. the /tour screenshots) are emitted next
// to the bundle too, but unlike js/css they are already compressed — serve
// the bytes as-is.
const IMAGE_TYPES: Record<string, string> = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  svg: "image/svg+xml",
};

async function optimize(path: string): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const result = await Bun.build({
      entrypoints: [path],
      target: "browser",
      minify: true,
    });
    const output = result.outputs[0];
    if (!output) throw new Error("minify produced no output");
    return new Uint8Array(await output.arrayBuffer());
  } catch (error) {
    // Never let an optimization failure take the app down — fall back to
    // serving the asset exactly as the deploy build emitted it.
    console.error(`Could not minify ${path}; serving unmodified.`, error);
    return new Uint8Array(await Bun.file(path).arrayBuffer());
  }
}

export async function builtClientRoutes(): Promise<Record<
  string,
  (req: Request) => Response
> | null> {
  const dir = import.meta.dir;
  const names = [...new Bun.Glob("index-*.{js,css}").scanSync(dir)];
  if (names.length === 0) return null;

  const routes: Record<string, (req: Request) => Response> = {};
  for (const name of names) {
    const body = await optimize(join(dir, name));
    const brotli = new Uint8Array(brotliCompressSync(body));
    const gzipped = Bun.gzipSync(body, { level: 9 });
    const headers = {
      "Content-Type": CONTENT_TYPES[name.split(".").at(-1)!] ?? "",
      "Cache-Control": "public, max-age=31536000, immutable",
      Vary: "Accept-Encoding",
    };
    routes[`/${name}`] = (req) => {
      const accepts = req.headers.get("Accept-Encoding") ?? "";
      if (accepts.includes("br"))
        return new Response(brotli, {
          headers: { ...headers, "Content-Encoding": "br" },
        });
      if (accepts.includes("gzip"))
        return new Response(gzipped, {
          headers: { ...headers, "Content-Encoding": "gzip" },
        });
      return new Response(body, { headers });
    };
  }

  for (const name of new Bun.Glob("*.{webp,png,jpg,svg}").scanSync(dir)) {
    const bytes = new Uint8Array(await Bun.file(join(dir, name)).arrayBuffer());
    const contentType = IMAGE_TYPES[name.split(".").at(-1)!];
    routes[`/${name}`] = () =>
      new Response(bytes, {
        headers: {
          "Content-Type": contentType ?? "application/octet-stream",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
  }

  // Catch-all: the app shell. Served fresh (it's tiny) so a new deploy's
  // hashed asset URLs are picked up immediately.
  const html = await Bun.file(join(dir, "client/index.html")).bytes();
  routes["/*"] = () =>
    new Response(html, {
      headers: {
        "Content-Type": "text/html;charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });

  return routes;
}
