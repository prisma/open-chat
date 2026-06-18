import { defineComputeConfig } from "@prisma/compute-sdk/config";

export default defineComputeConfig({
  apps: {
    streams: {
      name: "Streams",
      framework: "bun",
      entry: "src/streams-app/index.ts",
      httpPort: 8080,
      build: {
        command: "bun run build:streams",
        outputDirectory: "dist/streams",
      },
    },
    "open-chat": {
      name: "open-chat",
      framework: "bun",
      entry: "src/start.ts",
      httpPort: 3000,
      build: {
        command: "bun run build:chat",
        outputDirectory: "dist/server",
      },
    },
  },
});
