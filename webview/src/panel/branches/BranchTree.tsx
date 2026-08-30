import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useModifierClickSelection } from "../../shared/hooks/useModifierClickSelection";
import { useGitLogStore } from "../../shared/store/git-log-store-context";
import type { PanelStore } from "../../shared/store/panel-store";
import { useRepoStore } from "../../shared/store/repo-store";
import type { GitRefIdentity } from "../../shared/types/git";
import { BranchSidebar } from "../components/BranchSidebar";
import {
  type BranchActionUi,
  runBranchAction,
  submitCreateBranch,
  submitPush,
} from "./actions/branchActionRunner";
import { getBranchActionItems } from "./actions/branchActionState";
import type {
  BranchActionContext,
  BranchActionError,
  BranchActionId,
} from "./actions/branchActionTypes";
import { useBranchOperations } from "./branchOperations";
import {
  type BranchTreeMenuView,
  BranchTreeView,
} from "./components/BranchTreeView";
import {
  buildBranchTreeSnapshot,
  normalizeBranchEntries,
  normalizeTagEntries,
} from "./model/branchTreeModel";
import {
  collectVisibleRefs,
  filterBranchTreeEntries,
} from "./model/branchTreeSelectors";
import type {
  BranchTreeEntry,
  BranchTreeMode,
  BranchTreeSnapshot,
} from "./model/branchTreeTypes";
import { useBranchOverlay } from "./state/useBranchOverlay";
import { useBranchTreeState } from "./state/useBranchTreeState";

export interface BranchTreeProps {
  headerAction?: React.ReactNode;
  onTogglePanel?: () => void;
}

