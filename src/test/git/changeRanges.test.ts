import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { GitService } from "../../git/gitService";
import { GitTestRepo } from "./gitTestRepo";

function serviceFor(repo: GitTestRepo): GitService {
  return new GitService({
    workTreeRoot: repo.rootPath,
    gitDir: path.join(repo.rootPath, ".git"),
    commonDir: path.join(repo.rootPath, ".git"),
  });
}

function read(repo: GitTestRepo): Promise<string> {
  return fs.readFile(path.join(repo.rootPath, "r.ts"), "utf8");
}

/**
 * Two changes two lines apart. Git's three lines of context merge them into a
 * single hunk, while a diff viewer draws them as two separate blocks — which
 * is exactly the case where addressing a change by hunk acts on the wrong
 * thing.
 */
async function twoBlocksOneHunk(): Promise<{
  repo: GitTestRepo;
  service: GitService;
}> {
  const repo = await GitTestRepo.create();
  await repo.writeFile(
    "r.ts",
    "a\nb\nc\nd\ne\nf\ng\nh\ni\nmethod\npattern\nkeys\nhandler: H;\n}\n\nexport function make() {\n  return 1;\n}\n",
  );
  await repo.git("add", "r.ts");
  await repo.git("commit", "-m", "seed");
  await repo.writeFile(
    "r.ts",
    "a\nb\nc\nd\ne\nf\ng\nh\ni\nmethod\npattern\nkeys\nhandle: H;\n}\n\n// new one\n// new two\n// new three\nexport function make() {\n  return 1;\n}\n",
  );
  return { repo, service: serviceFor(repo) };
}

describe("change ranges", () => {
  it("puts both changes in one hunk, which is why ranges are needed", async () => {
    const { service } = await twoBlocksOneHunk();
    // The premise of every test below: git reports one hunk for what the
    // viewer draws as two blocks.
    assert.strictEqual((await service.getFileHunks("r.ts")).length, 1);
  });

  it("reverts only the change pointed at, not its neighbour", async () => {
    const { repo, service } = await twoBlocksOneHunk();

    // The modification on new line 13, one line long.
    assert.strictEqual(await service.revertRange("r.ts", 13, 1), true);

    const after = await read(repo);
    // The modification is undone…
    assert.ok(after.includes("handler: H;"), `not reverted:\n${after}`);
    // …and the insertion two lines below it is untouched.
    assert.ok(after.includes("// new one"), `neighbour lost:\n${after}`);
    assert.ok(after.includes("// new three"));
  });

  it("reverts the insertion without restoring the modification", async () => {
    const { repo, service } = await twoBlocksOneHunk();

    // The three inserted lines start at new line 16.
    assert.strictEqual(await service.revertRange("r.ts", 16, 3), true);

    const after = await read(repo);
    assert.ok(!after.includes("// new one"), `not reverted:\n${after}`);
    assert.ok(!after.includes("// new three"));
    // The modification above it stays applied.
    assert.ok(after.includes("handle: H;"), `neighbour lost:\n${after}`);
  });

  it("stages only the change pointed at", async () => {
    const { repo, service } = await twoBlocksOneHunk();

    assert.strictEqual(
      await service.setRangeStaged(
        "r.ts",
        { newStart: 16, newCount: 3, oldStart: 15, oldCount: 0 },
        true,
      ),
      true,
    );

    const staged = await repo.git("show", ":r.ts");
    assert.ok(staged.includes("// new one"), `not staged:\n${staged}`);
    // The modification was not taken along with it.
    assert.ok(staged.includes("handler: H;"), `neighbour staged:\n${staged}`);
    // And the working tree still has both.
    const disk = await read(repo);
    assert.ok(disk.includes("handle: H;") && disk.includes("// new one"));
  });

  it("hands one change back without disturbing the other", async () => {
    const { repo, service } = await twoBlocksOneHunk();
    // Stage everything, then return just the insertion.
    await repo.git("add", "r.ts");

    // Unstaging is addressed from the old side, the only coordinate the
    // HEAD-against-index diff shares with this view: the three new lines go
    // in after HEAD line 15, so they are anchored at 16 there.
    assert.strictEqual(
      await service.setRangeStaged(
        "r.ts",
        { newStart: 16, newCount: 3, oldStart: 16, oldCount: 0 },
        false,
      ),
      true,
    );

    const staged = await repo.git("show", ":r.ts");
    assert.ok(!staged.includes("// new one"), `not unstaged:\n${staged}`);
    // The modification stays staged.
    assert.ok(staged.includes("handle: H;"), `neighbour unstaged:\n${staged}`);
    // Nothing left the working tree.
    const disk = await read(repo);
    assert.ok(disk.includes("// new one") && disk.includes("handle: H;"));
  });

  it("reverts a deletion of the final lines of a file", async () => {
    // A trailing deletion sits in front of a row past the end of the new
    // file, so a range covering no lines still has to select its removals.
    const repo = await GitTestRepo.create();
    await repo.writeFile("r.ts", "one\ntwo\nthree\nfour\n");
    await repo.git("add", "r.ts");
    await repo.git("commit", "-m", "seed");
    await repo.writeFile("r.ts", "one\ntwo\n");
    const service = serviceFor(repo);

    // The deleted block starts at new line 3 and covers none of it.
    assert.strictEqual(await service.revertRange("r.ts", 3, 0), true);
    assert.strictEqual(await read(repo), "one\ntwo\nthree\nfour\n");
  });

  it("reports when a range names no change at all", async () => {
    const { service } = await twoBlocksOneHunk();
    // Line 1 is context on both sides.
    assert.strictEqual(await service.revertRange("r.ts", 1, 1), false);
  });
});
