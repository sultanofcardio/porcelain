import type { ReactNode } from "react";
import type {
  BridgeRequestOptions,
  CommandType,
} from "../../shared/bridge/types";
import type { Commit } from "../../shared/types/git";

export type CommitActionRefreshScope = "none" | "surface" | "comparison";

type Request = (
  command: CommandType,
  params?: Record<string, unknown>,
  options?: BridgeRequestOptions,
) => Promise<unknown>;

export interface CommitActionContext {
  repoId: string;
  commit: Commit;
  /** Every commit currently selected in the log, newest-first. */
  selectedCommitHashes: string[];
  currentBranch: string;
  fileFilter: string;
  isRebasing: boolean;
  isMerging: boolean;
  isCherryPicking: boolean;
  mutationRefresh: Exclude<CommitActionRefreshScope, "none">;
  request: Request;
  requestWithProgress: Request;
  confirm: (options: {
    message: string;
    confirmLabel: string;
  }) => Promise<boolean>;
  input: (options: {
    prompt: string;
    placeHolder: string;
  }) => Promise<string | null>;
  createBranch: (hash: string, defaultName: string) => void | Promise<void>;
  showInGitLog: (hash: string) => void | Promise<void>;
}

export interface CommitActionDefinition {
  id: string;
  label: string;
  separator?: boolean;
  icon?: ReactNode;
  visible: boolean;
  enabled: boolean;
  refresh: CommitActionRefreshScope;
  execute: () => Promise<CommitActionRefreshScope>;
}

function IconCopy() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect
        x="2.5"
        y="3.5"
        width="9"
        height="10"
        rx="1.5"
        stroke="currentColor"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M11 2h.6C12.37 2 13 2.63 13 3.4v.51c0 .03 0 .06 0 .09v7.55c.6-.44 1-1.15 1-1.95V3.4C14 2.07 12.93 1 11.6 1H6.4c-.8 0-1.51.39-1.95 1H6.4H11z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconCherryPick() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="5" cy="11.5" r="2.5" stroke="currentColor" />
      <circle cx="10.5" cy="10.5" r="2.5" stroke="currentColor" />
      <path
        d="M5 9C5 6 4 4 7 2"
        stroke="currentColor"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M10.5 8C10.5 5.5 11 4 8 2"
        stroke="currentColor"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function IconCompare() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M2 5.5H13"
        stroke="currentColor"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M10 2.5L13 5.5L10 8.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M14 11H3"
        stroke="currentColor"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M6 8L3 11L6 14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function IconRevert() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M5.85 1.85a.5.5 0 00-.7-.7L1.65 4.65 1.3 5l.35.35 3.5 3.5a.5.5 0 00.7-.7L3.21 5.5H10.5a3.5 3.5 0 010 7H5.5a.5.5 0 000 1h5a4.5 4.5 0 000-9H3.21l2.64-2.65z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconBranch() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="4.5" cy="4" r="2" stroke="currentColor" />
      <path
        d="M4.5 11.5H8.5C9.6 11.5 10.5 10.6 10.5 9.5V8"
        stroke="currentColor"
      />
      <path d="M4.5 6.5V14.5" stroke="currentColor" strokeLinecap="round" />
      <circle cx="10.5" cy="6" r="2" stroke="currentColor" />
    </svg>
  );
}

function IconTag() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 2.5h4.5l6 6-4.5 4.5-6-6V2.5z" stroke="currentColor" />
      <circle cx="5.5" cy="5" r="1" fill="currentColor" />
    </svg>
  );
}

function separator(id: string, visible = true): CommitActionDefinition {
  return {
    id,
    label: "",
    separator: true,
    visible,
    enabled: false,
    refresh: "none",
    execute: async () => "none",
  };
}

