import { withProgress } from "../extension";
import type { MessageRouter } from "./messageRouter";
import type { RequestContext } from "./protocol";

const NOT_GIT_REPO = { status: "not_git_repo" as const, data: null };

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`${field} is required`);
  }
  return value;
}

function requireNumberArray(value: unknown, field: string): number[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "number")) {
    throw new Error(`${field} must be an array of numbers`);
  }
  return value as number[];
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value as string[];
}

/**
 * Branch, tag, and remote management — the ref-shaped half of the Git Log's
 * command surface. Mutations broadcast `gitStateChanged` so every open surface
 * re-reads the refs they just changed.
 */
export function registerRefHandlers(router: MessageRouter): void {
  const mutate = (
    context: RequestContext,
    run: () => Promise<unknown>,
  ): Promise<unknown> =>
    withProgress(router, context.repoId, async () => {
      const result = await run();
      router.broadcastEvent("gitStateChanged", {
        scope: "all",
        repoId: context.repoId,
      });
      return result ?? { success: true };
    });

  router.handle("getRecentBranches", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const limit = typeof params.limit === "number" ? params.limit : undefined;
    return context.gitService.getRecentBranches(limit);
  });

  router.handle("smartCheckout", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const branchName = requireString(params.branchName, "branchName");
    return mutate(context, () => context.gitService.smartCheckout(branchName));
  });

  router.handle("getUnmergedCommits", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const branchName = requireString(params.branchName, "branchName");
    const target =
      typeof params.target === "string" ? params.target : undefined;
    return context.gitService.getUnmergedCommits(branchName, target);
  });

  router.handle("resetToRemoteBranch", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const branchName = requireString(params.branchName, "branchName");
    return mutate(context, () =>
      context.gitService.resetToRemoteBranch(branchName),
    );
  });

  router.handle("getMergedBranches", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const target =
      typeof params.target === "string" ? params.target : undefined;
    const prefix =
      typeof params.prefix === "string" ? params.prefix : undefined;
    return context.gitService.getMergedBranches(target, prefix);
  });

  router.handle("deleteTag", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const tagName = requireString(params.tagName, "tagName");
    return mutate(context, () => context.gitService.deleteTag(tagName));
  });

  router.handle("deleteRemoteTag", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const tagName = requireString(params.tagName, "tagName");
    const remotes = requireStringArray(params.remotes, "remotes");
    return mutate(context, () =>
      context.gitService.deleteRemoteTag(tagName, remotes),
    );
  });

  router.handle("pushTag", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const remote = requireString(params.remote, "remote");
    const tagName =
      typeof params.tagName === "string" && params.tagName
        ? params.tagName
        : undefined;
    return mutate(context, () => context.gitService.pushTag(remote, tagName));
  });

  router.handle("getRemotes", async (_params, context) => {
    if (!context) return NOT_GIT_REPO;
    return context.gitService.getRemotes();
  });

  router.handle("addRemote", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const name = requireString(params.name, "name");
    const url = requireString(params.url, "url");
    return mutate(context, () => context.gitService.addRemote(name, url));
  });

  router.handle("renameRemote", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const oldName = requireString(params.oldName, "oldName");
    const newName = requireString(params.newName, "newName");
    return mutate(context, () =>
      context.gitService.renameRemote(oldName, newName),
    );
  });

  router.handle("setRemoteUrl", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const name = requireString(params.name, "name");
    const url = requireString(params.url, "url");
    return mutate(context, () => context.gitService.setRemoteUrl(name, url));
  });

  router.handle("removeRemote", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const name = requireString(params.name, "name");
    return mutate(context, () => context.gitService.removeRemote(name));
  });
}

/**
 * History rewriting: the interactive rebase engine and the verbs built on it.
 * A conflict deliberately leaves the rebase in progress — the existing
 * continue/abort/skip banner is what finishes it.
 */
