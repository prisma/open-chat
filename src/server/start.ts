// Deployment entrypoint: fix the working directory, then start the server.
// Module order matters — ESM executes imports in order, so chdir.ts runs
// before index.ts resolves its bundled client assets. Both imports must be
// static so the bundler emits the HTML import's assets next to the bundle.
import "./chdir";
import "./index";
