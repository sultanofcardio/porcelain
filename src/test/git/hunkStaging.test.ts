import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { buildPartialPatch, parseUnifiedDiff } from "../../git/commit/hunks";
import { GitService } from "../../git/gitService";
import { GitTestRepo } from "./gitTestRepo";

function serviceFor(repo: GitTestRepo): GitService {
  return new GitService({
    workTreeRoot: repo.rootPath,
    gitDir: path.join(repo.rootPath, ".git"),
    commonDir: path.join(repo.rootPath, ".git"),
  });
}

/** Ten numbered lines — far enough apart to make separate hunks. */
function numberedLines(count = 10): string {
  return `${Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n")}\n`;
}

async function seedFile(repo: GitTestRepo): Promise<void> {
  await repo.writeFile("file.txt", numberedLines());
  await repo.git("add", "file.txt");
  await repo.git("commit", "-m", "seed");
}

describe("unified diff parsing", () => {
  const diff = [
    "diff --git a/file.txt b/file.txt",
    "index 1111111..2222222 100644",
    "--- a/file.txt",
    "+++ b/file.txt",
    "@@ -1,3 +1,4 @@",
    " line 1",
    "+added near the top",
    " line 2",
    " line 3",
    "@@ -8,3 +9,3 @@",
    " line 8",
    "-line 9",
    "+line nine",
    " line 10",
    "",
  ].join("\n");

  it("splits the header from the hunks and reads their ranges", () => {
    const parsed = parseUnifiedDiff(diff);
    assert.strictEqual(parsed.fileHeader.length, 4);
    assert.strictEqual(parsed.hunks.length, 2);
    assert.deepStrictEqual(
      parsed.hunks.map((hunk) => [
        hunk.oldStart,
        hunk.oldCount,
        hunk.newStart,
        hunk.newCount,
      ]),
      [
        [1, 3, 1, 4],
        [8, 3, 9, 3],
      ],
    );
    assert.strictEqual(parsed.hunks[0].index, 0);
  });

  it("renumbers later hunks when an earlier one is left out", () => {
    const parsed = parseUnifiedDiff(diff);
    // Taking only the second hunk means the first hunk's added line is not
    // there, so the second hunk starts one line earlier than in the full diff.
    const patch = buildPartialPatch(parsed, [1]);
    assert.ok(patch);
    assert.ok(
      patch.includes("@@ -8,3 +8,3 @@"),
      `second hunk was not renumbered:\n${patch}`,
    );
    assert.ok(!patch.includes("added near the top"));
    // The file header rides along so git knows what is being patched.
    assert.ok(patch.startsWith("diff --git a/file.txt b/file.txt"));
  });

  it("keeps the original numbering when the first hunk is kept", () => {
    const patch = buildPartialPatch(parseUnifiedDiff(diff), [0]);
    assert.ok(patch?.includes("@@ -1,3 +1,4 @@"));
    assert.ok(!patch?.includes("line nine"));
  });

  it("returns null when nothing is selected", () => {
    assert.strictEqual(buildPartialPatch(parseUnifiedDiff(diff), []), null);
  });
});

