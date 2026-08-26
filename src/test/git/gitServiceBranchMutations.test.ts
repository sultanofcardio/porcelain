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

function serviceFor(repo: string): GitService {
  return new GitService({
    workTreeRoot: repo,
    gitDir: path.join(repo, ".git"),
    commonDir: path.join(repo, ".git"),
  });
}

describe("GitService branch mutations", () => {
  it("reports an unmerged branch as a typed safe-delete rejection", async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "porcelain-delete-"));
    try {
      await git(repo, "init", "-b", "main");
      await git(repo, "config", "user.name", "Porcelain Test");
      await git(repo, "config", "user.email", "porcelain@example.com");
      await fs.writeFile(path.join(repo, "README.md"), "initial\n");
      await git(repo, "add", "README.md");
      await git(repo, "commit", "-m", "initial");
      await git(repo, "checkout", "-b", "topic");
      await fs.writeFile(path.join(repo, "topic.txt"), "topic\n");
      await git(repo, "add", "topic.txt");
      await git(repo, "commit", "-m", "topic");
      const topicHash = await git(repo, "rev-parse", "HEAD");
      await git(repo, "checkout", "main");

      await assert.rejects(
        serviceFor(repo).deleteBranch("topic", false),
        (error: unknown) =>
          error instanceof PorcelainError &&
          error.code === PorcelainErrorCode.BRANCH_NOT_FULLY_MERGED,
      );
      assert.strictEqual(
        await git(repo, "rev-parse", "--verify", "topic"),
        topicHash,
      );

      await serviceFor(repo).deleteBranch("topic", true);
      await assert.rejects(git(repo, "rev-parse", "--verify", "topic"));
    } finally {
      await fs.rm(repo, { recursive: true, force: true });
    }
  });
});
