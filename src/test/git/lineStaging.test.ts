import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { buildLinePatch, parseUnifiedDiff } from "../../git/commit/hunks";
import { GitService } from "../../git/gitService";
import { GitTestRepo } from "./gitTestRepo";

function serviceFor(repo: GitTestRepo): GitService {
  return new GitService({
    workTreeRoot: repo.rootPath,
    gitDir: path.join(repo.rootPath, ".git"),
    commonDir: path.join(repo.rootPath, ".git"),
  });
}

describe("buildLinePatch", () => {
  // One hunk replacing two lines with two others.
  const diff = [
    "diff --git a/f.txt b/f.txt",
    "index 1111111..2222222 100644",
    "--- a/f.txt",
    "+++ b/f.txt",
    "@@ -1,4 +1,4 @@",
    " keep",
    "-old one",
    "-old two",
    "+new one",
    "+new two",
    " tail",
    "",
  ].join("\n");

  it("keeps an excluded removal as context rather than dropping it", () => {
    const parsed = parseUnifiedDiff(diff);
    // Take only the first removal and the first addition; positions are
    // indices into the hunk body: 0=' keep', 1='-old one', 2='-old two',
    // 3='+new one', 4='+new two', 5=' tail'.
    const patch = buildLinePatch(parsed, new Map([[0, new Set([1, 3])]]));
    assert.ok(patch);

    const body = patch.split("\n");
    // The excluded removal survives as a context line — dropping it instead
    // would silently delete the line from the file.
    assert.ok(body.includes(" old two"), `"old two" was lost:\n${patch}`);
    assert.ok(body.includes("-old one"));
    assert.ok(body.includes("+new one"));
    // The excluded addition simply is not there.
    assert.ok(!body.includes("+new two"));
  });

  it("recomputes the counts for what it actually applies", () => {
    const parsed = parseUnifiedDiff(diff);
    const patch = buildLinePatch(parsed, new Map([[0, new Set([1, 3])]]));
    // old side: keep, -old one, old two(context), tail = 4
    // new side: keep, +new one, old two(context), tail = 4
    assert.ok(patch?.includes("@@ -1,4 +1,4 @@"), `bad header:\n${patch}`);
  });

  it("returns null when the selection changes nothing", () => {
    const parsed = parseUnifiedDiff(diff);
    assert.strictEqual(buildLinePatch(parsed, new Map()), null);
    // Selecting only context lines leaves the file identical.
    assert.strictEqual(
      buildLinePatch(parsed, new Map([[0, new Set([0, 5])]])),
      null,
    );
  });
});

describe("gitService.stageLines", () => {
  async function seeded(): Promise<{ repo: GitTestRepo; service: GitService }> {
    const repo = await GitTestRepo.create();
    await repo.writeFile("f.txt", "keep\nold one\nold two\ntail\n");
    await repo.git("add", "f.txt");
    await repo.git("commit", "-m", "seed");
    await repo.writeFile("f.txt", "keep\nnew one\nnew two\ntail\n");
    return { repo, service: serviceFor(repo) };
  }

  it("stages only the chosen lines of a hunk", async () => {
    const { repo, service } = await seeded();
    const hunks = await service.getFileHunks("f.txt");
    assert.strictEqual(hunks.length, 1);

    // Take the first replacement only: -old one / +new one.
    const body = hunks[0].lines;
    const removeOne = body.findIndex((line) => line === "-old one");
    const addOne = body.findIndex((line) => line === "+new one");
    assert.ok(removeOne >= 0 && addOne >= 0);

    const staged = await service.stageLines(
      "f.txt",
      new Map([[0, new Set([removeOne, addOne])]]),
    );
    assert.strictEqual(staged, true);

    const cached = await repo.git("diff", "--cached");
    assert.ok(cached.includes("+new one"));
    // The line we did not take is untouched in the index…
    assert.ok(!cached.includes("+new two"));
    assert.ok(!cached.includes("-old two"));

    // …and nothing left the working tree.
    assert.strictEqual(
      await fs.readFile(path.join(repo.rootPath, "f.txt"), "utf8"),
      "keep\nnew one\nnew two\ntail\n",
    );

    // The staged content is exactly the half-applied file.
    const stagedFile = await repo.git("show", ":f.txt");
    assert.strictEqual(stagedFile, "keep\nnew one\nold two\ntail\n");
  });

  it("keeps the file's order when the excluded removal comes first", async () => {
    // The mirror of the case above: taking the *second* replacement must
    // leave "old one" ahead of the new line, not behind it.
    const { repo, service } = await seeded();
    const hunks = await service.getFileHunks("f.txt");
    const body = hunks[0].lines;
    const removeTwo = body.findIndex((line) => line === "-old two");
    const addTwo = body.findIndex((line) => line === "+new two");

    await service.stageLines(
      "f.txt",
      new Map([[0, new Set([removeTwo, addTwo])]]),
    );

    assert.strictEqual(
      await repo.git("show", ":f.txt"),
      "keep\nold one\nnew two\ntail\n",
    );
  });

  it("stages an addition without any removal", async () => {
    const repo = await GitTestRepo.create();
    await repo.writeFile("f.txt", "one\ntwo\n");
    await repo.git("add", "f.txt");
    await repo.git("commit", "-m", "seed");
    await repo.writeFile("f.txt", "one\ninserted\ntwo\n");
    const service = serviceFor(repo);

    const hunks = await service.getFileHunks("f.txt");
    const added = hunks[0].lines.findIndex((line) => line === "+inserted");
    await service.stageLines("f.txt", new Map([[0, new Set([added])]]));

    assert.strictEqual(
      await repo.git("show", ":f.txt"),
      "one\ninserted\ntwo\n",
    );
  });

  it("reports when a selection applies nothing", async () => {
    const { service } = await seeded();
    assert.strictEqual(await service.stageLines("f.txt", new Map()), false);
  });
});
