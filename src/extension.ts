import * as nodefs from "node:fs/promises";
import * as nodepath from "node:path";
import * as vscode from "vscode";
import {
  BranchDashboardStateStore,
  type GitRefIdentity,
} from "./git/branchDashboardState";
import type { GitOperationResult } from "./git/core/operationResult";
import { PorcelainError, PorcelainErrorCode } from "./git/errors";
import { GitService, isAbsentPathError } from "./git/gitService";
import { discoverRepos } from "./git/repoDiscovery";
import {
  type DiscoveredRepo,
  formatRepoLabel,
  RepoRegistry,
} from "./git/repoRegistry";
import {
  FolderReconciler,
  persistAndBroadcastActive,
  RepoSelectionCoordinator,
  RepoSelectionError,
  Serializer,
} from "./git/repoSelection";
import type { CommitSelection, DiffFile } from "./git/types";
import { registerLogHandlers } from "./messages/logHandlers";
import { MessageRouter } from "./messages/messageRouter";
import {
  type DiffSidesMeta,
  type DiffSidesResult,
  ErrorCode,
  type FileVersionsResult,
} from "./messages/protocol";
import { ChangesWindowManager } from "./views/changesWindowManager";
import { CommitViewProvider } from "./views/commitViewProvider";
import {
  ComparePanelManager,
  registerComparePanelHandlers,
} from "./views/comparePanelManager";
import { ConflictsManager } from "./views/conflictsManager";
import {
  classifyBinaryPair,
  countLines,
  isBinaryContent,
  LARGE_DIFF_LINE_LIMIT,
} from "./views/diffContentClassifier";
import { DiffEditorManager } from "./views/diffEditorManager";
import { DiffViewerManager, refLabel } from "./views/diffViewerManager";
import { DiffWindow } from "./views/diffWindow";
import {
  GitContentProvider,
  PORCELAIN_SCHEME,
} from "./views/gitContentProvider";
import { GitLogViewProvider } from "./views/gitLogViewProvider";
import { buildGitContentUri } from "./views/gitUri";
import { MergeEditorManager } from "./views/mergeEditorManager";
import { PushPanel } from "./views/pushPanel";
import type { RollbackFileInfo } from "./views/rollbackPanel";
import { RollbackPanel } from "./views/rollbackPanel";
import {
  EMPTY_CONTENT_REF,
  getWorkingTreeDiffKind,
  getWorkingTreeDiffResources,
  resolveRepoWritePath,
  WORKING_INDEX_REF,
  WORKING_TREE_REF,
  type WorkingTreeDiffResource,
} from "./views/workingTreeDiffModel";
import { GitWatcher } from "./watchers/gitWatcher";

const NOT_GIT_REPO = { status: "not_git_repo" as const, data: null };

/** Temporary storage for shelf diff content (base/modified) */
const shelfDiffContent = new Map<string, string>();

function requireSuccessfulGitOperation(
  result: GitOperationResult<unknown>,
): void {
  if (result.ok) return;
  throw new PorcelainError(result.code, result.message, result.recovery);
}

/**
 * Wrap a git operation with progress events tagged by the acting repo.
 *
 * `repoId` is the repo the operation acts on (the handler's `ctx.repoId`), or
 * `null` for a non-repo-bound operation. The payload `{ repoId }` is always
 * sent (null included for symmetry) so the webview can filter busy state by the
 * active repo — an operation on repo B does not disable the UI while repo A is
 * visible.
 */
export function withProgress(
  messageRouter: MessageRouter,
  repoId: string | null,
  fn: () => Promise<unknown>,
): Promise<unknown> {
  messageRouter.broadcastEvent("operationStart", { repoId });
  return fn().finally(() => {
    messageRouter.broadcastEvent("operationEnd", { repoId });
  });
}

/** Refresh Git Log surfaces bound to the currently active repository only. */
export function broadcastActiveRepoLogRefresh(
  messageRouter: MessageRouter,
  repoRegistry: RepoRegistry,
): void {
  const runtime = repoRegistry.getActive();
  if (!runtime) return;
  messageRouter.broadcastEvent("gitStateChanged", {
    scope: "all",
    repoId: runtime.descriptor.id,
  });
}

