import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { GitExecutor } from "../../git/core/gitExecutor";

export class GitTestRepo {
  readonly executor: GitExecutor;

  private constructor(readonly rootPath: string) {
    this.executor = new GitExecutor(rootPath);
  }

  static async create(): Promise<GitTestRepo> {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "porcelain-git-"));
    const repo = new GitTestRepo(rootPath);
    // Explicit branch name: with the runner's hermetic git config there is
    // no global init.defaultBranch to lean on.
    await repo.git("init", "-b", "main");
    await repo.git("config", "user.name", "Porcelain Test");
    await repo.git("config", "user.email", "porcelain@example.com");
    // Scratch repos must not inherit the developer's signing setup: a global
    // commit.gpgsign=true would make every fixture commit call out to their
    // signing agent, and the whole suite fails the moment it is locked.
    await repo.git("config", "commit.gpgsign", "false");
    await repo.git("config", "tag.gpgsign", "false");
    return repo;
  }

  git(...args: string[]): Promise<string> {
    return this.executor.text(args);
  }

  writeFile(relativePath: string, content: Buffer | string): Promise<void> {
    return fs.writeFile(path.join(this.rootPath, relativePath), content);
  }
}
