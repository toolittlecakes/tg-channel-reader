#!/usr/bin/env node
import { main } from "../node-src/cli.js";

main(process.argv.slice(2)).catch((error) => {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
});
