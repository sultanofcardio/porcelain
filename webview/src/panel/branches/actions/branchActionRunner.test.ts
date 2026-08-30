import { describe, expect, it, vi } from "vitest";
import type { BranchInfo } from "../../../shared/types/git";
import type { BranchOperations } from "../branchOperations";
import {
  type BranchActionPorts,
  type BranchActionUi,
  formatBranchActionError,
  runBranchAction,
  submitCreateBranch,
  submitPush,
} from "./branchActionRunner";
import type {
  BranchActionContext,
  BranchActionError,
} from "./branchActionTypes";

const branch: BranchInfo = {
  name: "feature",
  fullRef: "refs/heads/feature",
  isRemote: false,
  isCurrent: false,
  isFavorite: false,
  upstream: "origin/feature",
  ahead: 1,
  behind: 2,
  lastCommitHash: "feature-tip",
};

const context: BranchActionContext = {
  repoId: "repo-a",
  ref: { type: "local", name: "feature", fullRef: "refs/heads/feature" },
  branch,
  currentBranch: "main",
};

function createPorts(): BranchActionPorts & {
  operations: BranchOperations;
  ui: BranchActionUi;
} {
  return {
    operations: {
      checkout: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      push: vi.fn().mockResolvedValue(undefined),
      merge: vi.fn().mockResolvedValue(undefined),
      rebase: vi.fn().mockResolvedValue(undefined),
      checkoutAndRebase: vi.fn().mockResolvedValue(undefined),
      setFavorite: vi.fn().mockResolvedValue(undefined),
      compare: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn().mockResolvedValue(undefined),
      createPrompt: vi.fn().mockResolvedValue(undefined),
      deletePrompt: vi.fn().mockResolvedValue(undefined),
      smartCheckout: vi.fn().mockResolvedValue({ restored: true }),
      unmergedCommits: vi.fn().mockResolvedValue([]),
      resetToRemote: vi.fn().mockResolvedValue(undefined),
      checkoutRevision: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockResolvedValue(undefined),
      pushTag: vi.fn().mockResolvedValue(undefined),
      deleteRemoteTag: vi
        .fn()
        .mockResolvedValue([{ remote: "origin", deleted: true }]),
      getRemotes: vi
        .fn()
        .mockResolvedValue([{ name: "origin", url: "git@example.com:r.git" }]),
    },
    ui: {
      confirm: vi.fn().mockResolvedValue(true),
      input: vi.fn().mockResolvedValue(null),
      openCreate: vi.fn(),
      openPush: vi.fn(),
      isCurrent: vi.fn().mockReturnValue(true),
      notifyError: vi.fn().mockResolvedValue(undefined),
      pickRemote: vi.fn().mockResolvedValue("origin"),
    },
  };
}

function typedError(
  code: string,
  message: string,
  recovery?: string,
): Error & { code: string; recovery?: string } {
  return Object.assign(new Error(message), {
    code,
    ...(recovery ? { recovery } : {}),
  });
}

