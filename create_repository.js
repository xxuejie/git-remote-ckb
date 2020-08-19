#!/usr/bin/env node

const { createRepository } = require("./src/assembler");

if (process.argv.length !== 3) {
  console.error("Usage: git-remote-ckb address");
  process.exit(1);
}
const ADDRESS = process.argv[2];

(async () => {
  const { remoteUrl } = await createRepository(ADDRESS);
  console.log(remoteUrl);
})().catch((e) => {
  console.error(e);
});
