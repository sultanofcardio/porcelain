import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { GitCache, type ReachabilityCacheEntry } from "./cache";
import { CommitService } from "./commit/commitService";
import { IndexTransaction } from "./commit/indexTransaction";
import type { CommitPathSelection } from "./commit/types";
import { GitCommandError, GitExecutor } from "./core/gitExecutor";
import type { GitOperationResult } from "./core/operationResult";
import { PorcelainError, PorcelainErrorCode } from "./errors";
import { computeGraphLayout } from "./graphLayout";
import type {
  BlameLine,
  BlameOptions,
  BranchInfo,
  CherryPickState,
  CommitNode,
  CommitOptions,
  CommitRequest,
  DiffFile,
  FileStatus,
  GraphLayoutResult,
  IdeaShelfEntry,
  LaneSnapshot,
  LogOptions,
  LogRevision,
  MergeOptions,
  MergeState,
  PullOptions,
  PushOptions,
  RebaseOptions,
  RefInfo,
  TagInfo,
} from "./types";

// For parsing git output (actual null byte)
const FIELD_SEP = "\x00";
const RECORD_SEP = "\x00\x00\x01";
// For git log --format (pretty-format): %x00 produces null byte
const FMT_FIELD_SEP = "%x00";
const FMT_RECORD_SEP = "%x00%x00%x01";
// For git branch/tag --format (ref-format / for-each-ref): %00 produces null byte
const REF_FMT_FIELD_SEP = "%00";
const MAX_BUFFER = 10 * 1024 * 1024; // 10MB

/**
 * Git's ways of saying "this path is not in that revision" — the one class of
 * `git show` failure that is an ordinary empty side (added/deleted/renamed
 * files) rather than an error worth surfacing.
 */
const ABSENT_PATH_MARKERS = [
  "does not exist in",
  "exists on disk, but not in",
  "is in the index, but not at",
  "not in the working tree",
  "neither on disk nor in the index",
];

export function isAbsentPathError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return ABSENT_PATH_MARKERS.some((marker) => message.includes(marker));
}

const LOG_FORMAT = [
  "%H", // hash
  "%h", // shortHash
  "%P", // parents (space separated)
  "%aN", // authorName (mailmap resolved)
  "%aE", // authorEmail (mailmap resolved)
  "%aI", // authorDate ISO 8601
  "%cI", // committerDate ISO 8601
  "%s", // subject
  "%b", // body
  "%D", // refs
].join(FMT_FIELD_SEP);

import {
  buildPartialPatch,
  type ParsedDiff,
  parseUnifiedDiff,
} from "./commit/hunks";
import {
  collectEditorMessages,
  createRebaseEditorSetup,
  type RebaseTodoEntry,
  renderRebaseTodo,
} from "./rebase/interactiveRebase";
import { RefService } from "./refs/refService";
import type { RepositoryPaths } from "./repoRegistry";
import { NativeShelfService } from "./shelf/nativeShelfService";
import { PatchShelfService } from "./shelf/patchShelfService";
import { WorkingTreeService } from "./workingTree/workingTreeService";

export class GitService {
  /**
   * The most commits an interactive rebase todo may cover. The rendered todo
   * replaces git's own file wholesale, so the full range must fit — a
   * truncated todo makes git drop the omitted commits.
   */
  private static readonly REBASE_TODO_LIMIT = 500;

  readonly cache = new GitCache();
  private reachabilityCache: ReachabilityCacheEntry | null = null;

  private readonly executor: GitExecutor;
  private readonly refService: RefService;
  private readonly workingTreeService: WorkingTreeService;
  private readonly commitService: CommitService;
  private readonly nativeShelfService: NativeShelfService;
  private readonly patchShelfService: PatchShelfService;

  constructor(readonly paths: RepositoryPaths) {
    this.executor = new GitExecutor(paths.workTreeRoot);
    this.refService = new RefService(this.executor);
    this.workingTreeService = new WorkingTreeService(this.executor);
    const indexTransaction = new IndexTransaction(this.executor);
    this.commitService = new CommitService(
      this.executor,
      this.workingTreeService,
      indexTransaction,
    );
    this.nativeShelfService = new NativeShelfService(
      this.executor,
      this.workingTreeService,
      indexTransaction,
    );
    this.patchShelfService = new PatchShelfService(
      this.executor,
      this.workingTreeService,
    );
  }

  get rootPath(): string {
    return this.paths.workTreeRoot;
  }

  private async execGit(
    args: string[],
    maxBuffer = MAX_BUFFER,
  ): Promise<string> {
    return this.executor.text(args, { maxBuffer });
  }

  /** Run git with extra environment (the rebase editors need this). */
  private async execGitWithEnv(
    args: string[],
    env: NodeJS.ProcessEnv,
  ): Promise<string> {
    return this.executor.text(args, { maxBuffer: MAX_BUFFER, env });
  }

  async checkGitAvailable(): Promise<boolean> {
    try {
      await this.execGit(["rev-parse", "--is-inside-work-tree"]);
      return true;
    } catch {
      return false;
    }
  }

  private async validateRef(ref: string): Promise<void> {
    if (ref === "HEAD") {
      return;
    }
    // A detached comparison is pinned to the full object id resolved when the
    // panel opens. Full SHA-1/SHA-256 ids are safe argv values and cannot be
    // interpreted as options or revision expressions.
    if (/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(ref)) {
      return;
    }
    if (!ref.startsWith("refs/")) {
      throw new Error(`Invalid Git ref: ${ref}`);
    }
    try {
      await this.execGit(["check-ref-format", ref]);
    } catch {
      throw new Error(`Invalid Git ref: ${ref}`);
    }
  }

  private async validateBranch(branch: string): Promise<void> {
    try {
      // The legacy log protocol still accepts a plain branch field. Validate
      // it as a branch/ref name before appending it to argv so values beginning
      // with '-' cannot be reinterpreted as Git options.
      await this.execGit(["check-ref-format", "--branch", branch]);
    } catch {
      throw new Error(`Invalid Git branch: ${branch}`);
    }
  }

  private async appendRevision(
    args: string[],
    revision: LogRevision | undefined,
    branch: string | undefined,
    branches: string[] | undefined,
  ): Promise<void> {
    if (!revision) {
      // Multiple refs are a union: `git log a b` walks everything reachable
      // from either, which is exactly the multi-branch filter's meaning.
      const refs = [
        ...(branch ? [branch] : []),
        ...(branches ?? []).filter((b) => typeof b === "string" && b.length),
      ];
      if (refs.length > 0) {
        for (const ref of refs) {
          await this.validateBranch(ref);
        }
        args.push(...refs);
      } else {
        args.push("--all");
      }
      return;
    }

    switch (revision.kind) {
      case "all":
        args.push("--all");
        return;
      case "ref":
        await this.validateRef(revision.ref);
        args.push(revision.ref);
        return;
      case "range":
        await this.validateRef(revision.excludeRef);
        await this.validateRef(revision.includeRef);
        args.push(`${revision.excludeRef}..${revision.includeRef}`);
        return;
    }
  }