export function registerRewriteHandlers(router: MessageRouter): void {
  const mutate = (
    context: RequestContext,
    run: () => Promise<unknown>,
  ): Promise<unknown> =>
    withProgress(router, context.repoId, async () => {
      const result = await run();
      router.broadcastEvent("gitStateChanged", {
        scope: "all",
        repoId: context.repoId,
      });
      return result ?? { success: true };
    });

  router.handle("getRebaseTodoCommits", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const fromHash = requireString(params.fromHash, "fromHash");
    return context.gitService.getRebaseTodoCommits(fromHash);
  });

  router.handle("runInteractiveRebase", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const baseHash = requireString(params.baseHash, "baseHash");
    const entries = params.entries;
    if (!Array.isArray(entries)) {
      throw new Error("entries must be an array");
    }
    return mutate(context, () =>
      context.gitService.runInteractiveRebase(
        baseHash,
        entries as Parameters<
          typeof context.gitService.runInteractiveRebase
        >[1],
      ),
    );
  });

  router.handle("rewordCommit", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const hash = requireString(params.hash, "hash");
    const message = requireString(params.message, "message");
    return mutate(context, () =>
      context.gitService.rewordCommit(hash, message),
    );
  });

  router.handle("squashCommits", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const hashes = requireStringArray(params.hashes, "hashes");
    const message = requireString(params.message, "message");
    return mutate(context, () =>
      context.gitService.squashCommits(hashes, message),
    );
  });

  router.handle("commitFixup", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const hash = requireString(params.hash, "hash");
    const kind = params.kind === "squash" ? "squash" : "fixup";
    const filePaths = Array.isArray(params.filePaths)
      ? requireStringArray(params.filePaths, "filePaths")
      : undefined;
    return mutate(context, () =>
      context.gitService.commitFixup(hash, kind, filePaths),
    );
  });

  router.handle("undoLastCommit", async (_params, context) => {
    if (!context) return NOT_GIT_REPO;
    return mutate(context, () => context.gitService.undoLastCommit());
  });

  router.handle("rebaseWithOptions", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const upstream = requireString(params.upstream, "upstream");
    const options = (params.options ?? {}) as Parameters<
      typeof context.gitService.rebase
    >[1];
    return mutate(context, () => context.gitService.rebase(upstream, options));
  });

  router.handle("mergeWithOptions", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const branchName = requireString(params.branchName, "branchName");
    const options = (params.options ?? {}) as Parameters<
      typeof context.gitService.merge
    >[1];
    return mutate(context, () => context.gitService.merge(branchName, options));
  });

  router.handle("pullWithOptions", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const options = (params.options ?? {}) as Parameters<
      typeof context.gitService.pullWithOptions
    >[0];
    return mutate(context, () => context.gitService.pullWithOptions(options));
  });
}

/** Working-tree depth: per-hunk staging and the commit-time affordances. */
export function registerWorkingTreeHandlers(router: MessageRouter): void {
  const mutate = (
    context: RequestContext,
    run: () => Promise<unknown>,
  ): Promise<unknown> =>
    withProgress(router, context.repoId, async () => {
      const result = await run();
      router.broadcastEvent("gitStateChanged", {
        scope: "all",
        repoId: context.repoId,
      });
      return result ?? { success: true };
    });

  router.handle("getFileHunks", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const filePath = requireString(params.filePath, "filePath");
    return context.gitService.getFileHunks(filePath, params.staged === true);
  });

  router.handle("stageHunks", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const filePath = requireString(params.filePath, "filePath");
    const indices = requireNumberArray(params.hunkIndices, "hunkIndices");
    return mutate(context, () =>
      context.gitService.stageHunks(filePath, indices),
    );
  });

  router.handle("unstageHunks", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const filePath = requireString(params.filePath, "filePath");
    const indices = requireNumberArray(params.hunkIndices, "hunkIndices");
    return mutate(context, () =>
      context.gitService.unstageHunks(filePath, indices),
    );
  });

  router.handle("stageHunkAtLine", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const filePath = requireString(params.filePath, "filePath");
    const newLine = params.newLine;
    if (typeof newLine !== "number") {
      throw new Error("newLine must be a number");
    }
    return mutate(context, async () => ({
      staged: await context.gitService.stageHunkAtLine(filePath, newLine, {
        unstage: params.unstage === true,
      }),
    }));
  });

  router.handle("getCommitTemplate", async (_params, context) => {
    if (!context) return NOT_GIT_REPO;
    const [template, mergeMessage] = await Promise.all([
      context.gitService.getCommitTemplate().catch(() => null),
      context.gitService.getMergeMessage().catch(() => null),
    ]);
    // Mid-merge, git's own prepared message wins over the template.
    return { template, mergeMessage };
  });

  router.handle("getMergeMessage", async (_params, context) => {
    if (!context) return NOT_GIT_REPO;
    return { message: await context.gitService.getMergeMessage() };
  });

  router.handle("addToGitignore", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const filePath = requireString(params.filePath, "filePath");
    return mutate(context, async () => ({
      ignoreFile: await context.gitService.addToGitignore(filePath),
    }));
  });

  router.handle("stashWithOptions", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    return mutate(context, () =>
      context.gitService.stashWithOptions({
        ...(typeof params.message === "string"
          ? { message: params.message }
          : {}),
        keepIndex: params.keepIndex === true,
        includeUntracked: params.includeUntracked === true,
      }),
    );
  });

  router.handle("stashToBranch", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const stashRef = requireString(params.stashRef, "stashRef");
    const branchName = requireString(params.branchName, "branchName");
    return mutate(context, () =>
      context.gitService.stashToBranch(stashRef, branchName),
    );
  });
}
