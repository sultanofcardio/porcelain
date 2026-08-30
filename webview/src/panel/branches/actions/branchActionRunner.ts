import type { GitRefIdentity } from "../../../shared/types/git";
import type { BranchOperations } from "../branchOperations";
import type {
  BranchActionContext,
  BranchActionError,
  BranchActionId,
} from "./branchActionTypes";

const BRANCH_NOT_FULLY_MERGED = "BRANCH_NOT_FULLY_MERGED";
const LOCAL_CHANGES_WOULD_BE_OVERWRITTEN = "LOCAL_CHANGES_WOULD_BE_OVERWRITTEN";

export interface BranchActionUi {
  confirm(message: string, confirmLabel: string): Promise<boolean>;
  input(prompt: string, value: string): Promise<string | null>;
  openCreate(
    repoId: string,
    sourceRef: GitRefIdentity,
    startPoint: string,
    defaultName: string,
  ): void;
  openPush(repoId: string, sourceRef: GitRefIdentity, branchName: string): void;
  isCurrent(
    repoId: string,
    ref?: GitRefIdentity,
    currentBranch?: string,
  ): boolean;
  notifyError(title: string, error: BranchActionError): Promise<void>;
  /** Choose one configured remote, or null when cancelled. */
  pickRemote(repoId: string, prompt: string): Promise<string | null>;
}

export interface BranchActionPorts {
  operations: BranchOperations;
  ui: BranchActionUi;
}