  async getLog(options: LogOptions = {}): Promise<CommitNode[]> {
    const cacheKey = `log:${JSON.stringify(options)}`;
    const cached = this.cache.get<CommitNode[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const args = [
      "log",
      `--format=${LOG_FORMAT}${FMT_RECORD_SEP}`,
      options.sortTopo ? "--topo-order" : "--date-order",
    ];

    if (options.firstParent) {
      args.push("--first-parent");
    }
    if (options.noMerges) {
      args.push("--no-merges");
    }
    if (options.maxCount) {
      args.push(`--max-count=${options.maxCount}`);
    } else {
      args.push("--max-count=200");
    }
    if (options.skip) {
      args.push(`--skip=${options.skip}`);
    }
    if (options.author) {
      args.push(`--author=${options.author}`);
    }
    if (options.search) {
      args.push(`--grep=${options.search}`);
    }
    if (options.search || options.author) {
      // Git treats --grep/--author patterns as case-sensitive basic regexes.
      // The log UI wants literal, case-insensitive matching unless the user
      // flips the regex / match-case toggles.
      args.push(options.searchRegex ? "--extended-regexp" : "--fixed-strings");
      if (!options.searchCaseSensitive) {
        args.push("--regexp-ignore-case");
      }
    }
    if (options.since) {
      args.push(`--since=${options.since}`);
    }
    if (options.until) {
      args.push(`--until=${options.until}`);
    }
    await this.appendRevision(
      args,
      options.revision,
      options.branch,
      options.branches,
    );
    const pathspecs = [
      ...(options.file ? [options.file] : []),
      ...(options.paths ?? []).filter(
        (p) => typeof p === "string" && p.length > 0,
      ),
    ];
    if (pathspecs.length > 0) {
      // Everything after "--" is a pathspec to git, so user-typed paths
      // cannot be reinterpreted as options or revisions.
      args.push("--", ...pathspecs);
    }

    const output = await this.execGit(args);
    const commits = parseLogOutput(output);
    this.cache.set(cacheKey, commits);
    return commits;
  }

  async getLogWithReachability(
    options: LogOptions,
    currentRef: string,
  ): Promise<CommitNode[]> {
    const [commits, reachableHashes] = await Promise.all([
      this.getLog(options),
      this.getReachableHashes(currentRef),
    ]);
    return commits.map((commit) => ({
      ...commit,
      reachableFromCurrent: reachableHashes.has(commit.hash),
    }));
  }

  async getGraphTopology(
    options: LogOptions = {},
    prevSnapshot?: LaneSnapshot,
    currentRef?: string,
  ): Promise<GraphLayoutResult> {
    const commits = currentRef
      ? await this.getLogWithReachability(options, currentRef)
      : await this.getLog(options);
    // These filters punch arbitrary holes in the ancestry, so lanes must not
    // wait for parents that will never arrive. Path filters keep the relation
    // (hiddenParent edges) instead, matching the existing file-history look.
    const breakHiddenParents =
      !!options.search || !!options.noMerges || !!options.firstParent;
    return computeGraphLayout(commits, prevSnapshot, breakHiddenParents);
  }

  async resolveCommitRef(ref: string): Promise<string | null> {
    await this.validateRef(ref);
    try {
      return (
        await this.execGit([
          "rev-parse",
          "--verify",
          "--quiet",
          `${ref}^{commit}`,
        ])
      ).trim();
    } catch (error) {
      if (error instanceof GitCommandError && error.exitCode === 1) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Every distinct author across the whole repository, most-commits first,
   * plus the configured local identity for the "me" filter entry. The log
   * toolbar's author dropdown must not be limited to the loaded page.
   */
  async getLogAuthors(): Promise<{ authors: string[]; me: string | null }> {
    const cacheKey = "log:authors";
    const cached = this.cache.get<{ authors: string[]; me: string | null }>(
      cacheKey,
    );
    if (cached) {
      return cached;
    }

    const [shortlog, me] = await Promise.all([
      this.execGit(["shortlog", "-sn", "--all"]),
      this.execGit(["config", "user.name"]).catch(() => ""),
    ]);
    const authors: string[] = [];
    for (const line of shortlog.split("\n")) {
      const match = line.match(/^\s*\d+\t(.+)$/);
      if (match) authors.push(match[1]);
    }
    const result = { authors, me: me.trim() || null };
    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Resolve free-form go-to input — a full or abbreviated hash, or a bare
   * branch/tag name — to a commit hash. Returns null when nothing matches.
   */
  async resolveRevisionInput(input: string): Promise<string | null> {
    const trimmed = input.trim();
    if (!trimmed) return null;

    // Abbreviated object ids never pass validateRef, so resolve hex input
    // directly; the character class keeps the argv value inert.
    if (/^[0-9a-f]{4,64}$/i.test(trimmed)) {
      try {
        return (
          await this.execGit([
            "rev-parse",
            "--verify",
            "--quiet",
            `${trimmed}^{commit}`,
          ])
        ).trim();
      } catch (error) {
        if (!(error instanceof GitCommandError && error.exitCode === 1)) {
          throw error;
        }
        // Fall through: an all-hex branch name is legal.
      }
    }

    for (const prefix of ["refs/heads/", "refs/remotes/", "refs/tags/"]) {
      try {
        const hash = await this.resolveCommitRef(`${prefix}${trimmed}`);
        if (hash) return hash;
      } catch {
        // Invalid as a ref name under this namespace; try the next.
      }
    }
    return null;
  }

  /** The configured author identity, for "me" affordances in the log. */
  async getUserIdentity(): Promise<{
    name: string | null;
    email: string | null;
  }> {
    const cacheKey = "log:identity";
    const cached = this.cache.get<{
      name: string | null;
      email: string | null;
    }>(cacheKey);
    if (cached) {
      return cached;
    }
    const [name, email] = await Promise.all([
      this.execGit(["config", "user.name"]).catch(() => ""),
      this.execGit(["config", "user.email"]).catch(() => ""),
    ]);
    const result = { name: name.trim() || null, email: email.trim() || null };
    this.cache.set(cacheKey, result);
    return result;
  }

  /** Branch names whose history contains the commit, for the details pane. */
  async getContainingBranches(
    hash: string,
  ): Promise<{ local: string[]; remote: string[] }> {
    await this.validateRef(hash);
    const cacheKey = `log:contains:${hash}`;
    const cached = this.cache.get<{ local: string[]; remote: string[] }>(
      cacheKey,
    );
    if (cached) {
      return cached;
    }

    const output = await this.execGit([
      "for-each-ref",
      "--contains",
      hash,
      "--format=%(refname)",
      "refs/heads",
      "refs/remotes",
    ]);
    const local: string[] = [];
    const remote: string[] = [];
    for (const line of output.split("\n")) {
      const ref = line.trim();
      if (ref.startsWith("refs/heads/")) {
        local.push(ref.slice("refs/heads/".length));
      } else if (ref.startsWith("refs/remotes/")) {
        const name = ref.slice("refs/remotes/".length);
        if (!name.endsWith("/HEAD")) remote.push(name);
      }
    }
    const result = { local, remote };
    this.cache.set(cacheKey, result);
    return result;
  }

  private async getReachableHashes(ref: string): Promise<Set<string>> {
    const tip = await this.resolveCommitRef(ref);
    if (!tip) {
      // Reachability only decorates log rows. If the checked-out ref vanishes
      // between the handler's availability check and this second resolution,
      // keep the log usable and temporarily render every commit as unreachable.
      return new Set();
    }

    const cached = this.reachabilityCache;
    if (cached?.tip === tip) {
      if (cached.hashes) {
        return cached.hashes;
      }
      if (cached.pending) {
        return cached.pending;
      }
    }

    const entry: ReachabilityCacheEntry = { tip };
    const pending = this.loadReachableHashes(tip).then(
      (hashes) => {
        if (this.reachabilityCache === entry) {
          entry.hashes = hashes;
          entry.pending = undefined;
        }
        return hashes;
      },
      (error) => {
        if (this.reachabilityCache === entry) {
          this.reachabilityCache = null;
        }
        throw error;
      },
    );
    entry.pending = pending;
    this.reachabilityCache = entry;
    return pending;
  }

  protected loadReachableHashes(tip: string): Promise<Set<string>> {
    return this.executor
      .lines(["rev-list", tip])
      .then(
        (lines) => new Set(lines.map((line) => line.trim()).filter(Boolean)),
      );
  }

  async getBranches(): Promise<BranchInfo[]> {
    const cacheKey = "branches";
    const cached = this.cache.get<BranchInfo[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const branches = await this.refService.getBranches();

    this.cache.set(cacheKey, branches);
    return branches;
  }

  async getRemoteBranches(): Promise<{ remote: string; branches: string[] }[]> {
    // Get the actual configured remotes (not inferred from tracking branches)
    const remoteOutput = await this.execGit(["remote"]).catch(() => "");
    const configuredRemotes = new Set(
      remoteOutput
        .trim()
        .split("\n")
        .map((r) => r.trim())
        .filter(Boolean),
    );

    if (configuredRemotes.size === 0) {
      return [];
    }

    const allBranches = await this.getBranches();
    const remoteBranches = allBranches.filter((b) => b.isRemote);

    const groups = new Map<string, string[]>();
    for (const branch of remoteBranches) {
      const slashIdx = branch.name.indexOf("/");
      if (slashIdx === -1) continue;
      const remote = branch.name.substring(0, slashIdx);
      // Only include branches for remotes that still exist
      if (!configuredRemotes.has(remote)) continue;
      const branchName = branch.name.substring(slashIdx + 1);
      if (!groups.has(remote)) {
        groups.set(remote, []);
      }
      groups.get(remote)?.push(branchName);
    }

    // Ensure all configured remotes appear even if they have no tracking branches yet
    for (const remote of configuredRemotes) {
      if (!groups.has(remote)) {
        groups.set(remote, []);
      }
    }

    // Sort branches alphabetically within each group (case-insensitive)
    const result: { remote: string; branches: string[] }[] = [];
    for (const [remote, branchList] of groups) {
      branchList.sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      );
      result.push({ remote, branches: branchList });
    }

    return result;
  }

  async getTags(): Promise<TagInfo[]> {
    const cacheKey = "tags";
    const cached = this.cache.get<TagInfo[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const tagFormat = [
      "%(refname:short)",
      "%(refname)",
      "%(objectname)",
      "%(*objectname)",
      "%(objecttype)",
      "%(contents:subject)",
    ].join(REF_FMT_FIELD_SEP);

    const output = await this.execGit([
      "tag",
      "-l",
      `--format=${tagFormat}`,
    ]).catch(() => "");

    const tags: TagInfo[] = [];
    for (const line of output.trim().split("\n")) {
      if (!line.trim()) {
        continue;
      }
      const fields = line.split(FIELD_SEP);
      const hash = fields[2]?.trim() ?? "";
      const peeledHash = fields[3]?.trim() ?? "";
      tags.push({
        name: fields[0]?.trim() ?? "",
        fullRef: fields[1]?.trim() ?? `refs/tags/${fields[0]?.trim() ?? ""}`,
        hash,
        targetCommitHash: peeledHash || hash,
        isAnnotated: fields[4]?.trim() === "tag",
        message: fields[5]?.trim() || undefined,
      });
    }

    this.cache.set(cacheKey, tags);
    return tags;
  }

  async getDiff(ref1: string, ref2: string, file?: string): Promise<string> {
    const args = ["diff", ref1, ref2];
    if (file) {
      args.push("--", file);
    }
    return this.execGit(args);
  }

  async getFileContent(ref: string, filePath: string): Promise<string> {
    if (!ref) {
      return "";
    }
    try {
      return await this.execGit(["show", `${ref}:${filePath}`]);
    } catch {
      return "";
    }
  }

  async getFileContentBuffer(ref: string, filePath: string): Promise<Buffer> {
    if (!ref) {
      return Buffer.alloc(0);
    }
    try {
      return await this.executor.buffer(["show", `${ref}:${filePath}`], {
        maxBuffer: MAX_BUFFER,
      });
    } catch (error) {
      // A path absent from the revision is not a failure — it is how an
      // added, deleted or renamed file diffs, and that side must stay empty.
      // Anything else (an oversized blob, a corrupt object, a bad ref) must
      // surface, or "could not read" masquerades as "deleted".
      if (isAbsentPathError(error)) return Buffer.alloc(0);
      throw error;
    }
  }

  readFileContent(ref: string, filePath: string): Promise<Buffer> {
    if (!ref) {
      throw new Error("A revision is required to read file content");
    }
    return this.executor.buffer(["show", `${ref}:${filePath}`], {
      maxBuffer: MAX_BUFFER,
    });
  }

  async getCommitFiles(hash: string): Promise<DiffFile[]> {
    return this.workingTreeService.getCommitFiles(hash);
  }

  async getCommitRangeFiles(hashes: string[]): Promise<DiffFile[]> {
    if (hashes.length === 0) return [];
    if (hashes.length === 1) return this.getCommitFiles(hashes[0]);

    // Cherry-pick style: get diff-tree for each commit individually, then merge
    const perCommitFiles = await Promise.all(
      hashes.map((h) => this.getCommitFiles(h)),
    );

    const merged = new Map<string, DiffFile>();
    for (const files of perCommitFiles) {
      for (const f of files) {
        const key = f.newPath || f.oldPath;
        if (!merged.has(key)) {
          merged.set(key, f);
        }
      }
    }
    return Array.from(merged.values());
  }

  /**
   * Files that differ between two commits, ordered oldest-first regardless of
   * the order they were selected in.
   */
  async getComparisonFiles(
    fromRef: string,
    toRef: string,
  ): Promise<DiffFile[]> {
    return this.workingTreeService.getComparisonFiles(fromRef, toRef);
  }

  /** True when `ancestor` is reachable from `descendant`. */
  async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    try {
      await this.execGit(["merge-base", "--is-ancestor", ancestor, descendant]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Order two commits oldest-first so a comparison always reads the way the
   * history reads. Ancestry decides it when the commits are on the same line;
   * otherwise commit date breaks the tie, and identical dates keep the given
   * order so the result stays stable.
   */
  async orderCommitsOldestFirst(
    a: string,
    b: string,
  ): Promise<{ from: string; to: string }> {
    if (a === b) return { from: a, to: b };
    if (await this.isAncestor(a, b)) return { from: a, to: b };
    if (await this.isAncestor(b, a)) return { from: b, to: a };
    const [dateA, dateB] = await Promise.all([
      this.getCommitTimestamp(a),
      this.getCommitTimestamp(b),
    ]);
    return dateB < dateA ? { from: b, to: a } : { from: a, to: b };
  }

  /**
   * Order a selection of commits the way history does, oldest first, using
   * their positions in `rev-list` rather than dates (which can lie).
   */
  private async sortHashesOldestFirst(
    hashes: readonly string[],
  ): Promise<string[]> {
    for (const hash of hashes) {
      await this.validateRef(hash);
    }
    const output = await this.execGit([
      "rev-list",
      "--topo-order",
      "--max-count=1000",
      "HEAD",
    ]);
    // rev-list is newest-first, so a higher index is older.
    const position = new Map<string, number>();
    output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((hash, index) => {
        position.set(hash, index);
      });
    const missing = hashes.find((hash) => !position.has(hash));
    if (missing) {
      throw new PorcelainError(
        PorcelainErrorCode.INVALID_REF,
        `Commit ${missing.slice(0, 8)} is not on the current branch`,
        "Interactive rebase can only rewrite commits reachable from HEAD.",
      );
    }
    return [...hashes].sort(
      (a, b) => (position.get(b) ?? 0) - (position.get(a) ?? 0),
    );
  }

  /** Committer timestamp in seconds, or 0 when it cannot be read. */
  private async getCommitTimestamp(hash: string): Promise<number> {
    const output = await this.execGit([
      "show",
      "-s",
      "--format=%ct",
      hash,
    ]).catch(() => "");
    const parsed = Number.parseInt(output.trim(), 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  async findFileRange(
    hashes: string[],
    filePath: string,
  ): Promise<{ oldest: string; newest: string } | null> {
    // From hashes (newest first), find commits that touch this file
    const touching: string[] = [];
    for (const h of hashes) {
      const files = await this.getCommitFiles(h);
      if (files.some((f) => f.newPath === filePath || f.oldPath === filePath)) {
        touching.push(h);
      }
    }
    if (touching.length === 0) return null;
    return { newest: touching[0], oldest: touching[touching.length - 1] };
  }

  async getStatus(): Promise<FileStatus[]> {
    return this.workingTreeService.getStatus();
  }

  getIndexFileContent(path: string): Promise<Buffer> {
    return this.workingTreeService.getIndexFileContent(path);
  }

  async getCommitParents(hash: string): Promise<string[]> {
    const output = await this.execGit(["rev-parse", `${hash}^@`]).catch(
      () => "",
    );
    return output
      .trim()
      .split("\n")
      .filter((s) => s.length > 0);
  }

  async getMergeState(): Promise<MergeState> {
    try {
      const mergeHead = (
        await fs.readFile(path.join(this.paths.gitDir, "MERGE_HEAD"), "utf-8")
      ).trim();
      let mergeMsg = "";
      try {
        mergeMsg = (
          await fs.readFile(path.join(this.paths.gitDir, "MERGE_MSG"), "utf-8")
        ).trim();
      } catch {}
      return { isMerging: true, mergeHead, mergeMsg };
    } catch {
      return { isMerging: false };
    }
  }

  async getCherryPickState(): Promise<CherryPickState> {
    try {
      const cherryPickHead = (
        await fs.readFile(
          path.join(this.paths.gitDir, "CHERRY_PICK_HEAD"),
          "utf-8",
        )
      ).trim();
      return { isCherryPicking: true, cherryPickHead };
    } catch {
      return { isCherryPicking: false };
    }
  }

  async cherryPickAction(action: "continue" | "abort" | "skip"): Promise<void> {
    if (action === "continue") {
      // Stage all resolved files before continuing.
      await this.execGit(["add", "-u"]);
      // Use --allow-empty to handle the case where cherry-pick becomes empty after conflict resolution
      try {
        await this.execGit(["cherry-pick", "--continue"]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("allow-empty")) {
          await this.execGit(["commit", "--allow-empty"]);
        } else {
          throw err;
        }
      }
    } else if (action === "skip") {
      await this.execGit(["cherry-pick", "--skip"]);
    } else {
      await this.execGit(["cherry-pick", "--abort"]);
    }
    this.invalidateCache();
  }

  async getRebaseState(): Promise<{
    isRebasing: boolean;
    branchName?: string;
    step?: number;
    totalSteps?: number;
  }> {
    const rebaseMergePath = path.join(this.paths.gitDir, "rebase-merge");
    const rebaseApplyPath = path.join(this.paths.gitDir, "rebase-apply");
    try {
      await fs.access(rebaseMergePath);
      let branchName = "";
      let step = 0;
      let totalSteps = 0;
      try {
        const headName = await fs.readFile(
          path.join(rebaseMergePath, "head-name"),
          "utf-8",
        );
        branchName = headName.trim().replace("refs/heads/", "");
      } catch {}
      try {
        const msgnum = await fs.readFile(
          path.join(rebaseMergePath, "msgnum"),
          "utf-8",
        );
        step = Number.parseInt(msgnum.trim(), 10);
      } catch {}
      try {
        const end = await fs.readFile(
          path.join(rebaseMergePath, "end"),
          "utf-8",
        );
        totalSteps = Number.parseInt(end.trim(), 10);
      } catch {}
      return { isRebasing: true, branchName, step, totalSteps };
    } catch {}
    try {
      await fs.access(rebaseApplyPath);
      let branchName = "";
      let step = 0;
      let totalSteps = 0;
      try {
        const headName = await fs.readFile(
          path.join(rebaseApplyPath, "head-name"),
          "utf-8",
        );
        branchName = headName.trim().replace("refs/heads/", "");
      } catch {}
      try {
        const next = await fs.readFile(
          path.join(rebaseApplyPath, "next"),
          "utf-8",
        );
        step = Number.parseInt(next.trim(), 10);
      } catch {}
      try {
        const last = await fs.readFile(
          path.join(rebaseApplyPath, "last"),
          "utf-8",
        );
        totalSteps = Number.parseInt(last.trim(), 10);
      } catch {}
      return { isRebasing: true, branchName, step, totalSteps };
    } catch {}
    return { isRebasing: false };
  }

  async getConflictFiles(): Promise<string[]> {
    const output = await this.execGit([
      "diff",
      "--name-only",
      "--diff-filter=U",
    ]);
    return output
      .trim()
      .split("\n")
      .filter((s) => s.length > 0);
  }

  async saveMergedContent(filePath: string, content: string): Promise<void> {
    await fs.writeFile(path.join(this.rootPath, filePath), content, "utf-8");
  }

  async stageFile(filePath: string): Promise<void> {
    await this.execGit(["add", filePath]);
  }

  async acceptOurs(filePath: string): Promise<void> {
    await this.execGit(["checkout", "--ours", filePath]);
    await this.execGit(["add", filePath]);
  }

  async acceptTheirs(filePath: string): Promise<void> {
    await this.execGit(["checkout", "--theirs", filePath]);
    await this.execGit(["add", filePath]);
  }

  async checkout(branchName: string): Promise<void> {
    try {
      await this.execGit(["checkout", branchName]);
    } catch (error) {
      // IntelliJ answers this case with the smart-checkout offer rather than
      // the raw git text, so the failure needs a code the UI can branch on.
      const detail = gitErrorText(error);
      if (
        /would be overwritten by checkout|Please commit your changes or stash them/i.test(
          detail,
        )
      ) {
        throw new PorcelainError(
          PorcelainErrorCode.LOCAL_CHANGES_WOULD_BE_OVERWRITTEN,
          `Local changes would be overwritten by checking out '${branchName}'`,
          "Stash the changes, check out, and restore them (smart checkout), or cancel.",
        );
      }
      throw error;
    }
    this.invalidateCache();
  }

  /**
   * IntelliJ's smart checkout: stash what blocks the switch, check out, then
   * restore. A restore conflict leaves the stash in place deliberately —
   * dropping it would lose the user's work.
   */
  async smartCheckout(
    branchName: string,
  ): Promise<{ restored: boolean; stashRef?: string }> {
    await this.validateBranch(branchName);
    const message = `porcelain: smart checkout ${branchName}`;
    await this.execGit(["stash", "push", "--include-untracked", "-m", message]);
    const stashRef = (await this.execGit(["rev-parse", "stash@{0}"]))
      .trim()
      .slice(0, 40);
    try {
      await this.execGit(["checkout", branchName]);
    } catch (error) {
      // Put the working tree back the way we found it before surfacing this.
      await this.execGit(["stash", "pop"]).catch(() => undefined);
      this.invalidateCache();
      throw error;
    }
    try {
      await this.execGit(["stash", "pop"]);
      this.invalidateCache();
      return { restored: true };
    } catch {
      this.invalidateCache();
      return { restored: false, stashRef };
    }
  }

  /** Branches ordered by most recent checkout, read from the reflog. */
  async getRecentBranches(limit = 10): Promise<string[]> {
    const cacheKey = `refs:recent:${limit}`;
    const cached = this.cache.get<string[]>(cacheKey);
    if (cached) {
      return cached;
    }
    const output = await this.execGit([
      "reflog",
      "show",
      "--format=%gs",
      "-n",
      "200",
    ]).catch(() => "");
    const seen: string[] = [];
    for (const line of output.split("\n")) {
      // "checkout: moving from <a> to <b>" — <b> is what was checked out.
      const match = line.match(/^checkout: moving from (.+) to (.+)$/);
      const name = match?.[2]?.trim();
      if (!name || seen.includes(name)) continue;
      // Detached checkouts record a hash, which is not a branch to offer.
      if (/^[0-9a-f]{7,64}$/i.test(name)) continue;
      seen.push(name);
      if (seen.length >= limit) break;
    }
    this.cache.set(cacheKey, seen);
    return seen;
  }

  /** Commits on `branchName` that `target` does not contain. */
  async getUnmergedCommits(
    branchName: string,
    target = "HEAD",
  ): Promise<CommitNode[]> {
    // The range revision takes full refs (or HEAD), so bare branch names are
    // resolved through git rather than concatenated into a ref path.
    const [includeRef, excludeRef] = await Promise.all([
      this.resolveFullRef(branchName),
      this.resolveFullRef(target),
    ]);
    return this.getLog({
      revision: { kind: "range", excludeRef, includeRef },
      maxCount: 50,
    });
  }

  /** Expand a branch name to its full ref; HEAD and full refs pass through. */
  private async resolveFullRef(nameOrRef: string): Promise<string> {
    if (nameOrRef === "HEAD" || nameOrRef.startsWith("refs/")) {
      return nameOrRef;
    }
    await this.validateBranch(nameOrRef);
    const full = (
      await this.execGit(["rev-parse", "--symbolic-full-name", nameOrRef])
    ).trim();
    if (!full.startsWith("refs/")) {
      throw new PorcelainError(
        PorcelainErrorCode.BRANCH_NOT_FOUND,
        `No branch named '${nameOrRef}'`,
      );
    }
    return full;
  }

  /** Drop local commits so the branch matches its upstream exactly. */
  async resetToRemoteBranch(branchName: string): Promise<void> {
    await this.validateBranch(branchName);
    const upstream = (
      await this.execGit([
        "rev-parse",
        "--abbrev-ref",
        `${branchName}@{upstream}`,
      ]).catch(() => "")
    ).trim();
    if (!upstream) {
      throw new PorcelainError(
        PorcelainErrorCode.BRANCH_NO_UPSTREAM,
        `Branch '${branchName}' has no upstream to reset to`,
        "Set a tracked branch first.",
      );
    }
    const current = await this.getCurrentBranch();
    if (current !== branchName) {
      throw new PorcelainError(
        PorcelainErrorCode.BRANCH_NOT_FOUND,
        `Only the checked-out branch can be reset to its remote`,
        `Check out '${branchName}' first.`,
      );
    }
    await this.execGit(["reset", "--hard", upstream]);
    this.invalidateCache();
  }

  /**
   * Local branches already contained in `target`, with the metadata the
   * cleanup dialog shows. `prefix` narrows to a directory-style namespace.
   */
  async getMergedBranches(
    target = "HEAD",
    prefix = "",
  ): Promise<
    Array<{
      name: string;
      lastCommitDate: string;
      upstream?: string;
      merged: boolean;
    }>
  > {
    if (target !== "HEAD") await this.validateBranch(target);
    const merged = new Set(
      (
        await this.execGit([
          "branch",
          "--merged",
          target,
          "--format=%(refname:short)",
        ])
      )
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    );
    const output = await this.execGit([
      "branch",
      `--format=${[
        "%(refname:short)",
        "%(committerdate:iso8601)",
        "%(upstream:short)",
        "%(HEAD)",
      ].join("%00")}`,
    ]);
    const rows: Array<{
      name: string;
      lastCommitDate: string;
      upstream?: string;
      merged: boolean;
    }> = [];
    for (const line of output.split("\n")) {
      if (!line.trim()) continue;
      const [name, date, upstream, head] = line.split(FIELD_SEP);
      const branchName = name?.trim() ?? "";
      if (!branchName) continue;
      // The checked-out branch is never a cleanup candidate.
      if (head?.trim() === "*") continue;
      if (prefix && !branchName.startsWith(prefix)) continue;
      rows.push({
        name: branchName,
        lastCommitDate: date?.trim() ?? "",
        upstream: upstream?.trim() || undefined,
        merged: merged.has(branchName),
      });
    }
    return rows;
  }

  async createBranch(
    newBranchName: string,
    startPoint: string,
    force = false,
  ): Promise<void> {
    const args = force
      ? ["branch", "-f", newBranchName, startPoint]
      : ["branch", newBranchName, startPoint];
    await this.execGit(args);
    this.invalidateCache();
  }

  async deleteBranch(branchName: string, force = false): Promise<void> {
    const flag = force ? "-D" : "-d";
    try {
      await this.execGit(["branch", flag, branchName]);
    } catch (error) {
      const detail = gitErrorText(error);
      if (!force && /not fully merged/i.test(detail)) {
        throw new PorcelainError(
          PorcelainErrorCode.BRANCH_NOT_FULLY_MERGED,
          `Branch '${branchName}' is not fully merged`,
          "Review its exclusive commits or force delete it.",
        );
      }
      throw error;
    }
    this.invalidateCache();
  }

  async deleteRemoteBranch(remoteBranch: string): Promise<void> {
    // remoteBranch is like "origin/feature" → push --delete origin feature
    const slashIdx = remoteBranch.indexOf("/");
    const remote = remoteBranch.substring(0, slashIdx);
    const branch = remoteBranch.substring(slashIdx + 1);
    await this.execGit(["push", remote, "--delete", branch]);
    this.invalidateCache();
  }

  async renameBranch(oldName: string, newName: string): Promise<void> {
    await this.execGit(["branch", "-m", oldName, newName]);
    this.invalidateCache();
  }

  async merge(branchName: string, options: MergeOptions = {}): Promise<void> {
    await this.validateBranch(branchName);
    const args = ["merge"];
    if (options.noFf) args.push("--no-ff");
    if (options.ffOnly) args.push("--ff-only");
    if (options.squash) args.push("--squash");
    if (options.noCommit) args.push("--no-commit");
    if (options.noVerify) args.push("--no-verify");
    if (options.allowUnrelatedHistories)
      args.push("--allow-unrelated-histories");
    if (options.message) args.push("-m", options.message);
    args.push(branchName);
    await this.execGit(args);
    this.invalidateCache();
  }

  async rebase(onto: string, options: RebaseOptions = {}): Promise<void> {
    const args = ["rebase"];
    if (options.interactive) args.push("--interactive");
    if (options.autosquash) args.push("--autosquash");
    if (options.updateRefs) args.push("--update-refs");
    if (options.rebaseMerges) args.push("--rebase-merges");
    if (options.keepEmpty) args.push("--keep-empty");
    if (options.autostash) args.push("--autostash");
    if (options.onto) {
      await this.validateBranch(options.onto);
      args.push("--onto", options.onto);
    }
    if (options.root) {
      args.push("--root");
    } else {
      await this.validateBranch(onto);
      args.push(onto);
    }
    if (options.branch) {
      await this.validateBranch(options.branch);
      args.push(options.branch);
    }
    await this.execGit(args);
    this.invalidateCache();
  }

  /**
   * The commits an interactive rebase would list, oldest-first — the order
   * git writes into `git-rebase-todo` and the order the editor shows.
   */
  async getRebaseTodoCommits(fromHash: string): Promise<CommitNode[]> {
    await this.validateRef(fromHash);
    const parent = await this.resolveParentHash(fromHash);
    const limit = GitService.REBASE_TODO_LIMIT;
    // Fetch one past the cap so an over-range is detected rather than silently
    // truncated: the rendered todo replaces git's own file wholesale, so any
    // omitted commit is read by git as `drop` and its history is lost.
    const commits = parent
      ? await this.getLog({
          revision: { kind: "range", excludeRef: parent, includeRef: "HEAD" },
          maxCount: limit + 1,
        })
      : // A root commit has no parent to exclude: take all of HEAD.
        await this.getLog({
          revision: { kind: "ref", ref: "HEAD" },
          maxCount: limit + 1,
        });
    if (commits.length > limit) {
      throw new PorcelainError(
        PorcelainErrorCode.INVALID_REF,
        `Interactive rebase is limited to ${limit} commits`,
        "Choose a more recent starting commit; rewriting a larger range would risk dropping history.",
      );
    }
    return [...commits].reverse();
  }

  /**
   * The full hash of a commit's first parent, or null at a root commit.
   * Revision expressions like `<hash>^` are resolved here rather than passed
   * through argv, which the ref validators reject on purpose.
   */
  private async resolveParentHash(hash: string): Promise<string | null> {
    await this.validateRef(hash);
    try {
      return (
        await this.execGit(["rev-parse", "--verify", "--quiet", `${hash}^`])
      ).trim();
    } catch (error) {
      if (error instanceof GitCommandError && error.exitCode === 1) return null;
      throw error;
    }
  }

  /**
   * Run a planned interactive rebase. The plan is rendered into
   * `git-rebase-todo` through GIT_SEQUENCE_EDITOR, and any reword or squash
   * messages are served through GIT_EDITOR, so no editor ever opens.
   *
   * A conflict leaves the rebase in progress on purpose: the existing
   * continue/abort/skip banner is what resolves it.
   */
  async runInteractiveRebase(
    baseHash: string,
    entries: readonly RebaseTodoEntry[],
  ): Promise<void> {
    await this.validateRef(baseHash);
    if (entries.length === 0) return;
    for (const entry of entries) {
      await this.validateRef(entry.hash);
    }
    // Squash and fixup fold into the commit above them, so a plan that opens
    // with one has nothing to fold into and git would refuse mid-run.
    const first = entries[0];
    if (first.action === "squash" || first.action === "fixup") {
      throw new PorcelainError(
        PorcelainErrorCode.INVALID_REF,
        "The first commit in a rebase cannot be squashed or fixed up",
        "Move a picked commit above it, or squash into the commit below instead.",
      );
    }

    const setup = await createRebaseEditorSetup(
      renderRebaseTodo(entries),
      collectEditorMessages(entries),
    );
    const base = await this.resolveParentHash(baseHash);
    try {
      await this.execGitWithEnv(
        base
          ? ["rebase", "--interactive", base]
          : // Rewriting from the root commit has no base to rebase onto.
            ["rebase", "--interactive", "--root"],
        setup.env,
      );
    } finally {
      await setup.cleanup();
      this.invalidateCache();
    }
  }

  /** Replace a commit's message: --amend for HEAD, a reword rebase below it. */
  async rewordCommit(hash: string, message: string): Promise<void> {
    await this.validateRef(hash);
    const head = (await this.execGit(["rev-parse", "HEAD"])).trim();
    if (head === hash) {
      await this.execGit(["commit", "--amend", "-m", message]);
      this.invalidateCache();
      return;
    }
    const commits = await this.getRebaseTodoCommits(hash);
    const entries: RebaseTodoEntry[] = commits.map((commit) => ({
      action: commit.hash === hash ? "reword" : "pick",
      hash: commit.hash,
      subject: commit.subject,
      ...(commit.hash === hash ? { message } : {}),
    }));
    await this.runInteractiveRebase(hash, entries);
  }

  /** Fold a run of commits into the oldest of them, under one message. */
  async squashCommits(
    hashes: readonly string[],
    message: string,
  ): Promise<void> {
    if (hashes.length < 2) {
      throw new PorcelainError(
        PorcelainErrorCode.INVALID_REF,
        "Squashing needs at least two commits",
      );
    }
    const ordered = await this.sortHashesOldestFirst(hashes);
    const oldest = ordered[0];
    const selected = new Set(ordered);
    const commits = await this.getRebaseTodoCommits(oldest);
    const subjectOf = new Map(
      commits.map((commit) => [commit.hash, commit.subject]),
    );
    // Git folds each squash into the line directly above it, so the selection
    // has to be laid out contiguously: the anchor reworded on top, the rest
    // squashed in below it (in their own oldest-first order), then every
    // unselected commit picked in its original relative order.
    const entries: RebaseTodoEntry[] = [
      {
        action: "reword",
        hash: oldest,
        subject: subjectOf.get(oldest) ?? "",
        message,
      },
    ];
    const foldHashes = ordered.slice(1);
    foldHashes.forEach((hash, index) => {
      const closesRun = index === foldHashes.length - 1;
      entries.push({
        action: "squash",
        hash,
        subject: subjectOf.get(hash) ?? "",
        // The entry that closes the fold run carries the combined message git
        // prompts for; the anchor's reword is served the same text.
        ...(closesRun ? { message } : {}),
      });
    });
    for (const commit of commits) {
      if (selected.has(commit.hash)) continue;
      entries.push({
        action: "pick",
        hash: commit.hash,
        subject: commit.subject,
      });
    }
    await this.runInteractiveRebase(oldest, entries);
  }

  /** Commit the working tree as a `fixup!`/`squash!` of an existing commit. */
  async commitFixup(
    hash: string,
    kind: "fixup" | "squash",
    filePaths?: readonly string[],
  ): Promise<void> {
    await this.validateRef(hash);
    if (filePaths?.length) {
      await this.execGit(["add", "--", ...filePaths]);
    } else {
      await this.execGit(["add", "-u"]);
    }
    await this.execGit(["commit", `--${kind}=${hash}`]);
    this.invalidateCache();
  }

  /**
   * The hunks of one file's diff — unstaged by default, or the staged diff
   * when `staged` is set. These are what the gutter checkboxes address.
   */
  async getFileHunks(
    filePath: string,
    staged = false,
  ): Promise<ParsedDiff["hunks"]> {
    const args = ["diff", "--no-color", "--no-ext-diff", "-U3"];
    if (staged) args.push("--cached");
    args.push("--", filePath);
    const diff = await this.execGit(args);
    return parseUnifiedDiff(diff).hunks;
  }

  /**
   * Stage only the chosen hunks of a file by handing git a patch built from
   * them. Git recomputes the result, so nothing here has to model the index.
   */
  async stageHunks(
    filePath: string,
    hunkIndices: readonly number[],
  ): Promise<void> {
    await this.applyHunkPatch(filePath, hunkIndices, { reverse: false });
  }

  /** Unstage chosen hunks by applying their patch to the index in reverse. */
  async unstageHunks(
    filePath: string,
    hunkIndices: readonly number[],
  ): Promise<void> {
    await this.applyHunkPatch(filePath, hunkIndices, { reverse: true });
  }

  /**
   * Stage (or unstage) the hunk covering a line, addressed by its position on
   * the new side. The UI knows line numbers; only git knows how it chunked the
   * file, so the mapping is resolved here rather than by trusting the
   * webview's own diff to agree with git's.
   */
  async stageHunkAtLine(
    filePath: string,
    newLine: number,
    options: { unstage?: boolean } = {},
  ): Promise<boolean> {
    const hunks = await this.getFileHunks(filePath, options.unstage === true);
    const target = hunks.find(
      (hunk) =>
        newLine >= hunk.newStart && newLine < hunk.newStart + hunk.newCount,
    );
    if (!target) return false;
    if (options.unstage) {
      await this.unstageHunks(filePath, [target.index]);
    } else {
      await this.stageHunks(filePath, [target.index]);
    }
    return true;
  }

  private async applyHunkPatch(
    filePath: string,
    hunkIndices: readonly number[],
    options: { reverse: boolean },
  ): Promise<void> {
    if (hunkIndices.length === 0) return;
    const args = ["diff", "--no-color", "--no-ext-diff", "-U3"];
    // Unstaging reads the staged diff; staging reads the working-tree diff.
    if (options.reverse) args.push("--cached");
    args.push("--", filePath);
    const parsed = parseUnifiedDiff(await this.execGit(args));
    const patch = buildPartialPatch(parsed, hunkIndices);
    if (!patch) return;
    await this.executor.withInput(
      // Context is deliberately verified: the patch carries three lines of
      // it, so git refusing to apply means the file moved under us.
      ["apply", "--cached", ...(options.reverse ? ["--reverse"] : []), "-"],
      patch,
    );
    this.invalidateCache();
  }

  /** The commit message template configured via `commit.template`, if any. */
  async getCommitTemplate(): Promise<string | null> {
    const configured = (
      await this.execGit(["config", "commit.template"]).catch(() => "")
    ).trim();
    if (!configured) return null;
    const resolved = configured.startsWith("~")
      ? path.join(os.homedir(), configured.slice(1))
      : path.isAbsolute(configured)
        ? configured
        : path.join(this.paths.workTreeRoot, configured);
    return fs.readFile(resolved, "utf8");
  }

  /** The default message git prepares mid-merge (MERGE_MSG). */
  async getMergeMessage(): Promise<string | null> {
    const mergeMsgPath = path.join(this.paths.gitDir, "MERGE_MSG");
    try {
      return await fs.readFile(mergeMsgPath, "utf8");
    } catch {
      return null;
    }
  }

  /**
   * Add a path to the repository's .gitignore, creating the file if needed.
   * Returns the ignore file that was written.
   */
  async addToGitignore(relativePath: string): Promise<string> {
    if (!relativePath || relativePath.startsWith("-")) {
      throw new Error(`Invalid path to ignore: ${relativePath}`);
    }
    const ignorePath = path.join(this.paths.workTreeRoot, ".gitignore");
    let existing = "";
    try {
      existing = await fs.readFile(ignorePath, "utf8");
    } catch {
      // A repository without a .gitignore yet gets one.
    }
    const entry = relativePath.replace(/\\/g, "/");
    const lines = existing.split("\n").map((line) => line.trim());
    if (lines.includes(entry)) return ignorePath;
    const separator =
      existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
    await fs.writeFile(ignorePath, `${existing}${separator}${entry}\n`);
    this.invalidateCache();
    return ignorePath;
  }

  /** Stash with the options IntelliJ's Stash dialog exposes. */
  async stashWithOptions(options: {
    message?: string;
    keepIndex?: boolean;
    includeUntracked?: boolean;
  }): Promise<void> {
    const args = ["stash", "push"];
    if (options.keepIndex) args.push("--keep-index");
    if (options.includeUntracked) args.push("--include-untracked");
    if (options.message) args.push("-m", options.message);
    await this.execGit(args);
    this.invalidateCache();
  }

  /** Create a branch from a stash entry, IntelliJ's "As new branch". */
  async stashToBranch(stashRef: string, branchName: string): Promise<void> {
    await this.validateBranch(branchName);
    if (!/^stash@\{\d+\}$/.test(stashRef)) {
      throw new Error(`Invalid stash reference: ${stashRef}`);
    }
    await this.execGit(["stash", "branch", branchName, stashRef]);
    this.invalidateCache();
  }

  /**
   * Blame a file: one entry per line, carrying the commit that last touched
   * it. Parsed from porcelain format, where a commit's details appear once
   * and later lines referring to it repeat only the hash.
   */
  async blameFile(
    filePath: string,
    options: BlameOptions = {},
  ): Promise<BlameLine[]> {
    const args = ["blame", "--line-porcelain"];
    if (options.ignoreWhitespace) args.push("-w");
    // -M finds lines moved within the file, -C across files in the commit.
    if (options.detectMovesWithinFile) args.push("-M");
    if (options.detectMovesAcrossFiles) args.push("-C");
    if (options.revision) {
      await this.validateRef(options.revision);
      args.push(options.revision);
    }
    args.push("--", filePath);

    const output = await this.execGit(args, MAX_BUFFER);
    return parseBlamePorcelain(output);
  }

  /** Undo the last commit, keeping its changes in the working tree. */
  async undoLastCommit(): Promise<void> {
    await this.execGit(["reset", "--soft", "HEAD~1"]);
    this.invalidateCache();
  }

  async rebaseAction(action: "continue" | "abort" | "skip"): Promise<void> {
    if (action === "continue") {
      // Stage all resolved files before continuing
      await this.execGit(["add", "-u"]);
    }
    await this.execGit(["rebase", `--${action}`]);
    this.invalidateCache();
  }

  async mergeAbort(): Promise<void> {
    await this.execGit(["merge", "--abort"]);
    this.invalidateCache();
  }

  async mergeContinue(): Promise<void> {
    // Stage all resolved files before committing
    await this.execGit(["add", "-u"]);
    await this.execGit(["commit", "--no-edit"]);
    this.invalidateCache();
  }

  async checkoutAndRebase(
    branchToCheckout: string,
    rebaseOnto: string,
  ): Promise<void> {
    await this.execGit(["checkout", branchToCheckout]);
    await this.execGit(["rebase", rebaseOnto]);
    this.invalidateCache();
  }

  async push(
    branchName: string,
    force = false,
    remote = "origin",
    targetBranch?: string,
    options: PushOptions = {},
  ): Promise<string> {
    await this.validateBranch(branchName);
    await this.validateRemoteName(remote);
    if (targetBranch) await this.validateBranch(targetBranch);
    const args = ["push"];
    // Safe force by default: --force-with-lease refuses when the remote moved
    // in a way we have not seen, which plain --force would silently overwrite.
    if (force) args.push("--force-with-lease");
    if (options.setUpstream) args.push("--set-upstream");
    if (options.noVerify) args.push("--no-verify");
    if (options.pushTags === "all") args.push("--tags");
    args.push(remote, `${branchName}:${targetBranch || branchName}`);
    const output = await this.execGit(args);
    this.invalidateCache();
    return output;
  }

  /**
   * Whether a branch matches any protected pattern. Patterns are regexes, as
   * IntelliJ's "Protected branches" list is; an unparseable pattern falls back
   * to an exact-name match rather than throwing the push away.
   */
  isProtectedBranch(branchName: string, patterns: readonly string[]): boolean {
    return patterns.some((pattern) => {
      if (!pattern.trim()) return false;
      try {
        return new RegExp(`^${pattern}$`).test(branchName);
      } catch {
        return pattern === branchName;
      }
    });
  }

  /**
   * Fetch, then bring the current branch up to date the way the user asked —
   * merge or rebase — carrying uncommitted work across with a stash.
   */
  async updateProject(options: {
    method: "merge" | "rebase";
    fetchTags?: "auto" | "all" | "none";
  }): Promise<{ method: string; updated: boolean; commits: CommitNode[] }> {
    const before = (await this.execGit(["rev-parse", "HEAD"])).trim();
    const fetchArgs = ["fetch"];
    if (options.fetchTags === "all") fetchArgs.push("--tags");
    if (options.fetchTags === "none") fetchArgs.push("--no-tags");
    await this.execGit(fetchArgs);

    const branch = await this.getCurrentBranch();
    if (!branch) {
      throw new PorcelainError(
        PorcelainErrorCode.BRANCH_NOT_FOUND,
        "Cannot update a detached HEAD",
        "Check out a branch first.",
      );
    }
    const upstream = (
      await this.execGit([
        "rev-parse",
        "--abbrev-ref",
        `${branch}@{upstream}`,
      ]).catch(() => "")
    ).trim();
    if (!upstream) {
      throw new PorcelainError(
        PorcelainErrorCode.BRANCH_NO_UPSTREAM,
        `Branch '${branch}' has no tracked branch to update from`,
        "Set a tracked branch, then update again.",
      );
    }

    // Resolve the fetched upstream tip before the merge/rebase runs: "what
    // arrived" is the commits reachable from upstream but not from the
    // pre-update HEAD. Deriving it from before..HEAD instead would count our
    // own commits replayed by a rebase, or a locally-created merge commit.
    const upstreamTip = (await this.execGit(["rev-parse", upstream])).trim();

    // --autostash carries uncommitted work across the update and puts it back
    // afterwards, which is what IntelliJ's "clean working tree using stash"
    // does around its own update.
    await this.execGit(
      options.method === "rebase"
        ? ["rebase", "--autostash", upstream]
        : ["merge", "--autostash", upstream],
    );
    this.invalidateCache();

    const after = (await this.execGit(["rev-parse", "HEAD"])).trim();
    if (before === after) {
      return { method: options.method, updated: false, commits: [] };
    }
    // What arrived, for the update-info view: the upstream range only.
    const commits = await this.getLog({
      revision: { kind: "range", excludeRef: before, includeRef: upstreamTip },
      maxCount: 200,
    });
    return { method: options.method, updated: true, commits };
  }

  /**
   * Incoming and outgoing counts per local branch, from the refs already
   * fetched — no network access, so it is cheap enough to call on refresh.
   */
  async getIncomingOutgoing(): Promise<
    Record<string, { incoming: number; outgoing: number }>
  > {
    const output = await this.execGit([
      "for-each-ref",
      `--format=${["%(refname:short)", "%(upstream:track,nobracket)"].join("%00")}`,
      "refs/heads",
    ]);
    const result: Record<string, { incoming: number; outgoing: number }> = {};
    for (const line of output.split("\n")) {
      if (!line.trim()) continue;
      const [name, track] = line.split(FIELD_SEP);
      const branchName = name?.trim();
      if (!branchName) continue;
      const ahead = Number(track?.match(/ahead (\d+)/)?.[1] ?? 0);
      const behind = Number(track?.match(/behind (\d+)/)?.[1] ?? 0);
      result[branchName] = { incoming: behind, outgoing: ahead };
    }
    return result;
  }

  /**
   * Get commits that are ahead of the remote tracking branch.
   * Returns commits in newest-first order.
   */
  async getAheadCommits(
    branchName: string,
    remote?: string,
  ): Promise<CommitNode[]> {
    const remoteName = remote || (await this.getDefaultRemote(branchName));
    const upstream = `${remoteName}/${branchName}`;
    // Check if upstream exists
    try {
      await this.execGit(["rev-parse", "--verify", upstream]);
    } catch {
      // No upstream — all local commits are "ahead"
      const args = [
        "log",
        `--format=${LOG_FORMAT}${FMT_RECORD_SEP}`,
        branchName,
        "--max-count=50",
      ];
      const output = await this.execGit(args);
      return parseLogOutput(output);
    }
    const args = [
      "log",
      `--format=${LOG_FORMAT}${FMT_RECORD_SEP}`,
      `${upstream}..${branchName}`,
    ];
    const output = await this.execGit(args);
    return parseLogOutput(output);
  }

  async pull(branchName?: string): Promise<void> {
    const args = ["pull", "--autostash"];
    if (branchName) {
      // The remote is resolved rather than assumed: not every repository
      // calls its remote "origin".
      args.push(await this.getDefaultRemote(), branchName);
    }
    await this.execGit(args);
    this.invalidateCache();
  }

  /** Pull with the options the Pull dialog exposes. */
  async pullWithOptions(options: PullOptions = {}): Promise<void> {
    const args = ["pull"];
    if (options.rebase) args.push("--rebase");
    if (options.ffOnly) args.push("--ff-only");
    if (options.noFf) args.push("--no-ff");
    if (options.squash) args.push("--squash");
    if (options.noCommit) args.push("--no-commit");
    if (options.remote) {
      await this.validateRemoteName(options.remote);
      args.push(options.remote);
      if (options.branch) {
        await this.validateBranch(options.branch);
        args.push(options.branch);
      }
    }
    await this.execGit(args);
    this.invalidateCache();
  }

  async updateBranch(branchName: string): Promise<void> {
    const localRef = `refs/heads/${branchName}`;
    const trackingOutput = await this.execGit([
      "for-each-ref",
      `--format=%(refname)${REF_FMT_FIELD_SEP}%(upstream:remotename)${REF_FMT_FIELD_SEP}%(upstream:remoteref)`,
      localRef,
    ]);
    const [resolvedRef, remote, remoteRef] = trackingOutput
      .trim()
      .split(FIELD_SEP);
    if (resolvedRef !== localRef) {
      throw new PorcelainError(
        PorcelainErrorCode.BRANCH_NOT_FOUND,
        `Local branch '${branchName}' does not exist`,
      );
    }
    if (!remote || !remoteRef) {
      throw new PorcelainError(
        PorcelainErrorCode.BRANCH_NO_UPSTREAM,
        `Branch '${branchName}' has no configured upstream`,
      );
    }

    const currentBranch = (
      await this.execGit(["branch", "--show-current"])
    ).trim();
    if (currentBranch === branchName) {
      await this.pull();
      return;
    }

    const checkedOutPath = parseWorktreeCheckouts(
      await this.execGit(["worktree", "list", "--porcelain"]),
    ).get(localRef);
    if (checkedOutPath) {
      throw new PorcelainError(
        PorcelainErrorCode.BRANCH_CHECKED_OUT_IN_WORKTREE,
        `Branch '${branchName}' is checked out in worktree '${checkedOutPath}'`,
      );
    }

    try {
      await this.execGit(["fetch", remote, `${remoteRef}:${localRef}`]);
    } catch (error) {
      const detail = gitErrorText(error);
      if (/non-fast-forward|\[rejected\]/i.test(detail)) {
        throw new PorcelainError(
          PorcelainErrorCode.BRANCH_NON_FAST_FORWARD,
          `Branch '${branchName}' cannot be fast-forwarded from its upstream`,
        );
      }
      throw error;
    }
    this.invalidateCache();
  }

  async pullRebase(branchName?: string): Promise<void> {
    const args = ["pull", "--rebase", "--autostash"];
    if (branchName) {
      args.push("origin", branchName);
    }
    await this.execGit(args);
    this.invalidateCache();
  }

  async fetch(remote = "origin"): Promise<void> {
    await this.execGit(["fetch", remote]);
    this.invalidateCache();
  }

  /** Cherry-pick one or more commits, given oldest-first. */
  async cherryPick(hashes: string | string[]): Promise<void> {
    const list = Array.isArray(hashes) ? hashes : [hashes];
    if (list.length === 0) return;
    for (const hash of list) {
      await this.validateRef(hash);
    }
    await this.execGit(["cherry-pick", ...list]);
    this.invalidateCache();
  }

  async checkoutCommit(hash: string): Promise<void> {
    await this.execGit(["checkout", hash]);
    this.invalidateCache();
  }

  async checkoutFileFromCommit(hash: string, filePath: string): Promise<void> {
    await this.execGit(["checkout", hash, "--", filePath]);
    this.invalidateCache();
  }

  async checkoutFileFromParent(
    hash: string,
    filePath: string,
    status?: string,
  ): Promise<void> {
    if (status === "added") {
      // File was newly added in this commit, revert means removing it
      // Use --cached to handle case where file may not exist on disk
      try {
        await this.execGit(["rm", "-f", "--", filePath]);
      } catch {
        // File might not exist in working tree or index, try removing from index only
        try {
          await this.execGit(["rm", "-f", "--cached", "--", filePath]);
        } catch {
          // File doesn't exist at all - nothing to revert
        }
        // Also try to remove the physical file if it exists
        try {
          await fs.unlink(path.join(this.rootPath, filePath));
        } catch {
          // File already doesn't exist on disk
        }
      }
    } else if (status === "deleted") {
      // File was deleted in this commit, revert means restoring it from parent
      await this.execGit(["checkout", `${hash}~1`, "--", filePath]);
    } else {
      // File was modified/renamed/copied, revert to parent state
      await this.execGit(["checkout", `${hash}~1`, "--", filePath]);
    }
    this.invalidateCache();
  }

  async resetToCommit(
    hash: string,
    mode: "soft" | "mixed" | "hard",
  ): Promise<void> {
    await this.execGit(["reset", `--${mode}`, hash]);
    this.invalidateCache();
  }

  async revertCommit(hash: string): Promise<void> {
    await this.execGit(["revert", "--no-edit", hash]);
    this.invalidateCache();
  }

  async dropCommit(hash: string): Promise<void> {
    const headHash = (await this.execGit(["rev-parse", "HEAD"])).trim();
    const isHead = hash === headHash;

    if (isHead) {
      await this.dropHeadCommit(hash);
    } else {
      await this.dropNonHeadCommit(hash);
    }
    this.invalidateCache();
  }

  private async dropHeadCommit(hash: string): Promise<void> {
    // Verify commit has a parent
    const parents = await this.getCommitParents(hash);
    if (parents.length === 0) {
      throw new Error("Cannot drop the initial commit (no parent)");
    }
    await this.execGit(["reset", "--mixed", "HEAD~1"]);
  }

  private async dropNonHeadCommit(hash: string): Promise<void> {
    // 1. Capture the target commit's diff BEFORE rebase
    const diff = await this.execGit(["diff-tree", "-p", hash]);

    // 2. Check working directory status
    const status = await this.execGit(["status", "--porcelain"]);
    const isDirty = status.trim().length > 0;

    // 3. Stash if dirty
    if (isDirty) {
      await this.execGit([
        "stash",
        "push",
        "-u",
        "-m",
        "drop-commit-autostash",
      ]);
    }

    // 4. Execute rebase to remove the commit
    try {
      await this.execGit(["rebase", "--onto", `${hash}^`, hash]);
    } catch (rebaseErr) {
      // Abort rebase on failure
      try {
        await this.execGit(["rebase", "--abort"]);
      } catch {
        // ignore abort errors
      }

      // Restore stash if it was used
      if (isDirty) {
        try {
          await this.execGit(["stash", "pop"]);
        } catch {
          // stash pop failure is secondary
        }
      }

      throw rebaseErr;
    }

    // 5. Restore stashed changes on success
    if (isDirty) {
      await this.execGit(["stash", "pop"]);
    }

    // 6. Apply dropped commit's diff to working directory via temp file
    if (diff.trim()) {
      const tmpFile = path.join(os.tmpdir(), `drop-commit-${hash}.patch`);
      try {
        await fs.writeFile(tmpFile, diff, "utf-8");
        await this.execGit(["apply", "--3way", tmpFile]);
      } catch {
        throw new Error(
          "Commit was removed from history but its changes could not be applied to the working directory",
        );
      } finally {
        try {
          await fs.unlink(tmpFile);
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }

  async createBranchFromCommit(
    branchName: string,
    hash: string,
    force = false,
  ): Promise<void> {
    const args = force
      ? ["branch", "-f", branchName, hash]
      : ["branch", branchName, hash];
    await this.execGit(args);
    this.invalidateCache();
  }

  async createTag(
    tagName: string,
    hash: string,
    message?: string,
    force = false,
  ): Promise<void> {
    const forceFlag = force ? ["-f"] : [];
    if (message) {
      await this.execGit([
        "tag",
        ...forceFlag,
        "-a",
        tagName,
        hash,
        "-m",
        message,
      ]);
    } else {
      await this.execGit(["tag", ...forceFlag, tagName, hash]);
    }
    this.invalidateCache();
  }

  async deleteTag(tagName: string): Promise<void> {
    await this.validateRef(`refs/tags/${tagName}`);
    await this.execGit(["tag", "-d", tagName]);
    this.invalidateCache();
  }

  /** Delete a tag on one or more remotes, reporting where it existed. */
  async deleteRemoteTag(
    tagName: string,
    remotes: string[],
  ): Promise<Array<{ remote: string; deleted: boolean; message?: string }>> {
    await this.validateRef(`refs/tags/${tagName}`);
    const results: Array<{
      remote: string;
      deleted: boolean;
      message?: string;
    }> = [];
    for (const remote of remotes) {
      await this.validateRemoteName(remote);
      try {
        await this.execGit([
          "push",
          remote,
          "--delete",
          `refs/tags/${tagName}`,
        ]);
        results.push({ remote, deleted: true });
      } catch (error) {
        results.push({
          remote,
          deleted: false,
          message: gitErrorText(error).trim(),
        });
      }
    }
    this.invalidateCache();
    return results;
  }

  /** Push one tag, or every tag, to a remote. */
  async pushTag(remote: string, tagName?: string): Promise<void> {
    await this.validateRemoteName(remote);
    if (tagName) {
      await this.validateRef(`refs/tags/${tagName}`);
      await this.execGit(["push", remote, `refs/tags/${tagName}`]);
    } else {
      await this.execGit(["push", remote, "--tags"]);
    }
    this.invalidateCache();
  }

  /** Configured remotes with their fetch URLs. */
  async getRemotes(): Promise<Array<{ name: string; url: string }>> {
    const cacheKey = "refs:remotes";
    const cached =
      this.cache.get<Array<{ name: string; url: string }>>(cacheKey);
    if (cached) {
      return cached;
    }
    const output = await this.execGit(["remote", "-v"]).catch(() => "");
    const byName = new Map<string, string>();
    for (const line of output.split("\n")) {
      if (!line.trim()) continue;
      const match = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/);
      if (match) byName.set(match[1], match[2]);
    }
    const result = [...byName].map(([name, url]) => ({ name, url }));
    this.cache.set(cacheKey, result);
    return result;
  }

  async addRemote(name: string, url: string): Promise<void> {
    await this.validateRemoteName(name, { mustExist: false });
    assertRemoteUrl(url);
    try {
      await this.execGit(["remote", "add", name, url]);
    } catch (error) {
      if (/already exists/i.test(gitErrorText(error))) {
        throw new PorcelainError(
          PorcelainErrorCode.REMOTE_ALREADY_EXISTS,
          `A remote named '${name}' already exists`,
          "Pick another name, or edit the existing remote.",
        );
      }
      throw error;
    }
    this.invalidateCache();
  }

  async renameRemote(oldName: string, newName: string): Promise<void> {
    await this.validateRemoteName(oldName);
    await this.validateRemoteName(newName, { mustExist: false });
    await this.execGit(["remote", "rename", oldName, newName]);
    this.invalidateCache();
  }

  async setRemoteUrl(name: string, url: string): Promise<void> {
    await this.validateRemoteName(name);
    assertRemoteUrl(url);
    await this.execGit(["remote", "set-url", name, url]);
    this.invalidateCache();
  }

  async removeRemote(name: string): Promise<void> {
    await this.validateRemoteName(name);
    await this.execGit(["remote", "remove", name]);
    this.invalidateCache();
  }

  /**
   * Remote names reach git as argv values, so they are checked against the
   * configured set (or the ref-name grammar when the remote is being created).
   */
  private async validateRemoteName(
    name: string,
    options: { mustExist?: boolean } = {},
  ): Promise<void> {
    const mustExist = options.mustExist ?? true;
    if (!name || name.startsWith("-")) {
      throw new Error(`Invalid Git remote: ${name}`);
    }
    if (mustExist) {
      const configured = (await this.execGit(["remote"]).catch(() => ""))
        .split("\n")
        .map((line) => line.trim());
      if (!configured.includes(name)) {
        throw new PorcelainError(
          PorcelainErrorCode.REMOTE_NOT_FOUND,
          `No remote named '${name}'`,
        );
      }
      return;
    }
    try {
      await this.execGit(["check-ref-format", `refs/remotes/${name}/HEAD`]);
    } catch {
      throw new Error(`Invalid Git remote: ${name}`);
    }
  }

  // ─── Commit Panel Operations ───────────────────────────────────────

  async getWorkingTreeChanges(): Promise<import("./types").WorkingTreeFile[]> {
    return this.workingTreeService.getWorkingTreeChanges();
  }

  async stageFiles(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return;
    await this.execGit(["add", "--", ...filePaths]);
  }

  async unstageFile(filePath: string): Promise<void> {
    await this.execGit(["reset", "HEAD", "--", filePath]);
  }

  async unstageAll(): Promise<void> {
    await this.execGit(["reset", "HEAD"]);
  }

  async stageAll(): Promise<void> {
    await this.execGit(["add", "-A"]);
  }

  async commit(
    message: string,
    amend = false,
    options: CommitOptions = {},
  ): Promise<void> {
    const args = ["commit", "-m", message];
    if (amend) args.push("--amend");
    if (options.signOff) args.push("--signoff");
    if (options.noVerify) args.push("--no-verify");
    if (options.author) {
      assertCommitAuthor(options.author);
      args.push(`--author=${options.author}`);
    }
    await this.execGit(args);
    this.invalidateCache();
  }

  async commitSelected(
    request: CommitRequest,
  ): Promise<GitOperationResult<void>> {
    const result = await this.commitService.commitSelected(request);
    if (result.ok) this.invalidateCache();
    return result;
  }

  async commitAndPush(message: string, amend = false): Promise<void> {
    await this.commit(message, amend);
    await this.pushCurrentBranch(amend);
  }

  async pushCurrentBranch(force = false): Promise<void> {
    const branch = await this.getCurrentBranch();
    if (branch) {
      await this.push(branch, force);
    }
  }

  async getCurrentBranch(): Promise<string | null> {
    try {
      const output = await this.execGit(["rev-parse", "--abbrev-ref", "HEAD"]);
      const branch = output.trim();
      return branch === "HEAD" ? null : branch;
    } catch {
      return null;
    }
  }

  /**
   * Get the default remote for the current branch.
   * Tries the upstream tracking remote first, then falls back to the first configured remote.
   */
  async getDefaultRemote(branch?: string): Promise<string> {
    // Try to get the upstream remote for the given branch
    if (branch) {
      try {
        const output = await this.execGit([
          "config",
          `branch.${branch}.remote`,
        ]);
        const remote = output.trim();
        if (remote) return remote;
      } catch {
        // No upstream configured
      }
    }

    // Fall back to first configured remote
    try {
      const output = await this.execGit(["remote"]);
      const remotes = output
        .trim()
        .split("\n")
        .map((r) => r.trim())
        .filter(Boolean);
      if (remotes.length > 0) {
        // Prefer "origin" if it exists, otherwise first remote
        return remotes.includes("origin") ? "origin" : remotes[0];
      }
    } catch {
      // ignore
    }

    return "origin";
  }

  async getLastCommitMessage(): Promise<string> {
    try {
      const output = await this.execGit(["log", "-1", "--format=%B"]);
      return output.trim();
    } catch {
      return "";
    }
  }

  async getRecentCommitMessages(count = 20): Promise<string[]> {
    try {
      const output = await this.execGit(["log", `-${count}`, "--format=%s"]);
      return output
        .trim()
        .split("\n")
        .filter((msg) => msg.length > 0);
    } catch {
      return [];
    }
  }

  async rollbackFile(filePath: string): Promise<void> {
    // Check if file exists in HEAD (i.e., was previously committed)
    let existsInHead = false;
    try {
      await this.execGit(["cat-file", "-e", `HEAD:${filePath}`]);
      existsInHead = true;
    } catch {
      existsInHead = false;
    }

    if (existsInHead) {
      // File exists in HEAD - restore to HEAD version (handles both staged and unstaged changes)
      await this.execGit(["checkout", "HEAD", "--", filePath]);
    } else {
      // File is new (not in HEAD) - remove from index and delete from disk
      try {
        await this.execGit(["rm", "-f", "--cached", "--", filePath]);
      } catch {
        // Not in index either, nothing to unstage
      }
      const fullPath = path.join(this.rootPath, filePath);
      try {
        await fs.unlink(fullPath);
      } catch {
        // File already doesn't exist on disk
      }
    }
  }

  // ─── Shelf (Stash-based) Operations ───────────────────────────────

  async getShelves(): Promise<import("./types").ShelveEntry[]> {
    try {
      const output = await this.execGit([
        "stash",
        "list",
        "--format=%gd%x00%s%x00%aI%x00%D",
      ]);
      if (!output.trim()) return [];

      const entries: import("./types").ShelveEntry[] = [];
      for (const line of output.trim().split("\n")) {
        if (!line.trim()) continue;
        const parts = line.split("\x00");
        const id = parts[0] ?? "";
        const message = (parts[1] ?? "").replace(/^(WIP on|On) [^:]+:\s*/, "");
        const date = parts[2] ?? "";
        const _refs = parts[3] ?? "";
        // Extract branch from refs or message
        const branchMatch = (parts[1] ?? "").match(/^(?:WIP on|On) ([^:]+)/);
        const branch = branchMatch?.[1] ?? "";

        entries.push({ id, message, date, branch, files: [] });
      }

      // Load files for each stash
      for (const entry of entries) {
        try {
          const filesOutput = await this.execGit([
            "stash",
            "show",
            entry.id,
            "--name-only",
          ]);
          entry.files = filesOutput.trim().split("\n").filter(Boolean);
        } catch {
          // ignore
        }
      }

      return entries;
    } catch {
      return [];
    }
  }

  async shelveChanges(message: string, filePaths?: string[]): Promise<void> {
    const selections = filePaths
      ? await this.resolveShelfPaths(filePaths)
      : undefined;
    const result = await this.nativeShelfService.create({
      message,
      ...(selections !== undefined ? { selections } : {}),
    });
    this.unwrapShelfResult(result);
    this.invalidateCache();
  }

  async unshelveChanges(stashId: string, drop = true): Promise<void> {
    if (drop) {
      await this.execGit(["stash", "pop", stashId]);
    } else {
      await this.execGit(["stash", "apply", stashId]);
    }
    this.invalidateCache();
  }

  async deleteShelve(stashId: string): Promise<void> {
    await this.execGit(["stash", "drop", stashId]);
  }

  // ─── IDEA Shelf (patch-file based) Operations ─────────────────────

  async getIdeaShelves(): Promise<IdeaShelfEntry[]> {
    const shelfDir = path.join(this.rootPath, ".idea", "shelf");
    try {
      await fs.access(shelfDir);
    } catch {
      return [];
    }

    const entries: IdeaShelfEntry[] = [];
    const dirContents = await fs.readdir(shelfDir);

    for (const item of dirContents) {
      if (!item.endsWith(".xml")) continue;
      const xmlPath = path.join(shelfDir, item);
      try {
        const xmlContent = await fs.readFile(xmlPath, "utf-8");
        const entry = this.parseIdeaShelfXml(xmlContent, shelfDir);
        if (entry) entries.push(entry);
      } catch {
        // skip malformed entries
      }
    }

    // Sort by date descending (newest first)
    entries.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    return entries;
  }

  private parseIdeaShelfXml(
    xmlContent: string,
    shelfDir: string,
  ): IdeaShelfEntry | null {
    // Parse: <changelist name="..." date="..." recycled="...">
    const nameMatch = xmlContent.match(/changelist\s+name="([^"]*)"/);
    const dateMatch = xmlContent.match(/\bdate="(\d+)"/);
    const pathMatch = xmlContent.match(
      /option\s+name="PATH"\s+value="([^"]*)"/,
    );
    const descMatch = xmlContent.match(
      /option\s+name="DESCRIPTION"\s+value="([^"]*)"/,
    );

    if (!nameMatch || !pathMatch) return null;

    const name = nameMatch[1];
    const dateMs = dateMatch ? Number.parseInt(dateMatch[1], 10) : Date.now();
    const date = new Date(dateMs).toISOString();
    const description = descMatch?.[1] ?? "";

    // Resolve $PROJECT_DIR$ to workspace root
    const patchRelative = pathMatch[1].replace(
      /\$PROJECT_DIR\$/g,
      this.rootPath,
    );
    const patchPath = path.isAbsolute(patchRelative)
      ? patchRelative
      : path.join(shelfDir, patchRelative);

    // Parse files from patch
    const files = this.parseFilesFromPatchPath(patchPath);

    return { name, description, date, patchPath, files };
  }

  private parseFilesFromPatchPath(patchPath: string): string[] {
    try {
      const content = require("node:fs").readFileSync(patchPath, "utf-8");
      return this.parseFilesFromPatch(content);
    } catch {
      return [];
    }
  }

  private parseFilesFromPatch(patchContent: string): string[] {
    const files: string[] = [];
    const lines = patchContent.split("\n");
    for (const line of lines) {
      // Match: diff --git a/path b/path
      const diffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (diffMatch) {
        files.push(diffMatch[2]);
        continue;
      }
      // Match: Index: path
      const indexMatch = line.match(/^Index:\s+(.+)$/);
      if (indexMatch) {
        files.push(indexMatch[1]);
      }
    }
    return [...new Set(files)];
  }

  async ideaShelveChanges(
    message: string,
    filePaths?: string[],
  ): Promise<void> {
    const selections = filePaths
      ? await this.resolveShelfPaths(filePaths)
      : undefined;
    const result = await this.patchShelfService.create({
      message,
      ...(selections !== undefined ? { selections } : {}),
    });
    this.unwrapShelfResult(result);
    this.invalidateCache();
  }

  async ideaUnshelveChanges(shelfName: string, drop?: boolean): Promise<void> {
    const shelfDir = path.join(this.rootPath, ".idea", "shelf");
    const patchPath = path.join(shelfDir, shelfName, "shelved.patch");

    try {
      const patchContent = await fs.readFile(patchPath, "utf-8");
      if (patchContent.trim()) {
        // Apply patch using git apply
        try {
          await this.execGit(["apply", "--3way", patchPath]);
        } catch {
          // Try without --3way as fallback
          await this.execGit(["apply", patchPath]);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to apply shelf "${shelfName}": ${message}`);
    }

    if (drop) {
      await this.deleteIdeaShelf(shelfName);
    }

    this.invalidateCache();
  }

  async deleteIdeaShelf(shelfName: string): Promise<void> {
    const shelfDir = path.join(this.rootPath, ".idea", "shelf");
    const entryDir = path.join(shelfDir, shelfName);
    const xmlPath = path.join(shelfDir, `${shelfName}.xml`);

    // Delete directory
    try {
      await fs.rm(entryDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    // Delete XML file
    try {
      await fs.unlink(xmlPath);
    } catch {
      // ignore
    }
  }

  private sanitizeShelfName(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .substring(0, 100);
  }

  async importPatchAsShelf(name: string, patchContent: string): Promise<void> {
    const shelfDir = path.join(this.rootPath, ".idea", "shelf");
    await fs.mkdir(shelfDir, { recursive: true });

    const sanitized = this.sanitizeShelfName(name || "Imported");
    const shelfName = await this.getUniqueShelfName(shelfDir, sanitized);

    // Create shelf directory and write patch
    const entryDir = path.join(shelfDir, shelfName);
    await fs.mkdir(entryDir, { recursive: true });
    await fs.writeFile(
      path.join(entryDir, "shelved.patch"),
      patchContent,
      "utf-8",
    );

    // Write XML metadata
    const now = Date.now();
    const xml = `<changelist name="${shelfName}" date="${now}" recycled="false">\n  <option name="PATH" value="$PROJECT_DIR$/.idea/shelf/${shelfName}/shelved.patch" />\n  <option name="DESCRIPTION" value="${shelfName}" />\n</changelist>\n`;
    await fs.writeFile(path.join(shelfDir, `${shelfName}.xml`), xml, "utf-8");
  }

  private async getUniqueShelfName(
    shelfDir: string,
    baseName: string,
  ): Promise<string> {
    let candidate = baseName;
    let counter = 1;
    while (true) {
      const xmlPath = path.join(shelfDir, `${candidate}.xml`);
      try {
        await fs.access(xmlPath);
        // File exists, try next
        candidate = `${baseName}${counter}`;
        counter++;
      } catch {
        // File doesn't exist, use this name
        return candidate;
      }
    }
  }

  private async resolveShelfPaths(
    filePaths: readonly string[],
  ): Promise<CommitPathSelection[]> {
    const changes = await this.workingTreeService.getWorkingTreeChanges();
    return filePaths.map((filePath) => {
      const matching = changes.filter(
        (change) => change.path === filePath || change.oldPath === filePath,
      );
      const oldPath = matching.find((change) => change.oldPath)?.oldPath;
      return {
        path: filePath,
        ...(oldPath ? { oldPath } : {}),
        includeIndex: matching.some((change) => change.staged),
        includeWorkingTree: matching.some((change) => !change.staged),
      };
    });
  }

  private unwrapShelfResult<T>(result: GitOperationResult<T>): T {
    if (result.ok) return result.value;
    throw new PorcelainError(result.code, result.message, result.recovery);
  }

  invalidateCache(pattern?: string): void {
    this.cache.invalidate(pattern);
  }
}

function gitErrorText(error: unknown): string {
  if (error && typeof error === "object") {
    const stderr = "stderr" in error ? String(error.stderr ?? "") : "";
    const message = "message" in error ? String(error.message ?? "") : "";
    return `${message}\n${stderr}`;
  }
  return String(error);
}

function parseWorktreeCheckouts(output: string): Map<string, string> {
  const result = new Map<string, string>();
  let worktreePath: string | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      worktreePath = line.slice("worktree ".length);
    } else if (line.startsWith("branch ") && worktreePath) {
      result.set(line.slice("branch ".length), worktreePath);
    } else if (!line.trim()) {
      worktreePath = null;
    }
  }
  return result;
}

/**
 * Remote URLs reach git as argv values. Anything starting with "-" would be
 * read as an option, so it is rejected before the command is built.
 */
/**
 * `--author` is a single argv value, so a leading "-" would be read as an
 * option. Git itself validates the "Name <email>" shape when it commits.
 */
/**
 * Parse `git blame --line-porcelain`. Each line begins with
 * "<hash> <origLine> <finalLine>", then header fields, then the line content
 * prefixed by a tab. Commit details are emitted once per commit, so details
 * seen earlier are carried forward for later lines of the same commit.
 */
function parseBlamePorcelain(output: string): BlameLine[] {
  const lines = output.split("\n");
  const details = new Map<
    string,
    { author: string; authorEmail: string; authorTime: number; summary: string }
  >();
  const result: BlameLine[] = [];
  let current: {
    hash: string;
    finalLine: number;
    author?: string;
    authorEmail?: string;
    authorTime?: number;
    summary?: string;
  } | null = null;

  for (const line of lines) {
    const header = /^([0-9a-f]{40}|[0-9a-f]{64}) (\d+) (\d+)(?: (\d+))?$/.exec(
      line,
    );
    if (header) {
      current = { hash: header[1], finalLine: Number(header[3]) };
      continue;
    }
    if (!current) continue;

    if (line.startsWith("author ")) {
      current.author = line.slice("author ".length);
    } else if (line.startsWith("author-mail ")) {
      current.authorEmail = line
        .slice("author-mail ".length)
        .replace(/[<>]/g, "");
    } else if (line.startsWith("author-time ")) {
      current.authorTime = Number(line.slice("author-time ".length));
    } else if (line.startsWith("summary ")) {
      current.summary = line.slice("summary ".length);
    } else if (line.startsWith("\t")) {
      // The content line closes the entry.
      const known = details.get(current.hash);
      const detail = {
        author: current.author ?? known?.author ?? "",
        authorEmail: current.authorEmail ?? known?.authorEmail ?? "",
        authorTime: current.authorTime ?? known?.authorTime ?? 0,
        summary: current.summary ?? known?.summary ?? "",
      };
      details.set(current.hash, detail);
      result.push({
        hash: current.hash,
        line: current.finalLine,
        content: line.slice(1),
        ...detail,
        // An all-zero hash is git's marker for a not-yet-committed line.
        uncommitted: /^0{40}$|^0{64}$/.test(current.hash),
      });
      current = null;
    }
  }
  return result;
}

function assertCommitAuthor(author: string): void {
  const trimmed = author.trim();
  if (!trimmed || trimmed.startsWith("-")) {
    throw new Error(`Invalid commit author: ${author}`);
  }
}

function assertRemoteUrl(url: string): void {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("-")) {
    throw new Error(`Invalid remote URL: ${url}`);
  }
}

function parseLogOutput(output: string): CommitNode[] {
  const commits: CommitNode[] = [];
  const records = output.split(RECORD_SEP);

  for (const record of records) {
    const trimmed = record.trim();
    if (!trimmed) {
      continue;
    }
    const fields = trimmed.split(FIELD_SEP);
    if (fields.length < 10) {
      continue;
    }

    const refsStr = fields[9]?.trim() ?? "";
    const refs = parseRefs(refsStr);

    commits.push({
      hash: fields[0] ?? "",
      shortHash: fields[1] ?? "",
      parents: (fields[2] ?? "").split(" ").filter((s) => s.length > 0),
      authorName: fields[3] ?? "",
      authorEmail: fields[4] ?? "",
      authorDate: fields[5] ?? "",
      committerDate: fields[6] ?? "",
      subject: fields[7] ?? "",
      body: fields[8] ?? "",
      refs,
    });
  }
  return commits;
}

function parseRefs(refsStr: string): RefInfo[] {
  if (!refsStr) {
    return [];
  }
  const refs: RefInfo[] = [];
  const parts = refsStr.split(",").map((s) => s.trim());

  for (const part of parts) {
    if (!part) {
      continue;
    }
    if (part === "HEAD") {
      refs.push({ type: "HEAD", name: "HEAD" });
    } else if (part.startsWith("HEAD -> ")) {
      refs.push({ type: "HEAD", name: "HEAD" });
      refs.push({ type: "branch", name: part.replace("HEAD -> ", "") });
    } else if (part.startsWith("tag: ")) {
      refs.push({ type: "tag", name: part.replace("tag: ", "") });
    } else if (part.includes("/")) {
      // Distinguish remote branches from local branches with slashes (e.g. feat/xxx)
      // Remote branches in %D format are prefixed with remote name (origin/, upstream/, etc.)
      // Common pattern: if first segment before / is a short name (likely a remote), treat as remote
      const firstSlash = part.indexOf("/");
      const prefix = part.substring(0, firstSlash);
      // Heuristic: remote names are typically short (origin, upstream, fork, etc.)
      // Local branch names with / typically start with feat/, fix/, hotfix/, release/, etc.
      const localPrefixes = [
        "feat",
        "fix",
        "hotfix",
        "release",
        "bugfix",
        "feature",
        "chore",
        "docs",
        "refactor",
        "test",
        "ci",
        "build",
        "perf",
        "style",
        "revert",
        "wip",
        "dependabot",
      ];
      if (localPrefixes.includes(prefix.toLowerCase())) {
        refs.push({ type: "branch", name: part });
      } else {
        refs.push({ type: "remote-branch", name: part });
      }
    } else {
      refs.push({ type: "branch", name: part });
    }
  }
  return refs;
}
