import * as assert from "node:assert";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { GitService } from "../../git/gitService";

const execFileAsync = promisify(execFile);

async function git(
  cwd: string,
  date: string | null,
  ...args: string[]
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: {
      ...process.env,
      LC_ALL: "C",
      GIT_TERMINAL_PROMPT: "0",
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
    },
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

interface Fixture {
  base: string;
  repo: string;
  service: GitService;
  /** Linear history on main, oldest first. */
  first: string;
  second: string;
  third: string;
  /** Tip of a sibling branch forked from `first`, dated after `third`. */
  sibling: string;
}

/**
 * main:  first ── second ── third
 *          └───── sibling
 *
 * `second` adds transient.txt and `third` deletes it again, so a net two-commit
 * comparison across the pair must not mention it.
 */
async function createFixture(): Promise<Fixture> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "porcelain-compare-"));
  const repo = path.join(base, "repo");
  await git(base, null, "init", "-b", "main", repo);
  await git(repo, null, "config", "user.name", "Porcelain Test");
  await git(repo, null, "config", "user.email", "porcelain@example.com");

  await fs.writeFile(path.join(repo, "kept.txt"), "one\n");
  await git(repo, null, "add", "kept.txt");
  await git(repo, "2020-01-01T00:00:00Z", "commit", "-m", "first");
  const first = await git(repo, null, "rev-parse", "HEAD");

  await fs.writeFile(path.join(repo, "transient.txt"), "here\n");
  await fs.writeFile(path.join(repo, "kept.txt"), "two\n");
  await git(repo, null, "add", ".");
  await git(repo, "2020-02-01T00:00:00Z", "commit", "-m", "second");
  const second = await git(repo, null, "rev-parse", "HEAD");

  await fs.rm(path.join(repo, "transient.txt"));
  await fs.writeFile(path.join(repo, "added.txt"), "new\n");
  await git(repo, null, "add", "-A");
  await git(repo, "2020-03-01T00:00:00Z", "commit", "-m", "third");
  const third = await git(repo, null, "rev-parse", "HEAD");

  await git(repo, null, "checkout", "-b", "sibling", first);
  await fs.writeFile(path.join(repo, "sibling.txt"), "side\n");
  await git(repo, null, "add", "sibling.txt");
  await git(repo, "2020-04-01T00:00:00Z", "commit", "-m", "sibling");
  const sibling = await git(repo, null, "rev-parse", "HEAD");
  await git(repo, null, "checkout", "main");

  return {
    base,
    repo,
    service: serviceFor(repo),
    first,
    second,
    third,
    sibling,
  };
}

describe("two-commit comparison", () => {
  let fixture: Fixture;

  before(async () => {
    fixture = await createFixture();
  });

  after(async () => {
    await fs.rm(fixture.base, { recursive: true, force: true });
  });

  it("reports the net difference between two snapshots", async () => {
    const files = await fixture.service.getComparisonFiles(
      fixture.first,
      fixture.third,
    );

    assert.deepStrictEqual(
      files
        .map((file) => `${file.status} ${file.newPath}`)
        .sort((a, b) => a.localeCompare(b)),
      ["added added.txt", "modified kept.txt"],
      "a file added and deleted between the endpoints must not appear",
    );
  });

  it("is empty for a commit compared with itself", async () => {
    assert.deepStrictEqual(
      await fixture.service.getComparisonFiles(fixture.second, fixture.second),
      [],
    );
  });

  it("orders an ancestor pair oldest-first whichever way round it is given", async () => {
    const { first, third, service } = fixture;
    const forwards = await service.orderCommitsOldestFirst(first, third);
    const backwards = await service.orderCommitsOldestFirst(third, first);

    assert.deepStrictEqual(forwards, { from: first, to: third });
    assert.deepStrictEqual(
      backwards,
      { from: first, to: third },
      "selection order must not change which end is the base",
    );
  });

  it("falls back to commit date for commits on diverged branches", async () => {
    const { second, sibling, service } = fixture;
    assert.strictEqual(await service.isAncestor(second, sibling), false);
    assert.strictEqual(await service.isAncestor(sibling, second), false);

    assert.deepStrictEqual(
      await service.orderCommitsOldestFirst(sibling, second),
      { from: second, to: sibling },
      "the older commit date wins when neither commit reaches the other",
    );
  });
});
