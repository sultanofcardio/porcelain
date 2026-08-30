import { createStore, type StoreApi } from "zustand/vanilla";
import { bridge } from "../bridge";
import type {
  Bridge,
  BridgeRequestOptions,
  CommandType,
  LogQueryResult,
  LogQueryRevision,
} from "../bridge/types";
import type { SelectionMode } from "../hooks/useModifierClickSelection";
import type {
  BranchInfo,
  Commit,
  DiffFile,
  GitRefIdentity,
  LaneInfo,
  LaneSnapshot,
  TagInfo,
} from "../types/git";
import { computeCollapsibleSequences } from "../utils/collapsible-sequences";
import { useRepoStore } from "./repo-store";

const DEFAULT_LOG_BATCH_SIZE = 200;
const REPO_REFRESH_DEBOUNCE_MS = 100;

export interface PanelFilter {
  searchQuery: string;
  /** Treat `searchQuery` as an extended regex instead of a literal string. */
  searchRegex: boolean;
  /** Match `searchQuery` case-sensitively. */
  searchCaseSensitive: boolean;
  branch: string;
  author: string;
  dateRange: string;
  /** Custom range bounds (yyyy-mm-dd), used when `dateRange` is "custom". */
  dateAfter: string;
  dateBefore: string;
  file: string;
}

export interface PanelLoadError {
  kind: "repository-unavailable" | "generic";
  message: string;
}

export interface FetchInitialDataOptions {
  defaultToCurrentBranch?: boolean;
  preserveSelection?: boolean;
}

export interface RefreshOptions {
  preserveSelection?: boolean;
}

export interface PanelStore {
  commits: Commit[];
  /** Commits visible after local collapse state. Host queries apply log filters. */
  visibleCommits: Commit[];
  branches: BranchInfo[];
  tags: TagInfo[];
  currentBranch: string;
  graphLayout: Record<string, LaneInfo>;
  laneSnapshot: LaneSnapshot | null;
  unavailableRef: GitRefIdentity | null;

  selectedCommitHash: string | null;
  selectedCommitHashes: string[];
  lastSelectedCommitHash: string | null;
  hoveredColumn: number | null;
  commitFiles: DiffFile[];
  selectedFilePath: string | null;
  /** Column visibility for the commit list */
  visibleColumns: { author: boolean; date: boolean; hash: boolean };
  /** When multiple commits are selected, stores the oldest/newest for range diff */
  rangeOldest: string | null;
  rangeNewest: string | null;
  selectedRefs: GitRefIdentity[];
  lastSelectedRefKey: string | null;
  branchGroupByDirectory: boolean;
  showTags: boolean;
  singleClickAction: "filter" | "navigate";
  scrollTargetHash: string | null;

  filter: PanelFilter;
  /** Hashes to restore after clearing a filter */
  pendingSelectionFromFilter: string[];
  /** Collapsed sequence IDs */
  collapsedSequenceIds: Set<string>;
  /** sequenceId → intermediate hashes that are hidden */
  collapsedIntermediates: Map<string, string[]>;

  loading: boolean;
  hasMore: boolean;
  operationInProgress: boolean;
  /** Most recent host-backed history load failure, cleared by a successful load. */
  loadError: PanelLoadError | null;

  /** Repository and command facade owned by this reusable log surface. */
  actionRepoId: () => string | null;
  actionRefreshScope: "surface" | "comparison";
  requestFromSurface: (
    command: CommandType,
    params?: Record<string, unknown>,
    requestOptions?: BridgeRequestOptions,
  ) => Promise<unknown>;
  requestWithProgressFromSurface: (
    command: CommandType,
    params?: Record<string, unknown>,
    requestOptions?: BridgeRequestOptions,
  ) => Promise<unknown>;

  fetchInitialData: (options?: FetchInitialDataOptions) => Promise<void>;
  loadMore: () => Promise<void>;
  selectCommit: (
    hash: string,
    mode?: SelectionMode,
    allVisibleCommits?: string[],
    source?: "user" | "navigation",
  ) => Promise<void>;
  selectFile: (filePath: string) => void;
  openDiffEditor: (commitHash: string, file: DiffFile) => Promise<void>;
  setFilter: (filter: Partial<PanelFilter>) => void;
  selectRef: (
    ref: GitRefIdentity,
    mode: "single" | "toggle" | "range",
    allVisibleRefs: GitRefIdentity[],
  ) => void;
  setFavorite: (
    ref: GitRefIdentity,
    favorite: boolean,
    repoId?: string,
  ) => Promise<void>;
  loadBranchDashboardPreferences: () => Promise<void>;
  setBranchDashboardPreferences: (patch: {
    showTags?: boolean;
    singleClickAction?: "filter" | "navigate";
  }) => Promise<void>;
  navigateToRef: (ref: GitRefIdentity, targetHash: string) => Promise<void>;
  clearScrollTarget: () => void;
  setHoveredColumn: (column: number | null) => void;
  toggleColumnVisibility: (column: "author" | "date" | "hash") => void;
  toggleSequenceCollapse: (sequenceId: string, intermediates: string[]) => void;
  /** Collapse every collapsible linear run in the loaded graph. */
  collapseAllSequences: () => void;
  /** Expand every collapsed linear run. */
  expandAllSequences: () => void;
  toggleBranchGroupByDirectory: () => void;
  refresh: (options?: RefreshOptions) => Promise<void>;
  /**
   * Reset the repo-SCOPED parts of `filter` (`branch`, `file`) before fetching
   * for a newly-active repo, WITHOUT touching the carryover (global-scope)
   * fields `searchQuery`/`author`/`dateRange`. Also drops collapse/selection
   * state that was tied to the previous repo's commit graph. Call this from the
   * active-repo switch site BEFORE `fetchInitialData()` so the new repo's Git
   * Log isn't silently scoped to the old repo's branch/path.
   */
  resetForRepoSwitch: () => void;
  /**
   * Clear all repo-bound display data (`commits`, `branches`, `tags`, graph,
   * selection, commit files) AND the repo-scoped filter fields, leaving the
   * panel empty. Used when `activeRepoId` becomes `null` (no repos / all
   * removed) so no stale data from a gone repo lingers. Carryover filter fields
   * are preserved (they are not repo-bound).
   */
  clearForNoRepo: () => void;
}

export type LogRevision = LogQueryRevision;

export interface GitLogStoreOptions {
  repoId: string | null;
  history: { kind: "ordinary" } | { kind: "comparison"; revision: LogRevision };
  followGlobalActiveRepo: boolean;
  showCurrentReachability: boolean;
  operationProgressGroup?: RepoOperationProgressGroup;
  bridge: Bridge;
}

export interface RepoOperationProgressGroup {
  begin: (repoId: string) => void;
  end: (repoId: string) => void;
  getCount: (repoId: string) => number;
  subscribe: (listener: () => void) => () => void;
}

/**
 * Shares client-side operation progress across every log surface in one
 * comparison session. Host operation events reach both surfaces already, but
 * only the surface that initiated an action owns the one-second client
 * progress facade. This group keeps both stores behind that same barrier until
 * the action can run its explicit refreshBoth call.
 */
