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
): Promise<void> {
  await repo.git(
    "-c",
    `user.name=${author}`,
    "-c",
    "user.email=author@example.com",
    "commit",
    "--allow-empty",
    "-m",
    subject,
  );
}

describe("gitService log search modes", () => {
  let repo: GitTestRepo;
  let service: GitService;

  beforeEach(async () => {
    repo = await GitTestRepo.create();
    await commitAs(repo, "Ada Lovelace", "Fix the parser");
    await commitAs(repo, "Grace Hopper", "add fixture files");
    await commitAs(repo, "Ada Lovelace", "feat: new graph");
    service = serviceFor(repo);
  });

  it("matches literally and case-insensitively by default", async () => {
    // "fix the" must match "Fix the parser" (case folded)…
    const folded = await service.getLog({ search: "fix the" });
    assert.deepStrictEqual(
      folded.map((c) => c.subject),
      ["Fix the parser"],
    );

    // …and a regex metacharacter must not act as one.
    const literalDot = await service.getLog({ search: "f.x" });
    assert.strictEqual(literalDot.length, 0);
  });

  it("honours the match-case toggle", async () => {
    const wrongCase = await service.getLog({
      search: "fix the",
      searchCaseSensitive: true,
    });
    assert.strictEqual(wrongCase.length, 0);

    const rightCase = await service.getLog({
      search: "Fix the",
      searchCaseSensitive: true,
    });
    assert.deepStrictEqual(
      rightCase.map((c) => c.subject),
      ["Fix the parser"],
    );
  });

  it("honours the regex toggle", async () => {
    const commits = await service.getLog({
      search: "f.x",
      searchRegex: true,
    });
    assert.deepStrictEqual(commits.map((c) => c.subject).sort(), [
      "Fix the parser",
      "add fixture files",
    ]);
  });
});

describe("gitService.getLogAuthors", () => {
  it("lists every author across history and the configured identity", async () => {
    const repo = await GitTestRepo.create();
    await commitAs(repo, "Ada Lovelace", "one");
    await commitAs(repo, "Grace Hopper", "two");
    await commitAs(repo, "Ada Lovelace", "three");
    const service = serviceFor(repo);

    const { authors, me } = await service.getLogAuthors();
    assert.deepStrictEqual([...authors].sort(), [
      "Ada Lovelace",
      "Grace Hopper",
    ]);
    // Ada has more commits, so shortlog orders her first.
    assert.strictEqual(authors[0], "Ada Lovelace");
    assert.strictEqual(me, "Porcelain Test");
  });
});

describe("gitService.getContainingBranches", () => {
  it("separates local and remote branches and skips the remote HEAD", async () => {
    const repo = await GitTestRepo.create();
    await commitAs(repo, "Ada Lovelace", "base");
    const baseHash = (await repo.git("rev-parse", "HEAD")).trim();
    await repo.git("branch", "feature");
    await commitAs(repo, "Ada Lovelace", "main only");
    const tipHash = (await repo.git("rev-parse", "HEAD")).trim();
    await repo.git("update-ref", "refs/remotes/origin/main", tipHash);
    await repo.git(
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/main",
    );
    const service = serviceFor(repo);

    const base = await service.getContainingBranches(baseHash);
    assert.deepStrictEqual(base.local.sort(), ["feature", "main"]);
    assert.deepStrictEqual(base.remote, ["origin/main"]);

    const tip = await service.getContainingBranches(tipHash);
    assert.deepStrictEqual(tip.local, ["main"]);
    assert.deepStrictEqual(tip.remote, ["origin/main"]);
  });
});