describe("gitService hunk staging", () => {
  let repo: GitTestRepo;
  let service: GitService;

  beforeEach(async () => {
    repo = await GitTestRepo.create();
    await seedFile(repo);
    service = serviceFor(repo);
    // Two edits far enough apart that git reports them as separate hunks.
    const lines = numberedLines().split("\n");
    lines[0] = "line 1 edited";
    lines[9] = "line 10 edited";
    await repo.writeFile("file.txt", lines.join("\n"));
  });

  it("reports one hunk per separated edit", async () => {
    const hunks = await service.getFileHunks("file.txt");
    assert.strictEqual(hunks.length, 2);
    assert.ok(hunks[0].lines.some((line) => line === "+line 1 edited"));
    assert.ok(hunks[1].lines.some((line) => line === "+line 10 edited"));
  });

  it("stages only the chosen hunk, leaving the other unstaged", async () => {
    await service.stageHunks("file.txt", [0]);

    const staged = await repo.git("diff", "--cached");
    assert.ok(staged.includes("line 1 edited"));
    assert.ok(
      !staged.includes("line 10 edited"),
      "the unselected hunk was staged too",
    );

    // The working tree still holds both edits.
    const onDisk = await fs.readFile(
      path.join(repo.rootPath, "file.txt"),
      "utf8",
    );
    assert.ok(onDisk.includes("line 1 edited"));
    assert.ok(onDisk.includes("line 10 edited"));

    // And the second edit is still pending.
    const unstaged = await repo.git("diff");
    assert.ok(unstaged.includes("line 10 edited"));
  });

  it("stages a later hunk correctly despite the earlier one being skipped", async () => {
    // This is the renumbering case: staging hunk 1 alone must still apply.
    await service.stageHunks("file.txt", [1]);

    const staged = await repo.git("diff", "--cached");
    assert.ok(staged.includes("line 10 edited"));
    assert.ok(!staged.includes("line 1 edited"));
  });

  it("stages every hunk when all are chosen", async () => {
    await service.stageHunks("file.txt", [0, 1]);

    const staged = await repo.git("diff", "--cached");
    assert.ok(staged.includes("line 1 edited"));
    assert.ok(staged.includes("line 10 edited"));
    assert.strictEqual((await repo.git("diff")).trim(), "");
  });

  it("unstages a chosen hunk without losing the working-tree edit", async () => {
    await service.stageHunks("file.txt", [0, 1]);
    const stagedHunks = await service.getFileHunks("file.txt", true);
    assert.strictEqual(stagedHunks.length, 2);

    await service.unstageHunks("file.txt", [0]);

    const staged = await repo.git("diff", "--cached");
    assert.ok(!staged.includes("line 1 edited"), "hunk was not unstaged");
    assert.ok(staged.includes("line 10 edited"));
    // Nothing left the working tree.
    const onDisk = await fs.readFile(
      path.join(repo.rootPath, "file.txt"),
      "utf8",
    );
    assert.ok(onDisk.includes("line 1 edited"));
    assert.ok(onDisk.includes("line 10 edited"));
  });

  it("stages the hunk covering a given line, addressed by position", async () => {
    // Line 10 sits in the second hunk; line 1 in the first.
    assert.strictEqual(await service.stageHunkAtLine("file.txt", 10), true);

    const staged = await repo.git("diff", "--cached");
    assert.ok(staged.includes("line 10 edited"));
    assert.ok(!staged.includes("line 1 edited"));
  });

  it("reports when no hunk covers the line", async () => {
    // Line 5 is untouched context, in neither hunk.
    assert.strictEqual(await service.stageHunkAtLine("file.txt", 5), false);
    assert.strictEqual((await repo.git("diff", "--cached")).trim(), "");
  });

  it("unstages the hunk covering a line", async () => {
    await service.stageHunks("file.txt", [0, 1]);
    assert.strictEqual(
      await service.stageHunkAtLine("file.txt", 1, { unstage: true }),
      true,
    );

    const staged = await repo.git("diff", "--cached");
    assert.ok(!staged.includes("line 1 edited"));
    assert.ok(staged.includes("line 10 edited"));
  });

  it("reverts the hunk covering a line, rewriting the working tree", async () => {
    const before = await fs.readFile(
      path.join(repo.rootPath, "file.txt"),
      "utf8",
    );
    assert.ok(before.includes("line 1 edited"));

    assert.strictEqual(await service.revertHunkAtLine("file.txt", 1), true);

    const after = await fs.readFile(
      path.join(repo.rootPath, "file.txt"),
      "utf8",
    );
    // The reverted edit is gone from disk; the other one is untouched.
    assert.ok(!after.includes("line 1 edited"));
    assert.ok(after.includes("line 1"));
    assert.ok(after.includes("line 10 edited"));
  });

  it("leaves the file alone when no hunk covers the line", async () => {
    const before = await fs.readFile(
      path.join(repo.rootPath, "file.txt"),
      "utf8",
    );
    assert.strictEqual(await service.revertHunkAtLine("file.txt", 5), false);
    assert.strictEqual(
      await fs.readFile(path.join(repo.rootPath, "file.txt"), "utf8"),
      before,
    );
  });

  it("does nothing when no hunks are selected", async () => {
    await service.stageHunks("file.txt", []);
    assert.strictEqual((await repo.git("diff", "--cached")).trim(), "");
  });
});

