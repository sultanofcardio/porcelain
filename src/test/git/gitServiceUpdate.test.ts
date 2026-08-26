import * as assert from "node:assert";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { PorcelainError, PorcelainErrorCode } from "../../git/errors";
import { GitService } from "../../git/gitService";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout.trim();
}

async function configureIdentity(repo: string): Promise<void> {
  await git(repo, "config", "user.name", "Porcelain Test");
  await git(repo, "config", "user.email", "porcelain@example.com");
}

async function createTrackedRepository(): Promise<{
  base: string;
  repo: string;
  upstream: string;
}> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "porcelain-update-"));
  const repo = path.join(base, "repo");
  const upstream = path.join(base, "upstream.git");
  const origin = path.join(base, "origin.git");

  await git(base, "init", "--bare", upstream);
  await git(base, "init", "--bare", origin);
  await git(base, "init", "-b", "main", repo);
  await configureIdentity(repo);
  await fs.writeFile(path.join(repo, "README.md"), "initial\n");
  await git(repo, "add", "README.md");
  await git(repo, "commit", "-m", "initial");
  await git(repo, "remote", "add", "upstream", upstream);
  await git(repo, "remote", "add", "origin", origin);
  await git(repo, "push", "-u", "upstream", "main");
  await git(repo, "push", "origin", "main");
  await git(
    base,
    "--git-dir",
    upstream,
    "symbolic-ref",
    "HEAD",
    "refs/heads/main",
  );

  return { base, repo, upstream };
}

function serviceFor(repo: string): GitService {
  return new GitService({
    workTreeRoot: repo,
    gitDir: path.join(repo, ".git"),
    commonDir: path.join(repo, ".git"),
  });
}