export async function runBranchAction(
  id: BranchActionId,
  context: BranchActionContext,
  ports: BranchActionPorts,
): Promise<void> {
  const { operations, ui } = ports;
  const { branch, ref, repoId } = context;
  if (!isActionCurrent(context, ui)) return;

  switch (id) {
    case "toggle-favorite": {
      const favorite = branch?.isFavorite ?? context.tag?.isFavorite;
      if (favorite === undefined) return;
      await runAndPresent(
        () => operations.setFavorite(repoId, ref, !favorite),
        "Could not update favorite",
        context,
        ui,
      );
      return;
    }
    case "checkout": {
      if (!branch) return;
      try {
        await operations.checkout(repoId, branch);
      } catch (error) {
        if (!isActionCurrent(context, ui)) return;
        const formatted = formatBranchActionError(error);
        if (formatted.code !== LOCAL_CHANGES_WOULD_BE_OVERWRITTEN) {
          await notifyBranchActionErrorIfCurrent(
            "Checkout failed",
            formatted,
            context,
            ui,
          );
          return;
        }
        // IntelliJ's smart checkout: offer to carry the changes across
        // rather than making the user stash by hand.
        const smart = await ui.confirm(
          `Local changes would be overwritten by checking out '${branch.name}'. Stash them, check out, and restore?`,
          "Smart Checkout",
        );
        if (!isActionCurrent(context, ui) || !smart) return;
        try {
          const result = await operations.smartCheckout(repoId, branch.name);
          if (!result.restored && isActionCurrent(context, ui)) {
            await ui.notifyError("Checked out with conflicts", {
              code: "SMART_CHECKOUT_RESTORE_CONFLICT",
              message: `Switched to '${branch.name}', but restoring your changes hit a conflict.`,
              recovery:
                "Your changes are kept in the stash — resolve the conflict, or unstash them later from the Shelf tab.",
            });
          }
        } catch (smartError) {
          await notifyBranchActionErrorIfCurrent(
            "Smart checkout failed",
            formatBranchActionError(smartError),
            context,
            ui,
          );
        }
      }
      return;
    }
    case "new-branch": {
      if (!branch) return;
      const defaultName = branch.isRemote
        ? branch.name.substring(branch.name.indexOf("/") + 1)
        : branch.name;
      ui.openCreate(repoId, ref, branch.name, defaultName);
      return;
    }
    case "compare-current":
      await runAndPresent(
        () => operations.compare(repoId, ref),
        "Compare failed",
        context,
        ui,
      );
      return;
    case "checkout-rebase":
      if (!branch) return;
      await runAndPresent(
        () =>
          operations.checkoutAndRebase(
            repoId,
            branch.name,
            context.currentBranch,
          ),
        "Checkout and rebase failed",
        context,
        ui,
      );
      return;
    case "rebase-current":
      if (!branch) return;
      if (
        !(await confirmCurrent(
          `Rebase '${context.currentBranch}' onto '${branch.name}'?`,
          "Rebase",
          context,
          ui,
        ))
      )
        return;
      await runAndPresent(
        () => operations.rebase(repoId, branch.name),
        "Rebase failed",
        context,
        ui,
      );
      return;
    case "merge-current":
      if (!branch) return;
      if (
        !(await confirmCurrent(
          `Merge '${branch.name}' into '${context.currentBranch}'?`,
          "Merge",
          context,
          ui,
        ))
      )
        return;
      await runAndPresent(
        () => operations.merge(repoId, branch.name),
        "Merge failed",
        context,
        ui,
      );
      return;
    case "rename": {
      if (!branch) return;
      const value = await ui.input(
        `Rename branch '${branch.name}' to:`,
        branch.name,
      );
      if (!isActionCurrent(context, ui)) return;
      const newName = value?.trim();
      if (!newName || newName === branch.name) return;
      await runAndPresent(
        () => operations.rename(repoId, branch.name, newName),
        "Rename failed",
        context,
        ui,
      );
      return;
    }
    case "delete":
      if (!branch) return;
      if (
        !(await confirmCurrent(
          `Delete branch '${branch.name}'?`,
          "Delete",
          context,
          ui,
        ))
      )
        return;
      try {
        await operations.delete(repoId, branch, false);
      } catch (error) {
        if (!isActionCurrent(context, ui)) return;
        const formatted = formatBranchActionError(error);
        if (formatted.code !== BRANCH_NOT_FULLY_MERGED) {
          await notifyBranchActionErrorIfCurrent(
            "Delete failed",
            formatted,
            context,
            ui,
          );
          return;
        }
        // Name what force-delete would discard, the way IntelliJ's
        // "not fully merged" dialog lists the branch's exclusive commits.
        const unmerged = await operations
          .unmergedCommits(repoId, branch.name)
          .catch(() => []);
        if (!isActionCurrent(context, ui)) return;
        const preview = unmerged
          .slice(0, 5)
          .map((commit) => `  ${commit.shortHash} ${commit.subject}`)
          .join("\n");
        const more =
          unmerged.length > 5 ? `\n  …and ${unmerged.length - 5} more` : "";
        const detail = unmerged.length
          ? `\n\nThese ${unmerged.length} commit(s) would be lost:\n${preview}${more}`
          : "";
        const force = await ui.confirm(
          `Branch '${branch.name}' is not fully merged. Force delete?${detail}`,
          "Force Delete",
        );
        if (!isActionCurrent(context, ui) || !force) return;
        await runAndPresent(
          () => operations.delete(repoId, branch, true),
          "Force delete failed",
          context,
          ui,
        );
      }
      return;
    case "update":
      if (!branch) return;
      await runAndPresent(
        () => operations.update(repoId, branch.name),
        "Update failed",
        context,
        ui,
      );
      return;
    case "reset-to-remote": {
      if (!branch) return;
      const upstream = branch.upstream ?? "its upstream";
      if (
        !(await confirmCurrent(
          `Reset '${branch.name}' to '${upstream}'? Local commits on this branch will be lost.`,
          "Reset",
          context,
          ui,
        ))
      )
        return;
      await runAndPresent(
        () => operations.resetToRemote(repoId, branch.name),
        "Reset to remote failed",
        context,
        ui,
      );
      return;
    }
    case "checkout-tag": {
      const tag = context.tag;
      if (!tag) return;
      if (
        !(await confirmCurrent(
          `Check out tag '${tag.name}'? This leaves HEAD detached.`,
          "Checkout",
          context,
          ui,
        ))
      )
        return;
      await runAndPresent(
        () => operations.checkoutRevision(repoId, tag.targetCommitHash),
        "Checkout failed",
        context,
        ui,
      );
      return;
    }
    case "delete-tag": {
      const tag = context.tag;
      if (!tag) return;
      if (
        !(await confirmCurrent(
          `Delete tag '${tag.name}'?`,
          "Delete",
          context,
          ui,
        ))
      )
        return;
      await runAndPresent(
        () => operations.deleteTag(repoId, tag.name),
        "Delete tag failed",
        context,
        ui,
      );
      return;
    }
    case "push-tag": {
      const tag = context.tag;
      if (!tag) return;
      const remote = await ui.pickRemote(repoId, `Push tag '${tag.name}' to:`);
      if (!isActionCurrent(context, ui) || !remote) return;
      await runAndPresent(
        () => operations.pushTag(repoId, remote, tag.name),
        "Push tag failed",
        context,
        ui,
      );
      return;
    }
    case "delete-tag-remote": {
      const tag = context.tag;
      if (!tag) return;
      const remote = await ui.pickRemote(
        repoId,
        `Delete tag '${tag.name}' on:`,
      );
      if (!isActionCurrent(context, ui) || !remote) return;
      if (
        !(await confirmCurrent(
          `Delete tag '${tag.name}' on '${remote}'?`,
          "Delete",
          context,
          ui,
        ))
      )
        return;
      await runAndPresent(
        async () => {
          const results = await operations.deleteRemoteTag(repoId, tag.name, [
            remote,
          ]);
          const failed = results.filter((result) => !result.deleted);
          if (failed.length && isActionCurrent(context, ui)) {
            await ui.notifyError("Delete tag on remote failed", {
              code: "REMOTE_TAG_DELETE_FAILED",
              message:
                failed[0].message ??
                `Could not delete '${tag.name}' on '${failed[0].remote}'.`,
            });
          }
        },
        "Delete tag on remote failed",
        context,
        ui,
      );
      return;
    }
    case "push":
      if (!branch) return;
      ui.openPush(repoId, ref, branch.name);
  }
}

