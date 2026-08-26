import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { GitService } from "../../git/gitService";

class ReachabilityGitService extends GitService {
  reachable(tip: string): Promise<Set<string>> {
    return this.loadReachableHashes(tip);
  }
}

describe("GitService reachable hashes", () => {
  it("accepts rev-list output larger than the standard command buffer", async () => {
    const bin = await fs.mkdtemp(path.join(os.tmpdir(), "porcelain-bin-"));
    const git = path.join(bin, "git");
    await fs.writeFile(git, "#!/bin/sh\nyes x | head -c 11534336\n");
    await fs.chmod(git, 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath ?? ""}`;
    const service = new ReachabilityGitService({
      workTreeRoot: bin,
      gitDir: path.join(bin, ".git"),
      commonDir: path.join(bin, ".git"),
    });

    try {
      assert.deepStrictEqual(await service.reachable("HEAD"), new Set(["x"]));
    } finally {
      process.env.PATH = previousPath;
    }
  });
});
