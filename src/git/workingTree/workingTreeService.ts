import type { GitExecutor } from "../core/gitExecutor";
import type { DiffFile, FileStatus, WorkingTreeFile } from "../types";
import { parseNameStatusZ } from "./nameStatusParser";
import { type GitStatusRecord, parseStatusPorcelainZ } from "./statusParser";

/** File content, not porcelain output: matches gitService's MAX_BUFFER. */
const INDEX_CONTENT_MAX_BUFFER = 10 * 1024 * 1024;

export class WorkingTreeService {
  constructor(private readonly git: GitExecutor) {}

  async getStatus(): Promise<FileStatus[]> {
    return parseStatusPorcelainZ(
      await this.git.buffer(["status", "--porcelain=v1", "-z", "-uall"]),
    );
  }

  async getWorkingTreeChanges(): Promise<WorkingTreeFile[]> {
    return (await this.getStatus()).flatMap((record) =>
      this.toWorkingTreeFiles(record),
    );
  }

  async getCommitFiles(hash: string): Promise<DiffFile[]> {
    return parseNameStatusZ(
      await this.git.buffer([
        "diff-tree",
        "--root",
        "--no-commit-id",
        "-r",
        "--name-status",
        "-z",
        "-M",
        "-C",
        hash,
      ]),
    );
  }

  /**
   * Files that differ between two commits, as the net change from `fromRef` to
   * `toRef`. This is a two-snapshot diff, not a union of the commits between
   * them: work added and later reverted in that span shows as no change.
   */
  async getComparisonFiles(
    fromRef: string,
    toRef: string,
  ): Promise<DiffFile[]> {
    return parseNameStatusZ(
      await this.git.buffer([
        "diff",
        "--name-status",
        "-z",
        "-M",
        "-C",
        fromRef,
        toRef,
      ]),
    );
  }

  getIndexFileContent(path: string): Promise<Buffer> {
    // The executor's default cap is 1 MB — fine for porcelain output, far too
    // small for file content: a staged file past it would throw, be swallowed
    // into an empty side upstream, and render as a wholly added/deleted file.
    return this.git.buffer(["show", `:${path}`], {
      maxBuffer: INDEX_CONTENT_MAX_BUFFER,
    });
  }

  private toWorkingTreeFiles(record: GitStatusRecord): WorkingTreeFile[] {
    const { path, oldPath, indexStatus, workTreeStatus } = record;
    if (indexStatus === "!" && workTreeStatus === "!") return [];
    const staged =
      indexStatus !== " " && indexStatus !== "?" && indexStatus !== "!";
    const status = this.toWorkingTreeStatus(record);
    if (staged && ![" ", "?", "!"].includes(workTreeStatus))
      return [
        { path, oldPath, status, staged: true },
        { path, oldPath, status: "modified", staged: false },
      ];
    return [{ path, oldPath, status, staged }];
  }

  private toWorkingTreeStatus(
    record: GitStatusRecord,
  ): WorkingTreeFile["status"] {
    const { indexStatus, workTreeStatus } = record;
    if (indexStatus === "?" && workTreeStatus === "?") return "untracked";
    if (
      indexStatus === "U" ||
      workTreeStatus === "U" ||
      (indexStatus === "A" && workTreeStatus === "A") ||
      (indexStatus === "D" && workTreeStatus === "D")
    )
      return "conflicted";
    if (indexStatus === "A" || workTreeStatus === "A") return "added";
    if (indexStatus === "D" || workTreeStatus === "D") return "deleted";
    if (indexStatus === "R" || workTreeStatus === "R") return "renamed";
    return "modified";
  }
}