export function createRepoOperationProgressGroup(): RepoOperationProgressGroup {
  const counts = new Map<string, number>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    begin(repoId) {
      counts.set(repoId, (counts.get(repoId) ?? 0) + 1);
      notify();
    },
    end(repoId) {
      const next = (counts.get(repoId) ?? 0) - 1;
      if (next <= 0) counts.delete(repoId);
      else counts.set(repoId, next);
      notify();
    },
    getCount(repoId) {
      return counts.get(repoId) ?? 0;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener();
      return () => listeners.delete(listener);
    },
  };
}

export interface GitLogStore {
  store: StoreApi<PanelStore>;
  dispose: () => void;
  beginClientOperation: (repoId: string | null) => void;
  endClientOperation: (repoId: string | null) => void;
  resetOperationProgressForTests: () => void;
}

interface SelectionSnapshot {
  selectedCommitHash: string | null;
  selectedCommitHashes: string[];
  lastSelectedCommitHash: string | null;
  rangeOldest: string | null;
  rangeNewest: string | null;
}

function filterCommits(
  commits: Commit[],
  collapsedIntermediates: Map<string, string[]>,
): Commit[] {
  const hiddenSet = new Set<string>();
  for (const hashes of collapsedIntermediates.values()) {
    for (const h of hashes) hiddenSet.add(h);
  }

  return commits.filter((commit) => !hiddenSet.has(commit.hash));
}