export function buildCommitActions(
  context: CommitActionContext,
): CommitActionDefinition[] {
  const cancelled = Symbol("cancelled");
  const { commit, repoId, selectedCommitHashes } = context;
  const shortHash = commit.shortHash || commit.hash.slice(0, 8);
  const repoOptions = { repoId };
  const mutationRefresh = context.mutationRefresh;
  // Actions that act on one commit are ambiguous while several are selected:
  // the right-clicked row is not obviously the target. Keep them visible but
  // disabled so the menu still reads the same, and offer Compare Versions in
  // their place when the selection is a clean pair.
  const multiSelected = selectedCommitHashes.length > 1;
  const singleOnly = !multiSelected;

  const action = (
    definition: Omit<CommitActionDefinition, "execute">,
    run: () => unknown | Promise<unknown>,
    errorLabel: string,
  ): CommitActionDefinition => ({
    ...definition,
    execute: async () => {
      try {
        if ((await run()) === cancelled) return "none";
        return definition.refresh;
      } catch (error) {
        console.error(`${errorLabel} failed:`, error);
        return "none";
      }
    },
  });

  return [
    action(
      {
        id: "copy-revision",
        label: multiSelected ? "Copy Revision Numbers" : "Copy Revision Number",
        icon: <IconCopy />,
        visible: true,
        enabled: true,
        refresh: "none",
      },
      () =>
        context.request(
          "copyToClipboard",
          {
            text: multiSelected ? selectedCommitHashes.join("\n") : commit.hash,
          },
          { scope: "global" },
        ),
      "Copy",
    ),
    action(
      {
        id: "cherry-pick",
        label: multiSelected
          ? `Cherry-Pick ${selectedCommitHashes.length} Commits`
          : "Cherry-Pick",
        icon: <IconCherryPick />,
        visible: true,
        enabled: true,
        refresh: mutationRefresh,
      },
      () =>
        context.requestWithProgress(
          "cherryPick",
          {
            // The selection arrives newest-first; git applies oldest-first.
            hashes: multiSelected
              ? [...selectedCommitHashes].reverse()
              : [commit.hash],
          },
          repoOptions,
        ),
      "Cherry-pick",
    ),
    separator("after-cherry-pick"),
    action(
      {
        id: "checkout-revision",
        label: "Checkout Revision",
        visible: true,
        enabled: singleOnly,
        refresh: mutationRefresh,
      },
      () =>
        context.requestWithProgress(
          "checkoutCommit",
          { hash: commit.hash },
          repoOptions,
        ),
      "Checkout revision",
    ),
    action(
      {
        id: "compare-versions",
        label: "Compare Versions",
        icon: <IconCompare />,
        visible: multiSelected,
        enabled: selectedCommitHashes.length === 2,
        refresh: "none",
      },
      () =>
        context.request(
          "openCompareVersions",
          { hashes: selectedCommitHashes },
          repoOptions,
        ),
      "Compare versions",
    ),
    separator("after-checkout"),
    action(
      {
        id: "reset-mixed",
        label: "Reset Current Branch to Here (Mixed)...",
        icon: <IconRevert />,
        visible: true,
        enabled: singleOnly,
        refresh: mutationRefresh,
      },
      () =>
        context.requestWithProgress(
          "resetToCommit",
          { hash: commit.hash, mode: "mixed" },
          repoOptions,
        ),
      "Reset",
    ),
    action(
      {
        id: "reset-soft",
        label: "Reset Current Branch to Here (Soft)...",
        icon: <IconRevert />,
        visible: true,
        enabled: singleOnly,
        refresh: mutationRefresh,
      },
      () =>
        context.requestWithProgress(
          "resetToCommit",
          { hash: commit.hash, mode: "soft" },
          repoOptions,
        ),
      "Reset",
    ),
    action(
      {
        id: "reset-hard",
        label: "Reset Current Branch to Here (Hard)...",
        icon: <IconRevert />,
        visible: true,
        enabled: singleOnly,
        refresh: mutationRefresh,
      },
      async () => {
        const confirmed = await context.confirm({
          message: `Reset '${context.currentBranch}' to ${shortHash} (hard)? This will discard all uncommitted changes.`,
          confirmLabel: "Reset",
        });
        if (!confirmed) return cancelled;
        await context.requestWithProgress(
          "resetToCommit",
          { hash: commit.hash, mode: "hard" },
          repoOptions,
        );
      },
      "Reset",
    ),
    action(
      {
        id: "revert",
        label: "Revert Commit",
        icon: <IconRevert />,
        visible: true,
        enabled: singleOnly,
        refresh: mutationRefresh,
      },
      () =>
        context.requestWithProgress(
          "revertCommit",
          { hash: commit.hash },
          repoOptions,
        ),
      "Revert",
    ),
    action(
      {
        id: "drop",
        label: "Drop Commit",
        icon: <IconRevert />,
        visible: true,
        enabled:
          singleOnly &&
          Boolean(context.currentBranch) &&
          !context.isRebasing &&
          !context.isMerging &&
          !context.isCherryPicking,
        refresh: mutationRefresh,
      },
      async () => {
        const confirmed = await context.confirm({
          message: `Drop commit ${shortHash} "${commit.subject}"?\n\nThis will remove the commit from history but keep its changes as unstaged modifications.\n\nThis operation cannot be undone.`,
          confirmLabel: "Drop Commit",
        });
        if (!confirmed) return cancelled;
        await context.requestWithProgress(
          "dropCommit",
          { hash: commit.hash },
          repoOptions,
        );
      },
      "Drop commit",
    ),
    separator("before-create"),
    action(
      {
        id: "new-branch",
        label: "New Branch...",
        icon: <IconBranch />,
        visible: true,
        enabled: singleOnly,
        refresh: "none",
      },
      () => context.createBranch(commit.hash, ""),
      "Create branch",
    ),
    action(
      {
        id: "new-tag",
        label: "New Tag...",
        icon: <IconTag />,
        visible: true,
        enabled: singleOnly,
        refresh: mutationRefresh,
      },
      async () => {
        const value = await context.input({
          prompt: `Create tag at ${shortHash}:`,
          placeHolder: "tag-name",
        });
        if (!value?.trim()) return cancelled;
        await context.request(
          "createTag",
          { tagName: value.trim(), hash: commit.hash },
          repoOptions,
        );
      },
      "Create tag",
    ),
    separator("before-show-in-log", Boolean(context.fileFilter)),
    action(
      {
        id: "show-in-git-log",
        label: "Show in Git Log",
        icon: <IconBranch />,
        visible: Boolean(context.fileFilter),
        enabled: true,
        refresh: "none",
      },
      () => context.showInGitLog(commit.hash),
      "Show in Git Log",
    ),
  ];
}