export async function activate(context: vscode.ExtensionContext) {
  // 1. MessageRouter (always created)
  const messageRouter = new MessageRouter();

  // 2. GitLogViewProvider (always registered)
  const logProvider = new GitLogViewProvider(
    context.extensionUri,
    messageRouter,
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      GitLogViewProvider.viewType,
      logProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  // 2b. Repo registry built from validated workspace folders
  const repoRegistry = new RepoRegistry();
  const branchDashboardState = new BranchDashboardStateStore(
    context.workspaceState,
  );
  const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => ({
    fsPath: f.uri.fsPath,
    name: f.name,
  }));
  const discovered = await discoverRepos(folders);
  repoRegistry.build(discovered, (paths) => new GitService(paths));

  // Restore last active repo (per-workspace).
  const savedActive = context.workspaceState.get<string | undefined>(
    "porcelain.activeRepoId",
  );
  if (savedActive) repoRegistry.setActive(savedActive);

  // Until Task 13 flips strict mode, missing repoId means the active repo.
  messageRouter.setRepoResolver((repoId) => {
    const runtime = repoId
      ? repoRegistry.get(repoId)
      : repoRegistry.getActive();
    if (!runtime) return null;
    return {
      repoId: runtime.descriptor.id,
      repo: runtime.descriptor,
      paths: runtime.paths,
      gitService: runtime.gitService,
    };
  });

  // diffManager / contentProvider are repo-aware via the registry.
  // They resolve the originating repo from the diff URI's ?repo= param
  // (or the active repo for legacy URIs) and stay module-level so native
  // commands (nextDiff/prevDiff/openDiffEditor) and the diff handler can use them.
  // Registered UNCONDITIONALLY: both resolve the repo lazily per request, so they
  // don't need an active repo at construction. This matters for multi-root setups
  // launched with zero repos (or where the first repo is discovered after activation) —
  // otherwise git-content diff URIs wouldn't resolve and native diff commands would
  // no-op until something re-ran activation (which never happens).
  const contentProvider = new GitContentProvider(repoRegistry);
  contentProvider.setExternalContentMap(shelfDiffContent);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      PORCELAIN_SCHEME,
      contentProvider,
    ),
    vscode.workspace.registerFileSystemProvider(
      PORCELAIN_SCHEME,
      contentProvider,
      { isReadonly: true },
    ),
  );

  const diffViewer = new DiffViewerManager(context.extensionUri, messageRouter);
  context.subscriptions.push({ dispose: () => diffViewer.dispose() });
  const diffWindow = new DiffWindow(diffViewer);
  const diffManager = new DiffEditorManager(repoRegistry, diffWindow);

  // 2c. CommitViewProvider (always registered)
  const commitProvider = new CommitViewProvider(
    context.extensionUri,
    messageRouter,
    repoRegistry,
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      CommitViewProvider.viewType,
      commitProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  // 3. MergeEditorManager + ConflictsManager (always created)
  const mergeManager = new MergeEditorManager(
    context.extensionUri,
    messageRouter,
  );
  const conflictsManager = new ConflictsManager(
    context.extensionUri,
    messageRouter,
    repoRegistry,
  );
  const comparePanelManager = new ComparePanelManager(
    context.extensionUri,
    messageRouter,
  );
  const changesWindowManager = new ChangesWindowManager(
    context.extensionUri,
    messageRouter,
  );
  context.subscriptions.push({
    dispose: () => changesWindowManager.dispose(),
  });

  // 4. PushPanel
  const pushPanel = new PushPanel(
    context.extensionUri,
    messageRouter,
    repoRegistry,
  );

  // 4b. RollbackPanel
  const rollbackPanel = new RollbackPanel(
    context.extensionUri,
    messageRouter,
    repoRegistry,
  );

  // 5. Register VSCode commands (always registered)
  context.subscriptions.push(
    vscode.commands.registerCommand("porcelain.openPushPanel", async () => {
      const runtime = repoRegistry.getActive();
      if (!runtime) return;
      const branch = await runtime.gitService.getCurrentBranch();
      if (branch) {
        const remote = await runtime.gitService.getDefaultRemote(branch);
        pushPanel.open(runtime.descriptor.id, branch, remote);
      }
    }),
    vscode.commands.registerCommand(
      "porcelain.openMergeEditor",
      (file?: string) => {
        const runtime = repoRegistry.getActive();
        if (!runtime) return;
        void mergeManager.openMergeEditor(
          runtime.descriptor.id,
          file ?? "untitled",
        );
      },
    ),
    vscode.commands.registerCommand(
      "porcelain.openDiffEditor",
      (commit?: string, filePath?: string) => {
        if (commit && filePath && diffManager) {
          const runtime = repoRegistry.getActive();
          if (!runtime) return;
          diffManager.openDiffEditor(runtime.descriptor.id, commit, filePath);
        }
      },
    ),
    vscode.commands.registerCommand("porcelain.refreshLog", () => {
      broadcastActiveRepoLogRefresh(messageRouter, repoRegistry);
    }),
    vscode.commands.registerCommand("porcelain.nextDiff", async () => {
      if (diffManager) {
        const result = await diffManager.nextDiff();
        if (!result) {
          void vscode.window.showInformationMessage(
            "Porcelain: No diff file list. Double-click a file in Changed Files first.",
          );
        }
      } else {
        void vscode.window.showInformationMessage(
          "Porcelain: No workspace open.",
        );
      }
    }),
    vscode.commands.registerCommand("porcelain.prevDiff", async () => {
      if (diffManager) {
        const result = await diffManager.prevDiff();
        if (!result) {
          void vscode.window.showInformationMessage(
            "Porcelain: No diff file list. Double-click a file in Changed Files first.",
          );
        }
      } else {
        void vscode.window.showInformationMessage(
          "Porcelain: No workspace open.",
        );
      }
    }),
    vscode.commands.registerCommand("porcelain.openConflicts", () => {
      const runtime = repoRegistry.getActive();
      if (!runtime) return;
      void conflictsManager.openConflictsPanel(runtime.descriptor.id);
    }),
    vscode.commands.registerCommand(
      "porcelain.openMergeEditorFromSCM",
      (arg?: unknown) => {
        const filePath = getScmResourcePath(arg);
        if (!filePath) {
          void vscode.window.showWarningMessage(
            "Unable to locate conflict file from SCM item.",
          );
          return;
        }
        const runtime = repoRegistry.getActive();
        if (!runtime) return;
        void mergeManager.openMergeEditor(runtime.descriptor.id, filePath);
      },
    ),
    vscode.commands.registerCommand(
      "porcelain.showFileHistory",
      async (uri?: vscode.Uri) => {
        const fileUri = uri ?? vscode.window.activeTextEditor?.document.uri;
        const runtime = repoRegistry.getActive();
        if (!fileUri || !runtime) return;
        const relativePath = vscode.workspace.asRelativePath(fileUri, false);
        // Ensure the Git Log panel is visible before sending the event
        await vscode.commands.executeCommand("porcelain.gitLog.focus");
        // Send file filter to webview
        messageRouter.broadcastEvent("showFileHistory", {
          file: relativePath,
        });
      },
    ),
    vscode.commands.registerCommand("porcelain.editSource", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const uri = editor.document.uri;
      const line = editor.selection.active.line;
      const character = editor.selection.active.character;

      // Resolve the repo this document belongs to. Prefer an explicit `?repo=`
      // on the URI (set by buildGitContentUri) so editing a file opened from
      // repo B's diff works even when repo A is active; fall back to active.
      const repoIdFromUri = new URLSearchParams(uri.query).get("repo");
      const runtime = repoIdFromUri
        ? repoRegistry.get(repoIdFromUri)
        : repoRegistry.getActive();
      const workspaceRoot = runtime?.descriptor.rootPath;

      // Resolve the actual workspace file path from diff URI
      // Format: porcelain:/<relativePath>?ref=<commitHash>&repo=<repoId>
      let filePath: string | undefined;

      if (uri.scheme === "file") {
        filePath = uri.fsPath;
      } else if (uri.scheme === "porcelain" || uri.scheme === "git") {
        // Extract relative path from URI path (strip leading /)
        const relativePath = uri.path.startsWith("/")
          ? uri.path.slice(1)
          : uri.path;
        if (relativePath && workspaceRoot) {
          filePath = vscode.Uri.joinPath(
            vscode.Uri.file(workspaceRoot),
            relativePath,
          ).fsPath;
        }
      } else {
        // Other schemes (e.g. vscode builtin git) — try path
        const relativePath = uri.path.startsWith("/")
          ? uri.path.slice(1)
          : uri.path;
        if (relativePath && workspaceRoot) {
          filePath = vscode.Uri.joinPath(
            vscode.Uri.file(workspaceRoot),
            relativePath,
          ).fsPath;
        }
      }

      if (!filePath) return;

      // Check if file exists before opening
      const fileUri = vscode.Uri.file(filePath);
      try {
        await vscode.workspace.fs.stat(fileUri);
      } catch {
        void vscode.window.showWarningMessage(
          "Source file does not exist in the working directory.",
        );
        return;
      }

      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc, {
        selection: new vscode.Range(line, character, line, character),
        preview: false,
      });
    }),
  );

  // 6. Register command handlers to MessageRouter
  // If GitService is unavailable, handlers return { status: 'not_git_repo' }

  registerLogHandlers(messageRouter);
  registerComparePanelHandlers(messageRouter, comparePanelManager);

  messageRouter.handle("openMergeEditor", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const file = (params.file as string) ?? "untitled";
    await mergeManager.openMergeEditor(ctx.repoId, file);
    return undefined;
  });

  messageRouter.handle("openDiffEditor", async (params, ctx) => {
    if (!ctx) return undefined;
    if (!diffManager) return undefined;
    const commit = params.commit as string;
    const filePathParam = params.filePath as string | undefined;
    const fileParam = params.file as string | DiffFile | undefined;
    const baseRef = params.baseRef as string | undefined;
    const cherryPickHashes = params.cherryPickHashes as string[] | undefined;
    const fileList = params.fileList as DiffFile[] | undefined;
    const fileMeta =
      typeof fileParam === "object" && fileParam !== null
        ? (fileParam as DiffFile)
        : undefined;
    const filePath =
      filePathParam ??
      (typeof fileParam === "string" ? fileParam : undefined) ??
      fileMeta?.newPath ??
      fileMeta?.oldPath;

    if (commit && filePath) {
      // Set file list for next/prev navigation
      if (fileList && fileList.length > 0) {
        diffManager.setDiffFileList(
          ctx.repoId,
          fileList,
          commit,
          baseRef,
          cherryPickHashes,
        );
        // Set current index to the file being opened
        const idx = fileList.findIndex(
          (f) => (f.newPath || f.oldPath) === filePath,
        );
        if (idx >= 0) {
          diffManager.setCurrentIndex(idx);
        }
      }

      await diffManager.openDiffEditor(
        ctx.repoId,
        commit,
        filePath,
        fileMeta,
        baseRef,
        cherryPickHashes,
      );
    }
    return undefined;
  });

  messageRouter.handle("getBranches", async (_params, ctx) => {
    if (!ctx) {
      return NOT_GIT_REPO;
    }
    const branches = await ctx.gitService.getBranches();
    return branches.map((branch) => ({
      ...branch,
      isFavorite: branchDashboardState.isFavorite(
        ctx.repoId,
        branch.isRemote ? "remote" : "local",
        branch.name,
      ),
    }));
  });

  messageRouter.handle("getRemoteBranches", async (_params, ctx) => {
    if (!ctx) {
      return NOT_GIT_REPO;
    }
    // Invalidate branch cache to reflect latest remote changes
    ctx.gitService.cache.invalidate("branches");
    return ctx.gitService.getRemoteBranches();
  });

  messageRouter.handle("getTags", async (_params, ctx) => {
    if (!ctx) {
      return NOT_GIT_REPO;
    }
    const tags = await ctx.gitService.getTags();
    return tags.map((tag) => ({
      ...tag,
      isFavorite: branchDashboardState.isFavorite(ctx.repoId, "tag", tag.name),
    }));
  });

  messageRouter.handle("getDiff", async (params, ctx) => {
    if (!ctx) {
      return NOT_GIT_REPO;
    }
    const ref1 = params.ref1 as string;
    const ref2 = params.ref2 as string;
    const file = params.file as string | undefined;
    return ctx.gitService.getDiff(ref1, ref2, file);
  });

  messageRouter.handle("getFileContent", async (params, ctx) => {
    if (!ctx) {
      return NOT_GIT_REPO;
    }
    const ref = params.ref as string;
    const filePath = params.filePath as string;
    return ctx.gitService.getFileContent(ref, filePath);
  });

  messageRouter.handle("getDiffSides", async (params, ctx) => {
    if (!ctx) {
      return NOT_GIT_REPO;
    }
    const filePath = params.filePath as string;
    // A rename diffs two different paths; every other diff sends none and
    // both sides fall back to the file's own.
    const leftPath = (params.leftPath as string | undefined) ?? filePath;
    const rightPath = (params.rightPath as string | undefined) ?? filePath;
    const leftRef = params.leftRef as string;
    const rightRef = params.rightRef as string;
    // "Show anyway" on the tooLarge placeholder: the limit is soft because
    // change density is the other axis of diff cost, and a refusal would
    // leave a small edit in a huge file with no way in.
    const force = params.force === true;

    // A side missing from its revision is not an error: it is how an added or
    // deleted file diffs, and the empty buffer is exactly what the model
    // needs. A working-tree file that is not on disk is the same — deleted.
    // Any *other* failure is reported as such, so "could not read" stops
    // masquerading as "deleted".
    const read = async (
      ref: string,
      sidePath: string,
    ): Promise<Buffer | { failed: string }> => {
      if (!ref || ref === EMPTY_CONTENT_REF) return Buffer.alloc(0);
      if (ref === WORKING_TREE_REF) {
        const onDisk = vscode.Uri.joinPath(
          vscode.Uri.file(ctx.paths.workTreeRoot),
          sidePath,
        );
        try {
          return Buffer.from(await vscode.workspace.fs.readFile(onDisk));
        } catch (error) {
          if (
            error instanceof vscode.FileSystemError &&
            error.code === "FileNotFound"
          ) {
            return Buffer.alloc(0);
          }
          return {
            failed: error instanceof Error ? error.message : `${error}`,
          };
        }
      }
      try {
        if (ref === WORKING_INDEX_REF) {
          return await ctx.gitService.getIndexFileContent(sidePath);
        }
        // An absent path stays an empty side (added/renamed files in
        // history); a genuine failure — oversized blob, corrupt object —
        // surfaces as unreadable instead of masquerading as deleted.
        return await ctx.gitService.getFileContentBuffer(ref, sidePath);
      } catch (error) {
        if (isAbsentPathError(error)) return Buffer.alloc(0);
        return { failed: error instanceof Error ? error.message : `${error}` };
      }
    };

    const [left, right] = await Promise.all([
      read(leftRef, leftPath),
      read(rightRef, rightPath),
    ]);
    const meta: DiffSidesMeta = {
      filePath,
      leftRef,
      rightRef,
      leftLabel: refLabel(leftRef),
      rightLabel: refLabel(rightRef),
      language: extToLanguage(filePath.split(".").pop() ?? ""),
    };

    const failure = [left, right].find(
      (side): side is { failed: string } => !Buffer.isBuffer(side),
    );
    if (failure || !Buffer.isBuffer(left) || !Buffer.isBuffer(right)) {
      return {
        kind: "unreadable",
        reason: failure?.failed ?? "unknown error",
        ...meta,
      } satisfies DiffSidesResult;
    }

    if (isBinaryContent(left) || isBinaryContent(right)) {
      return {
        ...classifyBinaryPair(left, right, filePath),
        ...meta,
      } satisfies DiffSidesResult;
    }

    const lines = Math.max(countLines(left), countLines(right));
    if (!force && lines > LARGE_DIFF_LINE_LIMIT) {
      return {
        kind: "tooLarge",
        lines,
        limit: LARGE_DIFF_LINE_LIMIT,
        ...meta,
      } satisfies DiffSidesResult;
    }

    return {
      kind: "text",
      left: left.toString("utf8"),
      right: right.toString("utf8"),
      ...meta,
    } satisfies DiffSidesResult;
  });

  messageRouter.handle("stepDiffFile", async (params) => {
    // The file list lives on the host; the webview only says which way to go.
    const delta = Number(params.delta ?? 1);
    const moved =
      delta > 0 ? await diffManager.nextDiff() : await diffManager.prevDiff();
    return { moved };
  });

  messageRouter.handle("getCommitFiles", async (params, ctx) => {
    if (!ctx) {
      return NOT_GIT_REPO;
    }
    const hash = params.hash as string;
    return ctx.gitService.getCommitFiles(hash);
  });

  messageRouter.handle("getCommitRangeFiles", async (params, ctx) => {
    if (!ctx) {
      return NOT_GIT_REPO;
    }
    const hashes = params.hashes as string[];
    return ctx.gitService.getCommitRangeFiles(hashes);
  });

  messageRouter.handle("getComparisonFiles", async (params, ctx) => {
    if (!ctx) {
      return NOT_GIT_REPO;
    }
    const fromHash = params.fromHash as string;
    const toHash = params.toHash as string;
    return ctx.gitService.getComparisonFiles(fromHash, toHash);
  });

  messageRouter.handle("openCompareVersions", async (params, ctx) => {
    if (!ctx) {
      throw new PorcelainError(
        PorcelainErrorCode.REPO_NOT_FOUND,
        "No repository context for comparison",
      );
    }
    const hashes = params.hashes as string[];
    if (!Array.isArray(hashes) || hashes.length !== 2) {
      throw new PorcelainError(
        PorcelainErrorCode.INVALID_REF,
        "Compare Versions needs exactly two commits",
      );
    }
    const { from, to } = await ctx.gitService.orderCommitsOldestFirst(
      hashes[0],
      hashes[1],
    );
    await changesWindowManager.open({
      repoId: ctx.repoId,
      fromHash: from,
      toHash: to,
    });
    return { success: true };
  });

  messageRouter.handle("getStatus", async (_params, ctx) => {
    if (!ctx) {
      return NOT_GIT_REPO;
    }
    return ctx.gitService.getStatus();
  });

  messageRouter.handle("getMergeState", async (_params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    return ctx.gitService.getMergeState();
  });

  messageRouter.handle("getCherryPickState", async (_params, ctx) => {
    if (!ctx) return { isCherryPicking: false };
    return ctx.gitService.getCherryPickState();
  });

  messageRouter.handle("cherryPickAction", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const action = params.action as "continue" | "abort" | "skip";
    return withProgress(messageRouter, ctx.repoId, async () => {
      await gitService.cherryPickAction(action);
      messageRouter.broadcastEvent("gitStateChanged", {
        scope: "all",
        repoId: ctx.repoId,
      });
      messageRouter.broadcastEvent("commitStateChanged", {
        repoId: ctx.repoId,
      });
      return { success: true };
    });
  });

  messageRouter.handle("getRebaseState", async (_params, ctx) => {
    if (!ctx) return { isRebasing: false };
    return ctx.gitService.getRebaseState();
  });

  messageRouter.handle("rebaseAction", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const action = params.action as "continue" | "abort" | "skip";
    return withProgress(messageRouter, ctx.repoId, async () => {
      await gitService.rebaseAction(action);
      messageRouter.broadcastEvent("gitStateChanged", {
        scope: "all",
        repoId: ctx.repoId,
      });
      messageRouter.broadcastEvent("commitStateChanged", {
        repoId: ctx.repoId,
      });
      return { success: true };
    });
  });

  messageRouter.handle("mergeAction", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const action = params.action as "continue" | "abort";
    return withProgress(messageRouter, ctx.repoId, async () => {
      if (action === "continue") {
        await gitService.mergeContinue();
      } else {
        await gitService.mergeAbort();
      }
      messageRouter.broadcastEvent("gitStateChanged", {
        scope: "all",
        repoId: ctx.repoId,
      });
      messageRouter.broadcastEvent("commitStateChanged", {
        repoId: ctx.repoId,
      });
      return { success: true };
    });
  });

  messageRouter.handle("getConflictFiles", async (_params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    return ctx.gitService.getConflictFiles();
  });

  messageRouter.handle("openConflictsPanel", async (_params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    await conflictsManager.openConflictsPanel(ctx.repoId);
    return { success: true };
  });

  messageRouter.handle("getFileVersions", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const filePath = params.filePath as string;

    // The three stages as bytes: a binary stage must be classified, not
    // UTF-8-decoded into mojibake and handed to diff3. A stage missing from
    // the index (added on one side only) reads as empty, which is exactly
    // what the merge model wants; a genuine read failure surfaces as
    // unreadable rather than an invented empty side.
    const failures: string[] = [];
    const read = (stage: string) =>
      gitService.getFileContentBuffer(stage, filePath).catch((error) => {
        if (!isAbsentPathError(error)) {
          failures.push(error instanceof Error ? error.message : `${error}`);
        }
        return Buffer.alloc(0);
      });
    const [base, ours, theirs] = await Promise.all([
      read(":1"),
      read(":2"),
      read(":3"),
    ]);

    const mergeState = await gitService.getMergeState();
    const branch = await gitService.getCurrentBranch().catch(() => null);
    // "Merge branch 'x'" carries the human name; the hash is the fallback.
    // Outside an actual merge (cherry-pick and rebase conflicts land here
    // too) there is no MERGE_HEAD to name, so the label stays generic.
    const mergeMsg = mergeState.isMerging ? (mergeState.mergeMsg ?? "") : "";
    const theirsLabel =
      /branch '([^']+)'/.exec(mergeMsg)?.[1] ??
      (mergeState.isMerging && mergeState.mergeHead
        ? mergeState.mergeHead.slice(0, 7)
        : "incoming");
    const meta = {
      filePath,
      language: extToLanguage(filePath.split(".").pop() ?? ""),
      mergeMsg,
      oursLabel: branch ?? "HEAD",
      theirsLabel,
    };

    if (failures.length > 0) {
      return {
        kind: "unreadable",
        reason: failures[0],
        ...meta,
      } satisfies FileVersionsResult;
    }

    if ([base, ours, theirs].some(isBinaryContent)) {
      return {
        kind: "binary",
        bytes: Math.max(ours.length, theirs.length),
        ...meta,
      } satisfies FileVersionsResult;
    }
    const lines = Math.max(
      countLines(base),
      countLines(ours),
      countLines(theirs),
    );
    if (lines > LARGE_DIFF_LINE_LIMIT) {
      return {
        kind: "tooLarge",
        lines,
        limit: LARGE_DIFF_LINE_LIMIT,
        ...meta,
      } satisfies FileVersionsResult;
    }
    return {
      kind: "text",
      base: base.toString("utf8"),
      ours: ours.toString("utf8"),
      theirs: theirs.toString("utf8"),
      ...meta,
    } satisfies FileVersionsResult;
  });

  messageRouter.handle("saveMergedContent", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    // Same boundary as writeFileContent: one stated write fence, held
    // uniformly by both webview-facing write paths.
    resolveRepoWritePath(
      ctx.paths.workTreeRoot,
      ctx.paths.gitDir,
      params.filePath as string,
      nodepath,
    );
    await ctx.gitService.saveMergedContent(
      params.filePath as string,
      params.content as string,
    );
    // The save is a working-tree change like any other: without this the
    // conflicts list and the log panel only hear about it at the next poke.
    messageRouter.broadcastEvent("gitStateChanged", {
      scope: "status",
      repoId: ctx.repoId,
    });
    return { success: true };
  });

  messageRouter.handle("writeFileContent", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const filePath = params.filePath as string;
    const content = params.content as string;
    // The one write path diff editing has, and it writes only the working
    // tree: resolve against the repo root, refuse anything that escapes it
    // or lands in the git dir — the webview names files, not paths.
    const target = resolveRepoWritePath(
      ctx.paths.workTreeRoot,
      ctx.paths.gitDir,
      filePath,
      nodepath,
    );
    await nodefs.writeFile(target, content, "utf-8");
    messageRouter.broadcastEvent("gitStateChanged", {
      scope: "status",
      repoId: ctx.repoId,
    });
    return { success: true };
  });

  messageRouter.handle("stageFile", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    await ctx.gitService.stageFile(params.filePath as string);
    messageRouter.broadcastEvent("commitStateChanged", {
      repoId: ctx.repoId,
    });
    return { success: true };
  });

  messageRouter.handle("acceptOurs", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    await ctx.gitService.acceptOurs(params.filePath as string);
    return { success: true };
  });

  messageRouter.handle("acceptTheirs", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    await ctx.gitService.acceptTheirs(params.filePath as string);
    return { success: true };
  });

  messageRouter.handle("confirmCancelMerge", async (params) => {
    const hasChanges = params.hasChanges as boolean;
    if (!hasChanges) return { confirmed: true };
    const choice = await vscode.window.showWarningMessage(
      "You have unsaved merge changes. Discard them?",
      { modal: true },
      "Discard",
    );
    return { confirmed: choice === "Discard" };
  });

  messageRouter.handle("closeMergeEditor", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const filePath = params.filePath as string;
    mergeManager.closeMergeEditor(ctx.repoId, filePath);
    return { success: true };
  });

  messageRouter.handle("openFile", async (params, ctx) => {
    const filePath = params.filePath as string;
    const workspaceRoot = ctx?.repo.rootPath;
    const absPath = workspaceRoot
      ? vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), filePath)
      : vscode.Uri.file(filePath);
    try {
      await vscode.commands.executeCommand("vscode.open", absPath);
    } catch {
      // Fallback for files that can't be opened in any editor
      await vscode.env.openExternal(absPath);
    }
    return { success: true };
  });

  messageRouter.handle("showInputBox", async (params) => {
    const prompt = params.prompt as string | undefined;
    const value = params.value as string | undefined;
    const placeHolder = params.placeHolder as string | undefined;
    const result = await vscode.window.showInputBox({
      prompt,
      value,
      placeHolder,
    });
    return { value: result ?? null };
  });

  messageRouter.handle("showConfirmMessage", async (params) => {
    const message = params.message as string;
    const confirmLabel = (params.confirmLabel as string) || "OK";
    const result = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      confirmLabel,
    );
    return { confirmed: result === confirmLabel };
  });

  messageRouter.handle("showErrorNotification", async (params) => {
    const message = params.message as string;
    void vscode.window.showErrorMessage(message);
    return { success: true };
  });

  messageRouter.handle("showInfoNotification", async (params) => {
    const message = params.message as string;
    void vscode.window.showInformationMessage(message);
    return { success: true };
  });

  messageRouter.handle("checkoutBranch", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const branchName = params.branchName as string;
    return withProgress(messageRouter, ctx.repoId, async () => {
      await gitService.checkout(branchName);
      messageRouter.broadcastEvent("gitStateChanged", {
        scope: "all",
        repoId: ctx.repoId,
      });
      return { success: true };
    });
  });

  messageRouter.handle("createBranch", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const newBranchName = params.newBranchName as string;
    const startPoint = params.startPoint as string;
    const checkout = params.checkout as boolean | undefined;
    const force = params.force as boolean | undefined;
    await gitService.createBranch(newBranchName, startPoint, force ?? false);
    if (checkout) {
      await gitService.checkout(newBranchName);
    }
    messageRouter.broadcastEvent("gitStateChanged", {
      scope: "all",
      repoId: ctx.repoId,
    });
    return { success: true };
  });

  messageRouter.handle("deleteBranch", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const branchName = params.branchName as string;
    const isRemote = params.isRemote as boolean;
    const force = params.force as boolean | undefined;
    if (isRemote) {
      await gitService.deleteRemoteBranch(branchName);
    } else {
      await gitService.deleteBranch(branchName, force ?? false);
    }
    messageRouter.broadcastEvent("gitStateChanged", {
      scope: "all",
      repoId: ctx.repoId,
    });
    return { success: true };
  });

  messageRouter.handle("renameBranch", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const oldName = params.oldName as string;
    const newName = params.newName as string;
    await gitService.renameBranch(oldName, newName);
    messageRouter.broadcastEvent("gitStateChanged", {
      scope: "all",
      repoId: ctx.repoId,
    });
    return { success: true };
  });

  messageRouter.handle("mergeBranch", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const branchName = params.branchName as string;
    return withProgress(messageRouter, ctx.repoId, async () => {
      await gitService.merge(branchName);
      messageRouter.broadcastEvent("gitStateChanged", {
        scope: "all",
        repoId: ctx.repoId,
      });
      return { success: true };
    });
  });

  messageRouter.handle("rebaseBranch", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const onto = params.onto as string;
    return withProgress(messageRouter, ctx.repoId, async () => {
      await gitService.rebase(onto);
      messageRouter.broadcastEvent("gitStateChanged", {
        scope: "all",
        repoId: ctx.repoId,
      });
      return { success: true };
    });
  });

  messageRouter.handle("checkoutAndRebase", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const branchToCheckout = params.branchToCheckout as string;
    const rebaseOnto = params.rebaseOnto as string;
    return withProgress(messageRouter, ctx.repoId, async () => {
      await gitService.checkoutAndRebase(branchToCheckout, rebaseOnto);
      messageRouter.broadcastEvent("gitStateChanged", {
        scope: "all",
        repoId: ctx.repoId,
      });
      return { success: true };
    });
  });

  messageRouter.handle("pushBranch", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const branchName = params.branchName as string;
    const force = params.force as boolean | undefined;
    return withProgress(messageRouter, ctx.repoId, async () => {
      await gitService.push(branchName, force ?? false);
      messageRouter.broadcastEvent("gitStateChanged", {
        scope: "all",
        repoId: ctx.repoId,
      });
      return { success: true };
    });
  });

  messageRouter.handle("getAheadCommits", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const branchName = params.branchName as string;
    const remote = params.remote as string | undefined;
    const commits = await ctx.gitService.getAheadCommits(branchName, remote);
    return { commits };
  });

  messageRouter.handle("executePush", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const branchName = params.branchName as string;
    const force = params.force as boolean | undefined;
    const remote = (params.remote as string) || "origin";
    const targetBranch = (params.targetBranch as string) || branchName;
    return withProgress(messageRouter, ctx.repoId, async () => {
      const output = await gitService.push(
        branchName,
        force ?? false,
        remote,
        targetBranch,
      );
      messageRouter.broadcastEvent("gitStateChanged", {
        scope: "all",
        repoId: ctx.repoId,
      });
      messageRouter.broadcastEvent("commitStateChanged", {
        repoId: ctx.repoId,
      });
      // Return push output so webview can show result toast before closing
      const isUpToDate =
        output?.includes("Everything up-to-date") ||
        output?.includes("up to date");
      return { success: true, data: { output: output ?? "", isUpToDate } };
    });
  });

  messageRouter.handle("closePushPanel", async () => {
    pushPanel.close();
    return { success: true };
  });

  messageRouter.handle("openPushPanel", async (_params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const branch = await gitService.getCurrentBranch();
    if (!branch) return { error: "No current branch" };
    const remote = await gitService.getDefaultRemote(branch);
    pushPanel.open(ctx.repoId, branch, remote);
    return { success: true };
  });

  // ─── Rollback Panel Handlers ───────────────────────────────────────

  messageRouter.handle("openRollbackPanel", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const files = params.files as RollbackFileInfo[];
    rollbackPanel.open(ctx.repoId, files);
    return { success: true };
  });

  messageRouter.handle("executeRollback", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const workspaceRoot = ctx.repo.rootPath;
    const filePaths = params.filePaths as string[];
    const deleteLocalCopies = params.deleteLocalCopies as boolean;

    try {
      // Get current working tree status to determine each file's state
      const workingTreeChanges = await gitService.getWorkingTreeChanges();
      const statusMap = new Map<string, string>();
      for (const file of workingTreeChanges) {
        statusMap.set(file.path, file.status);
      }

      for (const filePath of filePaths) {
        const status = statusMap.get(filePath) ?? "modified";
        if (status === "added" || status === "untracked") {
          if (deleteLocalCopies) {
            // Delete untracked/added file from filesystem
            const absPath = vscode.Uri.joinPath(
              vscode.Uri.file(workspaceRoot),
              filePath,
            );
            await vscode.workspace.fs.delete(absPath);
          }
          // If deleteLocalCopies is false, skip untracked/added files
        } else {
          // Revert tracked file changes via git checkout
          await gitService.rollbackFile(filePath);
        }
      }

      messageRouter.broadcastEvent("commitStateChanged", {
        repoId: ctx.repoId,
      });
      rollbackPanel.close();
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });

  messageRouter.handle("closeRollbackPanel", async () => {
    rollbackPanel.close();
    return { success: true };
  });

  messageRouter.handle("pullBranch", async (_params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    return withProgress(messageRouter, ctx.repoId, async () => {
      await gitService.pull();
      messageRouter.broadcastEvent("gitStateChanged", {
        scope: "all",
        repoId: ctx.repoId,
      });
      return { success: true };
    });
  });

  messageRouter.handle("updateBranch", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const branchName = params.branchName as string;
    if (!branchName) {
      throw new PorcelainError(
        PorcelainErrorCode.BRANCH_NOT_FOUND,
        "No local branch was selected",
      );
    }
    return withProgress(messageRouter, ctx.repoId, async () => {
      await ctx.gitService.updateBranch(branchName);
      messageRouter.broadcastEvent("gitStateChanged", {
        scope: "all",
        repoId: ctx.repoId,
      });
      return { success: true };
    });
  });

  messageRouter.handle("pullRebase", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const branchName = params.branchName as string | undefined;
    return withProgress(messageRouter, ctx.repoId, async () => {
      await gitService.pullRebase(branchName);
      messageRouter.broadcastEvent("gitStateChanged", {
        scope: "all",
        repoId: ctx.repoId,
      });
      return { success: true };
    });
  });

  messageRouter.handle("pullMerge", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const branchName = params.branchName as string | undefined;
    return withProgress(messageRouter, ctx.repoId, async () => {
      await gitService.pull(branchName);
      messageRouter.broadcastEvent("gitStateChanged", {
        scope: "all",
        repoId: ctx.repoId,
      });
      return { success: true };
    });
  });

  messageRouter.handle("fetchBranch", async (_params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    return withProgress(messageRouter, ctx.repoId, async () => {
      await gitService.fetch();
      messageRouter.broadcastEvent("gitStateChanged", {
        scope: "all",
        repoId: ctx.repoId,
      });
      return { success: true };
    });
  });

  messageRouter.handle("cherryPick", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const hash = params.hash as string;
    return withProgress(messageRouter, ctx.repoId, async () => {
      await gitService.cherryPick(hash);
      messageRouter.broadcastEvent("gitStateChanged", {
        scope: "all",
        repoId: ctx.repoId,
      });
      return { success: true };
    });
  });

  messageRouter.handle("checkoutCommit", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const hash = params.hash as string;
    await gitService.checkoutCommit(hash);
    messageRouter.broadcastEvent("gitStateChanged", {
      scope: "all",
      repoId: ctx.repoId,
    });
    return { success: true };
  });

  messageRouter.handle("revertFileChanges", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const hash = params.hash as string;
    const filePath = params.filePath as string;
    const status = params.status as string | undefined;
    await gitService.checkoutFileFromParent(hash, filePath, status);
    messageRouter.broadcastEvent("gitStateChanged", {
      scope: "all",
      repoId: ctx.repoId,
    });
    return { success: true };
  });

  messageRouter.handle("cherryPickFileChanges", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const hash = params.hash as string;
    const filePath = params.filePath as string;
    await gitService.checkoutFileFromCommit(hash, filePath);
    messageRouter.broadcastEvent("gitStateChanged", {
      scope: "all",
      repoId: ctx.repoId,
    });
    return { success: true };
  });

  messageRouter.handle("resetToCommit", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const hash = params.hash as string;
    const mode = params.mode as "soft" | "mixed" | "hard";
    return withProgress(messageRouter, ctx.repoId, async () => {
      await gitService.resetToCommit(hash, mode);
      messageRouter.broadcastEvent("gitStateChanged", {
        scope: "all",
        repoId: ctx.repoId,
      });
      return { success: true };
    });
  });

  messageRouter.handle("revertCommit", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const hash = params.hash as string;
    return withProgress(messageRouter, ctx.repoId, async () => {
      await gitService.revertCommit(hash);
      messageRouter.broadcastEvent("gitStateChanged", {
        scope: "all",
        repoId: ctx.repoId,
      });
      return { success: true };
    });
  });

  messageRouter.handle("dropCommit", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;

    const hash = params.hash as string;

    // Validate hash format (40-char hex)
    if (!hash || !/^[0-9a-f]{40}$/i.test(hash)) {
      return {
        success: false,
        error: { code: ErrorCode.INVALID_REF, message: "Invalid commit hash" },
      };
    }

    // Check if merge commit (reject before emitting operationStart)
    const parents = await gitService.getCommitParents(hash);
    if (parents.length > 1) {
      return {
        success: false,
        error: {
          code: ErrorCode.GIT_COMMAND_FAILED,
          message: "Merge commits cannot be dropped",
        },
      };
    }

    // Proceed with progress and 30-second timeout
    return withProgress(messageRouter, ctx.repoId, async () => {
      const timeoutMs = 30_000;
      const dropPromise = gitService.dropCommit(hash);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Operation timed out")), timeoutMs),
      );

      await Promise.race([dropPromise, timeoutPromise]);

      messageRouter.broadcastEvent("gitStateChanged", {
        scope: "all",
        repoId: ctx.repoId,
      });
      messageRouter.broadcastEvent("commitStateChanged", {
        repoId: ctx.repoId,
      });
      return { success: true };
    });
  });

  messageRouter.handle("createBranchFromCommit", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const branchName = params.branchName as string;
    const hash = params.hash as string;
    const checkout = params.checkout as boolean | undefined;
    const force = params.force as boolean | undefined;
    await gitService.createBranchFromCommit(branchName, hash, force ?? false);
    if (checkout) {
      await gitService.checkout(branchName);
    }
    messageRouter.broadcastEvent("gitStateChanged", {
      scope: "all",
      repoId: ctx.repoId,
    });
    return { success: true };
  });

  messageRouter.handle("createTag", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const tagName = params.tagName as string;
    const hash = params.hash as string;
    const message = params.message as string | undefined;
    await gitService.createTag(tagName, hash, message);
    messageRouter.broadcastEvent("gitStateChanged", {
      scope: "all",
      repoId: ctx.repoId,
    });
    return { success: true };
  });

  messageRouter.handle("copyToClipboard", async (params) => {
    const text = params.text as string;
    await vscode.env.clipboard.writeText(text);
    return { success: true };
  });

  messageRouter.handle("openFileAtRevision", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const filePath = params.filePath as string;
    const ref = params.ref as string;
    const uri = buildGitContentUri(ref, filePath, ctx.repoId);
    await vscode.window.showTextDocument(uri, { preview: true });
    return { success: true };
  });

  // ─── Commit Panel Handlers ───────────────────────────────────────

  messageRouter.handle("getWorkingTreeChanges", async (_params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    return ctx.gitService.getWorkingTreeChanges();
  });

  messageRouter.handle("unstageFile", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    await ctx.gitService.unstageFile(params.filePath as string);
    messageRouter.broadcastEvent("commitStateChanged", {
      repoId: ctx.repoId,
    });
    return { success: true };
  });

  messageRouter.handle("stageAll", async (_params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    await ctx.gitService.stageAll();
    messageRouter.broadcastEvent("commitStateChanged", {
      repoId: ctx.repoId,
    });
    return { success: true };
  });

  messageRouter.handle("unstageAll", async (_params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    await ctx.gitService.unstageAll();
    messageRouter.broadcastEvent("commitStateChanged", {
      repoId: ctx.repoId,
    });
    return { success: true };
  });

  messageRouter.handle("commitChanges", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const message = params.message as string;
    const amend = params.amend as boolean | undefined;
    const selections = params.selections as
      | readonly CommitSelection[]
      | undefined;
    const filePaths = params.filePaths as string[] | undefined;

    if (selections !== undefined) {
      const result = await gitService.commitSelected({
        message,
        amend: amend ?? false,
        selections,
      });
      requireSuccessfulGitOperation(result);
    } else {
      if (filePaths && filePaths.length > 0) {
        await gitService.stageFiles(filePaths);
      }
      await gitService.commit(message, amend ?? false);
    }

    messageRouter.broadcastEvent("commitStateChanged", {
      repoId: ctx.repoId,
    });
    messageRouter.broadcastEvent("gitStateChanged", {
      scope: "all",
      repoId: ctx.repoId,
    });
    return { success: true };
  });

  messageRouter.handle("commitAndPush", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const message = params.message as string;
    const amend = params.amend as boolean | undefined;
    const selections = params.selections as
      | readonly CommitSelection[]
      | undefined;
    const filePaths = params.filePaths as string[] | undefined;

    return withProgress(messageRouter, ctx.repoId, async () => {
      if (selections !== undefined) {
        const result = await gitService.commitSelected({
          message,
          amend: amend ?? false,
          selections,
        });
        requireSuccessfulGitOperation(result);
        await gitService.pushCurrentBranch(amend ?? false);
      } else {
        if (filePaths && filePaths.length > 0) {
          await gitService.stageFiles(filePaths);
        }
        await gitService.commitAndPush(message, amend ?? false);
      }
      messageRouter.broadcastEvent("commitStateChanged", {
        repoId: ctx.repoId,
      });
      messageRouter.broadcastEvent("gitStateChanged", {
        scope: "all",
        repoId: ctx.repoId,
      });
      return { success: true };
    });
  });

  messageRouter.handle("amendCommit", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const message = params.message as string;
    await gitService.commit(message, true);
    messageRouter.broadcastEvent("commitStateChanged", {
      repoId: ctx.repoId,
    });
    messageRouter.broadcastEvent("gitStateChanged", {
      scope: "all",
      repoId: ctx.repoId,
    });
    return { success: true };
  });

  messageRouter.handle("getAmendMessage", async (_params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const message = await ctx.gitService.getLastCommitMessage();
    return { message };
  });

  messageRouter.handle("getRecentCommitMessages", async (_params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    return ctx.gitService.getRecentCommitMessages(20);
  });

  messageRouter.handle("refreshGitState", async (_params, ctx) => {
    if (ctx) {
      ctx.gitService.invalidateCache();
    }
    messageRouter.broadcastEvent("gitStateChanged", {
      scope: "all",
      repoId: ctx?.repoId,
    });
    return { success: true };
  });

  messageRouter.handle("rollbackFile", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const filePath = params.filePath as string;
    const choice = await vscode.window.showWarningMessage(
      `Rollback changes to "${filePath}"? This cannot be undone.`,
      { modal: true },
      "Rollback",
    );
    if (choice !== "Rollback") return { success: false };
    await gitService.rollbackFile(filePath);
    messageRouter.broadcastEvent("commitStateChanged", {
      repoId: ctx.repoId,
    });
    return { success: true };
  });

  messageRouter.handle("rollbackFiles", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const filePaths = params.filePaths as string[];
    if (!filePaths || filePaths.length === 0) return { success: false };
    const choice = await vscode.window.showWarningMessage(
      `Rollback changes to ${filePaths.length} file(s)? This cannot be undone.`,
      { modal: true },
      "Rollback",
    );
    if (choice !== "Rollback") return { success: false };
    for (const filePath of filePaths) {
      await gitService.rollbackFile(filePath);
    }
    messageRouter.broadcastEvent("commitStateChanged", {
      repoId: ctx.repoId,
    });
    return { success: true };
  });

  messageRouter.handle("revealInSystemExplorer", async (params, ctx) => {
    const filePath = params.filePath as string;
    if (!filePath || !ctx) return { success: false };
    const workspaceRoot = ctx.repo.rootPath;
    const absPath = vscode.Uri.joinPath(
      vscode.Uri.file(workspaceRoot),
      filePath,
    );
    await vscode.commands.executeCommand("revealFileInOS", absPath);
    return { success: true };
  });

  messageRouter.handle("deleteFiles", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const workspaceRoot = ctx.repo.rootPath;
    const filePaths = params.filePaths as string[];
    if (!filePaths || filePaths.length === 0) return { success: false };

    const fileCount = filePaths.length;
    const message =
      fileCount === 1
        ? `Delete "${filePaths[0]}"? This cannot be undone.`
        : `Delete ${fileCount} files? This cannot be undone.`;

    const choice = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      "Delete",
    );
    if (choice !== "Delete") return { success: false };

    for (const filePath of filePaths) {
      const fullPath = vscode.Uri.joinPath(
        vscode.Uri.file(workspaceRoot),
        filePath,
      );
      try {
        await vscode.workspace.fs.delete(fullPath, { recursive: true });
      } catch {
        // File may already be deleted, ignore
      }
    }
    messageRouter.broadcastEvent("commitStateChanged", {
      repoId: ctx.repoId,
    });
    return { success: true };
  });

  messageRouter.handle("showDiffForWorkingFile", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const workspaceRoot = ctx.repo.rootPath;
    const filePath = params.filePath as string;
    // `staged` omitted means the whole change against HEAD. The Commit panel
    // sends no side because staging is not part of its model.
    const staged =
      params.staged === undefined ? undefined : Boolean(params.staged);
    const changes = await ctx.gitService.getWorkingTreeChanges();
    const matching = changes.filter((candidate) => candidate.path === filePath);
    const file =
      staged === undefined
        ? // Prefer the indexed row: the working-tree duplicate of a staged
          // change is always reported as "modified", losing add/rename/delete.
          (matching.find((candidate) => candidate.staged) ?? matching[0])
        : matching.find((candidate) => candidate.staged === staged);
    if (!file) {
      throw new Error(`Working tree change no longer exists: ${filePath}`);
    }
    const resources = getWorkingTreeDiffResources(
      file,
      getWorkingTreeDiffKind(staged),
    );
    const toUri = (resource: WorkingTreeDiffResource): vscode.Uri => {
      if (resource.source === "workingTree") {
        return vscode.Uri.joinPath(
          vscode.Uri.file(workspaceRoot),
          resource.path,
        );
      }
      return buildGitContentUri(
        resource.source === "empty" ? EMPTY_CONTENT_REF : resource.ref,
        resource.path,
        ctx.repoId,
      );
    };
    await diffWindow.show(
      toUri(resources.left),
      toUri(resources.right),
      staged
        ? `${filePath} (HEAD ↔ Index)`
        : `${filePath} (Index ↔ Working Tree)`,
    );
    return { success: true };
  });

  // ─── Shelf Handlers ───────────────────────────────────────────────

  messageRouter.handle("getShelves", async (_params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    return ctx.gitService.getShelves();
  });

  messageRouter.handle("shelveChanges", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const message = params.message as string | undefined;
    const filePaths = params.filePaths as string[] | undefined;
    await gitService.shelveChanges(message ?? "", filePaths);
    messageRouter.broadcastEvent("commitStateChanged", {
      repoId: ctx.repoId,
    });
    return { success: true };
  });

  messageRouter.handle("unshelveChanges", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const stashId = params.stashId as string;
    const drop = (params.drop as boolean) ?? true;
    await gitService.unshelveChanges(stashId, drop);
    messageRouter.broadcastEvent("commitStateChanged", {
      repoId: ctx.repoId,
    });
    messageRouter.broadcastEvent("gitStateChanged", {
      scope: "all",
      repoId: ctx.repoId,
    });
    return { success: true };
  });

  messageRouter.handle("deleteShelve", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const stashId = params.stashId as string;
    const choice = await vscode.window.showWarningMessage(
      `Delete shelved changes "${stashId}"? This cannot be undone.`,
      { modal: true },
      "Delete",
    );
    if (choice !== "Delete") return { success: false };
    await gitService.deleteShelve(stashId);
    messageRouter.broadcastEvent("commitStateChanged", {
      repoId: ctx.repoId,
    });
    return { success: true };
  });

  messageRouter.handle("showShelfFileDiff", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const stashId = params.stashId as string;
    const filePath = params.filePath as string;

    // Show diff between the stash version and the parent (before stash)
    const stashUri = buildGitContentUri(stashId, filePath, ctx.repoId);
    const parentUri = buildGitContentUri(`${stashId}^`, filePath, ctx.repoId);
    await diffWindow.show(
      parentUri,
      stashUri,
      `${filePath} (Shelved: ${stashId})`,
    );
    return { success: true };
  });

  messageRouter.handle("unshelveFile", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const stashId = params.stashId as string;
    const filePath = params.filePath as string;

    // Checkout the single file from the stash into the working tree
    try {
      await gitService.checkoutFileFromCommit(stashId, filePath);
      messageRouter.broadcastEvent("commitStateChanged", {
        repoId: ctx.repoId,
      });
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(
        `Failed to unshelve file: ${message}`,
      );
      return { success: false };
    }
  });

  // ─── IDEA Shelf Handlers ────────────────────────────────────────────

  messageRouter.handle("getIdeaShelves", async (_params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    return ctx.gitService.getIdeaShelves();
  });

  messageRouter.handle("ideaShelveChanges", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const message = params.message as string | undefined;
    const filePaths = params.filePaths as string[] | undefined;
    await gitService.ideaShelveChanges(message ?? "", filePaths);
    messageRouter.broadcastEvent("commitStateChanged", {
      repoId: ctx.repoId,
    });
    return { success: true };
  });

  messageRouter.handle("ideaUnshelveChanges", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const shelfName = params.shelfName as string;
    const drop = (params.drop as boolean) ?? true;
    await gitService.ideaUnshelveChanges(shelfName, drop);
    messageRouter.broadcastEvent("commitStateChanged", {
      repoId: ctx.repoId,
    });
    return { success: true };
  });

  messageRouter.handle("deleteIdeaShelf", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const shelfName = params.shelfName as string;
    const choice = await vscode.window.showWarningMessage(
      `Delete shelf "${shelfName}"? This cannot be undone.`,
      { modal: true },
      "Delete",
    );
    if (choice !== "Delete") return { success: false };
    await gitService.deleteIdeaShelf(shelfName);
    messageRouter.broadcastEvent("commitStateChanged", {
      repoId: ctx.repoId,
    });
    return { success: true };
  });

  messageRouter.handle("showIdeaShelfFileDiff", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const workspaceRoot = ctx.repo.rootPath;
    const shelfName = params.shelfName as string;
    const filePath = params.filePath as string;

    const patchFile = `${workspaceRoot}/.idea/shelf/${shelfName}/shelved.patch`;
    try {
      const patchContent = await nodefs.readFile(patchFile, "utf-8");

      // Parse IDEA patch format to extract base content and modified content
      const { baseContent, modifiedContent } = parseIdeaPatchForFile(
        patchContent,
        filePath,
      );

      // Create virtual documents for both sides and show diff
      const baseUri = buildGitContentUri(
        "base",
        `shelved/${shelfName}/${filePath}`,
        ctx.repoId,
      );
      const modifiedUri = buildGitContentUri(
        "modified",
        `shelved/${shelfName}/${filePath}`,
        ctx.repoId,
      );

      // Register temporary content for these URIs
      shelfDiffContent.set(baseUri.toString(), baseContent);
      shelfDiffContent.set(modifiedUri.toString(), modifiedContent);

      await diffWindow.show(
        baseUri,
        modifiedUri,
        `${filePath.split("/").pop()} (Shelved in ${shelfName})`,
      );
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(
        `Could not show diff for "${filePath}": ${msg}`,
      );
      return { success: false };
    }
  });

  messageRouter.handle("createPatchFromShelf", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const workspaceRoot = ctx.repo.rootPath;
    const shelfName = params.shelfName as string;
    const patchFile = `${workspaceRoot}/.idea/shelf/${shelfName}/shelved.patch`;

    // Ask user where to save the patch
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${workspaceRoot}/${shelfName}.patch`),
      filters: { "Patch files": ["patch", "diff"], "All files": ["*"] },
      title: "Save Patch File",
    });

    if (!saveUri) return { success: false };

    try {
      const patchContent = await nodefs.readFile(patchFile, "utf-8");
      await nodefs.writeFile(saveUri.fsPath, patchContent, "utf-8");
      void vscode.window.showInformationMessage(
        `Patch saved to ${saveUri.fsPath}`,
      );
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Failed to create patch: ${msg}`);
      return { success: false };
    }
  });

  messageRouter.handle("copyShelfPatchToClipboard", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const workspaceRoot = ctx.repo.rootPath;
    const shelfName = params.shelfName as string;
    const patchFile = `${workspaceRoot}/.idea/shelf/${shelfName}/shelved.patch`;

    try {
      const patchContent = await nodefs.readFile(patchFile, "utf-8");
      await vscode.env.clipboard.writeText(patchContent);
      void vscode.window.showInformationMessage("Patch copied to clipboard");
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Failed to copy patch: ${msg}`);
      return { success: false };
    }
  });

  messageRouter.handle("importPatches", async (_params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;

    // Ask user to select patch files
    const fileUris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      filters: { "Patch files": ["patch", "diff"], "All files": ["*"] },
      title: "Import Patch Files",
    });

    if (!fileUris || fileUris.length === 0) return { success: false };

    try {
      for (const uri of fileUris) {
        const patchContent = await nodefs.readFile(uri.fsPath, "utf-8");

        // Create a shelf entry from the imported patch
        const fileName = uri.fsPath.split("/").pop() ?? "Imported";
        const shelfName = fileName.replace(/\.(patch|diff)$/, "");
        await gitService.importPatchAsShelf(shelfName, patchContent);
      }

      messageRouter.broadcastEvent("commitStateChanged", {
        repoId: ctx.repoId,
      });
      void vscode.window.showInformationMessage(
        `Imported ${fileUris.length} patch${fileUris.length > 1 ? "es" : ""}`,
      );
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Failed to import patches: ${msg}`);
      return { success: false };
    }
  });

  messageRouter.handle("importPatchFromClipboard", async (_params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;

    try {
      const clipboardContent = await vscode.env.clipboard.readText();
      if (!clipboardContent || !clipboardContent.trim()) {
        void vscode.window.showWarningMessage(
          "Clipboard is empty or does not contain patch content.",
        );
        return { success: false };
      }

      // Validate it looks like a patch
      if (
        !clipboardContent.includes("diff ") &&
        !clipboardContent.includes("---") &&
        !clipboardContent.includes("@@")
      ) {
        void vscode.window.showWarningMessage(
          "Clipboard content does not appear to be a valid patch.",
        );
        return { success: false };
      }

      const shelfName = `Clipboard patch ${new Date().toLocaleString()}`;
      await gitService.importPatchAsShelf(shelfName, clipboardContent);

      messageRouter.broadcastEvent("commitStateChanged", {
        repoId: ctx.repoId,
      });
      void vscode.window.showInformationMessage(
        "Imported patch from clipboard as shelf entry.",
      );
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(
        `Failed to import patch from clipboard: ${msg}`,
      );
      return { success: false };
    }
  });

  // ─── Branch Sidebar Actions ─────────────────────────────────────────

  messageRouter.handle("createBranchPrompt", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const name = params.branchName as string | undefined;
    const checkout = params.checkout as boolean | undefined;
    const force = params.force as boolean | undefined;
    if (!name) return { success: false };
    return withProgress(messageRouter, ctx.repoId, async () => {
      await gitService.createBranch(name, "HEAD", force ?? false);
      if (checkout) {
        await gitService.checkout(name);
      }
      messageRouter.broadcastEvent("gitStateChanged", {
        scope: "all",
        repoId: ctx.repoId,
      });
      return { success: true };
    });
  });

  messageRouter.handle("deleteBranchPrompt", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    const branchName = params.branchName as string;
    if (!branchName) return { success: false };
    const confirm = await vscode.window.showWarningMessage(
      `Delete branch "${branchName}"?`,
      { modal: true },
      "Delete",
    );
    if (confirm !== "Delete") return { success: false };
    return withProgress(messageRouter, ctx.repoId, async () => {
      await gitService.deleteBranch(branchName);
      messageRouter.broadcastEvent("gitStateChanged", {
        scope: "all",
        repoId: ctx.repoId,
      });
      return { success: true };
    });
  });

  messageRouter.handle("fetchAll", async (_params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const { gitService } = ctx;
    return withProgress(messageRouter, ctx.repoId, async () => {
      await gitService.fetch();
      gitService.invalidateCache();
      messageRouter.broadcastEvent("gitStateChanged", {
        scope: "all",
        repoId: ctx.repoId,
      });
      return { success: true };
    });
  });

  messageRouter.handle("setFavorite", async (params, ctx) => {
    if (!ctx) return NOT_GIT_REPO;
    const ref = params.ref as GitRefIdentity | undefined;
    const favorite = params.favorite as boolean | undefined;
    if (
      !ref ||
      !["local", "remote", "tag"].includes(ref.type) ||
      !ref.name ||
      typeof favorite !== "boolean"
    ) {
      throw new Error("Invalid favorite ref");
    }
    const isFavorite = await branchDashboardState.setFavorite(
      ctx.repoId,
      ref.type,
      ref.name,
      favorite,
    );
    return { ref, isFavorite };
  });

  messageRouter.handle("getBranchDashboardPreferences", async () =>
    branchDashboardState.getPreferences(),
  );

  messageRouter.handle("setBranchDashboardPreferences", async (params) => {
    const patch: {
      showTags?: boolean;
      singleClickAction?: "filter" | "navigate";
    } = {};
    if (typeof params.showTags === "boolean") {
      patch.showTags = params.showTags;
    }
    if (
      params.singleClickAction === "filter" ||
      params.singleClickAction === "navigate"
    ) {
      patch.singleClickAction = params.singleClickAction;
    }
    return branchDashboardState.updatePreferences(patch);
  });

  // 6b. Repo registry commands & dynamic workspace folder handling
  messageRouter.handle("getRepos", async () => ({
    repos: repoRegistry.list(),
    activeId: repoRegistry.getActiveId(),
  }));

  // Single source of truth for the active-repo broadcast: computes the
  // disambiguated label (formatRepoLabel) from the current registry list so the
  // webview's panel header stays in lockstep with repoId — not just on panel
  // re-open but on every idle-follow switch. The label can shift on
  // reposChanged without the id changing (adding a same-name repo flips the
  // active repo's label to include the path suffix), so the label is recomputed
  // here at broadcast time, not cached.
  const broadcastActiveRepoChanged = (
    repo: { id: string; name: string; rootPath: string } | null,
  ) => {
    const repoName = repo ? formatRepoLabel(repo, repoRegistry.list()) : "";
    messageRouter.broadcastEvent("activeRepoChanged", { repo, repoName });
  };

  // Task 24 (P2#6) + Fix-5 (F5): serialize concurrent selects via a
  // promise-chain mutex so the broadcast always reflects the truly-active repo.
  // The coordinator re-reads the active id from the registry (source of truth)
  // and persists BEFORE broadcasting, eliminating the setActive/persist/broadcast
  // interleave window that let a stale broadcast land last.
  //
  // Fix-5 (F5): the SAME serializer is shared with folderReconciler below, so a
  // `select` and a folder-reconciliation pass can NEVER interleave — closing
  // the three-way-split window (registry=A, response=B, broadcast=null) that
  // existed when each had its own private promise-chain.
  const selectionSerializer = new Serializer();
  const selectionCoordinator = new RepoSelectionCoordinator(
    repoRegistry,
    (activeId) =>
      context.workspaceState.update("porcelain.activeRepoId", activeId),
    (repo) => broadcastActiveRepoChanged(repo),
    selectionSerializer,
  );

  messageRouter.handle("selectRepo", async (params) => {
    const repoId = params.repoId as string;
    try {
      const { activeId } = await selectionCoordinator.select(repoId);
      return { ok: true as const, activeId };
    } catch (err) {
      // A queued select whose repo was removed by a concurrent folder
      // reconciliation. Surface the same REPO_NOT_FOUND the old handler did.
      if (err instanceof RepoSelectionError) {
        throw new PorcelainError(
          PorcelainErrorCode.REPO_NOT_FOUND,
          err.message,
        );
      }
      throw err;
    }
  });

  const broadcastRepos = () =>
    messageRouter.broadcastEvent("reposChanged", {
      repos: repoRegistry.list(),
      activeId: repoRegistry.getActiveId(),
    });

  // 7. GitWatcher — one per registered repo, disposed on removal.
  const watchers = new Map<string, GitWatcher>(); // repoId → watcher
  const registerRepoWatchers = () => {
    for (const desc of repoRegistry.list()) {
      if (watchers.has(desc.id)) continue;
      const runtime = repoRegistry.get(desc.id);
      if (!runtime) continue;
      const w = new GitWatcher(
        runtime.paths,
        runtime.descriptor.rootPath,
        messageRouter,
        runtime.gitService.cache,
        desc.id,
      );
      watchers.set(desc.id, w);
      context.subscriptions.push(w);
    }
    for (const [id, w] of watchers) {
      if (!repoRegistry.get(id)) {
        w.dispose();
        watchers.delete(id);
      }
    }
  };
  registerRepoWatchers();

  // Task 24 (P2#9): reconcile workspace-folder changes through a single
  // serialized discovery so a slow earlier discoverRepos cannot complete after
  // a later one and resurrect a repo the later change removed. The reconciler
  // guarantees at most one discovery in flight, plus one follow-up pass with
  // the latest folders if a change arrives mid-flight.
  const applyDiscovered = (fresh: DiscoveredRepo[]) => {
    const nextIds = new Set(fresh.map((d) => d.descriptor.id));
    for (const old of repoRegistry.list()) {
      if (!nextIds.has(old.id)) {
        repoRegistry.remove(old.id); // disposes its watcher below
      }
    }
    for (const d of fresh) {
      if (!repoRegistry.get(d.descriptor.id)) {
        repoRegistry.add(d, new GitService(d.paths));
      }
    }
    registerRepoWatchers(); // create/dispose watchers to match registry state
    broadcastRepos();
  };
  const folderReconciler = new FolderReconciler(
    discoverRepos,
    applyDiscovered,
    selectionSerializer,
    // Fix-5 revision (I1): the post-reconcile persist + broadcast runs UNDER the
    // shared serializer (inside runPass's finally, before the mutex releases),
    // so a concurrently-queued `select` cannot interleave its own
    // persist/broadcast between the reconciler's registry mutation and this tail.
    // Pre-fix this tail ran OFF the mutex in reconcileFolders: during its
    // `await workspaceState.update` a queued `select` ran its full body, then
    // this tail resumed and broadcast the STALE pre-select active id LAST and
    // overwrote the select's fresh persisted value — the F5-class interleave the
    // shared serializer was meant to close. Running it under the mutex via
    // onSettled closes that window with no nested chain acquisition (this
    // closure only reads the registry + persists + broadcasts).
    // Fix-10: delegate to persistAndBroadcastActive so the always-broadcast-on-
    // persist-failure guarantee is the shared, unit-tested implementation rather
    // than an inline closure (which the host suite could not exercise). The
    // mutex guarantee (I1) is unchanged — this whole onSettled closure still
    // runs under the shared serializer via runPass's finally, so a concurrently-
    // queued `select` cannot interleave its own persist/broadcast here.
    //
    // Re-broadcast the active repo after every reconcile pass. When the active
    // id CHANGED, this is the authoritative switch broadcast. When it did NOT
    // change, the broadcast is still needed because the repo set changed — the
    // active repo's disambiguated label may have shifted (e.g. adding a
    // same-name repo appends the path suffix). Re-computing the label here
    // (broadcastActiveRepoChanged → formatRepoLabel) keeps the panel header
    // correct without a panel re-open. Cheap + idempotent. This broadcast fires
    // EVEN when the persist threw (persistAndBroadcastActive swallows the error
    // and broadcasts regardless), so the UI never stops tracking the registry.
    async () => {
      await persistAndBroadcastActive(
        repoRegistry,
        (activeId) =>
          context.workspaceState.update("porcelain.activeRepoId", activeId),
        (repo) => broadcastActiveRepoChanged(repo),
      );
    },
  );

  const reconcileFolders = async (
    folders: Array<{ fsPath: string; name: string }>,
  ) => {
    // The persist + broadcast of the active repo now happens INSIDE the
    // reconciler's runPass (under the shared serializer) via onSettled, so this
    // wrapper just delegates. See the folderReconciler construction above for
    // why the tail must run under the mutex (I1).
    return folderReconciler.reconcile(folders);
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const foldersNow = (vscode.workspace.workspaceFolders ?? []).map((f) => ({
        fsPath: f.uri.fsPath,
        name: f.name,
      }));
      void reconcileFolders(foldersNow);
    }),
  );

  // 8. Status bar item to quickly open the panel
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.text = "$(git-branch) Porcelain";
  statusBarItem.tooltip = "Open Porcelain Git Log";
  statusBarItem.command = "porcelain.gitLog.focus";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
  messageRouter.enableStrictRepoContext();
}

