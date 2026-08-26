import * as vscode from "vscode";
import { PORCELAIN_SCHEME } from "./gitContentProvider";
import { buildGitContentQuery } from "./workingTreeDiffModel";

/**
 * Build a `porcelain:/` content URI that resolves to a specific file
 * revision inside a specific repository.
 *
 * The resulting URI carries two query params read back by GitContentProvider:
 *   - `ref`   — git ref / commit hash whose file content to load (or "empty")
 *   - `repo`  — repoId that binds the URI to the correct repo regardless of
 *               which repo is currently "active" (see resolveGitService)
 *
 * Shape matches the URIs DiffEditorManager already builds, so the provider
 * parses them identically.
 */
export function buildGitContentUri(
  ref: string,
  filePath: string,
  repoId: string,
): vscode.Uri {
  return vscode.Uri.from({
    scheme: PORCELAIN_SCHEME,
    path: `/${filePath}`,
    query: buildGitContentQuery(ref, repoId),
  });
}
