// Deployment entrypoint. When this server is bundled (`bun build
// --target=bun`), the client assets from the HTML import are emitted next
// to the bundle, but Bun resolves them against the process working
// directory at runtime. Hosts often start the process from elsewhere, so
// pin the cwd to the bundle directory before the server module loads.
// The dynamic import is load-bearing: a static import would execute
// index.ts before the chdir runs.
process.chdir(import.meta.dir);
await import("./index");