describe("runBranchAction", () => {
  it("forwards update to the repository captured in the action context", async () => {
    const ports = createPorts();

    await runBranchAction("update", context, ports);

    expect(ports.operations.update).toHaveBeenCalledWith("repo-a", "feature");
  });

  it("routes non-destructive and dialog actions through operation and UI ports", async () => {
    const ports = createPorts();
    ports.ui.input = vi.fn().mockResolvedValue("renamed");

    await runBranchAction("toggle-favorite", context, ports);
    await runBranchAction("checkout", context, ports);
    await runBranchAction("new-branch", context, ports);
    await runBranchAction("compare-current", context, ports);
    await runBranchAction("checkout-rebase", context, ports);
    await runBranchAction("rename", context, ports);
    await runBranchAction("push", context, ports);

    expect(ports.operations.setFavorite).toHaveBeenCalledWith(
      "repo-a",
      context.ref,
      true,
    );
    expect(ports.operations.checkout).toHaveBeenCalledWith("repo-a", branch);
    expect(ports.ui.openCreate).toHaveBeenCalledWith(
      "repo-a",
      context.ref,
      "feature",
      "feature",
    );
    expect(ports.operations.compare).toHaveBeenCalledWith(
      "repo-a",
      context.ref,
    );
    expect(ports.operations.checkoutAndRebase).toHaveBeenCalledWith(
      "repo-a",
      "feature",
      "main",
    );
    expect(ports.operations.rename).toHaveBeenCalledWith(
      "repo-a",
      "feature",
      "renamed",
    );
    expect(ports.ui.openPush).toHaveBeenCalledWith(
      "repo-a",
      context.ref,
      "feature",
    );
  });

  it("confirms merge, rebase, and delete before invoking them", async () => {
    const ports = createPorts();

    await runBranchAction("merge-current", context, ports);
    await runBranchAction("rebase-current", context, ports);
    await runBranchAction("delete", context, ports);

    expect(ports.operations.merge).toHaveBeenCalledWith("repo-a", "feature");
    expect(ports.operations.rebase).toHaveBeenCalledWith("repo-a", "feature");
    expect(ports.operations.delete).toHaveBeenCalledWith(
      "repo-a",
      branch,
      false,
    );
  });

  it("does not merge after the checked-out branch changes during confirmation", async () => {
    const ports = createPorts();
    let currentBranch = "main";
    let resolveConfirmation: (confirmed: boolean) => void = () => {};
    ports.ui.confirm = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirmation = resolve;
        }),
    );
    ports.ui.isCurrent = vi.fn(
      (_repoId, _ref, capturedCurrentBranch?: string) =>
        capturedCurrentBranch === undefined ||
        capturedCurrentBranch === currentBranch,
    );

    const pending = runBranchAction("merge-current", context, ports);
    await vi.waitFor(() => expect(ports.ui.confirm).toHaveBeenCalled());
    currentBranch = "release";
    resolveConfirmation(true);
    await pending;

    expect(ports.operations.merge).not.toHaveBeenCalled();
  });

  it("offers force delete only for BRANCH_NOT_FULLY_MERGED", async () => {
    const ports = createPorts();
    vi.mocked(ports.operations.delete)
      .mockRejectedValueOnce(
        typedError("BRANCH_NOT_FULLY_MERGED", "not merged"),
      )
      .mockResolvedValueOnce(undefined);

    await runBranchAction("delete", context, ports);

    expect(ports.ui.confirm).toHaveBeenNthCalledWith(
      2,
      "Branch 'feature' is not fully merged. Force delete?",
      "Force Delete",
    );
    expect(ports.operations.delete).toHaveBeenNthCalledWith(
      2,
      "repo-a",
      branch,
      true,
    );
    expect(ports.ui.notifyError).not.toHaveBeenCalled();
  });

  it("preserves a nonmatching typed delete error without a force prompt", async () => {
    const ports = createPorts();
    const error = typedError(
      "REPO_NOT_FOUND",
      "Repository disappeared",
      "Choose another repository.",
    );
    vi.mocked(ports.operations.delete).mockRejectedValueOnce(error);

    await runBranchAction("delete", context, ports);

    expect(ports.ui.confirm).toHaveBeenCalledTimes(1);
    expect(ports.ui.notifyError).toHaveBeenCalledWith("Delete failed", {
      code: "REPO_NOT_FOUND",
      message: "Repository disappeared",
      recovery: "Choose another repository.",
    });
  });

  it("suppresses recovery prompts and errors when pending work settles stale", async () => {
    const ports = createPorts();
    let rejectDelete: (error: unknown) => void = () => {};
    vi.mocked(ports.operations.delete).mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectDelete = reject;
        }),
    );
    vi.mocked(ports.ui.isCurrent).mockReturnValueOnce(true);

    const pending = runBranchAction("delete", context, ports);
    await vi.waitFor(() => expect(ports.operations.delete).toHaveBeenCalled());
    vi.mocked(ports.ui.isCurrent).mockReturnValue(false);
    rejectDelete(typedError("BRANCH_NOT_FULLY_MERGED", "not merged"));
    await pending;

    expect(ports.ui.confirm).toHaveBeenCalledTimes(1);
    expect(ports.ui.notifyError).not.toHaveBeenCalled();
  });

  it("preserves unknown operation failures in user-visible errors", async () => {
    const ports = createPorts();
    vi.mocked(ports.operations.update).mockRejectedValueOnce(
      "network vanished",
    );

    await runBranchAction("update", context, ports);

    expect(ports.ui.notifyError).toHaveBeenCalledWith("Update failed", {
      code: "UNKNOWN",
      message: "network vanished",
    });
  });
});