describe("gitService commit-time options", () => {
  it("adds a sign-off trailer", async () => {
    const repo = await GitTestRepo.create();
    await seedFile(repo);
    const service = serviceFor(repo);
    await repo.writeFile("file.txt", "changed\n");
    await repo.git("add", "file.txt");

    await service.commit("with a sign-off", false, { signOff: true });

    const body = await repo.git("log", "-1", "--format=%B");
    assert.ok(
      body.includes("Signed-off-by: Porcelain Test <porcelain@example.com>"),
      `missing trailer:\n${body}`,
    );
  });

  it("commits under an overridden author", async () => {
    const repo = await GitTestRepo.create();
    await seedFile(repo);
    const service = serviceFor(repo);
    await repo.writeFile("file.txt", "changed\n");
    await repo.git("add", "file.txt");

    await service.commit("by someone else", false, {
      author: "Ada Lovelace <ada@example.com>",
    });

    assert.strictEqual(
      (await repo.git("log", "-1", "--format=%an <%ae>")).trim(),
      "Ada Lovelace <ada@example.com>",
    );
    // The committer stays the configured identity.
    assert.strictEqual(
      (await repo.git("log", "-1", "--format=%cn")).trim(),
      "Porcelain Test",
    );
  });

  it("rejects an option-shaped author before it reaches git", async () => {
    const repo = await GitTestRepo.create();
    await seedFile(repo);
    const service = serviceFor(repo);

    await assert.rejects(
      () => service.commit("nope", false, { author: "--exec=evil" }),
      /Invalid commit author/,
    );
  });
});

describe("gitService template, ignore, and stash options", () => {
  it("reads the configured commit template", async () => {
    const repo = await GitTestRepo.create();
    await seedFile(repo);
    await repo.writeFile(".gitmessage", "Subject\n\nWhy:\n");
    await repo.git("config", "commit.template", ".gitmessage");
    const service = serviceFor(repo);

    assert.strictEqual(await service.getCommitTemplate(), "Subject\n\nWhy:\n");
  });

  it("returns null when no template is configured", async () => {
    const repo = await GitTestRepo.create();
    await seedFile(repo);
    assert.strictEqual(await serviceFor(repo).getCommitTemplate(), null);
  });

  it("appends to .gitignore without duplicating an existing entry", async () => {
    const repo = await GitTestRepo.create();
    await seedFile(repo);
    const service = serviceFor(repo);

    await service.addToGitignore("build/");
    await service.addToGitignore("build/");
    await service.addToGitignore("dist/");

    const contents = await fs.readFile(
      path.join(repo.rootPath, ".gitignore"),
      "utf8",
    );
    assert.deepStrictEqual(contents.split("\n").filter(Boolean), [
      "build/",
      "dist/",
    ]);
  });

  it("keeps the index when stashing with keep-index", async () => {
    const repo = await GitTestRepo.create();
    await seedFile(repo);
    const service = serviceFor(repo);
    await repo.writeFile("file.txt", "staged change\n");
    await repo.git("add", "file.txt");
    await repo.writeFile("other.txt", "untracked\n");

    await service.stashWithOptions({
      message: "keeping the index",
      keepIndex: true,
      includeUntracked: true,
    });

    assert.ok((await repo.git("stash", "list")).includes("keeping the index"));
    // --keep-index leaves the staged change in place.
    assert.ok((await repo.git("diff", "--cached")).includes("staged change"));
  });

  it("turns a stash into a branch", async () => {
    const repo = await GitTestRepo.create();
    await seedFile(repo);
    const service = serviceFor(repo);
    await repo.writeFile("file.txt", "work in progress\n");
    await service.stashWithOptions({ message: "wip" });

    await service.stashToBranch("stash@{0}", "from-stash");

    assert.strictEqual(
      (await repo.git("rev-parse", "--abbrev-ref", "HEAD")).trim(),
      "from-stash",
    );
    const onDisk = await fs.readFile(
      path.join(repo.rootPath, "file.txt"),
      "utf8",
    );
    assert.strictEqual(onDisk, "work in progress\n");
  });

  it("rejects a stash reference that is not a stash", async () => {
    const repo = await GitTestRepo.create();
    await seedFile(repo);
    await assert.rejects(
      () => serviceFor(repo).stashToBranch("HEAD", "nope"),
      /Invalid stash reference/,
    );
  });
});