function extToLanguage(ext: string): string {
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescriptreact",
    js: "javascript",
    jsx: "javascriptreact",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    css: "css",
    scss: "scss",
    less: "less",
    html: "html",
    xml: "xml",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    sql: "sql",
    sh: "shellscript",
    bash: "shellscript",
    toml: "toml",
    ini: "ini",
    vue: "vue",
    svelte: "svelte",
  };
  return map[ext.toLowerCase()] ?? "plaintext";
}

export function deactivate() {}

/**
 * Extract the patch section for a specific file from a combined patch.
 * Handles IDEA format (Index: path) and standard git format (diff --git).
 */
function _extractFilePatch(
  patchContent: string,
  filePath: string,
): string | null {
  const lines = patchContent.split("\n");
  let collecting = false;
  const result: string[] = [];

  for (const line of lines) {
    // IDEA format: "Index: <path>"
    if (line.startsWith("Index: ")) {
      if (collecting) break;
      const indexPath = line.substring(7).trim();
      if (indexPath === filePath) {
        collecting = true;
        result.push(line);
      }
      continue;
    }

    // Standard git format: "diff --git a/<path> b/<path>"
    if (line.startsWith("diff --git ")) {
      if (collecting && result.length > 1) {
        // Already collecting from Index: line, this is part of same section
        result.push(line);
        continue;
      }
      if (collecting) break;
      if (line.includes(`a/${filePath}`) || line.includes(`b/${filePath}`)) {
        collecting = true;
        result.push(line);
      }
      continue;
    }

    if (collecting) {
      result.push(line);
    }
  }

  return result.length > 0 ? result.join("\n") : null;
}

