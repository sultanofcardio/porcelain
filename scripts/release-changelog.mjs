// Turns the Unreleased section of CHANGELOG.md into the section for the
// version being released. Runs from npm's "version" lifecycle, after
// package.json carries the new number and before npm makes the release commit,
// so the renamed changelog rides in that commit.
//   node scripts/release-changelog.mjs          (version from package.json)
//   node scripts/release-changelog.mjs 0.9.0
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const version =
  process.argv[2] ?? JSON.parse(readFileSync(new URL("package.json", root), "utf8")).version;
const changelog = new URL("CHANGELOG.md", root);
const text = readFileSync(changelog, "utf8");

const unreleased = /^## \[Unreleased\][^\n]*$/m;
if (!unreleased.test(text)) {
  console.error(`CHANGELOG.md has no "## [Unreleased]" section to release as ${version}`);
  process.exit(1);
}
if (new RegExp(`^## \\[${version.replaceAll(".", "\\.")}\\]`, "m").test(text)) {
  console.error(`CHANGELOG.md already has a "## [${version}]" section`);
  process.exit(1);
}
const date = new Date().toISOString().slice(0, 10);
writeFileSync(changelog, text.replace(unreleased, `## [${version}] - ${date}`));
execFileSync("git", ["add", "CHANGELOG.md"], { stdio: "inherit" });
console.log(`CHANGELOG.md: Unreleased -> ${version} (${date})`);
