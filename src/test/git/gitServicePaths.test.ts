import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { GitService } from "../../git/gitService";

describe("GitService repository paths", () => {
  it("reads operation state from gitDir instead of <worktree>/.git", async () => {
    const base = await fs.mkdtemp(
      path.join(os.tmpdir(), "porcelain-worktree-"),
    );
    const workTreeRoot = path.join(base, "worktree");
    const gitDir = path.join(base, "common", "worktrees", "wt");
    await fs.mkdir(workTreeRoot, { recursive: true });
    await fs.mkdir(path.join(gitDir, "rebase-merge"), { recursive: true });
    await fs.writeFile(path.join(gitDir, "MERGE_HEAD"), "merge-hash\n");
    await fs.writeFile(path.join(gitDir, "MERGE_MSG"), "merge message\n");
    await fs.writeFile(path.join(gitDir, "CHERRY_PICK_HEAD"), "pick-hash\n");
    await fs.writeFile(
      path.join(gitDir, "rebase-merge", "head-name"),
      "refs/heads/topic\n",
    );
    await fs.writeFile(path.join(gitDir, "rebase-merge", "msgnum"), "2\n");
    await fs.writeFile(path.join(gitDir, "rebase-merge", "end"), "5\n");

    const service = new GitService({
      workTreeRoot,
      gitDir,
      commonDir: path.join(base, "common"),
    });

    assert.deepStrictEqual(await service.getMergeState(), {
      isMerging: true,
      mergeHead: "merge-hash",
      mergeMsg: "merge message",
    });
    assert.deepStrictEqual(await service.getCherryPickState(), {
      isCherryPicking: true,
      cherryPickHead: "pick-hash",
    });
    assert.deepStrictEqual(await service.getRebaseState(), {
      isRebasing: true,
      branchName: "topic",
      step: 2,
      totalSteps: 5,
    });
  });
});
