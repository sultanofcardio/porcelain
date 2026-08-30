import * as assert from "node:assert";
import * as path from "node:path";
import { GitService } from "../../git/gitService";
import {
  collectEditorMessages,
  type RebaseTodoEntry,
  renderRebaseTodo,
} from "../../git/rebase/interactiveRebase";
import { GitTestRepo } from "./gitTestRepo";

function serviceFor(repo: GitTestRepo): GitService {
  return new GitService({
    workTreeRoot: repo.rootPath,
    gitDir: path.join(repo.rootPath, ".git"),
    commonDir: path.join(repo.rootPath, ".git"),
  });
}

async function commitFile(
  repo: GitTestRepo,
  file: string,
  content: string,
  subject: string,
): Promise<string> {
  await repo.writeFile(file, content);
  await repo.git("add", file);
  await repo.git("commit", "-m", subject);
  return (await repo.git("rev-parse", "HEAD")).trim();
}

function subjects(log: string): string[] {
  return log.split("\n").filter(Boolean);
}

describe("rebase todo rendering", () => {
  const entries: RebaseTodoEntry[] = [
    { action: "pick", hash: "aaa", subject: "first" },
    { action: "reword", hash: "bbb", subject: "second", message: "renamed" },
    { action: "drop", hash: "ccc", subject: "third" },
  ];

  it("writes one line per entry in git's own grammar", () => {
    assert.strictEqual(
      renderRebaseTodo(entries),
      "pick aaa first\nreword bbb second\ndrop ccc third\n",
    );
  });

  it("queues one message per prompt git will actually raise", () => {
    // A reword prompts for itself.
    assert.deepStrictEqual(collectEditorMessages(entries), ["renamed"]);

    // A squash run prompts once, when the group closes.
    const squashRun: RebaseTodoEntry[] = [
      { action: "pick", hash: "a", subject: "base" },
      { action: "squash", hash: "b", subject: "one" },
      { action: "squash", hash: "c", subject: "two", message: "combined" },
      { action: "pick", hash: "d", subject: "after" },
    ];
    assert.deepStrictEqual(collectEditorMessages(squashRun), ["combined"]);

    // fixup never prompts, so a group ending in fixup still asks once.
    const withFixup: RebaseTodoEntry[] = [
      { action: "pick", hash: "a", subject: "base" },
      { action: "squash", hash: "b", subject: "one", message: "combined" },
      { action: "fixup", hash: "c", subject: "two" },
    ];
    assert.deepStrictEqual(collectEditorMessages(withFixup), ["combined"]);
  });
});

describe("gitService.runInteractiveRebase", () => {
  let repo: GitTestRepo;
  let service: GitService;
  let first: string;
  let second: string;
  let third: string;

  beforeEach(async () => {
    repo = await GitTestRepo.create();
    first = await commitFile(repo, "a.txt", "a\n", "first");
    second = await commitFile(repo, "b.txt", "b\n", "second");
    third = await commitFile(repo, "c.txt", "c\n", "third");
    service = serviceFor(repo);
  });

  it("lists the commits a rebase from a point would rewrite, oldest first", async () => {
    const commits = await service.getRebaseTodoCommits(second);
    assert.deepStrictEqual(
      commits.map((commit) => commit.subject),
      ["second", "third"],
    );
  });

  it("drops a commit without touching the others", async () => {
    const commits = await service.getRebaseTodoCommits(second);
    await service.runInteractiveRebase(
      second,
      commits.map((commit) => ({
        action: commit.subject === "second" ? "drop" : "pick",
        hash: commit.hash,
        subject: commit.subject,
      })),
    );

    assert.deepStrictEqual(subjects(await repo.git("log", "--format=%s")), [
      "third",
      "first",
    ]);
    // The dropped commit's file is gone; the kept one's survives.
    assert.ok(!(await repo.git("ls-files")).includes("b.txt"));
    assert.ok((await repo.git("ls-files")).includes("c.txt"));
  });

  it("reorders commits", async () => {
    const commits = await service.getRebaseTodoCommits(second);
    const reversed = [...commits].reverse();
    await service.runInteractiveRebase(
      second,
      reversed.map((commit) => ({
        action: "pick" as const,
        hash: commit.hash,
        subject: commit.subject,
      })),
    );

    assert.deepStrictEqual(subjects(await repo.git("log", "--format=%s")), [
      "second",
      "third",
      "first",
    ]);
  });

  it("refuses a plan that opens with squash", async () => {
    await assert.rejects(
      () =>
        service.runInteractiveRebase(second, [
          { action: "squash", hash: second, subject: "second" },
          { action: "pick", hash: third, subject: "third" },
        ]),
      /cannot be squashed or fixed up/,
    );
    // Nothing was rewritten.
    assert.strictEqual((await repo.git("rev-parse", "HEAD")).trim(), third);
  });
});

