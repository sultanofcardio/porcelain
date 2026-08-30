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
});
