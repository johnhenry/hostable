#!/usr/bin/env node
/**
 * The `hostable` executable: `serve` and `routes`. See README "Command
 * line" for the contract.
 */
import { readFileSync } from "node:fs";
import { CliError, EXIT, errorFields } from "@johnhenry/servable/cli";
import { hostableReporter, hostableServe, routesCommand } from "./hostable-cli.js";

const USAGE = `Usage: hostable <command> [options]

Commands:
  serve <module>    Serve the compiled gateway a module default-exports
  routes <module>   Print the hostnames, paths and backends it answers

Run "hostable <command> --help" for a command's options.
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "serve") return hostableServe(rest);
  if (command === "routes") return routesCommand(rest);
  if (command === "--version" || command === "-v") {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
    process.stdout.write(`${pkg.version}\n`);
    return EXIT.OK;
  }
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(USAGE);
    return command === undefined ? EXIT.USAGE : EXIT.OK;
  }
  const json = argv.includes("--json");
  if (!json) process.stderr.write(USAGE);
  const fields = errorFields(new CliError("E_USAGE", `unknown command: ${command}`), true);
  await new Promise<void>((done) => hostableReporter(json).final("error", fields, done));
  return EXIT.USAGE;
}

process.exitCode = await main(process.argv.slice(2));
// Exit explicitly: the app may hold timers or sockets open that would
// otherwise keep a stopped server's process alive.
process.exit();