/**
 * Parse IDEA patch format to extract base and modified content for a specific file.
 * IDEA patches have:
 * - BaseRevisionTextPatchEP section with <+> containing the original file (escaped)
 * - Standard unified diff section
 */
function parseIdeaPatchForFile(
  patchContent: string,
  filePath: string,
): { baseContent: string; modifiedContent: string } {
  const lines = patchContent.split("\n");
  let inTargetFile = false;
  let inBaseRevision = false;
  let baseContentEscaped = "";
  const diffLines: string[] = [];
  let inDiff = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect file section start
    if (line.startsWith("Index: ")) {
      if (inTargetFile) break; // hit next file
      const indexPath = line.substring(7).trim();
      if (indexPath === filePath) {
        inTargetFile = true;
      }
      continue;
    }

    if (!inTargetFile) continue;

    // Detect BaseRevisionTextPatchEP section
    if (
      line.includes(
        "com.intellij.openapi.diff.impl.patch.BaseRevisionTextPatchEP",
      )
    ) {
      inBaseRevision = true;
      continue;
    }

    // Collect base content (starts with <+>)
    if (inBaseRevision && line.startsWith("<+>")) {
      baseContentEscaped = line.substring(3);
      inBaseRevision = false;
      continue;
    }

    // Skip charset info
    if (line.includes("CharsetEP")) {
      // Next line will be <+>UTF-8 or similar, skip it
      if (i + 1 < lines.length && lines[i + 1].startsWith("<+>")) {
        i++;
      }
      continue;
    }

    // Detect diff start
    if (line.startsWith("--- ") && !inDiff) {
      inDiff = true;
      diffLines.push(line);
      continue;
    }

    if (inDiff) {
      diffLines.push(line);
    }
  }

  // Unescape base content (IDEA uses \n for newlines, \t for tabs in the <+> section)
  const baseContent = baseContentEscaped
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");

  // Apply unified diff to base content to get modified content
  const modifiedContent = applyUnifiedDiff(baseContent, diffLines);

  return { baseContent, modifiedContent };
}

