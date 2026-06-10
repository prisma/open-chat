// Pin the working directory to this module's directory. In a bundled
// deploy, Bun resolves the HTML import's client assets against the process
// cwd, and hosts often start the process from outside the bundle directory.
// Imported first by start.ts so it runs before the server module loads.
process.chdir(import.meta.dir);
