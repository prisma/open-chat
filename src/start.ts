// The service's entry (src/service.ts's node() build): the deploy-printed
// bootstrap imports the built form of this file via service.run(), and the
// dev script (scripts/dev.ts) imports the source the same way. Fix the
// working directory, then start the server.
//
// This file lives at src/ (not src/server/) on purpose: the bundler's
// output tree mirrors the source tree relative to the entry's directory,
// and only the bundle directory is uploaded. From here, the client HTML
// emits inside the bundle; from src/server/ it would land one level above
// and be missing from the deploy.
//
// Module order matters too — ESM executes imports in order, so chdir.ts
// runs before the server resolves its bundled client assets. Both imports
// must be static so the bundler emits the HTML import's assets.
import "./chdir";
import "./server/index";
