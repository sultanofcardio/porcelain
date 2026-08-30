import type {
  BranchInfo,
  GitRefIdentity,
  TagInfo,
} from "../../../shared/types/git";

export interface BranchActionContext {
  repoId: string;
  ref: GitRefIdentity;
  branch?: BranchInfo;
  tag?: TagInfo;
  currentBranch: string;
  /** Whether the repository has any remote; gates remote-bound tag verbs. */
  hasRemotes?: boolean;
}

export type BranchActionId =
  | "toggle-favorite"
  | "checkout"
  | "reset-to-remote"
  | "delete-tag"
  | "push-tag"
  | "delete-tag-remote"
  | "checkout-tag"
  | "new-branch"
  | "compare-current"
  | "checkout-rebase"
  | "rebase-current"
  | "merge-current"
  | "rename"
  | "delete"
  | "update"
  | "push";

export type BranchActionMenuItem =
  | { kind: "separator"; id: string }
  | {
      kind: "action";
      id: BranchActionId;
      label: string;
      enabled: boolean;
      disabledReason?: string;
    };

export interface BranchActionAvailability {
  visible: boolean;
  enabled: boolean;
  disabledReason?: string;
}

export interface BranchActionError {
  code: string;
  message: string;
  recovery?: string;
}