/**
 * Apply a unified diff to base content to produce modified content.
 */
function applyUnifiedDiff(baseContent: string, diffLines: string[]): string {
  if (diffLines.length === 0) return baseContent;

  const baseLines = baseContent.split("\n");
  const result: string[] = [];
  let baseIdx = 0;

  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i];

    // Parse hunk header: @@ -start,count +start,count @@
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      const oldStart = Number.parseInt(hunkMatch[1], 10) - 1; // 0-indexed

      // Copy lines before this hunk
      while (baseIdx < oldStart) {
        result.push(baseLines[baseIdx]);
        baseIdx++;
      }

      // Process hunk lines
      for (let j = i + 1; j < diffLines.length; j++) {
        const hunkLine = diffLines[j];
        if (
          hunkLine.startsWith("@@") ||
          hunkLine.startsWith("diff ") ||
          hunkLine.startsWith("Index: ")
        ) {
          i = j - 1;
          break;
        }
        if (hunkLine.startsWith("-")) {
          // Removed line — skip in base
          baseIdx++;
        } else if (hunkLine.startsWith("+")) {
          // Added line
          result.push(hunkLine.substring(1));
        } else if (hunkLine.startsWith(" ")) {
          // Context line
          result.push(hunkLine.substring(1));
          baseIdx++;
        } else {
          // End of diff or no-newline marker
          if (hunkLine.startsWith("\\ No newline")) continue;
          i = j - 1;
          break;
        }
        if (j === diffLines.length - 1) {
          i = j;
        }
      }
      continue;
    }

    // Skip --- and +++ lines
    if (line.startsWith("--- ") || line.startsWith("+++ ")) continue;
  }

  // Copy remaining base lines
  while (baseIdx < baseLines.length) {
    result.push(baseLines[baseIdx]);
    baseIdx++;
  }

  return result.join("\n");
}

function getScmResourcePath(arg?: unknown): string | undefined {
  const value = arg as unknown;
  let uri: vscode.Uri | undefined;
  if (value instanceof vscode.Uri) {
    uri = value;
  } else if (value && typeof value === "object") {
    if ("resourceUri" in value) {
      uri = (value as { resourceUri?: vscode.Uri }).resourceUri;
    } else if ("sourceUri" in value) {
      uri = (value as { sourceUri?: vscode.Uri }).sourceUri;
    }
  }
  if (!uri) return undefined;

  return vscode.workspace.asRelativePath(uri, false);
}
