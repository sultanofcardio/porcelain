import { describe, expect, it } from "vitest";
import type { BranchInfo, TagInfo } from "../../../shared/types/git";
import {
  getBranchActionAvailability,
  getBranchActionItems,
} from "./branchActionState";
import type { BranchActionContext } from "./branchActionTypes";

const localBranch: BranchInfo = {
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

function branchContext(branch: BranchInfo): BranchActionContext {
  return {
    repoId: "repo-a",
    ref: {
      type: branch.isRemote ? "remote" : "local",
      name: branch.name,
      fullRef: branch.fullRef,
    },
    branch,
    currentBranch: "main",
  };
}

function menuShape(context: BranchActionContext): string[] {
  return getBranchActionItems(context).map((item) =>
    item.kind === "separator" ? `separator:${item.id}` : item.id,
  );
}

describe("branch action availability", () => {
  it("hides actions that would operate on the checked-out branch itself", () => {
    const current = branchContext({
      ...localBranch,
      name: "main",
      fullRef: "refs/heads/main",
      isCurrent: true,
    });

    expect(getBranchActionAvailability("delete", current)).toEqual({
      visible: false,
      enabled: false,
    });
    expect(menuShape(current)).toEqual([
      "toggle-favorite",
      "separator:favorite",
      "new-branch",
      "compare-current",
      "separator:sync",
      "update",
      "reset-to-remote",
      "push",
    ]);
    expect(
      getBranchActionItems(current).find(
        (item) => item.kind === "action" && item.id === "compare-current",
      ),
    ).toMatchObject({
      enabled: false,
      disabledReason: "Already checked out",
    });
  });

  it("keeps Update visible and explains why it is disabled without an upstream", () => {
    const noUpstream = branchContext({ ...localBranch, upstream: undefined });

    expect(getBranchActionAvailability("update", noUpstream)).toEqual({
      visible: true,
      enabled: false,
      disabledReason: "No upstream configured",
    });
  });

  it("uses the branch current marker to disable comparison", () => {
    const current = branchContext({
      ...localBranch,
      isCurrent: true,
    });

    expect(getBranchActionAvailability("compare-current", current)).toEqual({
      visible: true,
      enabled: false,
      disabledReason: "Already checked out",
    });
  });

  it("preserves the remote branch menu order while omitting local-only actions", () => {
    const remote = branchContext({
      ...localBranch,
      name: "origin/feature",
      fullRef: "refs/remotes/origin/feature",
      isRemote: true,
      upstream: undefined,
    });

    expect(getBranchActionAvailability("rename", remote).visible).toBe(false);
    expect(menuShape(remote)).toEqual([
      "toggle-favorite",
      "separator:favorite",
      "checkout",
      "new-branch",
      "compare-current",
      "checkout-rebase",
      "separator:integrate",
      "rebase-current",
      "merge-current",
      "separator:manage",
      "delete",
    ]);
  });

  it("preserves the complete local branch menu order and labels", () => {
    const items = getBranchActionItems(branchContext(localBranch));

    expect(menuShape(branchContext(localBranch))).toEqual([
      "toggle-favorite",
      "separator:favorite",
      "checkout",
      "new-branch",
      "compare-current",
      "checkout-rebase",
      "separator:integrate",
      "rebase-current",
      "merge-current",
      "separator:manage",
      "rename",
      "delete",
      "separator:sync",
      "update",
      "push",
    ]);
    expect(
      items.filter((item) => item.kind === "action").map((item) => item.label),
    ).toEqual([
      "Mark as Favorite",
      "Checkout",
      "New Branch from 'feature'...",
      "Compare with Current",
      "Checkout and Rebase onto 'main'",
      "Rebase 'main' onto 'feature'",
      "Merge 'feature' into 'main'",
      "Rename...",
      "Delete",
      "Update",
      "Push...",
    ]);
  });

  it("offers only favorite and compare actions for a tag", () => {
    const tag: TagInfo = {
      name: "v1.0.0",
      fullRef: "refs/tags/v1.0.0",
      hash: "tag-object",
      targetCommitHash: "release-tip",
      isFavorite: true,
      isAnnotated: true,
    };
    const context: BranchActionContext = {
      repoId: "repo-a",
      ref: { type: "tag", name: tag.name, fullRef: tag.fullRef },
      tag,
      currentBranch: "main",
    };

    expect(menuShape(context)).toEqual([
      "toggle-favorite",
      "separator:favorite",
      "checkout-tag",
      "compare-current",
      "separator:manage",
      "push-tag",
      "delete-tag",
      "delete-tag-remote",
    ]);
    expect(
      getBranchActionItems(context)
        .filter((item) => item.kind === "action")
        .map((item) => (item.kind === "action" ? item.label : "")),
    ).toEqual([
      "Unmark as Favorite",
      "Checkout Tag",
      "Compare with Current",
      "Push Tag...",
      "Delete Tag",
      "Delete Tag on Remote...",
    ]);
  });

  it("disables remote-bound tag actions when no remote is configured", () => {
    const tag: TagInfo = {
      name: "v1.0.0",
      fullRef: "refs/tags/v1.0.0",
      hash: "tag-object",
      targetCommitHash: "release-tip",
      isFavorite: false,
      isAnnotated: false,
    };
    const context: BranchActionContext = {
      repoId: "repo-a",
      ref: { type: "tag", name: tag.name, fullRef: tag.fullRef },
      tag,
      currentBranch: "main",
      hasRemotes: false,
    };

    for (const id of ["push-tag", "delete-tag-remote"] as const) {
      expect(getBranchActionAvailability(id, context)).toEqual({
        visible: true,
        enabled: false,
        disabledReason: "No remotes configured",
      });
    }
    // Local tag verbs stay usable without a remote.
    expect(getBranchActionAvailability("delete-tag", context).enabled).toBe(
      true,
    );
  });

  it("offers reset-to-remote only for the checked-out tracking branch", () => {
    const tracking = branchContext({
      ...localBranch,
      name: "main",
      fullRef: "refs/heads/main",
      isCurrent: true,
      upstream: "origin/main",
    });
    expect(getBranchActionAvailability("reset-to-remote", tracking)).toEqual({
      visible: true,
      enabled: true,
    });

    const noUpstream = branchContext({
      ...localBranch,
      name: "main",
      fullRef: "refs/heads/main",
      isCurrent: true,
      upstream: undefined,
    });
    expect(
      getBranchActionAvailability("reset-to-remote", noUpstream),
    ).toMatchObject({ visible: true, enabled: false });

    // Another branch cannot be hard-reset without checking it out first.
    const other = branchContext({
      ...localBranch,
      name: "feature",
      fullRef: "refs/heads/feature",
      isCurrent: false,
      upstream: "origin/feature",
    });
    expect(getBranchActionAvailability("reset-to-remote", other)).toEqual({
      visible: false,
      enabled: false,
    });
  });
});
