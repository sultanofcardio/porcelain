import { describe, expect, it, vi } from "vitest";
import type { CommandType } from "../../shared/bridge/types";
import type { Commit } from "../../shared/types/git";
import { buildCommitActions, type CommitActionContext } from "./commit-actions";

const commit = {
  hash: "0123456789abcdef",
  shortHash: "01234567",
  subject: "Keep the action registry reusable",
} as Commit;

function contextFor(
  overrides: Partial<CommitActionContext> = {},
): CommitActionContext {
  return {
    repoId: "repo-a",
    commit,
    selectedCommitHashes: [commit.hash],
    currentBranch: "main",
    fileFilter: "",
    isRebasing: false,
    isMerging: false,
    isCherryPicking: false,
    mutationRefresh: "surface",
    request: vi.fn().mockResolvedValue(undefined),
    requestWithProgress: vi.fn().mockResolvedValue(undefined),
    confirm: vi.fn().mockResolvedValue(true),
    input: vi.fn().mockResolvedValue("created-name"),
    createBranch: vi.fn().mockResolvedValue(undefined),
    openInteractiveRebase: vi.fn(),
    showInGitLog: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("buildCommitActions", () => {
  it("preserves menu ordering and dynamically shows Show in Git Log", () => {
    const actions = buildCommitActions(contextFor({ fileFilter: "src/a.ts" }));

    expect(
      actions.filter((action) => !action.separator).map((a) => a.id),
    ).toEqual([
      "copy-revision",
      "cherry-pick",
      "checkout-revision",
      "compare-versions",
      "reset-mixed",
      "reset-soft",
      "reset-hard",
      "revert",
      "drop",
      "interactive-rebase",
      "reword",
      "squash-commits",
      "fixup",
      "undo-commit",
      "new-branch",
      "new-tag",
      "show-in-git-log",
    ]);
    expect(
      actions.find((action) => action.id === "show-in-git-log")?.visible,
    ).toBe(true);
    expect(
      buildCommitActions(contextFor()).find(
        (action) => action.id === "show-in-git-log",
      )?.visible,
    ).toBe(false);
  });

  it.each([
    { state: { currentBranch: "" }, reason: "detached HEAD" },
    { state: { isRebasing: true }, reason: "rebase" },
    { state: { isMerging: true }, reason: "merge" },
    { state: { isCherryPicking: true }, reason: "cherry-pick" },
  ])("disables Drop Commit during $reason", ({ state }) => {
    const drop = buildCommitActions(contextFor(state)).find(
      (action) => action.id === "drop",
    );

    expect(drop?.enabled).toBe(false);
  });

  it("routes every repo-bound command through the context repo", async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const requestWithProgress = vi.fn().mockResolvedValue(undefined);
    const context = contextFor({ request, requestWithProgress });
    const actions = buildCommitActions(context);

    for (const id of [
      "cherry-pick",
      "checkout-revision",
      "reset-mixed",
      "reset-soft",
      "reset-hard",
      "revert",
      "drop",
      "new-tag",
    ]) {
      await actions.find((action) => action.id === id)?.execute();
    }

    const repoBoundCalls = [
      ...request.mock.calls,
      ...requestWithProgress.mock.calls,
    ].filter(([command]: [CommandType]) =>
      [
        "cherryPick",
        "checkoutCommit",
        "resetToCommit",
        "revertCommit",
        "dropCommit",
        "createTag",
      ].includes(command),
    );
    expect(repoBoundCalls.length).toBeGreaterThan(0);
    for (const call of repoBoundCalls) {
      expect(call[2]).toEqual({ repoId: "repo-a" });
    }
  });

  it("keeps UI-only bridge requests explicitly global", async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const context = contextFor({ request });
    const actions = buildCommitActions(context);

    await actions.find((action) => action.id === "copy-revision")?.execute();

    expect(request).toHaveBeenCalledWith(
      "copyToClipboard",
      { text: commit.hash },
      { scope: "global" },
    );
  });

  it("returns each action's declared refresh scope", async () => {
    const actions = buildCommitActions(
      contextFor({ fileFilter: "src/a.ts", mutationRefresh: "comparison" }),
    );

    for (const action of actions.filter(
      (candidate) => !candidate.separator && candidate.visible,
    )) {
      await expect(action.execute()).resolves.toBe(action.refresh);
    }
  });

  it("offers Compare Versions only for a two-commit selection", async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const hashes = ["aaaaaaaa", "bbbbbbbb"];

    const single = buildCommitActions(contextFor()).find(
      (action) => action.id === "compare-versions",
    );
    expect(single?.visible).toBe(false);

    const pair = buildCommitActions(
      contextFor({ selectedCommitHashes: hashes, request }),
    ).find((action) => action.id === "compare-versions");
    expect(pair?.visible).toBe(true);
    expect(pair?.enabled).toBe(true);

    await pair?.execute();
    expect(request).toHaveBeenCalledWith(
      "openCompareVersions",
      { hashes },
      { repoId: "repo-a" },
    );

    const triple = buildCommitActions(
      contextFor({ selectedCommitHashes: [...hashes, "cccccccc"] }),
    ).find((action) => action.id === "compare-versions");
    expect(triple?.visible).toBe(true);
    expect(triple?.enabled).toBe(false);
  });

  it("disables single-commit actions while several commits are selected", () => {
    const actions = buildCommitActions(
      contextFor({ selectedCommitHashes: ["aaaaaaaa", "bbbbbbbb"] }),
    );

    for (const id of [
      "checkout-revision",
      "reset-mixed",
      "reset-soft",
      "reset-hard",
      "revert",
      "drop",
      "new-branch",
      "new-tag",
    ]) {
      expect(actions.find((action) => action.id === id)?.enabled).toBe(false);
    }
  });

  it("cherry-picks a multi-selection oldest-first", async () => {
    const requestWithProgress = vi.fn().mockResolvedValue(undefined);
    // The log selection arrives newest-first.
    const pick = buildCommitActions(
      contextFor({
        selectedCommitHashes: ["cccccccc", "bbbbbbbb", "aaaaaaaa"],
        requestWithProgress,
      }),
    ).find((action) => action.id === "cherry-pick");

    expect(pick?.enabled).toBe(true);
    expect(pick?.label).toBe("Cherry-Pick 3 Commits");
    await pick?.execute();
    expect(requestWithProgress).toHaveBeenCalledWith(
      "cherryPick",
      { hashes: ["aaaaaaaa", "bbbbbbbb", "cccccccc"] },
      { repoId: "repo-a" },
    );
  });

  it("copies every selected revision when several are selected", async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const hashes = ["aaaaaaaa", "bbbbbbbb"];
    const actions = buildCommitActions(
      contextFor({ selectedCommitHashes: hashes, request }),
    );
    const copy = actions.find((action) => action.id === "copy-revision");

    expect(copy?.label).toBe("Copy Revision Numbers");
    await copy?.execute();
    expect(request).toHaveBeenCalledWith(
      "copyToClipboard",
      { text: hashes.join("\n") },
      { scope: "global" },
    );
  });

  describe("buildCommitActions history rewriting", () => {
    it("gates rewriting verbs on a branch with no operation in flight", () => {
      for (const state of [
        { currentBranch: "" },
        { isRebasing: true },
        { isMerging: true },
        { isCherryPicking: true },
      ]) {
        const actions = buildCommitActions(contextFor(state));
        for (const id of ["interactive-rebase", "reword", "fixup"]) {
          expect(actions.find((action) => action.id === id)?.enabled).toBe(
            false,
          );
        }
      }
    });

    it("opens the interactive rebase editor rooted at the commit", async () => {
      const openInteractiveRebase = vi.fn();
      const actions = buildCommitActions(contextFor({ openInteractiveRebase }));

      await actions
        .find((action) => action.id === "interactive-rebase")
        ?.execute();

      expect(openInteractiveRebase).toHaveBeenCalledWith(commit.hash);
    });

    it("rewords only when the message actually changed", async () => {
      const requestWithProgress = vi.fn().mockResolvedValue(undefined);
      const unchanged = buildCommitActions(
        contextFor({
          requestWithProgress,
          input: vi.fn().mockResolvedValue(commit.subject),
        }),
      );
      await unchanged.find((action) => action.id === "reword")?.execute();
      expect(requestWithProgress).not.toHaveBeenCalled();

      const changed = buildCommitActions(
        contextFor({
          requestWithProgress,
          input: vi.fn().mockResolvedValue("  a better subject  "),
        }),
      );
      await changed.find((action) => action.id === "reword")?.execute();
      expect(requestWithProgress).toHaveBeenCalledWith(
        "rewordCommit",
        { hash: commit.hash, message: "a better subject" },
        { repoId: "repo-a" },
      );
    });

    it("offers Squash only for a multi-selection and sends every hash", async () => {
      const requestWithProgress = vi.fn().mockResolvedValue(undefined);
      const single = buildCommitActions(contextFor()).find(
        (action) => action.id === "squash-commits",
      );
      expect(single?.visible).toBe(false);

      const hashes = ["cccccccc", "bbbbbbbb"];
      const multi = buildCommitActions(
        contextFor({
          selectedCommitHashes: hashes,
          requestWithProgress,
          input: vi.fn().mockResolvedValue("combined"),
        }),
      ).find((action) => action.id === "squash-commits");

      expect(multi?.visible).toBe(true);
      await multi?.execute();
      expect(requestWithProgress).toHaveBeenCalledWith(
        "squashCommits",
        { hashes, message: "combined" },
        { repoId: "repo-a" },
      );
    });

    it("undoes only the tip commit", async () => {
      const requestWithProgress = vi.fn().mockResolvedValue(undefined);
      const notHead = buildCommitActions(
        contextFor({ headHash: "someone-else" }),
      ).find((action) => action.id === "undo-commit");
      expect(notHead?.enabled).toBe(false);
      expect(notHead?.disabledReason).toMatch(/most recent commit/);

      const atHead = buildCommitActions(
        contextFor({ headHash: commit.hash, requestWithProgress }),
      ).find((action) => action.id === "undo-commit");
      expect(atHead?.enabled).toBe(true);
      await atHead?.execute();
      expect(requestWithProgress).toHaveBeenCalledWith(
        "undoLastCommit",
        {},
        { repoId: "repo-a" },
      );
    });
  });
});
