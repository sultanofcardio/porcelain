// Prints the CHANGELOG.md section for one version, for use as release notes.
//   node scripts/changelog-notes.mjs 0.9.0
import { readFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("usage: node scripts/changelog-notes.mjs <version>");
  process.exit(2);
}

const lines = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8").split("\n");
const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
if (start === -1) {
  console.error(`CHANGELOG.md has no "## [${version}]" section`);
  process.exit(1);
}
const rest = lines.slice(start + 1);
const end = rest.findIndex((line) => line.startsWith("## "));
const body = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
if (!body) {
  console.error(`CHANGELOG.md section for ${version} is empty`);
  process.exit(1);
}
process.stdout.write(`${body}\n`);