describe("formatBranchActionError", () => {
  it("preserves code, message, and recovery from typed host errors", () => {
    expect(
      formatBranchActionError(
        typedError("BRANCH_NO_UPSTREAM", "No upstream", "Set an upstream."),
      ),
    ).toEqual({
      code: "BRANCH_NO_UPSTREAM",
      message: "No upstream",
      recovery: "Set an upstream.",
    } satisfies BranchActionError);
  });

  it("normalizes unknown thrown values without inventing a diagnosis", () => {
    const thrown = { detail: "bad response" };
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    expect(formatBranchActionError(thrown)).toEqual({
      code: "UNKNOWN",
      message: "An unexpected error occurred.",
    } satisfies BranchActionError);
    expect(consoleError).toHaveBeenCalledWith(
      "Unexpected branch action error:",
      thrown,
    );
    consoleError.mockRestore();
  });
});

describe("dialog submissions", () => {
  it("returns the real create error and recovery text instead of guessing it already exists", async () => {
    const ports = createPorts();
    vi.mocked(ports.operations.create).mockRejectedValueOnce(
      typedError(
        "REPO_NOT_FOUND",
        "Repository disappeared",
        "Choose another repository.",
      ),
    );

    await expect(
      submitCreateBranch(
        "repo-a",
        "main",
        { branchName: "topic", checkout: true, force: false },
        ports.operations,
      ),
    ).resolves.toBe("Repository disappeared\nChoose another repository.");
    expect(ports.operations.create).toHaveBeenCalledWith("repo-a", {
      newBranchName: "topic",
      startPoint: "main",
      checkout: true,
      force: false,
    });
  });

  it("returns no create validation message after a successful submission", async () => {
    const ports = createPorts();

    await expect(
      submitCreateBranch(
        "repo-a",
        "main",
        { branchName: "topic", checkout: false, force: false },
        ports.operations,
      ),
    ).resolves.toBeUndefined();
  });

  it("reports push failures against the captured repository", async () => {
    const ports = createPorts();
    vi.mocked(ports.operations.push).mockRejectedValueOnce(
      typedError("BRANCH_NON_FAST_FORWARD", "Push was rejected", "Pull first."),
    );

    await expect(
      submitPush("repo-a", "feature", true, ports.operations, ports.ui),
    ).resolves.toBe(false);
    expect(ports.operations.push).toHaveBeenCalledWith(
      "repo-a",
      "feature",
      true,
    );
    expect(ports.ui.notifyError).toHaveBeenCalledWith("Push failed", {
      code: "BRANCH_NON_FAST_FORWARD",
      message: "Push was rejected",
      recovery: "Pull first.",
    });
  });

  it("suppresses a stale push error and reports success truthfully", async () => {
    const stalePorts = createPorts();
    vi.mocked(stalePorts.operations.push).mockRejectedValueOnce(
      new Error("late failure"),
    );
    vi.mocked(stalePorts.ui.isCurrent).mockReturnValue(false);

    await expect(
      submitPush(
        "repo-a",
        "team/feature",
        false,
        stalePorts.operations,
        stalePorts.ui,
      ),
    ).resolves.toBe(false);
    expect(stalePorts.ui.isCurrent).toHaveBeenCalledWith("repo-a", {
      type: "local",
      name: "team/feature",
      fullRef: "refs/heads/team/feature",
    });
    expect(stalePorts.ui.notifyError).not.toHaveBeenCalled();

    const successPorts = createPorts();
    await expect(
      submitPush(
        "repo-a",
        "feature",
        false,
        successPorts.operations,
        successPorts.ui,
      ),
    ).resolves.toBe(true);
  });
});