describe("GitService updateBranch", () => {
  it("updates the current branch from its configured upstream instead of origin", async () => {
    const { base, repo, upstream } = await createTrackedRepository();
    try {
      const writer = path.join(base, "writer");
      await git(base, "clone", upstream, writer);
      await configureIdentity(writer);
      await fs.writeFile(path.join(writer, "upstream.txt"), "from upstream\n");
      await git(writer, "add", "upstream.txt");
      await git(writer, "commit", "-m", "upstream change");
      const upstreamHead = await git(writer, "rev-parse", "HEAD");
      await git(writer, "push", "origin", "main");

      await serviceFor(repo).updateBranch("main");

      assert.strictEqual(await git(repo, "rev-parse", "HEAD"), upstreamHead);
      assert.strictEqual(
        await fs.readFile(path.join(repo, "upstream.txt"), "utf8"),
        "from upstream\n",
      );
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });

  it("fast-forwards a non-current branch without changing HEAD or the working tree", async () => {
    const { base, repo, upstream } = await createTrackedRepository();
    try {
      await git(repo, "checkout", "-b", "topic");
      await fs.writeFile(path.join(repo, "topic.txt"), "local topic\n");
      await git(repo, "add", "topic.txt");
      await git(repo, "commit", "-m", "topic start");
      await git(repo, "push", "-u", "upstream", "topic");
      await git(repo, "checkout", "main");

      const writer = path.join(base, "topic-writer");
      await git(base, "clone", upstream, writer);
      await configureIdentity(writer);
      await git(writer, "checkout", "topic");
      await fs.writeFile(path.join(writer, "topic.txt"), "remote topic\n");
      await git(writer, "add", "topic.txt");
      await git(writer, "commit", "-m", "advance topic");
      const remoteTopicHead = await git(writer, "rev-parse", "HEAD");
      await git(writer, "push", "origin", "topic");

      const headBefore = await git(repo, "rev-parse", "HEAD");
      const statusBefore = await git(repo, "status", "--porcelain=v1");

      await serviceFor(repo).updateBranch("topic");

      assert.strictEqual(
        await git(repo, "rev-parse", "topic"),
        remoteTopicHead,
      );
      assert.strictEqual(await git(repo, "rev-parse", "HEAD"), headBefore);
      assert.strictEqual(await git(repo, "branch", "--show-current"), "main");
      assert.strictEqual(
        await git(repo, "status", "--porcelain=v1"),
        statusBefore,
      );
      assert.strictEqual(
        await fs.readFile(path.join(repo, "README.md"), "utf8"),
        "initial\n",
      );
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });

  it("reports a typed error when the selected branch has no upstream", async () => {
    const { base, repo } = await createTrackedRepository();
    try {
      await git(repo, "branch", "local-only");

      await assert.rejects(
        serviceFor(repo).updateBranch("local-only"),
        (error: unknown) =>
          error instanceof PorcelainError &&
          error.code === PorcelainErrorCode.BRANCH_NO_UPSTREAM,
      );
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });

  it("rejects a non-fast-forward update without rewriting the local branch", async () => {
    const { base, repo, upstream } = await createTrackedRepository();
    try {
      await git(repo, "checkout", "-b", "topic");
      await fs.writeFile(path.join(repo, "topic.txt"), "topic base\n");
      await git(repo, "add", "topic.txt");
      await git(repo, "commit", "-m", "topic base");
      await git(repo, "push", "-u", "upstream", "topic");

      const writer = path.join(base, "divergent-writer");
      await git(base, "clone", upstream, writer);
      await configureIdentity(writer);
      await git(writer, "checkout", "topic");

      await fs.writeFile(path.join(repo, "local-only.txt"), "local\n");
      await git(repo, "add", "local-only.txt");
      await git(repo, "commit", "-m", "local-only topic change");
      const localTopicHead = await git(repo, "rev-parse", "HEAD");
      await git(repo, "checkout", "main");

      await fs.writeFile(path.join(writer, "remote-only.txt"), "remote\n");
      await git(writer, "add", "remote-only.txt");
      await git(writer, "commit", "-m", "remote-only topic change");
      await git(writer, "push", "origin", "topic");

      await assert.rejects(
        serviceFor(repo).updateBranch("topic"),
        (error: unknown) =>
          error instanceof PorcelainError &&
          error.code === PorcelainErrorCode.BRANCH_NON_FAST_FORWARD,
      );
      assert.strictEqual(await git(repo, "rev-parse", "topic"), localTopicHead);
      assert.strictEqual(await git(repo, "branch", "--show-current"), "main");
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });

  it("rejects updating a branch checked out in another worktree", async () => {
    const { base, repo } = await createTrackedRepository();
    try {
      await git(repo, "checkout", "-b", "topic");
      await fs.writeFile(path.join(repo, "topic.txt"), "topic\n");
      await git(repo, "add", "topic.txt");
      await git(repo, "commit", "-m", "topic");
      await git(repo, "push", "-u", "upstream", "topic");
      await git(repo, "checkout", "main");
      const worktreePath = path.join(base, "topic-worktree");
      await git(repo, "worktree", "add", worktreePath, "topic");

      await assert.rejects(
        serviceFor(repo).updateBranch("topic"),
        (error: unknown) =>
          error instanceof PorcelainError &&
          error.code === PorcelainErrorCode.BRANCH_CHECKED_OUT_IN_WORKTREE &&
          error.message.includes(path.basename(worktreePath)),
      );
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });

  it("returns full refs and the checkout path for branches in linked worktrees", async () => {
    const { base, repo } = await createTrackedRepository();
    try {
      await git(repo, "checkout", "-b", "topic");
      await git(repo, "push", "-u", "upstream", "topic");
      await git(repo, "checkout", "main");
      const worktreePath = path.join(base, "topic-worktree");
      await git(repo, "worktree", "add", worktreePath, "topic");

      const branches = await serviceFor(repo).getBranches();
      const topic = branches.find((branch) => branch.name === "topic");

      assert.strictEqual(topic?.fullRef, "refs/heads/topic");
      assert.ok(
        topic?.checkedOutWorktreePath?.endsWith(path.basename(worktreePath)),
      );
      assert.strictEqual(
        branches.find((branch) => branch.name === "upstream/topic")?.fullRef,
        "refs/remotes/upstream/topic",
      );
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });

  it("peels annotated tags to the commit used for log navigation", async () => {
    const { base, repo } = await createTrackedRepository();
    try {
      const head = await git(repo, "rev-parse", "HEAD");
      await git(repo, "tag", "-a", "annotated", "-m", "annotated tag");
      await git(repo, "tag", "lightweight");

      const tags = await serviceFor(repo).getTags();
      const annotated = tags.find((tag) => tag.name === "annotated");
      const lightweight = tags.find((tag) => tag.name === "lightweight");

      assert.strictEqual(annotated?.fullRef, "refs/tags/annotated");
      assert.strictEqual(annotated?.targetCommitHash, head);
      assert.strictEqual(lightweight?.fullRef, "refs/tags/lightweight");
      assert.strictEqual(lightweight?.targetCommitHash, head);
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });
});
