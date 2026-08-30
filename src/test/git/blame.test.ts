import * as assert from "node:assert";
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

async function commitAs(
  repo: GitTestRepo,
  author: string,
  subject: string,
): Promise<string> {
  await repo.git(
    "-c",
    `user.name=${author}`,
    "-c",
    `user.email=${author.split(" ")[0].toLowerCase()}@example.com`,
    "commit",
    "-m",
    subject,
  );
  return (await repo.git("rev-parse", "HEAD")).trim();
}

describe("gitService.blameFile", () => {
  it("attributes each line to the commit that last touched it", async () => {
    const repo = await GitTestRepo.create();
    await repo.writeFile("file.txt", "first line\nsecond line\n");
    await repo.git("add", "file.txt");
    const firstHash = await commitAs(repo, "Ada Lovelace", "add both lines");

    await repo.writeFile("file.txt", "first line\nsecond line edited\n");
    await repo.git("add", "file.txt");
    const secondHash = await commitAs(repo, "Grace Hopper", "edit the second");

    const blame = await serviceFor(repo).blameFile("file.txt");

    assert.strictEqual(blame.length, 2);
    assert.deepStrictEqual(
      blame.map((line) => [line.line, line.hash, line.author]),
      [
        [1, firstHash, "Ada Lovelace"],
        [2, secondHash, "Grace Hopper"],
      ],
    );
    assert.strictEqual(blame[0].content, "first line");
    assert.strictEqual(blame[1].content, "second line edited");
    assert.strictEqual(blame[1].summary, "edit the second");
    assert.strictEqual(blame[0].authorEmail, "ada@example.com");
    assert.ok(blame[0].authorTime > 0);
    assert.strictEqual(blame[0].uncommitted, false);
  });

  it("carries commit details forward to later lines of the same commit", async () => {
    const repo = await GitTestRepo.create();
    // Porcelain output only repeats a commit's headers the first time, so
    // three lines from one commit exercise the carry-forward.
    await repo.writeFile("file.txt", "one\ntwo\nthree\n");
    await repo.git("add", "file.txt");
    await commitAs(repo, "Ada Lovelace", "all three");

    const blame = await serviceFor(repo).blameFile("file.txt");

    assert.strictEqual(blame.length, 3);
    for (const line of blame) {
      assert.strictEqual(line.author, "Ada Lovelace");
      assert.strictEqual(line.summary, "all three");
      assert.ok(line.authorTime > 0, "author time was lost on a later line");
    }
  });

  it("marks a line that is not committed yet", async () => {
    const repo = await GitTestRepo.create();
    await repo.writeFile("file.txt", "committed\n");
    await repo.git("add", "file.txt");
    await commitAs(repo, "Ada Lovelace", "seed");
    await repo.writeFile("file.txt", "committed\nstill being written\n");

    const blame = await serviceFor(repo).blameFile("file.txt");

    assert.strictEqual(blame[0].uncommitted, false);
    assert.strictEqual(blame[1].uncommitted, true);
    assert.strictEqual(blame[1].content, "still being written");
  });

  it("blames the file as of an earlier revision", async () => {
    const repo = await GitTestRepo.create();
    await repo.writeFile("file.txt", "original\n");
    await repo.git("add", "file.txt");
    const first = await commitAs(repo, "Ada Lovelace", "original");
    await repo.writeFile("file.txt", "rewritten\n");
    await repo.git("add", "file.txt");
    await commitAs(repo, "Grace Hopper", "rewrite");

    const blame = await serviceFor(repo).blameFile("file.txt", {
      revision: first,
    });

    assert.strictEqual(blame.length, 1);
    assert.strictEqual(blame[0].content, "original");
    assert.strictEqual(blame[0].author, "Ada Lovelace");
  });

  it("ignores whitespace-only changes when asked", async () => {
    const repo = await GitTestRepo.create();
    await repo.writeFile("file.txt", "value = 1\n");
    await repo.git("add", "file.txt");
    const original = await commitAs(repo, "Ada Lovelace", "original");
    // Reindenting is the classic case where blame otherwise points at the
    // person who reformatted rather than the person who wrote the line.
    await repo.writeFile("file.txt", "    value = 1\n");
    await repo.git("add", "file.txt");
    await commitAs(repo, "Grace Hopper", "reindent");

    const plain = await serviceFor(repo).blameFile("file.txt");
    assert.strictEqual(plain[0].author, "Grace Hopper");

    const ignoring = await serviceFor(repo).blameFile("file.txt", {
      ignoreWhitespace: true,
    });
    assert.strictEqual(ignoring[0].author, "Ada Lovelace");
    assert.strictEqual(ignoring[0].hash, original);
  });
});
