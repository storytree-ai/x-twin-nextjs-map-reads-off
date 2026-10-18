#!/usr/bin/env node
// vinext CLI: `vinext dev | build | start [-p <port>] [-H <host>]`.
import { parseArgs } from "./cli-args.js";

const HELP = `Usage: vinext <command> [options]

Commands:
  vinext dev      Start the development server (Vite)
  vinext build    Build the app for production
  vinext start    Serve the production build

Options:
  -p, --port <port>      Port to listen on (default 3000)
  -H, --hostname <host>  Host to bind
  -h, --help             Show this help
`;

async function main(argv) {
  const { command, options } = parseArgs(argv);
  if (options.help || !command || command === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (options.version) {
    const { createRequire } = await import("node:module");
    const pkg = createRequire(import.meta.url)("../package.json");
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }
  const root = process.cwd();
  switch (command) {
    case "dev": {
      const { dev } = await import("./commands/dev.js");
      await dev({ root, port: options.port, host: options.hostname });
      return null; // keep running
    }
    case "build": {
      const { build } = await import("./commands/build.js");
      await build({ root });
      return 0;
    }
    case "start": {
      const { start } = await import("./commands/start.js");
      return start({ root, port: options.port, host: options.hostname });
    }
    default:
      process.stderr.write(`vinext: unknown command "${command}"\n\n${HELP}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code !== null && code !== undefined) process.exitCode = code;
  },
  (err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  },
);
