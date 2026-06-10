import index from "../client/index.html";
import { env } from "./env";
import { routeApi } from "./routes";

const server = Bun.serve({
  port: env.PORT,
  idleTimeout: 255,
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/api/*": routeApi,
    "/*": index,
  },
});

console.log(`Open Chat running at ${server.url}`);