describe("gitService.rewordCommit", () => {
  it("amends when the target is HEAD", async () => {
    const repo = await GitTestRepo.create();
    await commitFile(repo, "a.txt", "a\n", "first");
    const head = await commitFile(repo, "b.txt", "b\n", "second");
    const service = serviceFor(repo);

    await service.rewordCommit(head, "second, reworded");

    assert.deepStrictEqual(subjects(await repo.git("log", "--format=%s")), [
      "second, reworded",
      "first",
    ]);
  });

  it("rewrites an older commit's message and keeps the rest", async () => {
    const repo = await GitTestRepo.create();
    await commitFile(repo, "a.txt", "a\n", "first");
    const middle = await commitFile(repo, "b.txt", "b\n", "second");
    await commitFile(repo, "c.txt", "c\n", "third");
    const service = serviceFor(repo);

    await service.rewordCommit(middle, "second, reworded");

    assert.deepStrictEqual(subjects(await repo.git("log", "--format=%s")), [
      "third",
      "second, reworded",
      "first",
    ]);
    // Every file survives the rewrite.
    const files = await repo.git("ls-files");
    for (const file of ["a.txt", "b.txt", "c.txt"]) {
      assert.ok(files.includes(file), `${file} was lost`);
    }
  });
});

describe("gitService.squashCommits", () => {
  it("folds a selection into one commit under the given message", async () => {
    const repo = await GitTestRepo.create();
    await commitFile(repo, "a.txt", "a\n", "first");
    const second = await commitFile(repo, "b.txt", "b\n", "second");
    const third = await commitFile(repo, "c.txt", "c\n", "third");
    const service = serviceFor(repo);

    // Passed newest-first, as the log selection arrives.
    await service.squashCommits([third, second], "second and third");

    assert.deepStrictEqual(subjects(await repo.git("log", "--format=%s")), [
      "second and third",
      "first",
    ]);
    const files = await repo.git("ls-files");
    assert.ok(files.includes("b.txt") && files.includes("c.txt"));
  });

  it("refuses a single commit", async () => {
    const repo = await GitTestRepo.create();
    const only = await commitFile(repo, "a.txt", "a\n", "first");
    const service = serviceFor(repo);

    await assert.rejects(
      () => service.squashCommits([only], "nope"),
      /at least two commits/,
    );
  });
});

describe("gitService fixup and undo", () => {
  it("commits a fixup! that autosquash folds into its target", async () => {
    const repo = await GitTestRepo.create();
    // The fixup target needs a parent to rebase onto.
    await commitFile(repo, "base.txt", "base\n", "base");
    const target = await commitFile(repo, "a.txt", "a\n", "target");
    await commitFile(repo, "b.txt", "b\n", "later");
    const service = serviceFor(repo);

    await repo.writeFile("a.txt", "a fixed\n");
    await service.commitFixup(target, "fixup");

    const log = subjects(await repo.git("log", "--format=%s"));
    assert.ok(log[0].startsWith("fixup!"), `unexpected head: ${log[0]}`);

    // The whole point of a fixup! is that autosquash absorbs it.
    const base = (await repo.git("rev-parse", `${target}^`)).trim();
    await service.rebase(base, { interactive: true, autosquash: true });
    assert.deepStrictEqual(subjects(await repo.git("log", "--format=%s")), [
      "later",
      "target",
      "base",
    ]);
  });

  it("undoes the last commit, keeping its changes staged", async () => {
    const repo = await GitTestRepo.create();
    await commitFile(repo, "a.txt", "a\n", "first");
    await commitFile(repo, "b.txt", "b\n", "second");
    const service = serviceFor(repo);

    await service.undoLastCommit();

    assert.deepStrictEqual(subjects(await repo.git("log", "--format=%s")), [
      "first",
    ]);
    // The work is not lost — it is staged, ready to re-commit.
    assert.ok(
      (await repo.git("diff", "--cached", "--name-only")).includes("b.txt"),
    );
  });
});

describe("gitService.merge and pull options", () => {
  it("passes merge options through to git", async () => {
    const repo = await GitTestRepo.create();
    await commitFile(repo, "a.txt", "a\n", "base");
    await repo.git("checkout", "-b", "feature");
    await commitFile(repo, "b.txt", "b\n", "feature work");
    await repo.git("checkout", "main");
    const service = serviceFor(repo);

    // --no-ff forces a merge commit where a fast-forward was possible.
    await service.merge("feature", { noFf: true, message: "merged feature" });

    const log = subjects(await repo.git("log", "--format=%s"));
    assert.strictEqual(log[0], "merged feature");
    assert.strictEqual(
      (await repo.git("rev-list", "--count", "--merges", "HEAD")).trim(),
      "1",
    );
  });

  it("stages a squash merge without committing it", async () => {
    const repo = await GitTestRepo.create();
    await commitFile(repo, "a.txt", "a\n", "base");
    await repo.git("checkout", "-b", "feature");
    await commitFile(repo, "b.txt", "b\n", "feature work");
    await repo.git("checkout", "main");
    const service = serviceFor(repo);

    await service.merge("feature", { squash: true });

    // Squash leaves the change staged and HEAD where it was.
    assert.deepStrictEqual(subjects(await repo.git("log", "--format=%s")), [
      "base",
    ]);
    assert.ok(
      (await repo.git("diff", "--cached", "--name-only")).includes("b.txt"),
    );
  });
});