export function formatBranchActionError(error: unknown): BranchActionError {
  const value = error as {
    code?: unknown;
    message?: unknown;
    recovery?: unknown;
  };
  let message: string;
  if (typeof value?.message === "string") {
    message = value.message;
  } else if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else {
    console.error("Unexpected branch action error:", error);
    message = "An unexpected error occurred.";
  }
  return {
    code: typeof value?.code === "string" ? value.code : "UNKNOWN",
    message,
    ...(typeof value?.recovery === "string"
      ? { recovery: value.recovery }
      : {}),
  };
}

export async function submitCreateBranch(
  repoId: string,
  startPoint: string,
  input: { branchName: string; checkout: boolean; force: boolean },
  operations: BranchOperations,
): Promise<string | undefined> {
  try {
    await operations.create(repoId, {
      newBranchName: input.branchName,
      startPoint,
      checkout: input.checkout,
      force: input.force,
    });
    return undefined;
  } catch (error) {
    const formatted = formatBranchActionError(error);
    return formatted.recovery
      ? `${formatted.message}\n${formatted.recovery}`
      : formatted.message;
  }
}

export async function submitPush(
  repoId: string,
  branchName: string,
  force: boolean,
  operations: BranchOperations,
  ui: BranchActionUi,
): Promise<boolean> {
  try {
    await operations.push(repoId, branchName, force);
    return true;
  } catch (error) {
    const sourceRef: GitRefIdentity = {
      type: "local",
      name: branchName,
      fullRef: `refs/heads/${branchName}`,
    };
    if (ui.isCurrent(repoId, sourceRef)) {
      await ui.notifyError("Push failed", formatBranchActionError(error));
    }
    return false;
  }
}

async function confirmCurrent(
  message: string,
  label: string,
  context: BranchActionContext,
  ui: BranchActionUi,
): Promise<boolean> {
  const confirmed = await ui.confirm(message, label);
  return confirmed && isActionCurrent(context, ui);
}

async function runAndPresent(
  operation: () => Promise<void>,
  title: string,
  context: BranchActionContext,
  ui: BranchActionUi,
): Promise<void> {
  if (!isActionCurrent(context, ui)) return;
  try {
    await operation();
  } catch (error) {
    await notifyBranchActionErrorIfCurrent(
      title,
      formatBranchActionError(error),
      context,
      ui,
    );
  }
}

export async function notifyBranchActionErrorIfCurrent(
  title: string,
  error: BranchActionError,
  context: {
    repoId: string;
    ref?: GitRefIdentity;
    currentBranch?: string;
  },
  ui: Pick<BranchActionUi, "isCurrent" | "notifyError">,
): Promise<void> {
  if (!ui.isCurrent(context.repoId, context.ref, context.currentBranch)) return;
  await ui.notifyError(title, error);
}

function isActionCurrent(
  context: BranchActionContext,
  ui: Pick<BranchActionUi, "isCurrent">,
): boolean {
  return ui.isCurrent(context.repoId, context.ref, context.currentBranch);
}