function dateRangeParams(filter: PanelFilter): {
  since?: string;
  until?: string;
} {
  const { dateRange, dateAfter, dateBefore } = filter;
  if (!dateRange) return {};

  if (dateRange === "custom") {
    // Bounds are local calendar dates; the range is inclusive of both days.
    const since = dateAfter ? new Date(`${dateAfter}T00:00:00`) : null;
    const until = dateBefore ? new Date(`${dateBefore}T23:59:59.999`) : null;
    return {
      ...(since && !Number.isNaN(since.getTime())
        ? { since: since.toISOString() }
        : {}),
      ...(until && !Number.isNaN(until.getTime())
        ? { until: until.toISOString() }
        : {}),
    };
  }

  const now = new Date();
  let since: Date;
  if (dateRange === "today") {
    since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else {
    const days = dateRange === "7days" ? 7 : dateRange === "30days" ? 30 : 90;
    since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }
  return { since: since.toISOString(), until: now.toISOString() };
}

function queryParams(filter: PanelFilter): Record<string, unknown> {
  return {
    ...(filter.branch ? { branch: filter.branch } : {}),
    ...(filter.searchQuery
      ? {
          search: filter.searchQuery,
          searchRegex: filter.searchRegex,
          searchCaseSensitive: filter.searchCaseSensitive,
        }
      : {}),
    ...(filter.author ? { author: filter.author } : {}),
    ...dateRangeParams(filter),
    ...(filter.file ? { file: filter.file } : {}),
  };
}

function currentBranchRef(
  branches: BranchInfo[] | null,
): GitRefIdentity | null {
  const branch = branches?.find(
    (candidate) => !candidate.isRemote && candidate.isCurrent,
  );
  return branch
    ? { type: "local", name: branch.name, fullRef: branch.fullRef }
    : null;
}

function deriveSelectionFromVisible(
  visibleCommits: Commit[],
  selectedCommitHashes: string[],
  selectedCommitHash: string | null,
  lastSelectedCommitHash: string | null,
): SelectionSnapshot {
  const visibleHashes = visibleCommits.map((c) => c.hash);
  const visibleSet = new Set(visibleHashes);
  const nextSelected = selectedCommitHashes.filter((h) => visibleSet.has(h));

  if (nextSelected.length === 0) {
    const fallback = visibleCommits[0]?.hash ?? null;
    if (!fallback) {
      return {
        selectedCommitHash: null,
        selectedCommitHashes: [],
        lastSelectedCommitHash: null,
        rangeOldest: null,
        rangeNewest: null,
      };
    }
    return {
      selectedCommitHash: fallback,
      selectedCommitHashes: [fallback],
      lastSelectedCommitHash: fallback,
      rangeOldest: fallback,
      rangeNewest: fallback,
    };
  }

  const ordered = visibleHashes.filter((h) => nextSelected.includes(h));
  const preferredFocus =
    selectedCommitHash && visibleSet.has(selectedCommitHash);
  const nextFocus = preferredFocus ? selectedCommitHash : ordered[0];
  const nextAnchor =
    lastSelectedCommitHash && visibleSet.has(lastSelectedCommitHash)
      ? lastSelectedCommitHash
      : ordered[0];

  return {
    selectedCommitHash: nextFocus,
    selectedCommitHashes: ordered,
    lastSelectedCommitHash: nextAnchor,
    rangeOldest: ordered[ordered.length - 1],
    rangeNewest: ordered[0],
  };
}

/**
 * The repo-BOUND display/selection/range/collapse state to drop whenever the
 * active repo changes (repo→repo switch via `resetForRepoSwitch`, or →null via
 * `clearForNoRepo`). Shared by both paths so the field set cannot drift. The
 * carryover filter fields (`searchQuery`/`author`/`dateRange`) and the
 * repo-scoped filter fields (`branch`/`file`) are handled by each caller —
 * they reset repo-scoped fields and preserve carryover identically.
 */
function _clearRepoBoundDisplay() {
  return {
    commits: [] as Commit[],
    visibleCommits: [] as Commit[],
    branches: [] as BranchInfo[],
    tags: [] as TagInfo[],
    currentBranch: "",
    graphLayout: {} as Record<string, LaneInfo>,
    laneSnapshot: null as LaneSnapshot | null,
    unavailableRef: null as GitRefIdentity | null,
    selectedCommitHash: null,
    selectedCommitHashes: [] as string[],
    lastSelectedCommitHash: null,
    selectedRefs: [] as GitRefIdentity[],
    lastSelectedRefKey: null as string | null,
    scrollTargetHash: null as string | null,
    commitFiles: [] as DiffFile[],
    selectedFilePath: null,
    rangeOldest: null,
    rangeNewest: null,
    collapsedSequenceIds: new Set<string>(),
    collapsedIntermediates: new Map<string, string[]>(),
    pendingSelectionFromFilter: [] as string[],
    loadError: null as PanelLoadError | null,
  };
}

function loadErrorFrom(error: unknown): PanelLoadError {
  const structured = error as
    | { code?: unknown; message?: unknown }
    | null
    | undefined;
  const code = structured?.code;
  const message =
    typeof structured?.message === "string"
      ? structured.message
      : error instanceof Error
        ? error.message
        : String(error);
  return {
    kind: code === "REPO_NOT_FOUND" ? "repository-unavailable" : "generic",
    message,
  };
}

export function createGitLogStore(options: GitLogStoreOptions): GitLogStore {
  // Async log requests may overlap when the user changes filters, switches
  // repos, or clicks a ref while a refresh is in flight. Every generation and
  // active request belongs to this instance so one log cannot invalidate or
  // overwrite another log's work.
  let logLoadGeneration = 0;
  let selectionGeneration = 0;
  let navigationGeneration = 0;
  let activeLogLoad: Promise<void> | null = null;
  let filterRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let repoRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingRepoRefreshId: string | null = null;
  let currentReachabilityRef: GitRefIdentity | null = null;
  // Repository initialization is an intent, not a property of one request. A
  // watcher refresh may supersede the first request before branches resolve;
  // the replacement request must still initialize the checked-out branch.
  let pendingDefaultBranchInitialization = false;
  let disposed = false;

  function invalidateRepoAsyncWork(): void {
    logLoadGeneration += 1;
    selectionGeneration += 1;
    navigationGeneration += 1;
    activeLogLoad = null;
    currentReachabilityRef = null;
    if (filterRefreshTimer) {
      clearTimeout(filterRefreshTimer);
      filterRefreshTimer = null;
    }
    if (repoRefreshTimer) {
      clearTimeout(repoRefreshTimer);
      repoRefreshTimer = null;
    }
    pendingRepoRefreshId = null;
  }

  const boundRepoId = () =>
    options.followGlobalActiveRepo
      ? useRepoStore.getState().activeRepoId
      : options.repoId;

  function surfaceRepoId(requestOptions?: BridgeRequestOptions): string | null {
    if (requestOptions?.scope === "global") return null;
    if (!options.followGlobalActiveRepo) return options.repoId;
    return requestOptions?.repoId ?? boundRepoId();
  }

  function resolveSurfaceRequest(requestOptions?: BridgeRequestOptions): {
    repoId: string | null;
    requestOptions?: BridgeRequestOptions;
  } {
    const repoId = surfaceRepoId(requestOptions);
    if (requestOptions?.scope === "global") {
      return { repoId, requestOptions: { scope: "global" } };
    }
    return {
      repoId,
      requestOptions:
        repoId === null ? requestOptions : { ...requestOptions, repoId },
    };
  }

  function request(
    command: CommandType,
    params?: Record<string, unknown>,
    requestOptions?: BridgeRequestOptions,
  ): Promise<unknown> {
    const fixedRepoOptions =
      !options.followGlobalActiveRepo &&
      options.repoId !== null &&
      requestOptions?.scope !== "global"
        ? { ...requestOptions, repoId: options.repoId }
        : requestOptions;
    if (fixedRepoOptions) {
      return options.bridge.request(command, params, fixedRepoOptions);
    }
    if (params !== undefined) {
      return options.bridge.request(command, params);
    }
    return options.bridge.request(command);
  }

  function requestFromSurface(
    command: CommandType,
    params?: Record<string, unknown>,
    requestOptions?: BridgeRequestOptions,
  ): Promise<unknown> {
    const resolved = resolveSurfaceRequest(requestOptions);
    return options.bridge.request(command, params, resolved.requestOptions);
  }

  const revision =
    options.history.kind === "comparison"
      ? options.history.revision
      : undefined;
  const historyParams = revision ? { revision } : {};

  const store = createStore<PanelStore>((set, get) => ({
    commits: [],
    visibleCommits: [],
    branches: [],
    tags: [],
    currentBranch: "",
    graphLayout: {},
    laneSnapshot: null,
    unavailableRef: null,

    selectedCommitHash: null,
    selectedCommitHashes: [],
    lastSelectedCommitHash: null,
    hoveredColumn: null,
    commitFiles: [],
    selectedFilePath: null,
    visibleColumns: { author: true, date: true, hash: true },
    rangeOldest: null,
    rangeNewest: null,
    selectedRefs: [],
    lastSelectedRefKey: null,
    showTags: true,
    singleClickAction: "filter",
    scrollTargetHash: null,
    branchGroupByDirectory: (() => {
      try {
        return localStorage.getItem("branchGroupByDirectory") !== "false";
      } catch {
        return true;
      }
    })(),

    filter: {
      searchQuery: "",
      searchRegex: false,
      searchCaseSensitive: false,
      branch: "",
      author: "",
      dateRange: "",
      dateAfter: "",
      dateBefore: "",
      file: "",
    },
    pendingSelectionFromFilter: [],
    collapsedSequenceIds: new Set(),
    collapsedIntermediates: new Map(),

    loading: false,
    hasMore: true,
    operationInProgress: false,
    loadError: null,

    actionRepoId: boundRepoId,
    actionRefreshScope:
      options.history.kind === "comparison" ? "comparison" : "surface",
    requestFromSurface,
    async requestWithProgressFromSurface(command, params, requestOptions) {
      const resolved = resolveSurfaceRequest(requestOptions);
      const { repoId } = resolved;
      if (repoId !== null) beginClientOperationProgress(repoId);
      const start = Date.now();
      try {
        const result = await options.bridge.request(
          command,
          params,
          resolved.requestOptions,
        );
        const elapsed = Date.now() - start;
        if (elapsed < 1000) {
          await new Promise((resolve) => setTimeout(resolve, 1000 - elapsed));
        }
        return result;
      } finally {
        if (repoId !== null) endClientOperationProgress(repoId);
      }
    },

    async fetchInitialData(fetchOptions = {}) {
      const generation = ++logLoadGeneration;
      const selectionGenerationAtStart = selectionGeneration;
      const currentSelection = get();
      const requestedBatchSize = fetchOptions.preserveSelection
        ? Math.max(DEFAULT_LOG_BATCH_SIZE, currentSelection.commits.length)
        : DEFAULT_LOG_BATCH_SIZE;
      const selectionToPreserve =
        fetchOptions.preserveSelection &&
        currentSelection.selectedCommitHashes.length > 0
          ? {
              selectedCommitHash: currentSelection.selectedCommitHash,
              selectedCommitHashes: [...currentSelection.selectedCommitHashes],
              lastSelectedCommitHash: currentSelection.lastSelectedCommitHash,
              commitFiles: [...currentSelection.commitFiles],
              selectedFilePath: currentSelection.selectedFilePath,
            }
          : null;
      if (fetchOptions.defaultToCurrentBranch && !get().filter.branch) {
        pendingDefaultBranchInitialization = true;
      }
      const shouldDefaultToCurrentBranch =
        pendingDefaultBranchInitialization && !get().filter.branch;
      set({ loading: true });
      const start = Date.now();
      const operation = (async () => {
        try {
          let requestedFilter = { ...get().filter };
          const branchesRequest = request("getBranches") as Promise<
            BranchInfo[] | null
          >;
          const tagsRequest = request("getTags") as Promise<TagInfo[] | null>;
          const requestGraph = (currentRef: GitRefIdentity | null) =>
            request("getGraphData", {
              maxCount: requestedBatchSize,
              ...historyParams,
              ...queryParams(requestedFilter),
              ...(options.showCurrentReachability && currentRef
                ? { currentRef }
                : {}),
            }) as Promise<
              | LogQueryResult
              | {
                  graphData: {
                    commits: Commit[];
                    lanes: Record<string, LaneInfo>;
                  };
                  snapshot: LaneSnapshot;
                }
              | null
            >;

          let graphResult: Awaited<ReturnType<typeof requestGraph>>;
          let branches: BranchInfo[] | null;
          let tags: TagInfo[] | null;
          if (shouldDefaultToCurrentBranch || options.showCurrentReachability) {
            [branches, tags] = await Promise.all([
              branchesRequest,
              tagsRequest,
            ]);
            if (generation !== logLoadGeneration) return;
            const currentRef = currentBranchRef(branches);
            if (shouldDefaultToCurrentBranch && currentRef) {
              requestedFilter = {
                ...requestedFilter,
                branch: currentRef.fullRef,
              };
              set((state) => ({
                filter: { ...state.filter, branch: currentRef.fullRef },
              }));
              // The initialization intent is fulfilled once the checked-out ref
              // is known and reflected in state. Do not retain it while the
              // graph request is pending: a newer refresh may supersede that
              // request, and a leaked flag would later override an explicit
              // filter clear (for example during navigateToRef).
              pendingDefaultBranchInitialization = false;
            } else if (shouldDefaultToCurrentBranch) {
              // Detached HEAD (or a repository without a local branch) has no
              // branch to initialize. Future ordinary refreshes stay unfiltered.
              pendingDefaultBranchInitialization = false;
            }
            currentReachabilityRef = options.showCurrentReachability
              ? currentRef
              : null;
            graphResult = await requestGraph(currentReachabilityRef);
          } else {
            [graphResult, branches, tags] = await Promise.all([
              requestGraph(null),
              branchesRequest,
              tagsRequest,
            ]);
          }

          if (generation !== logLoadGeneration) return;
          if (shouldDefaultToCurrentBranch) {
            pendingDefaultBranchInitialization = false;
          }

          const branchList = branches ?? [];
          const tagList = tags ?? [];
          const current = branchList.find((b) => b.isCurrent)?.name ?? "";
          if (
            graphResult &&
            "status" in graphResult &&
            graphResult.status === "ref-unavailable"
          ) {
            set({
              ..._clearRepoBoundDisplay(),
              branches: branchList,
              tags: tagList,
              currentBranch: current,
              unavailableRef: graphResult.ref,
              hasMore: false,
              loadError: null,
            });
            return;
          }

          const commits = graphResult?.graphData?.commits ?? [];
          const lanes = graphResult?.graphData?.lanes ?? {};
          const snapshot = graphResult?.snapshot ?? null;
          const queryHasMore =
            graphResult && "status" in graphResult
              ? graphResult.hasMore
              : commits.length >= requestedBatchSize;

          const { pendingSelectionFromFilter, collapsedIntermediates } = get();
          const visible = filterCommits(commits, collapsedIntermediates);
          const latestSelection = get();
          const selectionChangedDuringLoad =
            selectionGeneration !== selectionGenerationAtStart;
          const selectionToRestore = selectionChangedDuringLoad
            ? {
                selectedCommitHash: latestSelection.selectedCommitHash,
                selectedCommitHashes: [...latestSelection.selectedCommitHashes],
                lastSelectedCommitHash: latestSelection.lastSelectedCommitHash,
                commitFiles: [...latestSelection.commitFiles],
                selectedFilePath: latestSelection.selectedFilePath,
              }
            : selectionToPreserve;

          // Check if we need to restore selection from a cleared filter.
          if (pendingSelectionFromFilter.length > 0) {
            const validHashes = pendingSelectionFromFilter.filter((h) =>
              commits.some((c) => c.hash === h),
            );
            if (validHashes.length > 0) {
              const fileGeneration = ++selectionGeneration;
              set({
                commits,
                visibleCommits: visible,
                graphLayout: lanes,
                laneSnapshot: snapshot,
                branches: branchList,
                tags: tagList,
                currentBranch: current,

                hasMore: queryHasMore,
                unavailableRef: null,
                loadError: null,
                selectedCommitHash: validHashes[0],
                selectedCommitHashes: validHashes,
                lastSelectedCommitHash: validHashes[0],
                commitFiles: [],
                selectedFilePath: null,
                rangeOldest: validHashes[validHashes.length - 1],
                rangeNewest: validHashes[0],
                pendingSelectionFromFilter: [],
              });

              const files = (await request("getCommitRangeFiles", {
                hashes: validHashes,
              })) as DiffFile[] | null;
              if (
                generation === logLoadGeneration &&
                fileGeneration === selectionGeneration
              ) {
                set({ commitFiles: files ?? [] });
              }
              return;
            }
          }

          if (selectionToRestore) {
            const commitHashes = new Set(commits.map((commit) => commit.hash));
            const validHashes = selectionToRestore.selectedCommitHashes.filter(
              (hash) => commitHashes.has(hash),
            );
            const validSet = new Set(validHashes);
            const orderedHashes = visible
              .map((commit) => commit.hash)
              .filter((hash) => validSet.has(hash));

            if (validHashes.length === 0) {
              set({
                commits,
                visibleCommits: visible,
                graphLayout: lanes,
                laneSnapshot: snapshot,
                branches: branchList,
                tags: tagList,
                currentBranch: current,
                hasMore: queryHasMore,
                unavailableRef: null,
                loadError: null,
                selectedCommitHash: null,
                selectedCommitHashes: [],
                lastSelectedCommitHash: null,
                commitFiles: [],
                selectedFilePath: null,
                rangeOldest: null,
                rangeNewest: null,
                pendingSelectionFromFilter: [],
              });
              return;
            }

            const selectedCommitHash =
              selectionToRestore.selectedCommitHash &&
              validSet.has(selectionToRestore.selectedCommitHash)
                ? selectionToRestore.selectedCommitHash
                : orderedHashes[0];
            const lastSelectedCommitHash =
              selectionToRestore.lastSelectedCommitHash &&
              validSet.has(selectionToRestore.lastSelectedCommitHash)
                ? selectionToRestore.lastSelectedCommitHash
                : orderedHashes[0];
            const fileGeneration = ++selectionGeneration;
            set({
              commits,
              visibleCommits: visible,
              graphLayout: lanes,
              laneSnapshot: snapshot,
              branches: branchList,
              tags: tagList,
              currentBranch: current,
              hasMore: queryHasMore,
              unavailableRef: null,
              loadError: null,
              selectedCommitHash,
              selectedCommitHashes: validHashes,
              lastSelectedCommitHash,
              commitFiles: selectionToRestore.commitFiles,
              selectedFilePath: selectionToRestore.selectedFilePath,
              rangeOldest: orderedHashes[orderedHashes.length - 1],
              rangeNewest: orderedHashes[0],
              pendingSelectionFromFilter: [],
            });

            const files = (await request("getCommitRangeFiles", {
              hashes: orderedHashes,
            })) as DiffFile[] | null;
            if (
              generation === logLoadGeneration &&
              fileGeneration === selectionGeneration
            ) {
              const nextFiles = files ?? [];
              const preservedFile = selectionToRestore.selectedFilePath;
              set({
                commitFiles: nextFiles,
                selectedFilePath:
                  preservedFile &&
                  nextFiles.some(
                    (file) => (file.newPath || file.oldPath) === preservedFile,
                  )
                    ? preservedFile
                    : null,
              });
            }
            return;
          }

          const firstVisible = visible[0];
          const fileGeneration = ++selectionGeneration;
          set({
            commits,
            visibleCommits: visible,
            graphLayout: lanes,
            laneSnapshot: snapshot,
            branches: branchList,
            tags: tagList,
            currentBranch: current,

            hasMore: queryHasMore,
            unavailableRef: null,
            loadError: null,
            selectedCommitHash: firstVisible?.hash ?? null,
            selectedCommitHashes: firstVisible ? [firstVisible.hash] : [],
            lastSelectedCommitHash: firstVisible?.hash ?? null,
            commitFiles: [],
            selectedFilePath: null,
            rangeOldest: null,
            rangeNewest: null,
            pendingSelectionFromFilter: [],
          });

          // Auto-select first visible commit.
          if (firstVisible) {
            const hash = firstVisible.hash;
            const files = (await request("getCommitRangeFiles", {
              hashes: [hash],
            })) as DiffFile[] | null;
            if (
              generation === logLoadGeneration &&
              fileGeneration === selectionGeneration
            ) {
              set({
                commitFiles: files ?? [],
                rangeOldest: hash,
                rangeNewest: hash,
              });
            }
          }
        } catch (err) {
          if (generation === logLoadGeneration) {
            console.error("fetchInitialData failed:", err);
            set({
              ..._clearRepoBoundDisplay(),
              hasMore: false,
              loadError: loadErrorFrom(err),
            });
          }
        } finally {
          const elapsed = Date.now() - start;
          if (elapsed < 1000) {
            await new Promise((resolve) => setTimeout(resolve, 1000 - elapsed));
          }
          if (generation === logLoadGeneration) set({ loading: false });
        }
      })();

      activeLogLoad = operation;
      try {
        await operation;
      } finally {
        if (activeLogLoad === operation) activeLogLoad = null;
      }
    },

    async loadMore() {
      if (activeLogLoad) {
        await activeLogLoad;
        return;
      }

      const { commits, laneSnapshot, hasMore, filter } = get();
      if (!hasMore) return;

      const generation = logLoadGeneration;
      set({ loading: true });
      const operation = (async () => {
        try {
          const result = (await request("loadMoreLog", {
            skip: commits.length,
            count: DEFAULT_LOG_BATCH_SIZE,
            snapshot: laneSnapshot,
            ...historyParams,
            ...queryParams(filter),
            ...(options.showCurrentReachability && currentReachabilityRef
              ? { currentRef: currentReachabilityRef }
              : {}),
          })) as
            | LogQueryResult
            | {
                graphData: {
                  commits: Commit[];
                  lanes: Record<string, LaneInfo>;
                };
                snapshot: LaneSnapshot;
              }
            | null;

          if (generation !== logLoadGeneration) return;

          if (
            result &&
            "status" in result &&
            result.status === "ref-unavailable"
          ) {
            set({
              unavailableRef: result.ref,
              hasMore: false,
              loadError: null,
            });
            return;
          }

          if (result?.graphData?.commits?.length) {
            const newCommits = result.graphData.commits;
            const allCommits = [...commits, ...newCommits];
            set({
              commits: allCommits,
              visibleCommits: filterCommits(
                allCommits,
                get().collapsedIntermediates,
              ),
              graphLayout: { ...get().graphLayout, ...result.graphData.lanes },
              laneSnapshot: result.snapshot,
              hasMore:
                "status" in result
                  ? result.hasMore
                  : newCommits.length >= DEFAULT_LOG_BATCH_SIZE,
              unavailableRef: null,
              loadError: null,
            });
          } else {
            set({ hasMore: false, unavailableRef: null, loadError: null });
          }
        } catch (err) {
          if (generation === logLoadGeneration) {
            console.error("loadMore failed:", err);
            const loadError = loadErrorFrom(err);
            set(
              loadError.kind === "repository-unavailable"
                ? {
                    ..._clearRepoBoundDisplay(),
                    hasMore: false,
                    loadError,
                  }
                : { loadError },
            );
          }
        } finally {
          if (generation === logLoadGeneration) set({ loading: false });
        }
      })();

      activeLogLoad = operation;
      try {
        await operation;
      } finally {
        if (activeLogLoad === operation) activeLogLoad = null;
      }
    },

    async selectCommit(
      hash: string,
      mode: SelectionMode = "single",
      allVisibleCommits: string[] = [],
      source: "user" | "navigation" = "user",
    ) {
      if (source === "user") navigationGeneration += 1;
      const generation = ++selectionGeneration;
      const { selectedCommitHashes, lastSelectedCommitHash } = get();
      let nextSelected: string[] = [];
      let nextAnchor = lastSelectedCommitHash;

      if (mode === "single") {
        nextSelected = [hash];
        nextAnchor = hash;
      } else if (mode === "toggle") {
        if (selectedCommitHashes.includes(hash)) {
          nextSelected = selectedCommitHashes.filter((h) => h !== hash);
          if (nextSelected.length === 0) {
            nextSelected = [hash];
          }
        } else {
          nextSelected = [...selectedCommitHashes, hash];
        }
        nextAnchor = hash;
      } else {
        const anchor = lastSelectedCommitHash;
        if (!anchor || allVisibleCommits.length === 0) {
          nextSelected = [hash];
          nextAnchor = hash;
        } else {
          const anchorIdx = allVisibleCommits.indexOf(anchor);
          const targetIdx = allVisibleCommits.indexOf(hash);
          if (anchorIdx === -1 || targetIdx === -1) {
            nextSelected = [hash];
            nextAnchor = hash;
          } else {
            const start = Math.min(anchorIdx, targetIdx);
            const end = Math.max(anchorIdx, targetIdx);
            nextSelected = allVisibleCommits.slice(start, end + 1);
          }
        }
      }

      const focusHash = nextSelected.includes(hash)
        ? hash
        : (nextSelected[nextSelected.length - 1] ?? hash);

      // Sort selected hashes by visible list order (newest first)
      const selected = new Set(nextSelected);
      const orderedHashes =
        allVisibleCommits.length > 0
          ? allVisibleCommits.filter((h) => selected.has(h))
          : nextSelected;

      set({
        selectedCommitHash: focusHash,
        selectedCommitHashes: nextSelected,
        lastSelectedCommitHash: nextAnchor,
        commitFiles: [],
        selectedFilePath: null,
        rangeOldest: orderedHashes[orderedHashes.length - 1],
        rangeNewest: orderedHashes[0],
      });
      try {
        const files = (await request("getCommitRangeFiles", {
          hashes: orderedHashes,
        })) as DiffFile[] | null;
        if (generation === selectionGeneration) {
          set({ commitFiles: files ?? [] });
        }
      } catch (err) {
        if (generation === selectionGeneration) {
          console.error("selectCommit failed:", err);
        }
      }
    },

    selectFile(filePath: string) {
      set({ selectedFilePath: filePath });
    },

    async openDiffEditor(commitHash: string, file: DiffFile) {
      try {
        const { selectedCommitHashes, commitFiles } = get();
        const filePath = file.newPath || file.oldPath;
        const isMulti = selectedCommitHashes.length > 1;

        if (isMulti) {
          await requestFromSurface("openDiffEditor", {
            commit: selectedCommitHashes[0],
            filePath,
            file,
            cherryPickHashes: selectedCommitHashes,
            fileList: commitFiles,
          });
        } else {
          await requestFromSurface("openDiffEditor", {
            commit: commitHash,
            filePath,
            file,
            fileList: commitFiles,
          });
        }
      } catch (err) {
        console.error("openDiffEditor failed:", err);
      }
    },

    setFilter(partial: Partial<PanelFilter>) {
      navigationGeneration += 1;
      if (partial.branch !== undefined) {
        // Any explicit branch choice, including clearing the chip, supersedes
        // repository initialization and must survive ordinary refreshes.
        pendingDefaultBranchInitialization = false;
      }
      const { filter: current } = get();
      const next = { ...current, ...partial };
      const searchModeChanged =
        current.searchRegex !== next.searchRegex ||
        current.searchCaseSensitive !== next.searchCaseSensitive;
      const queryChanged =
        current.searchQuery !== next.searchQuery ||
        // Search-mode toggles only change the query while a search is active.
        (searchModeChanged && !!next.searchQuery) ||
        current.branch !== next.branch ||
        current.author !== next.author ||
        current.dateRange !== next.dateRange ||
        (next.dateRange === "custom" &&
          (current.dateAfter !== next.dateAfter ||
            current.dateBefore !== next.dateBefore)) ||
        current.file !== next.file;
      if (!queryChanged) {
        // Still record inert changes (for example toggling regex with an
        // empty search box) so the toggle is armed for the next query.
        set({ filter: next });
        return;
      }

      // Invalidate old results and selection before a replacement host query.
      // These counters are per store instance, so comparison panels stay isolated.
      logLoadGeneration += 1;
      selectionGeneration += 1;
      if (filterRefreshTimer) clearTimeout(filterRefreshTimer);
      filterRefreshTimer = null;
      set({
        filter: next,
        commits: [],
        visibleCommits: [],
        graphLayout: {},
        laneSnapshot: null,
        unavailableRef: null,
        selectedCommitHash: null,
        selectedCommitHashes: [],
        lastSelectedCommitHash: null,
        commitFiles: [],
        selectedFilePath: null,
        rangeOldest: null,
        rangeNewest: null,
        pendingSelectionFromFilter: [],
        collapsedSequenceIds: new Set(),
        collapsedIntermediates: new Map(),
        hasMore: true,
        loading: false,
      });

      const refresh = () => {
        filterRefreshTimer = null;
        void get().fetchInitialData();
      };
      if (partial.searchQuery !== undefined) {
        filterRefreshTimer = setTimeout(refresh, 200);
      } else {
        refresh();
      }
    },

    selectRef(ref, mode, allVisibleRefs) {
      const keyOf = (candidate: GitRefIdentity) =>
        `${candidate.type}\0${candidate.name}`;
      const targetKey = keyOf(ref);
      const { selectedRefs, lastSelectedRefKey } = get();

      if (mode === "single") {
        set({ selectedRefs: [ref], lastSelectedRefKey: targetKey });
        return;
      }

      if (mode === "toggle") {
        const isSelected = selectedRefs.some(
          (candidate) => keyOf(candidate) === targetKey,
        );
        set({
          selectedRefs: isSelected
            ? selectedRefs.filter((candidate) => keyOf(candidate) !== targetKey)
            : [...selectedRefs, ref],
          lastSelectedRefKey: targetKey,
        });
        return;
      }

      const anchorIndex = allVisibleRefs.findIndex(
        (candidate) => keyOf(candidate) === lastSelectedRefKey,
      );
      const targetIndex = allVisibleRefs.findIndex(
        (candidate) => keyOf(candidate) === targetKey,
      );
      if (anchorIndex === -1 || targetIndex === -1) {
        set({ selectedRefs: [ref], lastSelectedRefKey: targetKey });
        return;
      }

      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      set({ selectedRefs: allVisibleRefs.slice(start, end + 1) });
    },

    async setFavorite(ref, favorite, repoId) {
      await request(
        "setFavorite",
        { ref, favorite },
        repoId === undefined ? undefined : { repoId },
      );
      if (repoId !== undefined && repoId !== boundRepoId()) return;
      set((state) => ({
        branches: state.branches.map((branch) => {
          const type = branch.isRemote ? "remote" : "local";
          return type === ref.type && branch.name === ref.name
            ? { ...branch, isFavorite: favorite }
            : branch;
        }),
        tags: state.tags.map((tag) =>
          ref.type === "tag" && tag.name === ref.name
            ? { ...tag, isFavorite: favorite }
            : tag,
        ),
      }));
    },

    async loadBranchDashboardPreferences() {
      const preferences = (await request(
        "getBranchDashboardPreferences",
        {},
        { scope: "global" },
      )) as {
        showTags: boolean;
        singleClickAction: "filter" | "navigate";
      } | null;
      if (preferences) set(preferences);
    },

    async setBranchDashboardPreferences(patch) {
      const preferences = (await request(
        "setBranchDashboardPreferences",
        patch,
        { scope: "global" },
      )) as {
        showTags: boolean;
        singleClickAction: "filter" | "navigate";
      } | null;
      if (preferences) set(preferences);
    },

    async navigateToRef(ref, targetHash) {
      const generation = ++navigationGeneration;
      const filter = get().filter;
      // Search-mode toggles alone don't narrow the log; only value-bearing
      // fields can hide the target commit.
      const hasActiveFilter =
        !!filter.searchQuery ||
        !!filter.branch ||
        !!filter.author ||
        !!filter.dateRange ||
        !!filter.file;

      // Navigate means reveal this ref's head in the main log. Any active filter
      // can hide that commit, so clear it and await the replacement log before
      // searching or paginating. The regex/match-case toggles are preferences,
      // not filters, and survive the clear.
      if (hasActiveFilter) {
        set({
          filter: {
            searchQuery: "",
            searchRegex: filter.searchRegex,
            searchCaseSensitive: filter.searchCaseSensitive,
            branch: "",
            author: "",
            dateRange: "",
            dateAfter: "",
            dateBefore: "",
            file: "",
          },
          pendingSelectionFromFilter: [],
          collapsedSequenceIds: new Set(),
          collapsedIntermediates: new Map(),
        });
        await get().fetchInitialData();
      } else if (activeLogLoad) {
        await activeLogLoad;
      }

      if (generation !== navigationGeneration) return;

      let visibleHashes = get().visibleCommits.map((commit) => commit.hash);
      while (!visibleHashes.includes(targetHash) && get().hasMore) {
        if (activeLogLoad) await activeLogLoad;
        if (generation !== navigationGeneration) return;
        visibleHashes = get().visibleCommits.map((commit) => commit.hash);
        if (visibleHashes.includes(targetHash) || !get().hasMore) break;

        const previousCount = get().commits.length;
        await get().loadMore();
        if (generation !== navigationGeneration) return;
        visibleHashes = get().visibleCommits.map((commit) => commit.hash);
        if (get().commits.length === previousCount) break;
      }
      if (!visibleHashes.includes(targetHash)) {
        await request(
          "showErrorNotification",
          {
            message: `Could not find ${ref.name} (${targetHash.slice(0, 8)}) in the loaded log.`,
          },
          { scope: "global" },
        );
        return;
      }
      await get().selectCommit(
        targetHash,
        "single",
        visibleHashes,
        "navigation",
      );
      if (
        generation === navigationGeneration &&
        get().selectedCommitHash === targetHash
      ) {
        set({ scrollTargetHash: targetHash });
      }
    },

    clearScrollTarget() {
      set({ scrollTargetHash: null });
    },

    setHoveredColumn(column: number | null) {
      set({ hoveredColumn: column });
    },

    toggleColumnVisibility(column: "author" | "date" | "hash") {
      set((state) => ({
        visibleColumns: {
          ...state.visibleColumns,
          [column]: !state.visibleColumns[column],
        },
      }));
    },

    toggleBranchGroupByDirectory() {
      set((state) => {
        const next = !state.branchGroupByDirectory;
        try {
          localStorage.setItem("branchGroupByDirectory", String(next));
        } catch {
          // ignore
        }
        return { branchGroupByDirectory: next };
      });
    },

    toggleSequenceCollapse(sequenceId: string, intermediates: string[]) {
      const fileGeneration = ++selectionGeneration;
      const {
        commits,
        collapsedSequenceIds,
        collapsedIntermediates,
        selectedCommitHashes,
        selectedCommitHash,
        lastSelectedCommitHash,
      } = get();
      const nextIds = new Set(collapsedSequenceIds);
      const nextMap = new Map(collapsedIntermediates);

      if (nextIds.has(sequenceId)) {
        nextIds.delete(sequenceId);
        nextMap.delete(sequenceId);
      } else {
        nextIds.add(sequenceId);
        nextMap.set(sequenceId, intermediates);
      }

      const nextVisible = filterCommits(commits, nextMap);
      const nextSelection = deriveSelectionFromVisible(
        nextVisible,
        selectedCommitHashes,
        selectedCommitHash,
        lastSelectedCommitHash,
      );

      set({
        collapsedSequenceIds: nextIds,
        collapsedIntermediates: nextMap,
        visibleCommits: nextVisible,
        selectedCommitHash: nextSelection.selectedCommitHash,
        selectedCommitHashes: nextSelection.selectedCommitHashes,
        lastSelectedCommitHash: nextSelection.lastSelectedCommitHash,
        rangeOldest: nextSelection.rangeOldest,
        rangeNewest: nextSelection.rangeNewest,
        selectedFilePath: null,
        commitFiles: [],
      });

      const hashes = nextSelection.selectedCommitHashes;
      if (hashes.length > 0) {
        void (async () => {
          try {
            const files = (await request("getCommitRangeFiles", {
              hashes,
            })) as DiffFile[] | null;
            if (fileGeneration === selectionGeneration) {
              set({ commitFiles: files ?? [] });
            }
          } catch (err) {
            console.error("toggleSequenceCollapse failed to load files:", err);
          }
        })();
      }
    },

    collapseAllSequences() {
      const { commits, graphLayout } = get();
      const { sequences } = computeCollapsibleSequences(commits, graphLayout);
      const nextIds = new Set<string>();
      const nextMap = new Map<string, string[]>();
      for (const seq of sequences) {
        nextIds.add(seq.id);
        nextMap.set(seq.id, seq.intermediates);
      }
      applyCollapseState(nextIds, nextMap);
    },

    expandAllSequences() {
      applyCollapseState(new Set(), new Map());
    },

    async refresh(refreshOptions = {}) {
      // A command surface explicitly refreshes after its mutation succeeds.
      // Consume any watcher/event refresh queued for the same mutation so the
      // comparison does not perform the same graph load twice.
      if (repoRefreshTimer) {
        clearTimeout(repoRefreshTimer);
        repoRefreshTimer = null;
      }
      pendingRepoRefreshId = null;
      set({
        collapsedSequenceIds: new Set(),
        collapsedIntermediates: new Map(),
      });
      await get().fetchInitialData({
        preserveSelection: refreshOptions.preserveSelection,
      });
    },

    resetForRepoSwitch() {
      invalidateRepoAsyncWork();
      pendingDefaultBranchInitialization = false;
      const { filter } = get();
      // On a repo→repo switch the old repo's display/selection/range/collapse
      // data must be dropped IMMEDIATELY: the new repo's fetch is async, and if
      // the old data lingered a user could act on a still-visible A commit
      // (Checkout / Delete / Cherry-pick / open file) through a now-B-bound
      // request — the operation would target B. Clearing here guarantees there
      // is nothing stale to act on during B's load. Carryover (global-scope)
      // filters `searchQuery`/`author`/`dateRange` are preserved; the repo-scoped
      // `branch`/`file` are reset so B's Git Log isn't scoped to A's refs/paths.
      // The repo-bound field set mirrors `clearForNoRepo` via the shared helper
      // so the two cannot drift.
      set({
        ..._clearRepoBoundDisplay(),
        filter: {
          searchQuery: filter.searchQuery,
          searchRegex: filter.searchRegex,
          searchCaseSensitive: filter.searchCaseSensitive,
          branch: "",
          author: filter.author,
          dateRange: filter.dateRange,
          dateAfter: filter.dateAfter,
          dateBefore: filter.dateBefore,
          file: "",
        },
        loading: false,
      });
    },

    clearForNoRepo() {
      invalidateRepoAsyncWork();
      pendingDefaultBranchInitialization = false;
      const { filter } = get();
      // Wipe repo-bound display data + repo-scoped filter fields; keep carryover
      // (search/author/date) since they are not repo-bound and a future repo may
      // reasonably reuse them. `hasMore` is reset to its initial `true` (the
      // null path leaves the panel fully empty, as if never loaded).
      set({
        ..._clearRepoBoundDisplay(),
        filter: {
          searchQuery: filter.searchQuery,
          searchRegex: filter.searchRegex,
          searchCaseSensitive: filter.searchCaseSensitive,
          branch: "",
          author: filter.author,
          dateRange: filter.dateRange,
          dateAfter: filter.dateAfter,
          dateBefore: filter.dateBefore,
          file: "",
        },
        hasMore: true,
        loading: false,
      });
    },
  }));

  /**
   * Replace the collapse state wholesale (collapse-all / expand-all), then
   * re-derive visibility and selection exactly like a single toggle does.
   */
  function applyCollapseState(
    nextIds: Set<string>,
    nextMap: Map<string, string[]>,
  ): void {
    const fileGeneration = ++selectionGeneration;
    const {
      commits,
      selectedCommitHashes,
      selectedCommitHash,
      lastSelectedCommitHash,
    } = store.getState();

    const nextVisible = filterCommits(commits, nextMap);
    const nextSelection = deriveSelectionFromVisible(
      nextVisible,
      selectedCommitHashes,
      selectedCommitHash,
      lastSelectedCommitHash,
    );

    store.setState({
      collapsedSequenceIds: nextIds,
      collapsedIntermediates: nextMap,
      visibleCommits: nextVisible,
      selectedCommitHash: nextSelection.selectedCommitHash,
      selectedCommitHashes: nextSelection.selectedCommitHashes,
      lastSelectedCommitHash: nextSelection.lastSelectedCommitHash,
      rangeOldest: nextSelection.rangeOldest,
      rangeNewest: nextSelection.rangeNewest,
      selectedFilePath: null,
      commitFiles: [],
    });

    const hashes = nextSelection.selectedCommitHashes;
    if (hashes.length > 0) {
      void (async () => {
        try {
          const files = (await request("getCommitRangeFiles", {
            hashes,
          })) as DiffFile[] | null;
          if (fileGeneration === selectionGeneration) {
            store.setState({ commitFiles: files ?? [] });
          }
        } catch (err) {
          console.error("applyCollapseState failed to load files:", err);
        }
      })();
    }
  }

  // Progress counts and both subscriptions are instance-owned. Fixed-repo
  // stores compare events against their configured repo while the ordinary
  // panel follows the repo store's active id.
  const inFlightOpCounts = new Map<string, number>();
  const visibleRepoId = boundRepoId;

  function recomputeOperationInProgress(): void {
    const repoId = visibleRepoId();
    const operationInProgress =
      repoId !== null &&
      (inFlightOpCounts.get(repoId) ?? 0) +
        (options.operationProgressGroup?.getCount(repoId) ?? 0) >
        0;
    store.setState({ operationInProgress });
    if (operationInProgress) {
      if (repoRefreshTimer) {
        clearTimeout(repoRefreshTimer);
        repoRefreshTimer = null;
      }
    } else {
      resumePendingRepoRefresh();
    }
  }

  function incrementInFlight(repoId: string): void {
    inFlightOpCounts.set(repoId, (inFlightOpCounts.get(repoId) ?? 0) + 1);
    recomputeOperationInProgress();
  }

  function decrementInFlight(repoId: string): void {
    const next = (inFlightOpCounts.get(repoId) ?? 0) - 1;
    if (next <= 0) {
      inFlightOpCounts.delete(repoId);
    } else {
      inFlightOpCounts.set(repoId, next);
    }
    recomputeOperationInProgress();
  }

  function beginClientOperationProgress(repoId: string): void {
    if (options.operationProgressGroup) {
      options.operationProgressGroup.begin(repoId);
    } else {
      incrementInFlight(repoId);
    }
  }

  function endClientOperationProgress(repoId: string): void {
    if (options.operationProgressGroup) {
      options.operationProgressGroup.end(repoId);
    } else {
      decrementInFlight(repoId);
    }
  }

  function armRepoRefresh(repoId: string): void {
    if (repoRefreshTimer) clearTimeout(repoRefreshTimer);
    repoRefreshTimer = setTimeout(() => {
      repoRefreshTimer = null;
      pendingRepoRefreshId = null;
      if (disposed || repoId !== visibleRepoId()) return;
      void store.getState().refresh({
        preserveSelection: options.history.kind === "comparison",
      });
    }, REPO_REFRESH_DEBOUNCE_MS);
  }

  function resumePendingRepoRefresh(): void {
    const repoId = pendingRepoRefreshId;
    if (
      repoId === null ||
      disposed ||
      repoId !== visibleRepoId() ||
      store.getState().operationInProgress ||
      repoRefreshTimer
    ) {
      return;
    }
    armRepoRefresh(repoId);
  }

  function scheduleRepoRefresh(repoId: string): void {
    pendingRepoRefreshId = repoId;
    if (store.getState().operationInProgress) {
      if (repoRefreshTimer) {
        clearTimeout(repoRefreshTimer);
        repoRefreshTimer = null;
      }
      return;
    }
    armRepoRefresh(repoId);
  }

  const unsubscribeEvents = options.bridge.onEvent((event, data) => {
    if (
      event === "reposChanged" &&
      options.history.kind === "comparison" &&
      options.repoId !== null
    ) {
      const { repos } = data as { repos?: Array<{ id: string }> };
      const repositoryStillExists =
        Array.isArray(repos) &&
        repos.some((repository) => repository.id === options.repoId);
      if (!repositoryStillExists) {
        invalidateRepoAsyncWork();
        inFlightOpCounts.delete(options.repoId);
        recomputeOperationInProgress();
        store.setState({
          ..._clearRepoBoundDisplay(),
          hasMore: false,
          loading: false,
          loadError: {
            kind: "repository-unavailable",
            message: "Repository is no longer in the workspace",
          },
        });
      } else if (
        store.getState().loadError?.kind === "repository-unavailable"
      ) {
        scheduleRepoRefresh(options.repoId);
      }
    }
    const refreshesComparison =
      event === "gitStateChanged" ||
      (event === "commitStateChanged" && options.history.kind === "comparison");
    if (refreshesComparison) {
      const { repoId } = data as { repoId?: string };
      if (repoId && repoId === visibleRepoId()) {
        scheduleRepoRefresh(repoId);
      }
    }
    if (
      event === "showFileHistory" &&
      options.history.kind === "ordinary" &&
      options.followGlobalActiveRepo
    ) {
      const { file } = data as { file: string };
      store.getState().setFilter({ file });
    }
    if (event === "operationStart") {
      const { repoId } = data as { repoId?: string | null };
      if (typeof repoId === "string") incrementInFlight(repoId);
    }
    if (event === "operationEnd") {
      const { repoId } = data as { repoId?: string | null };
      if (typeof repoId === "string") {
        decrementInFlight(repoId);
      } else {
        inFlightOpCounts.clear();
        recomputeOperationInProgress();
      }
    }
  });

  const unsubscribeActiveRepo = options.followGlobalActiveRepo
    ? useRepoStore.subscribe((state, prevState) => {
        if (state.activeRepoId !== prevState.activeRepoId) {
          recomputeOperationInProgress();
        }
      })
    : null;
  const unsubscribeOperationProgressGroup =
    options.operationProgressGroup?.subscribe(recomputeOperationInProgress) ??
    null;

  return {
    store,
    beginClientOperation(repoId) {
      if (typeof repoId === "string") beginClientOperationProgress(repoId);
    },
    endClientOperation(repoId) {
      if (typeof repoId === "string") endClientOperationProgress(repoId);
    },
    resetOperationProgressForTests() {
      inFlightOpCounts.clear();
      recomputeOperationInProgress();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      invalidateRepoAsyncWork();
      unsubscribeEvents();
      unsubscribeActiveRepo?.();
      unsubscribeOperationProgressGroup?.();
    },
  };
}

export const defaultGitLogStore = createGitLogStore({
  repoId: null,
  history: { kind: "ordinary" },
  followGlobalActiveRepo: true,
  showCurrentReachability: true,
  bridge,
});

/** Reset default-panel progress tracking (test-only). */
export function _resetOperationProgressForTests(): void {
  defaultGitLogStore.resetOperationProgressForTests();
}

/** Mark an ordinary-panel client operation as in flight. */
export function _beginClientOperation(repoId: string | null): void {
  defaultGitLogStore.beginClientOperation(repoId);
}

/** Clear an ordinary-panel client operation marker. */
export function _endClientOperation(repoId: string | null): void {
  defaultGitLogStore.endClientOperation(repoId);
}