export function BranchTree({ onTogglePanel }: BranchTreeProps = {}) {
  const branches = useGitLogStore((state) => state.branches);
  const tags = useGitLogStore((state) => state.tags);
  const commits = useGitLogStore((state) => state.commits);
  const currentBranch = useGitLogStore((state) => state.currentBranch);
  const filter = useGitLogStore((state) => state.filter);
  const setFilter = useGitLogStore((state) => state.setFilter);
  const selectedRefs = useGitLogStore((state) => state.selectedRefs);
  const selectRef = useGitLogStore((state) => state.selectRef);
  const navigateToRef = useGitLogStore((state) => state.navigateToRef);
  const requestFromSurface = useGitLogStore(
    (state) => state.requestFromSurface,
  );
  const showTags = useGitLogStore((state) => state.showTags);
  const singleClickAction = useGitLogStore((state) => state.singleClickAction);
  const branchGroupByDirectory = useGitLogStore(
    (state) => state.branchGroupByDirectory,
  );
  const activeRepoId = useRepoStore((state) => state.activeRepoId);
  const operations = useBranchOperations();
  const [currentBranchRowSelectedRepoId, setCurrentBranchRowSelectedRepoId] =
    useState<string | null>(null);
  const currentBranchRowSelected =
    activeRepoId !== null && currentBranchRowSelectedRepoId === activeRepoId;

  const favoriteRefs = useMemo(
    () =>
      new Set(
        branches
          .filter((branch) => branch.isFavorite)
          .map((branch) => branch.fullRef),
      ),
    [branches],
  );
  const branchEntries = useMemo(
    () => normalizeBranchEntries(branches, favoriteRefs),
    [branches, favoriteRefs],
  );
  const tagEntries = useMemo(
    () => normalizeTagEntries(tags, favoriteRefs),
    [favoriteRefs, tags],
  );
  const localEntries = useMemo(
    () => branchEntries.filter((entry) => entry.scope === "local"),
    [branchEntries],
  );
  const remoteEntries = useMemo(
    () => branchEntries.filter((entry) => entry.scope === "remote"),
    [branchEntries],
  );
  const mode: BranchTreeMode = branchGroupByDirectory ? "grouped" : "flat";
  const treeRepoId = activeRepoId ?? "none";

  const fullLocalSnapshot = useMemo(
    () =>
      buildBranchTreeSnapshot(localEntries, {
        repoId: treeRepoId,
        grouped: branchGroupByDirectory,
      }),
    [branchGroupByDirectory, localEntries, treeRepoId],
  );
  const fullRemoteSnapshot = useMemo(
    () =>
      buildBranchTreeSnapshot(remoteEntries, {
        repoId: treeRepoId,
        grouped: branchGroupByDirectory,
      }),
    [branchGroupByDirectory, remoteEntries, treeRepoId],
  );
  const fullTagSnapshot = useMemo(
    () =>
      buildBranchTreeSnapshot(tagEntries, {
        repoId: treeRepoId,
        grouped: branchGroupByDirectory,
      }),
    [branchGroupByDirectory, tagEntries, treeRepoId],
  );
  const allDirectoryIds = useMemo(
    () =>
      new Set([
        ...fullLocalSnapshot.directoryIds,
        ...fullRemoteSnapshot.directoryIds,
        ...fullTagSnapshot.directoryIds,
      ]),
    [fullLocalSnapshot, fullRemoteSnapshot, fullTagSnapshot],
  );
  const treeState = useBranchTreeState(activeRepoId, mode, {
    directoryIds: allDirectoryIds,
  });

  const filteredLocalEntries = useMemo(
    () => filterBranchTreeEntries(localEntries, treeState.searchQuery),
    [localEntries, treeState.searchQuery],
  );
  const filteredRemoteEntries = useMemo(
    () => filterBranchTreeEntries(remoteEntries, treeState.searchQuery),
    [remoteEntries, treeState.searchQuery],
  );
  const filteredTagEntries = useMemo(
    () => filterBranchTreeEntries(tagEntries, treeState.searchQuery),
    [tagEntries, treeState.searchQuery],
  );
  const localSnapshot = useMemo(
    () =>
      visibleSnapshot(filteredLocalEntries, treeRepoId, branchGroupByDirectory),
    [branchGroupByDirectory, filteredLocalEntries, treeRepoId],
  );
  const remoteSnapshot = useMemo(
    () =>
      visibleSnapshot(
        filteredRemoteEntries,
        treeRepoId,
        branchGroupByDirectory,
      ),
    [branchGroupByDirectory, filteredRemoteEntries, treeRepoId],
  );
  const tagSnapshot = useMemo(
    () =>
      visibleSnapshot(filteredTagEntries, treeRepoId, branchGroupByDirectory),
    [branchGroupByDirectory, filteredTagEntries, treeRepoId],
  );

  const validRefKeys = useMemo(
    () =>
      new Set(
        [...branchEntries, ...tagEntries].map((entry) =>
          refIdentityKey(entry.ref),
        ),
      ),
    [branchEntries, tagEntries],
  );
  const latestValidRefKeys = useRef(validRefKeys);
  latestValidRefKeys.current = validRefKeys;
  const latestCurrentBranch = useRef(currentBranch);
  latestCurrentBranch.current = currentBranch;
  const overlayController = useBranchOverlay(
    activeRepoId,
    validRefKeys,
    currentBranch,
  );
  const { overlay } = overlayController;

  const selectedRefKeys = useMemo(
    () => new Set(selectedRefs.map(refIdentityKey)),
    [selectedRefs],
  );
  const visibleRefs = useMemo(() => {
    const refs: GitRefIdentity[] = [];
    if (!treeState.effectiveCollapsedIds.has("section:local")) {
      refs.push(
        ...collectVisibleRefs(
          localSnapshot.roots,
          treeState.effectiveCollapsedIds,
        ),
      );
    }
    if (!treeState.effectiveCollapsedIds.has("section:remote")) {
      refs.push(
        ...collectVisibleRefs(
          remoteSnapshot.roots,
          treeState.effectiveCollapsedIds,
        ),
      );
    }
    if (showTags && !treeState.effectiveCollapsedIds.has("section:tags")) {
      refs.push(
        ...collectVisibleRefs(
          tagSnapshot.roots,
          treeState.effectiveCollapsedIds,
        ),
      );
    }
    return refs;
  }, [
    localSnapshot,
    remoteSnapshot,
    showTags,
    tagSnapshot,
    treeState.effectiveCollapsedIds,
  ]);

  const applySingleRefAction = useCallback(
    (ref: GitRefIdentity) => {
      if (singleClickAction === "filter") {
        // A plain click replaces the filter with this ref (or clears it when
        // it is already the sole filter); combining refs happens in the
        // toolbar's multi-select dropdown.
        const isSoleFilter =
          filter.branches.length === 1 && filter.branches[0] === ref.fullRef;
        setFilter({ branches: isSoleFilter ? [] : [ref.fullRef] });
        return;
      }
      const entry = [...branchEntries, ...tagEntries].find(
        (candidate) => refIdentityKey(candidate.ref) === refIdentityKey(ref),
      );
      const targetHash =
        entry?.branch?.lastCommitHash ?? entry?.tag?.targetCommitHash;
      if (targetHash) void navigateToRef(ref, targetHash);
    },
    [
      branchEntries,
      filter.branches,
      navigateToRef,
      setFilter,
      singleClickAction,
      tagEntries,
    ],
  );
  const selectWithModifiers = useModifierClickSelection<GitRefIdentity>(
    (ref, selectionMode) => {
      selectRef(ref, selectionMode, visibleRefs);
      if (selectionMode === "single") applySingleRefAction(ref);
    },
    () => setCurrentBranchRowSelectedRepoId(null),
  );
  const handleRefClick = useCallback(
    (event: React.MouseEvent, ref: GitRefIdentity) => {
      if (event.detail > 1) return;
      selectWithModifiers(event, ref);
    },
    [selectWithModifiers],
  );
  const handleRefDoubleClick = useCallback((_ref: GitRefIdentity) => {
    setCurrentBranchRowSelectedRepoId(null);
  }, []);
  const handleRefKeyboardActivate = useCallback(
    (ref: GitRefIdentity) => {
      setCurrentBranchRowSelectedRepoId(null);
      selectRef(ref, "single", visibleRefs);
      applySingleRefAction(ref);
    },
    [applySingleRefAction, selectRef, visibleRefs],
  );
  const handleRefContextMenu = useCallback(
    (event: React.MouseEvent, entry: BranchTreeEntry) => {
      event.preventDefault();
      event.stopPropagation();
      if (!activeRepoId) return;
      if (entry.scope === "tag") {
        selectRef(entry.ref, "single", visibleRefs);
      }
      const context: BranchActionContext = {
        repoId: activeRepoId,
        ref: entry.ref,
        ...(entry.branch ? { branch: entry.branch } : {}),
        ...(entry.tag ? { tag: entry.tag } : {}),
        currentBranch,
      };
      const input = { x: event.clientX, y: event.clientY, context };
      if (entry.scope === "tag") overlayController.openTagMenu(input);
      else overlayController.openBranchMenu(input);
    },
    [
      activeRepoId,
      currentBranch,
      overlayController.openBranchMenu,
      overlayController.openTagMenu,
      selectRef,
      visibleRefs,
    ],
  );

  const actionUi = useMemo<BranchActionUi>(
    () => ({
      async confirm(message, confirmLabel) {
        const result = (await requestFromSurface(
          "showConfirmMessage",
          { message, confirmLabel },
          { scope: "global" },
        )) as { confirmed?: boolean } | undefined;
        return result?.confirmed === true;
      },
      async input(prompt, value) {
        const result = (await requestFromSurface(
          "showInputBox",
          { prompt, value },
          { scope: "global" },
        )) as { value?: string | null } | undefined;
        return result?.value ?? null;
      },
      openCreate(repoId, sourceRef, startPoint, defaultName) {
        if (!isLatestRef(repoId, sourceRef, latestValidRefKeys.current)) return;
        overlayController.openCreate({
          sourceRefKey: refIdentityKey(sourceRef),
          startPoint,
          defaultName,
        });
      },
      openPush(repoId, sourceRef, branchName) {
        if (!isLatestRef(repoId, sourceRef, latestValidRefKeys.current)) return;
        overlayController.openPush({
          sourceRefKey: refIdentityKey(sourceRef),
          branchName,
        });
      },
      isCurrent(repoId, ref, capturedCurrentBranch) {
        if (
          capturedCurrentBranch !== undefined &&
          capturedCurrentBranch !== latestCurrentBranch.current
        ) {
          return false;
        }
        if (ref === undefined) {
          return useRepoStore.getState().activeRepoId === repoId;
        }
        return isLatestRef(repoId, ref, latestValidRefKeys.current);
      },
      async notifyError(title, error) {
        await notifyActionError(requestFromSurface, title, error);
      },
    }),
    [
      overlayController.openCreate,
      overlayController.openPush,
      requestFromSurface,
    ],
  );

  const menu = useMemo<BranchTreeMenuView | null>(() => {
    if (!isMenuOverlay(overlay)) return null;
    return {
      x: overlay.x,
      y: overlay.y,
      name: overlay.context.ref.name,
      items: getBranchActionItems(overlay.context),
      presentation: overlay.kind === "tag-menu" ? "tag" : "branch",
    };
  }, [overlay]);
  const handleMenuAction = useCallback(
    (id: BranchActionId) => {
      if (!isMenuOverlay(overlay)) return;
      const context = overlay.context;
      overlayController.closeOverlay();
      void runBranchAction(id, context, { operations, ui: actionUi });
    },
    [actionUi, operations, overlay, overlayController.closeOverlay],
  );
  const handleCreateConfirm = useCallback(
    async (input: {
      branchName: string;
      checkout: boolean;
      force: boolean;
    }) => {
      if (overlay?.kind !== "create") return undefined;
      const captured = overlay;
      const error = await submitCreateBranch(
        captured.repoId,
        captured.startPoint,
        input,
        operations,
      );
      if (
        error === undefined &&
        isLatestSource(
          captured.repoId,
          captured.sourceRefKey,
          latestValidRefKeys.current,
        )
      ) {
        overlayController.closeOverlay();
      }
      return error;
    },
    [operations, overlay, overlayController.closeOverlay],
  );
  const handlePush = useCallback(
    async (force: boolean) => {
      if (overlay?.kind !== "push") return;
      const captured = overlay;
      const pushed = await submitPush(
        captured.repoId,
        captured.branchName,
        force,
        operations,
        actionUi,
      );
      if (
        pushed &&
        isLatestSource(
          captured.repoId,
          captured.sourceRefKey,
          latestValidRefKeys.current,
        )
      ) {
        overlayController.closeOverlay();
      }
    },
    [actionUi, operations, overlay, overlayController.closeOverlay],
  );

  const headEntry = filteredLocalEntries.find((entry) => entry.isCurrent);
  const headCommit = commits.find((commit) =>
    commit.refs.some((ref) => ref.type === "HEAD"),
  );
  const toggle = useCallback(
    (id: string) => {
      setCurrentBranchRowSelectedRepoId(null);
      treeState.toggle(id);
    },
    [treeState.toggle],
  );

  useEffect(() => {
    const expandAll = () => treeState.expandAll();
    const collapseAll = () => treeState.collapseAll();
    window.addEventListener("branch-tree-expand-all", expandAll);
    window.addEventListener("branch-tree-collapse-all", collapseAll);
    return () => {
      window.removeEventListener("branch-tree-expand-all", expandAll);
      window.removeEventListener("branch-tree-collapse-all", collapseAll);
    };
  }, [treeState.collapseAll, treeState.expandAll]);

  const handleNewBranch = useCallback(() => {
    if (!activeRepoId) return;
    const currentEntry = localEntries.find((entry) => entry.isCurrent);
    if (currentEntry) {
      overlayController.openCreate({
        sourceRefKey: refIdentityKey(currentEntry.ref),
        startPoint: "HEAD",
        defaultName: "",
      });
      return;
    }
    overlayController.openCreate({
      startPoint: "HEAD",
      defaultName: "",
    });
  }, [activeRepoId, localEntries, overlayController.openCreate]);

  return (
    <div style={{ height: "100%", display: "flex" }}>
      <BranchSidebar
        onTogglePanel={onTogglePanel}
        onNewBranch={handleNewBranch}
      />
      <BranchTreeView
        localSnapshot={localSnapshot}
        remoteSnapshot={remoteSnapshot}
        tagSnapshot={tagSnapshot}
        collapsedIds={treeState.effectiveCollapsedIds}
        selectedRefKeys={selectedRefKeys}
        filteredRefs={filter.branches}
        searchQuery={treeState.searchQuery}
        showTags={showTags}
        showCurrentBranchRow={
          headEntry !== undefined || headCommit !== undefined
        }
        currentBranchName={headEntry?.name ?? null}
        currentBranchRowSelected={currentBranchRowSelected}
        menu={menu}
        createDialog={
          overlay?.kind === "create"
            ? {
                startPoint: overlay.startPoint,
                defaultName: overlay.defaultName,
              }
            : null
        }
        pushDialog={
          overlay?.kind === "push" ? { branchName: overlay.branchName } : null
        }
        onSearchChange={treeState.setSearchQuery}
        onToggle={toggle}
        onCurrentBranchClick={() =>
          setCurrentBranchRowSelectedRepoId(activeRepoId)
        }
        onCurrentBranchDoubleClick={() => {
          if (headEntry) handleRefDoubleClick(headEntry.ref);
        }}
        onRefClick={handleRefClick}
        onRefKeyboardActivate={handleRefKeyboardActivate}
        onRefDoubleClick={handleRefDoubleClick}
        onRefContextMenu={handleRefContextMenu}
        onMenuAction={handleMenuAction}
        onCloseOverlay={overlayController.closeOverlay}
        onCreateConfirm={handleCreateConfirm}
        onPush={handlePush}
      />
    </div>
  );
}

