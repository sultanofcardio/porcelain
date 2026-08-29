import type { WorkingTreeFile } from "../git/types";

export const WORKING_INDEX_REF = "__porcelain_index__";
export const EMPTY_CONTENT_REF = "empty";

/**
 * Stands in for the file on disk where a ref is expected.
 *
 * The native diff addresses the working tree with a real `file:` URI, which is
 * what keeps that side editable. The Porcelain viewer has no URI to hand — it
 * asks the host for content by ref — so it names the working tree the same way
 * the index is already named.
 */
export const WORKING_TREE_REF = "__porcelain_worktree__";

export type WorkingTreeDiffKind =
  | { left: "head"; right: "index" }
  | { left: "index"; right: "workingTree" }
  | { left: "head"; right: "workingTree" };

export type WorkingTreeDiffResource =
  | { source: "git"; ref: string; path: string }
  | { source: "workingTree"; path: string }
  | { source: "empty"; path: string };

export interface WorkingTreeDiffResources {
  left: WorkingTreeDiffResource;
  right: WorkingTreeDiffResource;
}

export interface GitContentReader {
  getIndexFileContent(path: string): Promise<Buffer>;
  readFileContent?(ref: string, path: string): Promise<Buffer>;
  getFileContent?(ref: string, path: string): Promise<string>;
}

type WorkingTreeDiffInput = Pick<
  WorkingTreeFile,
  "path" | "oldPath" | "status" | "staged"
>;

export function getWorkingTreeDiffKind(
  staged: boolean | undefined,
): WorkingTreeDiffKind {
  if (staged === undefined) return { left: "head", right: "workingTree" };
  return staged
    ? { left: "head", right: "index" }
    : { left: "index", right: "workingTree" };
}

export function getWorkingTreeDiffResources(
  file: WorkingTreeDiffInput,
  /**
   * Which side of the index to diff against. Omit for the whole change against
   * HEAD, which is what the Commit panel shows: staging is not part of its
   * model, so a row means "everything that differs from the last commit".
   */
  kind: WorkingTreeDiffKind = getWorkingTreeDiffKind(file.staged),
): WorkingTreeDiffResources {
  const originalPath =
    file.status === "renamed" ? (file.oldPath ?? file.path) : file.path;

  if (kind.left === "head" && kind.right === "workingTree") {
    return {
      left:
        file.status === "added" || file.status === "untracked"
          ? { source: "empty", path: originalPath }
          : { source: "git", ref: "HEAD", path: originalPath },
      right:
        file.status === "deleted"
          ? { source: "empty", path: file.path }
          : { source: "workingTree", path: file.path },
    };
  }

  if (kind.left === "head") {
    return {
      left:
        file.status === "added" || file.status === "untracked"
          ? { source: "empty", path: originalPath }
          : { source: "git", ref: "HEAD", path: originalPath },
      right:
        file.status === "deleted"
          ? { source: "empty", path: file.path }
          : { source: "git", ref: WORKING_INDEX_REF, path: file.path },
    };
  }

  return {
    left:
      file.status === "added" || file.status === "untracked"
        ? { source: "empty", path: originalPath }
        : {
            source: "git",
            ref: WORKING_INDEX_REF,
            path: originalPath,
          },
    right:
      file.status === "deleted"
        ? { source: "empty", path: file.path }
        : { source: "workingTree", path: file.path },
  };
}

export function buildGitContentQuery(ref: string, repoId: string): string {
  return `ref=${encodeURIComponent(ref)}&repo=${encodeURIComponent(repoId)}`;
}

interface FencePath {
  resolve: (...parts: string[]) => string;
  sep: string;
}

/** The filesystem calls the fence needs to see through symlinks. Optional:
 * without them the fence is lexical, which the unit tests exercise. */
export interface FenceFileSystem {
  existsSync(candidate: string): boolean;
  realpathSync(candidate: string): string;
}

/**
 * The one path boundary the webview-facing read and write paths share:
 * resolve a repo-relative path against the work-tree root and refuse
 * anything that escapes it. Writes additionally refuse the git dir, which
 * no editor surface has any business writing (hooks live there). Defence in
 * depth: the webview is trusted extension code, but the boundary is stated
 * once, so it holds uniformly.
 *
 * The git-dir rules compare case-insensitively — the default macOS and
 * Windows filesystems are case-insensitive, so `.GIT/hooks` names the real
 * hooks directory — and when a filesystem is supplied, the target's parent
 * is realpathed so a symlinked directory cannot carry a fenced path outside
 * the repository.
 */
export function resolveRepoWritePath(
  workTreeRoot: string,
  gitDir: string,
  filePath: string,
  path: FencePath,
  fs?: FenceFileSystem,
): string {
  const { target, realTarget } = resolveWithinRepo(
    workTreeRoot,
    filePath,
    path,
    fs,
  );
  for (const candidate of [target, realTarget]) {
    if (candidate !== undefined && hitsGitDir(candidate, gitDir, path)) {
      throw new Error(`Refusing to write into the git directory: ${filePath}`);
    }
  }
  return target;
}

/** The same containment fence for reads, without the git-dir rule. */
export function resolveRepoReadPath(
  workTreeRoot: string,
  filePath: string,
  path: FencePath,
  fs?: FenceFileSystem,
): string {
  return resolveWithinRepo(workTreeRoot, filePath, path, fs).target;
}

function resolveWithinRepo(
  workTreeRoot: string,
  filePath: string,
  path: FencePath,
  fs?: FenceFileSystem,
): { target: string; realTarget?: string } {
  const root = path.resolve(workTreeRoot);
  const target = path.resolve(root, filePath);
  const outside = () =>
    new Error(`Refusing to write outside the repository: ${filePath}`);
  if (!target.startsWith(root + path.sep)) throw outside();

  if (!fs) return { target };
  const sepIndex = target.lastIndexOf(path.sep);
  const parent = sepIndex > 0 ? target.slice(0, sepIndex) : path.sep;
  if (!fs.existsSync(parent)) return { target };
  const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : root;
  const realTarget = fs.realpathSync(parent) + target.slice(sepIndex);
  if (!realTarget.startsWith(realRoot + path.sep)) throw outside();
  return { target, realTarget };
}

function hitsGitDir(
  candidate: string,
  gitDir: string,
  path: FencePath,
): boolean {
  const lower = candidate.toLowerCase();
  const resolvedGitDir = path.resolve(gitDir).toLowerCase();
  if (lower === resolvedGitDir) return true;
  if (lower.startsWith(resolvedGitDir + path.sep)) return true;
  return lower.split(path.sep).includes(".git");
}

export async function readGitContent(
  service: GitContentReader,
  ref: string,
  filePath: string,
): Promise<Buffer> {
  if (!ref || !filePath || ref === EMPTY_CONTENT_REF) {
    return Buffer.alloc(0);
  }
  if (ref === WORKING_INDEX_REF) {
    return service.getIndexFileContent(filePath);
  }
  if (service.readFileContent) {
    return service.readFileContent(ref, filePath);
  }
  if (service.getFileContent) {
    return Buffer.from(await service.getFileContent(ref, filePath));
  }
  throw new Error("Repository content reader is unavailable");
}