describe("runBranchAction smart checkout and tag verbs", () => {
  const tagContext: BranchActionContext = {
    repoId: "repo-a",
    ref: { type: "tag", name: "v1", fullRef: "refs/tags/v1" },
    tag: {
      name: "v1",
      fullRef: "refs/tags/v1",
      hash: "tag-object",
      targetCommitHash: "tag-tip",
      isFavorite: false,
      isAnnotated: false,
    },
    currentBranch: "main",
  };

  it("offers smart checkout when local changes block the switch", async () => {
    const ports = createPorts();
    ports.operations.checkout = vi
      .fn()
      .mockRejectedValue(
        typedError("LOCAL_CHANGES_WOULD_BE_OVERWRITTEN", "blocked"),
      );

    await runBranchAction("checkout", context, ports);

    expect(ports.ui.confirm).toHaveBeenCalledWith(
      expect.stringContaining("Stash them, check out, and restore?"),
      "Smart Checkout",
    );
    expect(ports.operations.smartCheckout).toHaveBeenCalledWith(
      "repo-a",
      "feature",
    );
    expect(ports.ui.notifyError).not.toHaveBeenCalled();
  });

  it("reports a restore conflict without claiming the checkout failed", async () => {
    const ports = createPorts();
    ports.operations.checkout = vi
      .fn()
      .mockRejectedValue(
        typedError("LOCAL_CHANGES_WOULD_BE_OVERWRITTEN", "blocked"),
      );
    ports.operations.smartCheckout = vi
      .fn()
      .mockResolvedValue({ restored: false, stashRef: "abc123" });

    await runBranchAction("checkout", context, ports);

    expect(ports.ui.notifyError).toHaveBeenCalledWith(
      "Checked out with conflicts",
      expect.objectContaining({ code: "SMART_CHECKOUT_RESTORE_CONFLICT" }),
    );
  });

  it("does not offer smart checkout for an unrelated checkout failure", async () => {
    const ports = createPorts();
    ports.operations.checkout = vi
      .fn()
      .mockRejectedValue(typedError("SOMETHING_ELSE", "nope"));

    await runBranchAction("checkout", context, ports);

    expect(ports.operations.smartCheckout).not.toHaveBeenCalled();
    expect(ports.ui.notifyError).toHaveBeenCalledWith(
      "Checkout failed",
      expect.objectContaining({ code: "SOMETHING_ELSE" }),
    );
  });

  it("names the commits a force delete would discard", async () => {
    const ports = createPorts();
    ports.operations.delete = vi
      .fn()
      .mockRejectedValueOnce(
        typedError("BRANCH_NOT_FULLY_MERGED", "not merged"),
      )
      .mockResolvedValue(undefined);
    ports.operations.unmergedCommits = vi.fn().mockResolvedValue([
      { shortHash: "aaaaaaa", subject: "first" },
      { shortHash: "bbbbbbb", subject: "second" },
    ]);

    await runBranchAction("delete", context, ports);

    const forcePrompt = (ports.ui.confirm as ReturnType<typeof vi.fn>).mock
      .calls[1][0] as string;
    expect(forcePrompt).toContain("2 commit(s) would be lost");
    expect(forcePrompt).toContain("aaaaaaa first");
    expect(ports.operations.delete).toHaveBeenLastCalledWith(
      "repo-a",
      branch,
      true,
    );
  });

  it("pushes a tag to the picked remote", async () => {
    const ports = createPorts();

    await runBranchAction("push-tag", tagContext, ports);

    expect(ports.ui.pickRemote).toHaveBeenCalledWith(
      "repo-a",
      expect.stringContaining("v1"),
    );
    expect(ports.operations.pushTag).toHaveBeenCalledWith(
      "repo-a",
      "origin",
      "v1",
    );
  });

  it("does not delete a remote tag when the remote picker is cancelled", async () => {
    const ports = createPorts();
    ports.ui.pickRemote = vi.fn().mockResolvedValue(null);

    await runBranchAction("delete-tag-remote", tagContext, ports);

    expect(ports.operations.deleteRemoteTag).not.toHaveBeenCalled();
  });

  it("surfaces a failed remote tag delete", async () => {
    const ports = createPorts();
    ports.operations.deleteRemoteTag = vi
      .fn()
      .mockResolvedValue([
        { remote: "origin", deleted: false, message: "tag not found" },
      ]);

    await runBranchAction("delete-tag-remote", tagContext, ports);

    expect(ports.ui.notifyError).toHaveBeenCalledWith(
      "Delete tag on remote failed",
      expect.objectContaining({ message: "tag not found" }),
    );
  });

  it("confirms before resetting a branch to its upstream", async () => {
    const ports = createPorts();

    await runBranchAction("reset-to-remote", context, ports);

    expect(ports.ui.confirm).toHaveBeenCalledWith(
      expect.stringContaining("origin/feature"),
      "Reset",
    );
    expect(ports.operations.resetToRemote).toHaveBeenCalledWith(
      "repo-a",
      "feature",
    );
  });
});
