// Argument parsing for the vinext CLI (Next.js-style flags).
export function parseArgs(argv) {
  const options = {};
  let command;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.startsWith("--") && arg.includes("=") ? arg.split(/=(.*)/s) : [arg, undefined];
    const value = () => (inline !== undefined ? inline : argv[++i]);
    switch (flag) {
      case "-p":
      case "--port": {
        const port = Number(value());
        if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`vinext: invalid port`);
        options.port = port;
        break;
      }
      case "-H":
      case "--hostname":
      case "--host":
        options.hostname = value();
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "-v":
      case "--version":
        options.version = true;
        break;
      default:
        if (!command && !arg.startsWith("-")) command = arg;
    }
  }
  if (options.port === undefined && process.env.PORT) options.port = Number(process.env.PORT);
  return { command, options };
}
