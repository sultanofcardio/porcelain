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

describe("gitService log graph modes and paths", () => {
  let repo: GitTestRepo;
  let service: GitService;

  beforeEach(async () => {
    repo = await GitTestRepo.create();
    await repo.writeFile("main.txt", "main\n");
    await repo.git("add", "main.txt");
    await commitAs(repo, "Ada Lovelace", "base");
    await repo.git("checkout", "-b", "feature");
    await repo.writeFile("feature.txt", "feature\n");
    await repo.git("add", "feature.txt");
    await commitAs(repo, "Ada Lovelace", "feature work");
    await repo.git("checkout", "main");
    await repo.writeFile("main.txt", "main again\n");
    await repo.git("add", "main.txt");
    await commitAs(repo, "Ada Lovelace", "main work");
    await repo.git("merge", "--no-ff", "-m", "merge feature", "feature");
    service = serviceFor(repo);
  });

  it("excludes merge commits with noMerges", async () => {
    const commits = await service.getLog({ noMerges: true });
    assert.ok(!commits.some((c) => c.subject === "merge feature"));
    assert.ok(commits.some((c) => c.subject === "feature work"));
  });

  it("follows only the first parent with firstParent", async () => {
    // The unfiltered log walks --all, where the feature tip is still a head;
    // scope to main so first-parent traversal is what hides the side branch.
    const full = await service.getLog({ branch: "main" });
    assert.ok(full.some((c) => c.subject === "feature work"));

    const commits = await service.getLog({
      branch: "main",
      firstParent: true,
    });
    assert.ok(commits.some((c) => c.subject === "merge feature"));
    assert.ok(!commits.some((c) => c.subject === "feature work"));
  });

  it("returns the same commits under topological order", async () => {
    const byDate = await service.getLog({});
    const topo = await service.getLog({ sortTopo: true });
    assert.deepStrictEqual(
      topo.map((c) => c.subject).sort(),
      byDate.map((c) => c.subject).sort(),
    );
  });

  it("narrows the log to the given pathspecs", async () => {
    const commits = await service.getLog({ paths: ["feature.txt"] });
    assert.deepStrictEqual(
      commits.map((c) => c.subject),
      ["feature work"],
    );
  });

  it("parses the committer timestamp", async () => {
    const [head] = await service.getLog({ maxCount: 1 });
    assert.ok(head.committerDate);
    assert.ok(!Number.isNaN(new Date(head.committerDate).getTime()));
  });
});

describe("gitService.resolveRevisionInput", () => {
  it("resolves abbreviated hashes, branch names, and tag names", async () => {
    const repo = await GitTestRepo.create();
    await commitAs(repo, "Ada Lovelace", "one");
    const hash = (await repo.git("rev-parse", "HEAD")).trim();
    await repo.git("tag", "v1");
    await repo.git("branch", "topic");
    const service = serviceFor(repo);

    assert.strictEqual(await service.resolveRevisionInput(hash), hash);
    assert.strictEqual(
      await service.resolveRevisionInput(hash.slice(0, 7)),
      hash,
    );
    assert.strictEqual(await service.resolveRevisionInput("topic"), hash);
    assert.strictEqual(await service.resolveRevisionInput("v1"), hash);
    assert.strictEqual(await service.resolveRevisionInput("no-such-ref"), null);
    assert.strictEqual(await service.resolveRevisionInput("  "), null);
  });
});

describe("gitService.getUserIdentity", () => {
  it("returns the configured name and email", async () => {
    const repo = await GitTestRepo.create();
    const service = serviceFor(repo);
    assert.deepStrictEqual(await service.getUserIdentity(), {
      name: "Porcelain Test",
      email: "porcelain@example.com",
    });
  });
});

describe("gitService.cherryPick", () => {
  it("applies a multi-commit selection oldest-first", async () => {
    const repo = await GitTestRepo.create();
    await repo.writeFile("a.txt", "base\n");
    await repo.git("add", "a.txt");
    await commitAs(repo, "Ada Lovelace", "base");
    await repo.git("checkout", "-b", "feature");
    await repo.writeFile("b.txt", "one\n");
    await repo.git("add", "b.txt");
    await commitAs(repo, "Ada Lovelace", "pick one");
    const first = (await repo.git("rev-parse", "HEAD")).trim();
    await repo.writeFile("c.txt", "two\n");
    await repo.git("add", "c.txt");
    await commitAs(repo, "Ada Lovelace", "pick two");
    const second = (await repo.git("rev-parse", "HEAD")).trim();
    await repo.git("checkout", "main");
    const service = serviceFor(repo);

    await service.cherryPick([first, second]);

    const subjects = (await repo.git("log", "--format=%s", "-3")).split("\n");
    assert.deepStrictEqual(subjects.slice(0, 2), ["pick two", "pick one"]);
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
