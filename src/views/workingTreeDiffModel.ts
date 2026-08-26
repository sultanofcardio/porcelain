import type { WorkingTreeFile } from "../git/types";

export const WORKING_INDEX_REF = "__porcelain_index__";
export const EMPTY_CONTENT_REF = "empty";

export type WorkingTreeDiffKind =
  | { left: "head"; right: "index" }
  | { left: "index"; right: "workingTree" };

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

export function getWorkingTreeDiffKind(staged: boolean): WorkingTreeDiffKind {
  return staged
    ? { left: "head", right: "index" }
    : { left: "index", right: "workingTree" };
}

export function getWorkingTreeDiffResources(
  file: WorkingTreeDiffInput,
): WorkingTreeDiffResources {
  const originalPath =
    file.status === "renamed" ? (file.oldPath ?? file.path) : file.path;

  if (file.staged) {
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
