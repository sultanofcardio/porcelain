import { useMemo } from "react";
import { useGitLogStore } from "../../shared/store/git-log-store-context";
import type { PanelStore } from "../../shared/store/panel-store";
import type {
  BranchInfo,
  Commit,
  GitRefIdentity,
} from "../../shared/types/git";

export interface CreateBranchInput {
  newBranchName: string;
  startPoint: string;
  checkout: boolean;
  force: boolean;
}

export interface BranchOperations {
  checkout(repoId: string, branch: BranchInfo): Promise<void>;
  /** Stash blocking changes, switch, and restore them. */
  smartCheckout(
    repoId: string,
    branchName: string,
  ): Promise<{ restored: boolean; stashRef?: string }>;
  /** Commits on the branch that HEAD does not contain. */
  unmergedCommits(repoId: string, branchName: string): Promise<Commit[]>;
  resetToRemote(repoId: string, branchName: string): Promise<void>;
  checkoutRevision(repoId: string, hash: string): Promise<void>;
  deleteTag(repoId: string, tagName: string): Promise<void>;
  pushTag(repoId: string, remote: string, tagName: string): Promise<void>;
  deleteRemoteTag(
    repoId: string,
    tagName: string,
    remotes: string[],
  ): Promise<Array<{ remote: string; deleted: boolean; message?: string }>>;
  getRemotes(repoId: string): Promise<Array<{ name: string; url: string }>>;
  create(repoId: string, input: CreateBranchInput): Promise<void>;
  delete(repoId: string, branch: BranchInfo, force: boolean): Promise<void>;
  rename(repoId: string, oldName: string, newName: string): Promise<void>;
  update(repoId: string, branchName: string): Promise<void>;
  push(repoId: string, branchName: string, force: boolean): Promise<void>;
  merge(repoId: string, branchName: string): Promise<void>;
  rebase(repoId: string, onto: string): Promise<void>;
  checkoutAndRebase(
    repoId: string,
    branchName: string,
    onto: string,
  ): Promise<void>;
  setFavorite(
    repoId: string,
    ref: GitRefIdentity,
    favorite: boolean,
  ): Promise<void>;
  compare(repoId: string, ref: GitRefIdentity): Promise<void>;
  fetch(repoId: string): Promise<void>;
  createPrompt(repoId: string): Promise<void>;
  deletePrompt(repoId: string, branchName: string): Promise<void>;
}

export interface BranchOperationDependencies {
  request: PanelStore["requestFromSurface"];
  requestWithProgress: PanelStore["requestWithProgressFromSurface"];
  setFavorite: PanelStore["setFavorite"];
}

export function createBranchOperations(
  dependencies: BranchOperationDependencies,
): BranchOperations {
  const { request, requestWithProgress, setFavorite } = dependencies;

  return {
    async checkout(repoId, branch) {
      if (branch.isRemote) {
        const localName = branch.name.substring(branch.name.indexOf("/") + 1);
        await requestWithProgress(
          "createBranch",
          {
            newBranchName: localName,
            startPoint: branch.name,
            checkout: true,
          },
          { repoId },
        );
        return;
      }
      await requestWithProgress(
        "checkoutBranch",
        { branchName: branch.name },
        { repoId },
      );
    },
    async smartCheckout(repoId, branchName) {
      return (await requestWithProgress(
        "smartCheckout",
        { branchName },
        { repoId },
      )) as { restored: boolean; stashRef?: string };
    },
    async unmergedCommits(repoId, branchName) {
      return ((await request(
        "getUnmergedCommits",
        { branchName },
        { repoId },
      )) ?? []) as Commit[];
    },
    async resetToRemote(repoId, branchName) {
      await requestWithProgress(
        "resetToRemoteBranch",
        { branchName },
        { repoId },
      );
    },
    async checkoutRevision(repoId, hash) {
      await requestWithProgress("checkoutCommit", { hash }, { repoId });
    },
    async deleteTag(repoId, tagName) {
      await requestWithProgress("deleteTag", { tagName }, { repoId });
    },
    async pushTag(repoId, remote, tagName) {
      await requestWithProgress("pushTag", { remote, tagName }, { repoId });
    },
    async deleteRemoteTag(repoId, tagName, remotes) {
      return ((await requestWithProgress(
        "deleteRemoteTag",
        { tagName, remotes },
        { repoId },
      )) ?? []) as Array<{
        remote: string;
        deleted: boolean;
        message?: string;
      }>;
    },
    async getRemotes(repoId) {
      return ((await request("getRemotes", {}, { repoId })) ?? []) as Array<{
        name: string;
        url: string;
      }>;
    },
    async create(repoId, input) {
      await requestWithProgress(
        "createBranch",
        {
          newBranchName: input.newBranchName,
          startPoint: input.startPoint,
          checkout: input.checkout,
          force: input.force,
        },
        { repoId },
      );
    },
    async delete(repoId, branch, force) {
      await requestWithProgress(
        "deleteBranch",
        { branchName: branch.name, isRemote: branch.isRemote, force },
        { repoId },
      );
    },
    async rename(repoId, oldName, newName) {
      await request("renameBranch", { oldName, newName }, { repoId });
    },
    async update(repoId, branchName) {
      await requestWithProgress("updateBranch", { branchName }, { repoId });
    },
    async push(repoId, branchName, force) {
      await requestWithProgress(
        "pushBranch",
        { branchName, force },
        { repoId },
      );
    },
    async merge(repoId, branchName) {
      await requestWithProgress("mergeBranch", { branchName }, { repoId });
    },
    async rebase(repoId, onto) {
      await requestWithProgress("rebaseBranch", { onto }, { repoId });
    },
    async checkoutAndRebase(repoId, branchName, onto) {
      await requestWithProgress(
        "checkoutAndRebase",
        { branchToCheckout: branchName, rebaseOnto: onto },
        { repoId },
      );
    },
    async setFavorite(repoId, ref, favorite) {
      await setFavorite(ref, favorite, repoId);
    },
    async compare(repoId, ref) {
      await request("openCompareWithCurrent", { ref }, { repoId });
    },
    async fetch(repoId) {
      await request("fetchAll", undefined, { repoId });
    },
    async createPrompt(repoId) {
      const result = (await request("createBranchPrompt", {}, { repoId })) as
        | { success?: unknown }
        | undefined;
      if (result?.success === false) {
        throw new Error("Create branch was not completed.");
      }
    },
    async deletePrompt(repoId, branchName) {
      await request("deleteBranchPrompt", { branchName }, { repoId });
    },
  };
}

export function useBranchOperations(): BranchOperations {
  const request = useGitLogStore((state) => state.requestFromSurface);
  const requestWithProgress = useGitLogStore(
    (state) => state.requestWithProgressFromSurface,
  );
  const setFavorite = useGitLogStore((state) => state.setFavorite);

  return useMemo(
    () => createBranchOperations({ request, requestWithProgress, setFavorite }),
    [request, requestWithProgress, setFavorite],
  );
}
