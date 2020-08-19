#!/usr/bin/env node

const { mkdirSync, readFileSync, writeFileSync } = require("fs");
const { createInterface } = require("readline");
const { normalize, join } = require("path");
const tempy = require("tempy");

const { downloadFromCkb, queryTipHash, sendToCkb } = require("./src/assembler");

if (process.argv.length !== 4) {
  console.error("Usage: git-remote-ckb remote-name url");
  process.exit(1);
}

const REMOTE_NAME = process.argv[2];
const URL = process.argv[3];
const GIT_DIR = process.env.GIT_DIR;
const REPO_DIR = normalize(join(GIT_DIR, ".."));

const MODE_EMPTY = 0;
const MODE_FETCHING = 1;
const MODE_PUSHING = 2;

const DEFAULT_REMOTE = "refs/heads/master";

require("fs").unlinkSync("./git-remote-ckb-debug.log");
function debugLog(...args) {
  let str = "";
  for (const arg of args) {
    str += require("util").inspect(arg);
    str += " ";
  }
  str += "\n";
  require("fs").appendFileSync("./git-remote-ckb-debug.log", str);
}
function debugLogAndExit(...args) {
  debugLog(...args);
  process.exit(1);
}

(async () => {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  debugLog(REMOTE_NAME, URL, GIT_DIR, REPO_DIR);

  let currentMode = MODE_EMPTY;
  for await (const line of rl) {
    const commands = line.split(" ");
    debugLog("Command:", commands);
    switch (commands[0]) {
      case "capabilities":
        console.log("fetch");
        console.log("push");
        console.log();
        break;
      case "list":
        const tipHash = await queryTipHash(URL);
        if (tipHash) {
          console.log(`${tipHash.substr(2)} ${DEFAULT_REMOTE}`);
          console.log(`@${DEFAULT_REMOTE} HEAD`);
        }
        console.log();
        break;
      case "fetch":
        currentMode = MODE_FETCHING;
        const name = commands[2];
        if (name !== DEFAULT_REMOTE) {
          process.exit(1);
        }
        let localTipHash = null;
        try {
          localTipHash = "0x" + execSync("git rev-parse HEAD").toString("utf8");
        } catch (e) {}
        const bundles = await downloadFromCkb(URL, localTipHash);
        for (const bundle of bundles) {
          const file = tempy.file();
          writeFileSync(file, Buffer.from(bundle.substr(2), "hex"));
          execSync(`git bundle unbundle ${file}`);
        }
        break;
      case "push":
        currentMode = MODE_PUSHING;
        // TODO: support more branches later
        if (commands[1] !== `${DEFAULT_REMOTE}:${DEFAULT_REMOTE}`) {
          process.exit(1);
        }
        const file = tempy.file();
        execSync(`git bundle create ${file} origin/master..master`);
        const data = "0x" + readFileSync(file, "hex");
        const tipHash = "0x" + execSync("git rev-parse HEAD").toString("utf8");
        await sendToCkb(data, tipHash, URL);
        break;
      case "":
        if (currentMode === MODE_FETCHING || currentMode === MODE_PUSHING) {
          console.log();
        }
        break;
      default:
        debugLogAndExit("UNPROCESSED:", line);
    }
  }
})().catch(e => {
  console.error(e);
});