function visibleSnapshot(
  entries: readonly BranchTreeEntry[],
  repoId: string,
  grouped: boolean,
): BranchTreeSnapshot {
  return buildBranchTreeSnapshot(entries, { repoId, grouped });
}

function refIdentityKey(ref: GitRefIdentity): string {
  return `${ref.type}:${ref.fullRef}`;
}

function isLatestRef(
  repoId: string,
  ref: GitRefIdentity,
  validRefKeys: ReadonlySet<string>,
): boolean {
  return (
    useRepoStore.getState().activeRepoId === repoId &&
    validRefKeys.has(refIdentityKey(ref))
  );
}

function isLatestSource(
  repoId: string,
  sourceRefKey: string | undefined,
  validRefKeys: ReadonlySet<string>,
): boolean {
  return (
    useRepoStore.getState().activeRepoId === repoId &&
    (sourceRefKey === undefined || validRefKeys.has(sourceRefKey))
  );
}

function isMenuOverlay(
  overlay: ReturnType<typeof useBranchOverlay>["overlay"],
): overlay is Exclude<
  ReturnType<typeof useBranchOverlay>["overlay"],
  null | { kind: "create" } | { kind: "push" }
> {
  return overlay?.kind === "branch-menu" || overlay?.kind === "tag-menu";
}

async function notifyActionError(
  request: PanelStore["requestFromSurface"],
  title: string,
  error: BranchActionError,
): Promise<void> {
  const recovery = error.recovery ? `\n${error.recovery}` : "";
  await request(
    "showErrorNotification",
    { message: `${title}: ${error.message}${recovery}` },
    { scope: "global" },
  );
}
