// The HTML import must stay static even though production ignores it:
// it's what makes the bundler emit the client assets into the deploy bundle.
import index from "../client/index.html";
import { builtClientRoutes } from "./client-assets";
import { env } from "./env";
import { routeApi } from "./routes";

// Presence of built client assets doubles as the production signal.
// NODE_ENV can't be trusted here: the deploy build inlines it into this
// bundle before the runtime environment exists.
const clientRoutes = await builtClientRoutes();

const server = Bun.serve({
  port: env.PORT,
  idleTimeout: 255,
  development: clientRoutes === null,
  routes: {
    "/api/*": routeApi,
    // Dev serves the HTML import (on-the-fly bundling, hot reload); in
    // production the spread overrides "/*" and every asset route with the
    // pre-optimized versions.
    "/*": index,
    ...(clientRoutes ?? {}),
  },
});

console.log(`Open Chat running at ${server.url}`);
