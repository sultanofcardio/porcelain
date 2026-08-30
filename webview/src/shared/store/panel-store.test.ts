import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bridge, LogQueryRevision } from "../bridge/types";
import type { Commit, GitRefIdentity } from "../types/git";

// Capture the event handler registered by panel-store at import time so the
// test can dispatch events into it. panel-store calls bridge.onEvent(cb) once
// at module load.
let panelEventHandler: ((event: string, data: unknown) => void) | null = null;

vi.mock("../bridge", () => ({
  bridge: {
    request: vi.fn().mockResolvedValue({ commits: [], lanes: {} }),
    onEvent: vi.fn((cb: (event: string, data: unknown) => void) => {
      panelEventHandler = cb;
      return () => {};
    }),
    setRepoContext: vi.fn(),
  },
}));

// Import after the mock is installed so the module-load onEvent call is captured.
const {
  createGitLogStore,
  createRepoOperationProgressGroup,
  defaultGitLogStore,
  _resetOperationProgressForTests,
  _beginClientOperation,
  _endClientOperation,
} = await import("./panel-store");
const usePanelStore = defaultGitLogStore.store;
const { useRepoStore } = await import("./repo-store");
const { bridge } = await import("../bridge");

afterEach(() => {
  vi.useRealTimers();
});

function emit(event: string, data: unknown): void {
  if (!panelEventHandler) {
    throw new Error("panel event handler was never registered");
  }
  panelEventHandler(event, data);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function commit(hash: string): Commit {
  return {
    hash,
    shortHash: hash.slice(0, 8),
    parents: [],
    authorName: "author",
    authorEmail: "author@example.com",
    authorDate: "2026-07-17T00:00:00.000Z",
    subject: hash,
    body: "",
    refs: [],
  };
}

function graphResult(commits: Commit[]) {
  return {
    graphData: { commits, lanes: {} },
    snapshot: { activeLanes: [], laneColors: [], nextColorIndex: 0 },
  };
}

function createFakeBridge(
  request: Bridge["request"] = vi.fn().mockResolvedValue([]),
) {
  const handlers = new Set<(event: string, data: unknown) => void>();
  const unsubscribe = vi.fn();
  const fakeBridge: Bridge = {
    request,
    onEvent: vi.fn((handler) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
        unsubscribe();
      };
    }),
    setRepoContext: vi.fn(),
  };
  return { bridge: fakeBridge, handlers, unsubscribe };
}

function comparisonHistory(revision: LogQueryRevision) {
  return { kind: "comparison" as const, revision };
}

describe("git log store instances", () => {
  it("exposes an instance-bound action facade for fixed and ordinary surfaces", async () => {
    vi.useFakeTimers();
    const fixedRequest = vi.fn().mockResolvedValue(undefined);
    const fixed = createGitLogStore({
      repoId: "repo-fixed",
      history: comparisonHistory({
        kind: "ref",
        ref: { type: "local", name: "main", fullRef: "refs/heads/main" },
      }),
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      bridge: createFakeBridge(fixedRequest).bridge,
    });

    expect(fixed.store.getState().actionRepoId()).toBe("repo-fixed");
    expect(fixed.store.getState().actionRefreshScope).toBe("comparison");
    await fixed.store.getState().requestFromSurface("openFile", {
      filePath: "src/a.ts",
    });
    expect(fixedRequest).toHaveBeenCalledWith(
      "openFile",
      { filePath: "src/a.ts" },
      { repoId: "repo-fixed" },
    );

    fixedRequest.mockClear();
    await fixed.store
      .getState()
      .requestFromSurface(
        "openFile",
        { filePath: "src/conflict.ts" },
        { repoId: "repo-conflict" },
      );
    expect(fixedRequest).toHaveBeenCalledWith(
      "openFile",
      { filePath: "src/conflict.ts" },
      { repoId: "repo-fixed" },
    );

    const ordinaryRequest = vi.fn().mockResolvedValue(undefined);
    const ordinary = createGitLogStore({
      repoId: null,
      history: { kind: "ordinary" },
      followGlobalActiveRepo: true,
      showCurrentReachability: true,
      bridge: createFakeBridge(ordinaryRequest).bridge,
    });
    useRepoStore.setState({ activeRepoId: "repo-active" });
    expect(ordinary.store.getState().actionRepoId()).toBe("repo-active");
    expect(ordinary.store.getState().actionRefreshScope).toBe("surface");
    await ordinary.store.getState().requestFromSurface("openFile", {
      filePath: "src/b.ts",
    });
    expect(ordinaryRequest).toHaveBeenCalledWith(
      "openFile",
      { filePath: "src/b.ts" },
      { repoId: "repo-active" },
    );

    useRepoStore.setState({ activeRepoId: "repo-b" });
    ordinaryRequest.mockClear();
    await ordinary.store
      .getState()
      .requestFromSurface(
        "checkoutBranch",
        { branchName: "feature" },
        { repoId: "repo-a" },
      );
    expect(ordinaryRequest).toHaveBeenCalledWith(
      "checkoutBranch",
      { branchName: "feature" },
      { repoId: "repo-a" },
    );

    ordinaryRequest.mockClear();
    const operation = ordinary.store
      .getState()
      .requestWithProgressFromSurface(
        "updateBranch",
        { branchName: "feature" },
        { repoId: "repo-a" },
      );
    expect(ordinaryRequest).toHaveBeenCalledWith(
      "updateBranch",
      { branchName: "feature" },
      { repoId: "repo-a" },
    );
    expect(ordinary.store.getState().operationInProgress).toBe(false);
    useRepoStore.setState({ activeRepoId: "repo-a" });
    expect(ordinary.store.getState().operationInProgress).toBe(true);
    await vi.runAllTimersAsync();
    await operation;
    expect(ordinary.store.getState().operationInProgress).toBe(false);

    useRepoStore.setState({ activeRepoId: "repo-active" });
    ordinaryRequest.mockClear();
    await ordinary.store.getState().openDiffEditor("commit-a", {
      status: "M",
      oldPath: "src/a.ts",
      newPath: "src/a.ts",
    });
    expect(ordinaryRequest).toHaveBeenCalledWith(
      "openDiffEditor",
      expect.objectContaining({ commit: "commit-a", filePath: "src/a.ts" }),
      { repoId: "repo-active" },
    );

    fixed.dispose();
    ordinary.dispose();
  });

  it("attributes action progress to the owning fixed surface", async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockResolvedValue(undefined);
    const instance = createGitLogStore({
      repoId: "repo-fixed",
      history: { kind: "ordinary" },
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      bridge: createFakeBridge(request).bridge,
    });

    const operation = instance.store
      .getState()
      .requestWithProgressFromSurface("cherryPick", { hash: "abc" });
    expect(instance.store.getState().operationInProgress).toBe(true);
    expect(request).toHaveBeenCalledWith(
      "cherryPick",
      { hash: "abc" },
      { repoId: "repo-fixed" },
    );

    await vi.runAllTimersAsync();
    await operation;
    expect(instance.store.getState().operationInProgress).toBe(false);

    instance.dispose();
    vi.useRealTimers();
  });

  it("keeps global surface requests unbound from repositories", async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockResolvedValue(undefined);
    const instance = createGitLogStore({
      repoId: null,
      history: { kind: "ordinary" },
      followGlobalActiveRepo: true,
      showCurrentReachability: true,
      bridge: createFakeBridge(request).bridge,
    });
    useRepoStore.setState({ activeRepoId: "repo-active" });

    await instance.store
      .getState()
      .requestFromSurface(
        "showInfoNotification",
        { message: "ready" },
        { scope: "global", repoId: "repo-conflict" },
      );
    expect(request).toHaveBeenLastCalledWith(
      "showInfoNotification",
      { message: "ready" },
      { scope: "global" },
    );

    const operation = instance.store
      .getState()
      .requestWithProgressFromSurface(
        "showInfoNotification",
        { message: "working" },
        { scope: "global", repoId: "repo-conflict" },
      );
    expect(instance.store.getState().operationInProgress).toBe(false);
    expect(request).toHaveBeenLastCalledWith(
      "showInfoNotification",
      { message: "working" },
      { scope: "global" },
    );
    await vi.runAllTimersAsync();
    await operation;

    instance.dispose();
  });

  it("keeps mutations and async graph results isolated", async () => {
    const topRange: LogQueryRevision = {
      kind: "ref",
      ref: { type: "local", name: "top", fullRef: "refs/heads/top" },
    };
    const bottomRange: LogQueryRevision = {
      kind: "ref",
      ref: {
        type: "local",
        name: "bottom",
        fullRef: "refs/heads/bottom",
      },
    };
    const { bridge: fakeBridge } = createFakeBridge(
      vi.fn(async (command, params) => {
        if (command === "getGraphData") {
          const revision = (params as { revision?: LogQueryRevision }).revision;
          return graphResult([
            commit(revision === topRange ? "top-result" : "bottom-result"),
          ]);
        }
        if (command === "getBranches" || command === "getTags") return [];
        if (command === "getCommitRangeFiles") return [];
        return null;
      }),
    );
    const top = createGitLogStore({
      repoId: "repo-a",
      history: comparisonHistory(topRange),
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      bridge: fakeBridge,
    });
    const bottom = createGitLogStore({
      repoId: "repo-a",
      history: comparisonHistory(bottomRange),
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      bridge: fakeBridge,
    });

    top.store.getState().setFilter({ searchQuery: "top" });
    expect(bottom.store.getState().filter.searchQuery).toBe("");
    void top.store.getState().selectCommit("a", "single", ["a"]);
    expect(bottom.store.getState().selectedCommitHashes).toEqual([]);

    await Promise.all([
      top.store.getState().fetchInitialData(),
      bottom.store.getState().fetchInitialData(),
    ]);

    expect(top.store.getState().commits.map(({ hash }) => hash)).toEqual([
      "top-result",
    ]);
    expect(bottom.store.getState().commits.map(({ hash }) => hash)).toEqual([
      "bottom-result",
    ]);
    top.dispose();
    bottom.dispose();
  });

  it("preserves valid selection and inspector state while pruning removed hashes on explicit refresh", async () => {
    let refreshedCommits = [commit("a"), commit("b")];
    const refreshedFiles = [
      {
        status: "modified" as const,
        oldPath: "src/keep.ts",
        newPath: "src/keep.ts",
        isBinary: false,
      },
    ];
    const request = vi.fn(async (command: string) => {
      if (command === "getGraphData") return graphResult(refreshedCommits);
      if (command === "getBranches" || command === "getTags") return [];
      if (command === "getCommitRangeFiles") return refreshedFiles;
      return null;
    });
    const instance = createGitLogStore({
      repoId: "repo-a",
      history: comparisonHistory({
        kind: "ref",
        ref: { type: "local", name: "feature", fullRef: "refs/heads/feature" },
      }),
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      bridge: createFakeBridge(request).bridge,
    });
    instance.store.setState({
      commits: [commit("a"), commit("b"), commit("c")],
      visibleCommits: [commit("a"), commit("b"), commit("c")],
      selectedCommitHash: "c",
      selectedCommitHashes: ["b", "c"],
      lastSelectedCommitHash: "b",
      commitFiles: refreshedFiles,
      selectedFilePath: "src/keep.ts",
      rangeOldest: "c",
      rangeNewest: "b",
    });

    await instance.store.getState().refresh({ preserveSelection: true });

    expect(instance.store.getState()).toMatchObject({
      selectedCommitHash: "b",
      selectedCommitHashes: ["b"],
      lastSelectedCommitHash: "b",
      selectedFilePath: "src/keep.ts",
      rangeOldest: "b",
      rangeNewest: "b",
    });
    expect(instance.store.getState().commitFiles).toEqual(refreshedFiles);

    refreshedCommits = [commit("a")];
    await instance.store.getState().refresh({ preserveSelection: true });
    expect(instance.store.getState()).toMatchObject({
      selectedCommitHash: null,
      selectedCommitHashes: [],
      lastSelectedCommitHash: null,
      commitFiles: [],
      selectedFilePath: null,
      rangeOldest: null,
      rangeNewest: null,
    });
    instance.dispose();
  });

  it("widens preserve-selection refreshes to the loaded depth and uses that batch for hasMore", async () => {
    let repositoryCommits = Array.from({ length: 250 }, (_, index) =>
      commit(`commit-${index}`),
    );
    const graphBatchSizes: number[] = [];
    const request = vi.fn(async (command: string, params?: unknown) => {
      const query = (params ?? {}) as {
        maxCount?: number;
        skip?: number;
        count?: number;
      };
      if (command === "getGraphData") {
        const batchSize = query.maxCount ?? 200;
        graphBatchSizes.push(batchSize);
        return graphResult(repositoryCommits.slice(0, batchSize));
      }
      if (command === "loadMoreLog") {
        const skip = query.skip ?? 0;
        const count = query.count ?? 200;
        return graphResult(repositoryCommits.slice(skip, skip + count));
      }
      if (
        command === "getBranches" ||
        command === "getTags" ||
        command === "getCommitRangeFiles"
      ) {
        return [];
      }
      return null;
    });
    const fake = createFakeBridge(request);
    const instance = createGitLogStore({
      repoId: "repo-a",
      history: comparisonHistory({
        kind: "ref",
        ref: { type: "local", name: "feature", fullRef: "refs/heads/feature" },
      }),
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      bridge: fake.bridge,
    });

    await instance.store.getState().fetchInitialData();
    expect(graphBatchSizes).toEqual([200]);
    await instance.store.getState().loadMore();
    expect(instance.store.getState().commits).toHaveLength(250);
    await instance.store.getState().selectCommit("commit-240");

    repositoryCommits = repositoryCommits.slice(0, 249);
    await instance.store.getState().refresh({ preserveSelection: true });
    expect(graphBatchSizes.at(-1)).toBe(250);
    expect(instance.store.getState().selectedCommitHash).toBe("commit-240");
    expect(instance.store.getState().hasMore).toBe(false);

    const watcherRequestCount = graphBatchSizes.length;
    for (const handler of fake.handlers) {
      handler("gitStateChanged", { repoId: "repo-a" });
    }
    await vi.waitFor(() =>
      expect(graphBatchSizes.length).toBeGreaterThan(watcherRequestCount),
    );
    await vi.waitFor(
      () => expect(instance.store.getState().loading).toBe(false),
      { timeout: 2_000 },
    );
    expect(instance.store.getState().selectedCommitHash).toBe("commit-240");

    repositoryCommits = repositoryCommits.filter(
      ({ hash }) => hash !== "commit-240",
    );
    await instance.store.getState().refresh({ preserveSelection: true });
    expect(instance.store.getState()).toMatchObject({
      selectedCommitHash: null,
      selectedCommitHashes: [],
      commitFiles: [],
      selectedFilePath: null,
    });
    instance.dispose();
  });

  it("rejects a stale graph response after a newer filter intent", async () => {
    const older = deferred<ReturnType<typeof graphResult>>();
    const newer = deferred<ReturnType<typeof graphResult>>();
    const { bridge: fakeBridge } = createFakeBridge(
      vi.fn(async (command, params) => {
        if (command === "getGraphData") {
          return (params as { branch?: string }).branch === "branch-a"
            ? older.promise
            : newer.promise;
        }
        if (command === "getBranches" || command === "getTags") return [];
        if (command === "getCommitRangeFiles") return [];
        return null;
      }),
    );
    const instance = createGitLogStore({
      repoId: "repo-a",
      history: { kind: "ordinary" },
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      bridge: fakeBridge,
    });

    instance.store.setState((state) => ({
      filter: { ...state.filter, branch: "branch-a" },
    }));
    const first = instance.store.getState().fetchInitialData();
    instance.store.setState((state) => ({
      filter: { ...state.filter, branch: "branch-b" },
    }));
    const second = instance.store.getState().fetchInitialData();

    newer.resolve(graphResult([commit("branch-b-tip")]));
    await vi.waitFor(() => {
      expect(instance.store.getState().commits[0]?.hash).toBe("branch-b-tip");
    });
    older.resolve(graphResult([commit("branch-a-tip")]));
    await Promise.all([first, second]);

    expect(instance.store.getState().filter.branch).toBe("branch-b");
    expect(instance.store.getState().commits.map(({ hash }) => hash)).toEqual([
      "branch-b-tip",
    ]);
    instance.dispose();
  });

  it("does not overwrite a user selection made while a graph refresh is pending", async () => {
    vi.useFakeTimers();
    const pendingGraph = deferred<ReturnType<typeof graphResult>>();
    const request = vi.fn(async (command: string) => {
      if (command === "getGraphData") return pendingGraph.promise;
      if (
        command === "getBranches" ||
        command === "getTags" ||
        command === "getCommitRangeFiles"
      ) {
        return [];
      }
      return null;
    });
    const instance = createGitLogStore({
      repoId: "repo-a",
      history: { kind: "ordinary" },
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      bridge: createFakeBridge(request).bridge,
    });
    const first = commit("first");
    const chosen = commit("chosen-during-refresh");
    instance.store.setState({
      commits: [first, chosen],
      visibleCommits: [first, chosen],
      selectedCommitHash: "first",
      selectedCommitHashes: ["first"],
      lastSelectedCommitHash: "first",
    });

    try {
      const refresh = instance.store.getState().fetchInitialData();
      await instance.store.getState().selectCommit(chosen.hash);
      pendingGraph.resolve(graphResult([first, chosen]));
      await vi.runAllTimersAsync();
      await refresh;

      expect(instance.store.getState().selectedCommitHash).toBe(chosen.hash);
      expect(instance.store.getState().selectedCommitHashes).toEqual([
        chosen.hash,
      ]);
    } finally {
      instance.dispose();
      vi.useRealTimers();
    }
  });

  it("coalesces matching comparison events and ignores unscoped or other-repo events", async () => {
    vi.useFakeTimers();
    const graphRequest = vi.fn();
    const request = vi.fn(async (command: string) => {
      if (command === "getGraphData") {
        graphRequest();
        return graphResult([commit("tip")]);
      }
      if (
        command === "getBranches" ||
        command === "getTags" ||
        command === "getCommitRangeFiles"
      ) {
        return [];
      }
      return null;
    });
    const fake = createFakeBridge(request);
    const instance = createGitLogStore({
      repoId: "repo-a",
      history: comparisonHistory({
        kind: "ref",
        ref: { type: "local", name: "feature", fullRef: "refs/heads/feature" },
      }),
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      bridge: fake.bridge,
    });

    try {
      for (const handler of fake.handlers) {
        handler("gitStateChanged", { scope: "all" });
        handler("gitStateChanged", { scope: "branches", repoId: "repo-b" });
        handler("gitStateChanged", { scope: "all", repoId: "repo-a" });
        handler("gitStateChanged", { scope: "log", repoId: "repo-a" });
        handler("commitStateChanged", { repoId: "repo-a" });
      }

      expect(graphRequest).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100);
      expect(graphRequest).toHaveBeenCalledTimes(1);
    } finally {
      instance.dispose();
      vi.useRealTimers();
    }
  });

  it("clears a fixed comparison when its repository leaves the workspace", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async (command: string) => {
      if (command === "getGraphData") return graphResult([commit("recovered")]);
      if (
        command === "getBranches" ||
        command === "getTags" ||
        command === "getCommitRangeFiles"
      ) {
        return [];
      }
      return null;
    });
    const fake = createFakeBridge(request);
    const instance = createGitLogStore({
      repoId: "repo-a",
      history: comparisonHistory({
        kind: "ref",
        ref: { type: "local", name: "feature", fullRef: "refs/heads/feature" },
      }),
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      bridge: fake.bridge,
    });
    instance.store.setState({
      commits: [commit("stale")],
      visibleCommits: [commit("stale")],
      selectedCommitHash: "stale",
      selectedCommitHashes: ["stale"],
    });

    try {
      for (const handler of fake.handlers) {
        handler("reposChanged", {
          repos: [{ id: "repo-b", name: "B", rootPath: "/b" }],
          activeId: "repo-b",
        });
      }
      expect(instance.store.getState()).toMatchObject({
        commits: [],
        selectedCommitHash: null,
        selectedCommitHashes: [],
        loadError: {
          kind: "repository-unavailable",
          message: "Repository is no longer in the workspace",
        },
      });
      expect(request).not.toHaveBeenCalled();

      for (const handler of fake.handlers) {
        handler("reposChanged", {
          repos: [
            { id: "repo-a", name: "A", rootPath: "/a" },
            { id: "repo-b", name: "B", rootPath: "/b" },
          ],
          activeId: "repo-b",
        });
      }
      await vi.advanceTimersByTimeAsync(100);
      expect(request).toHaveBeenCalledWith(
        "getGraphData",
        expect.anything(),
        expect.objectContaining({ repoId: "repo-a" }),
      );
    } finally {
      instance.dispose();
      vi.useRealTimers();
    }
  });

  it("defers operation events and lets an explicit comparison refresh consume them", async () => {
    vi.useFakeTimers();
    const mutation = deferred<unknown>();
    const graphRequest = vi.fn();
    const request = vi.fn(async (command: string) => {
      if (command === "cherryPick") return mutation.promise;
      if (command === "getGraphData") {
        graphRequest();
        return graphResult([commit("tip")]);
      }
      if (
        command === "getBranches" ||
        command === "getTags" ||
        command === "getCommitRangeFiles"
      ) {
        return [];
      }
      return null;
    });
    const fake = createFakeBridge(request);
    const instance = createGitLogStore({
      repoId: "repo-a",
      history: comparisonHistory({
        kind: "ref",
        ref: { type: "local", name: "feature", fullRef: "refs/heads/feature" },
      }),
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      bridge: fake.bridge,
    });

    try {
      const operation = instance.store
        .getState()
        .requestWithProgressFromSurface("cherryPick", { hash: "tip" });
      for (const handler of fake.handlers) {
        handler("operationStart", { repoId: "repo-a" });
        handler("gitStateChanged", { scope: "all", repoId: "repo-a" });
        handler("commitStateChanged", { repoId: "repo-a" });
        handler("operationEnd", { repoId: "repo-a" });
      }
      mutation.resolve({ success: true });

      await vi.advanceTimersByTimeAsync(1_000);
      await operation;
      expect(graphRequest).not.toHaveBeenCalled();

      const explicitRefresh = instance.store
        .getState()
        .refresh({ preserveSelection: true });
      await vi.runAllTimersAsync();
      await explicitRefresh;
      expect(graphRequest).toHaveBeenCalledTimes(1);
    } finally {
      instance.dispose();
      vi.useRealTimers();
    }
  });

  it("holds both comparison stores behind one client-operation barrier", async () => {
    vi.useFakeTimers();
    const mutation = deferred<unknown>();
    const graphRequests = { top: vi.fn(), bottom: vi.fn() };
    const request = vi.fn(
      async (command: string, params?: Record<string, unknown>) => {
        if (command === "cherryPick") return mutation.promise;
        if (command === "getGraphData") {
          const revision = params?.revision as
            | { includeRef?: GitRefIdentity }
            | undefined;
          const side =
            revision?.includeRef?.fullRef === "refs/heads/feature"
              ? "top"
              : "bottom";
          graphRequests[side]();
          return graphResult([commit(`${side}-tip`)]);
        }
        if (
          command === "getBranches" ||
          command === "getTags" ||
          command === "getCommitRangeFiles"
        ) {
          return [];
        }
        return null;
      },
    );
    const fake = createFakeBridge(request);
    const operationProgressGroup = createRepoOperationProgressGroup();
    const top = createGitLogStore({
      repoId: "repo-a",
      history: comparisonHistory({
        kind: "range",
        excludeRef: {
          type: "local",
          name: "main",
          fullRef: "refs/heads/main",
        },
        includeRef: {
          type: "local",
          name: "feature",
          fullRef: "refs/heads/feature",
        },
      }),
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      operationProgressGroup,
      bridge: fake.bridge,
    });
    const bottom = createGitLogStore({
      repoId: "repo-a",
      history: comparisonHistory({
        kind: "range",
        excludeRef: {
          type: "local",
          name: "feature",
          fullRef: "refs/heads/feature",
        },
        includeRef: {
          type: "local",
          name: "main",
          fullRef: "refs/heads/main",
        },
      }),
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      operationProgressGroup,
      bridge: fake.bridge,
    });

    try {
      const operation = top.store
        .getState()
        .requestWithProgressFromSurface("cherryPick", { hash: "top-tip" });
      for (const handler of fake.handlers) {
        handler("operationStart", { repoId: "repo-a" });
        handler("gitStateChanged", { scope: "all", repoId: "repo-a" });
        handler("operationEnd", { repoId: "repo-a" });
      }
      mutation.resolve({ success: true });

      await vi.advanceTimersByTimeAsync(1_000);
      await operation;
      expect(graphRequests.top).not.toHaveBeenCalled();
      expect(graphRequests.bottom).not.toHaveBeenCalled();

      const refreshBoth = Promise.all([
        top.store.getState().refresh({ preserveSelection: true }),
        bottom.store.getState().refresh({ preserveSelection: true }),
      ]);
      await vi.runAllTimersAsync();
      await refreshBoth;
      expect(graphRequests.top).toHaveBeenCalledTimes(1);
      expect(graphRequests.bottom).toHaveBeenCalledTimes(1);
    } finally {
      top.dispose();
      bottom.dispose();
      vi.useRealTimers();
    }
  });

  it("releases its event subscription exactly once when disposed", () => {
    const fake = createFakeBridge();
    const instance = createGitLogStore({
      repoId: "repo-a",
      history: { kind: "ordinary" },
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      bridge: fake.bridge,
    });

    expect(fake.handlers.size).toBe(1);
    instance.dispose();
    instance.dispose();

    expect(fake.handlers.size).toBe(0);
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("uses tagged query hasMore and exposes an unavailable revision", async () => {
    const revisionRef: GitRefIdentity = {
      type: "local",
      name: "feature",
      fullRef: "refs/heads/feature",
    };
    let unavailable = false;
    const { bridge: fakeBridge } = createFakeBridge(
      vi.fn(async (command) => {
        if (command === "getGraphData") {
          return unavailable
            ? { status: "ref-unavailable", ref: revisionRef }
            : {
                status: "ok",
                ...graphResult([commit("feature-tip")]),
                hasMore: true,
              };
        }
        if (command === "getBranches" || command === "getTags") return [];
        if (command === "getCommitRangeFiles") return [];
        return null;
      }),
    );
    const instance = createGitLogStore({
      repoId: "repo-a",
      history: comparisonHistory({ kind: "ref", ref: revisionRef }),
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      bridge: fakeBridge,
    });

    await instance.store.getState().fetchInitialData();
    expect(instance.store.getState().hasMore).toBe(true);
    expect(instance.store.getState().unavailableRef).toBeNull();

    unavailable = true;
    await instance.store.getState().refresh();

    expect(instance.store.getState().unavailableRef).toEqual(revisionRef);
    expect(instance.store.getState().commits).toEqual([]);
    expect(instance.store.getState().hasMore).toBe(false);
    instance.dispose();
  });

  it("tags repository removal separately from generic load failures and clears errors on recovery", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let error: unknown = {
      code: "REPO_NOT_FOUND",
      message: "Repository was removed",
    };
    const { bridge: fakeBridge } = createFakeBridge(
      vi.fn(async (command) => {
        if (command === "getGraphData" && error) throw error;
        if (command === "getGraphData") return graphResult([commit("tip")]);
        if (command === "getBranches" || command === "getTags") return [];
        if (command === "getCommitRangeFiles") return [];
        return null;
      }),
    );
    const instance = createGitLogStore({
      repoId: "repo-a",
      history: { kind: "ordinary" },
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      bridge: fakeBridge,
    });

    await instance.store.getState().fetchInitialData();
    expect(instance.store.getState().loadError).toEqual({
      kind: "repository-unavailable",
      message: "Repository was removed",
    });

    error = Object.assign(new Error("Git process failed"), {
      code: "GIT_FAILED",
    });
    await instance.store.getState().refresh();
    expect(instance.store.getState().loadError).toEqual({
      kind: "generic",
      message: "Git process failed",
    });

    error = null;
    await instance.store.getState().refresh();
    expect(instance.store.getState().loadError).toBeNull();
    expect(instance.store.getState().commits[0]?.hash).toBe("tip");
    instance.dispose();
    expect(consoleError).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it("ignores global file-history events in a fixed ordinary store", () => {
    const fake = createFakeBridge();
    const instance = createGitLogStore({
      repoId: "repo-a",
      history: { kind: "ordinary" },
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      bridge: fake.bridge,
    });

    for (const handler of fake.handlers) {
      handler("showFileHistory", { file: "src/a.ts" });
    }
    const fileFilter = instance.store.getState().filter.file;
    const requestCount = vi.mocked(fake.bridge.request).mock.calls.length;
    instance.dispose();

    expect(fileFilter).toBe("");
    expect(requestCount).toBe(0);
  });
});

describe("panel-store host-backed filters", () => {
  it("clears stale selection, range, and file detail state before a host filter refresh", () => {
    const graphRequest = deferred<ReturnType<typeof graphResult>>();
    const request = vi.fn(async (command: string) => {
      if (command === "getBranches" || command === "getTags") return [];
      if (command === "getGraphData") return graphRequest.promise;
      return null;
    });
    const { bridge: fakeBridge } = createFakeBridge(request);
    const instance = createGitLogStore({
      repoId: "repo-a",
      history: { kind: "ordinary" },
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      bridge: fakeBridge,
    });
    const staleCommit = commit("stale");
    instance.store.setState({
      commits: [staleCommit],
      visibleCommits: [staleCommit],
      selectedCommitHash: staleCommit.hash,
      selectedCommitHashes: [staleCommit.hash],
      lastSelectedCommitHash: staleCommit.hash,
      rangeOldest: staleCommit.hash,
      rangeNewest: staleCommit.hash,
      commitFiles: [{ newPath: "stale.ts" } as never],
      selectedFilePath: "stale.ts",
    });

    instance.store.getState().setFilter({ author: "Ada" });

    expect(instance.store.getState()).toMatchObject({
      selectedCommitHash: null,
      selectedCommitHashes: [],
      lastSelectedCommitHash: null,
      rangeOldest: null,
      rangeNewest: null,
      commitFiles: [],
      selectedFilePath: null,
    });
    instance.dispose();
  });

  it("sends search, author, date, and file filters to the host query", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async (command: string) => {
      if (command === "getBranches" || command === "getTags") return [];
      if (command === "getGraphData") return graphResult([]);
      if (command === "getCommitRangeFiles") return [];
      return null;
    });
    const { bridge: fakeBridge } = createFakeBridge(request);
    const instance = createGitLogStore({
      repoId: "repo-a",
      history: { kind: "ordinary" },
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      bridge: fakeBridge,
    });

    try {
      instance.store.getState().setFilter({
        searchQuery: "fix race",
        author: "Ada",
        dateRange: "7days",
        file: "src/app.ts",
      });
      await vi.advanceTimersByTimeAsync(200);

      expect(request).toHaveBeenCalledWith(
        "getGraphData",
        expect.objectContaining({
          maxCount: 200,
          search: "fix race",
          author: "Ada",
          since: expect.any(String),
          until: expect.any(String),
          file: "src/app.ts",
        }),
        expect.objectContaining({ repoId: "repo-a" }),
      );
    } finally {
      instance.dispose();
      vi.useRealTimers();
    }
  });

  it("sends the search-mode toggles with an active search only", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async (command: string) => {
      if (command === "getBranches" || command === "getTags") return [];
      if (command === "getGraphData") return graphResult([]);
      if (command === "getCommitRangeFiles") return [];
      return null;
    });
    const { bridge: fakeBridge } = createFakeBridge(request);
    const instance = createGitLogStore({
      repoId: "repo-a",
      history: { kind: "ordinary" },
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      bridge: fakeBridge,
    });

    try {
      // Toggling a mode with no search text arms the toggle without a refetch.
      instance.store.getState().setFilter({ searchRegex: true });
      await vi.advanceTimersByTimeAsync(200);
      expect(request).not.toHaveBeenCalledWith(
        "getGraphData",
        expect.anything(),
        expect.anything(),
      );
      expect(instance.store.getState().filter.searchRegex).toBe(true);

      instance.store.getState().setFilter({
        searchQuery: "f.x",
        searchCaseSensitive: true,
      });
      await vi.advanceTimersByTimeAsync(200);
      expect(request).toHaveBeenCalledWith(
        "getGraphData",
        expect.objectContaining({
          search: "f.x",
          searchRegex: true,
          searchCaseSensitive: true,
        }),
        expect.objectContaining({ repoId: "repo-a" }),
      );

      // Flipping a mode while a search is active refetches with the new mode.
      request.mockClear();
      instance.store.getState().setFilter({ searchRegex: false });
      await vi.advanceTimersByTimeAsync(200);
      expect(request).toHaveBeenCalledWith(
        "getGraphData",
        expect.objectContaining({ search: "f.x", searchRegex: false }),
        expect.objectContaining({ repoId: "repo-a" }),
      );
    } finally {
      instance.dispose();
      vi.useRealTimers();
    }
  });

  it("sends a custom date range as inclusive since/until bounds", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async (command: string) => {
      if (command === "getBranches" || command === "getTags") return [];
      if (command === "getGraphData") return graphResult([]);
      if (command === "getCommitRangeFiles") return [];
      return null;
    });
    const { bridge: fakeBridge } = createFakeBridge(request);
    const instance = createGitLogStore({
      repoId: "repo-a",
      history: { kind: "ordinary" },
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      bridge: fakeBridge,
    });

    try {
      instance.store.getState().setFilter({
        dateRange: "custom",
        dateAfter: "2026-01-05",
        dateBefore: "2026-01-10",
      });
      await vi.advanceTimersByTimeAsync(200);

      const call = request.mock.calls.find((c) => c[0] === "getGraphData");
      expect(call).toBeDefined();
      const params = call?.[1] as { since: string; until: string };
      expect(new Date(params.since).getTime()).toBe(
        new Date("2026-01-05T00:00:00").getTime(),
      );
      expect(new Date(params.until).getTime()).toBe(
        new Date("2026-01-10T23:59:59.999").getTime(),
      );
    } finally {
      instance.dispose();
      vi.useRealTimers();
    }
  });

  it("discards a delayed earlier search response", async () => {
    vi.useFakeTimers();
    const older = deferred<ReturnType<typeof graphResult>>();
    const newer = deferred<ReturnType<typeof graphResult>>();
    const request = vi.fn(async (command: string, params?: unknown) => {
      if (command === "getBranches" || command === "getTags") return [];
      if (command === "getGraphData") {
        return (params as { search?: string }).search === "older"
          ? older.promise
          : newer.promise;
      }
      if (command === "getCommitRangeFiles") return [];
      return null;
    });
    const { bridge: fakeBridge } = createFakeBridge(request);
    const instance = createGitLogStore({
      repoId: "repo-a",
      history: { kind: "ordinary" },
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      bridge: fakeBridge,
    });

    try {
      instance.store.getState().setFilter({ searchQuery: "older" });
      await vi.advanceTimersByTimeAsync(200);
      expect(request).toHaveBeenCalledWith(
        "getGraphData",
        expect.objectContaining({ search: "older" }),
        expect.objectContaining({ repoId: "repo-a" }),
      );

      instance.store.getState().setFilter({ searchQuery: "newer" });
      await vi.advanceTimersByTimeAsync(200);
      expect(request).toHaveBeenCalledWith(
        "getGraphData",
        expect.objectContaining({ search: "newer" }),
        expect.objectContaining({ repoId: "repo-a" }),
      );

      newer.resolve(graphResult([commit("newer")]));
      await vi.advanceTimersByTimeAsync(0);
      older.resolve(graphResult([commit("older")]));
      await vi.advanceTimersByTimeAsync(1000);

      expect(
        instance.store.getState().commits.map((item) => item.hash),
      ).toEqual(["newer"]);
    } finally {
      instance.dispose();
      vi.useRealTimers();
    }
  });

  it("sends the checked-out full ref on reachability queries and pagination", async () => {
    const currentRef = {
      type: "local" as const,
      name: "main",
      fullRef: "refs/heads/main",
    };
    const graphRequests: Array<Record<string, unknown>> = [];
    const request = vi.fn(async (command: string, params?: unknown) => {
      if (command === "getBranches") {
        return [
          {
            ...currentRef,
            isRemote: false,
            isCurrent: true,
            isFavorite: false,
            ahead: 0,
            behind: 0,
            lastCommitHash: "tip",
          },
        ];
      }
      if (command === "getTags" || command === "getCommitRangeFiles") return [];
      if (command === "getGraphData" || command === "loadMoreLog") {
        graphRequests.push(params as Record<string, unknown>);
        return {
          status: "ok" as const,
          ...graphResult([
            commit(command === "getGraphData" ? "tip" : "older"),
          ]),
          hasMore: command === "getGraphData",
        };
      }
      return null;
    });
    const { bridge: fakeBridge } = createFakeBridge(request);
    const instance = createGitLogStore({
      repoId: "repo-a",
      history: { kind: "ordinary" },
      followGlobalActiveRepo: false,
      showCurrentReachability: true,
      bridge: fakeBridge,
    });

    await instance.store.getState().fetchInitialData();
    await instance.store.getState().loadMore();

    expect(graphRequests).toHaveLength(2);
    expect(graphRequests).toEqual(
      expect.arrayContaining([expect.objectContaining({ currentRef })]),
    );
    expect(graphRequests[1]).toEqual(expect.objectContaining({ currentRef }));
    instance.dispose();
  });
});

describe("panel-store operationInProgress per-repo filter", () => {
  beforeEach(() => {
    _resetOperationProgressForTests();
    usePanelStore.setState({ operationInProgress: false });
    useRepoStore.setState({ activeRepoId: null });
  });

  it("an operationStart on the active repo sets operationInProgress", () => {
    useRepoStore.setState({ activeRepoId: "A" });
    emit("operationStart", { repoId: "A" });
    expect(usePanelStore.getState().operationInProgress).toBe(true);
  });

  it("an operationStart on a different repo does NOT set operationInProgress", () => {
    useRepoStore.setState({ activeRepoId: "A" });
    emit("operationStart", { repoId: "B" });
    expect(usePanelStore.getState().operationInProgress).toBe(false);
  });

  it("operationEnd on the active repo's op clears operationInProgress", () => {
    useRepoStore.setState({ activeRepoId: "A" });
    emit("operationStart", { repoId: "A" });
    expect(usePanelStore.getState().operationInProgress).toBe(true);
    emit("operationEnd", { repoId: "A" });
    expect(usePanelStore.getState().operationInProgress).toBe(false);
  });

  it("operationEnd on a non-active repo does not flip a false state", () => {
    useRepoStore.setState({ activeRepoId: "A" });
    emit("operationStart", { repoId: "B" }); // active repo A unaffected
    expect(usePanelStore.getState().operationInProgress).toBe(false);
    emit("operationEnd", { repoId: "B" });
    expect(usePanelStore.getState().operationInProgress).toBe(false);
  });

  it("switching to a repo with an in-flight op re-derives busy=true (I1: order-independent)", () => {
    // Reproduce the REAL multi-store flow: repo-store's `activeRepoChanged`
    // bridge handler is registered LATER (in a useEffect) than panel-store's,
    // so on the event panel-store runs first and reads a STALE activeRepoId.
    // repo-store then updates activeRepoId AFTER. The fix makes panel-store
    // recompute on the activeRepoId STORE change, not on the bridge event, so
    // it is correct regardless of handler registration order.
    //
    // This test does NOT pre-set activeRepoId before the switch the way the
    // old test did. It drives the switch the way repo-store actually does:
    // setState({ activeRepoId }) — the bridge event is a red herring for the
    // recompute trigger.
    useRepoStore.setState({ activeRepoId: "A" });
    emit("operationStart", { repoId: "B" }); // B op starts while A visible
    expect(usePanelStore.getState().operationInProgress).toBe(false);
    // User switches to B. repo-store's handler (which would also run here) does
    // setState({ activeRepoId: "B" }) — with the subscribe-based fix this store
    // change triggers the recompute, surfacing B's in-flight op.
    useRepoStore.setState({ activeRepoId: "B" });
    expect(usePanelStore.getState().operationInProgress).toBe(true);
  });

  it("switching away from a busy repo clears busy when the new repo has no op (I1)", () => {
    useRepoStore.setState({ activeRepoId: "A" });
    emit("operationStart", { repoId: "A" });
    expect(usePanelStore.getState().operationInProgress).toBe(true);
    // Switch via the store change (not the bridge event) — see I1 test above.
    useRepoStore.setState({ activeRepoId: "B" });
    expect(usePanelStore.getState().operationInProgress).toBe(false);
  });

  it("ignores an operationStart with repoId:null (non-repo-bound op)", () => {
    useRepoStore.setState({ activeRepoId: "A" });
    emit("operationStart", { repoId: null });
    expect(usePanelStore.getState().operationInProgress).toBe(false);
  });

  it("tracks multiple concurrent in-flight ops across repos", () => {
    useRepoStore.setState({ activeRepoId: "A" });
    emit("operationStart", { repoId: "A" });
    emit("operationStart", { repoId: "B" });
    expect(usePanelStore.getState().operationInProgress).toBe(true); // A in flight
    emit("operationEnd", { repoId: "A" });
    expect(usePanelStore.getState().operationInProgress).toBe(false); // only B left
    // Switch via the store change (see I1 test) — B is still in flight.
    useRepoStore.setState({ activeRepoId: "B" });
    expect(usePanelStore.getState().operationInProgress).toBe(true); // B in flight
  });
});

describe("panel-store client-side operation markers (bridgeWithProgress)", () => {
  beforeEach(() => {
    _resetOperationProgressForTests();
    usePanelStore.setState({ operationInProgress: false });
    useRepoStore.setState({ activeRepoId: null });
  });

  it("_beginClientOperation on the active repo sets operationInProgress", () => {
    useRepoStore.setState({ activeRepoId: "A" });
    _beginClientOperation("A");
    expect(usePanelStore.getState().operationInProgress).toBe(true);
  });

  it("_beginClientOperation on a non-active repo does NOT set operationInProgress", () => {
    useRepoStore.setState({ activeRepoId: "A" });
    _beginClientOperation("B");
    expect(usePanelStore.getState().operationInProgress).toBe(false);
    // the marker is tracked, so switching to B re-derives busy (via the store
    // change — see I1 test)
    useRepoStore.setState({ activeRepoId: "B" });
    expect(usePanelStore.getState().operationInProgress).toBe(true);
  });

  it("_endClientOperation clears the active repo's op", () => {
    useRepoStore.setState({ activeRepoId: "A" });
    _beginClientOperation("A");
    expect(usePanelStore.getState().operationInProgress).toBe(true);
    _endClientOperation("A");
    expect(usePanelStore.getState().operationInProgress).toBe(false);
  });

  it("a null client op (no active repo) is a no-op", () => {
    useRepoStore.setState({ activeRepoId: null });
    _beginClientOperation(null);
    expect(usePanelStore.getState().operationInProgress).toBe(false);
    _endClientOperation(null);
    expect(usePanelStore.getState().operationInProgress).toBe(false);
  });

  it("host events and client markers compose for the same repo", () => {
    useRepoStore.setState({ activeRepoId: "A" });
    _beginClientOperation("A"); // client-side marker (e.g. createBranch)
    emit("operationStart", { repoId: "A" }); // host also tags (e.g. via fetch)
    expect(usePanelStore.getState().operationInProgress).toBe(true);
    _endClientOperation("A"); // client done, but host op still in flight
    expect(usePanelStore.getState().operationInProgress).toBe(true);
    emit("operationEnd", { repoId: "A" }); // now fully clear
    expect(usePanelStore.getState().operationInProgress).toBe(false);
  });
});

describe("panel-store resetForRepoSwitch", () => {
  beforeEach(() => {
    usePanelStore.setState({
      filter: {
        searchQuery: "",
        branch: "",
        author: "",
        dateRange: "",
        file: "",
      },
      commits: [],
      branches: [],
      tags: [],
      collapsedSequenceIds: new Set(),
      collapsedIntermediates: new Map(),
      pendingSelectionFromFilter: [],
    });
  });

  it("clears repo-scoped branch/file but preserves carryover search/author/date", () => {
    usePanelStore.setState({
      filter: {
        searchQuery: "fix",
        branch: "feature",
        author: "alice",
        dateRange: "7days",
        file: "src/a.ts",
      },
    });
    usePanelStore.getState().resetForRepoSwitch();
    const { filter } = usePanelStore.getState();
    expect(filter.branch).toBe(""); // repo-scoped → reset
    expect(filter.file).toBe(""); // repo-scoped → reset
    // carryover (global-scope) fields preserved
    expect(filter.searchQuery).toBe("fix");
    expect(filter.author).toBe("alice");
    expect(filter.dateRange).toBe("7days");
  });

  it("clears collapse + pending-selection state tied to the old repo's graph", () => {
    usePanelStore.setState({
      collapsedSequenceIds: new Set(["seq1"]),
      collapsedIntermediates: new Map([["seq1", ["h1"]]]),
      pendingSelectionFromFilter: ["abc", "def"],
    });
    usePanelStore.getState().resetForRepoSwitch();
    const s = usePanelStore.getState();
    expect(s.collapsedSequenceIds.size).toBe(0);
    expect(s.collapsedIntermediates.size).toBe(0);
    expect(s.pendingSelectionFromFilter).toEqual([]);
  });

  it("clears ALL repo-bound display data (commits/branches/tags/graph/selection/range) on switch (F3)", () => {
    // Seed the store with repo-A data across every repo-bound field.
    usePanelStore.setState({
      commits: [{ hash: "a1" } as never],
      visibleCommits: [{ hash: "a1" } as never],
      branches: [{ name: "main", isCurrent: true } as never],
      tags: [{ name: "v1" } as never],
      currentBranch: "main",
      graphLayout: { lane0: {} as never },
      laneSnapshot: { lanes: [], commitLanes: { a1: 0 } } as never,
      selectedCommitHash: "a1",
      selectedCommitHashes: ["a1"],
      lastSelectedCommitHash: "a1",
      selectedRefs: [
        {
          type: "local",
          name: "feature-a",
          fullRef: "refs/heads/feature-a",
        },
      ],
      lastSelectedRefKey: "local\0feature-a",
      commitFiles: [{ path: "a.ts" } as never],
      selectedFilePath: "a.ts",
      rangeOldest: "a1",
      rangeNewest: "a1",
      collapsedSequenceIds: new Set(["seq1"]),
      collapsedIntermediates: new Map([["seq1", ["h1"]]]),
      pendingSelectionFromFilter: ["a1"],
      filter: {
        searchQuery: "keep-search",
        branch: "feature-a",
        author: "keep-author",
        dateRange: "keep-date",
        file: "src/a.ts",
      },
    });

    usePanelStore.getState().resetForRepoSwitch();
    const s = usePanelStore.getState();

    // repo-bound display data cleared — nothing stale to act on during B's load
    expect(s.commits).toEqual([]);
    expect(s.visibleCommits).toEqual([]);
    expect(s.branches).toEqual([]);
    expect(s.tags).toEqual([]);
    expect(s.currentBranch).toBe("");
    expect(s.graphLayout).toEqual({});
    expect(s.laneSnapshot).toBeNull();
    // selection cleared (A's hashes must not survive into a B-bound context)
    expect(s.selectedCommitHash).toBeNull();
    expect(s.selectedCommitHashes).toEqual([]);
    expect(s.lastSelectedCommitHash).toBeNull();
    expect(s.selectedRefs).toEqual([]);
    expect(s.lastSelectedRefKey).toBeNull();
    expect(s.commitFiles).toEqual([]);
    expect(s.selectedFilePath).toBeNull();
    // range cleared
    expect(s.rangeOldest).toBeNull();
    expect(s.rangeNewest).toBeNull();
    // collapse + pending-selection (tied to old graph/hashes) cleared
    expect(s.collapsedSequenceIds.size).toBe(0);
    expect(s.collapsedIntermediates.size).toBe(0);
    expect(s.pendingSelectionFromFilter).toEqual([]);

    // repo-scoped filter cleared, carryover preserved
    expect(s.filter.branch).toBe("");
    expect(s.filter.file).toBe("");
    expect(s.filter.searchQuery).toBe("keep-search");
    expect(s.filter.author).toBe("keep-author");
    expect(s.filter.dateRange).toBe("keep-date");
  });

  it("resetForRepoSwitch clears the same repo-bound field set as clearForNoRepo (no drift)", () => {
    // Seed identical rich state, run both resets, and assert the repo-bound
    // (non-filter, non-hasMore) slice is identical between the two paths.
    const seed = {
      commits: [{ hash: "a1" } as never],
      visibleCommits: [{ hash: "a1" } as never],
      branches: [{ name: "main", isCurrent: true } as never],
      tags: [{ name: "v1" } as never],
      currentBranch: "main",
      graphLayout: { lane0: {} as never },
      laneSnapshot: { lanes: [], commitLanes: {} } as never,
      selectedCommitHash: "a1",
      selectedCommitHashes: ["a1"],
      lastSelectedCommitHash: "a1",
      selectedRefs: [
        {
          type: "local" as const,
          name: "feature-a",
          fullRef: "refs/heads/feature-a",
        },
      ],
      lastSelectedRefKey: "local\0feature-a",
      commitFiles: [{ path: "a.ts" } as never],
      selectedFilePath: "a.ts",
      rangeOldest: "a1",
      rangeNewest: "a1",
      collapsedSequenceIds: new Set(["seq1"]),
      collapsedIntermediates: new Map([["seq1", ["h1"]]]),
      pendingSelectionFromFilter: ["a1"],
    };

    usePanelStore.setState({ ...seed });
    usePanelStore.getState().resetForRepoSwitch();
    const afterSwitch = usePanelStore.getState();

    usePanelStore.setState({ ...seed });
    usePanelStore.getState().clearForNoRepo();
    const afterNull = usePanelStore.getState();

    const pick = (s: typeof afterSwitch) => ({
      commits: s.commits,
      visibleCommits: s.visibleCommits,
      branches: s.branches,
      tags: s.tags,
      currentBranch: s.currentBranch,
      graphLayout: s.graphLayout,
      laneSnapshot: s.laneSnapshot,
      selectedCommitHash: s.selectedCommitHash,
      selectedCommitHashes: s.selectedCommitHashes,
      lastSelectedCommitHash: s.lastSelectedCommitHash,
      selectedRefs: s.selectedRefs,
      lastSelectedRefKey: s.lastSelectedRefKey,
      commitFiles: s.commitFiles,
      selectedFilePath: s.selectedFilePath,
      rangeOldest: s.rangeOldest,
      rangeNewest: s.rangeNewest,
      collapsedSequenceIds: s.collapsedSequenceIds,
      collapsedIntermediates: s.collapsedIntermediates,
      pendingSelectionFromFilter: s.pendingSelectionFromFilter,
    });

    expect(pick(afterSwitch)).toEqual(pick(afterNull));
  });

  it("clears selectedRefs / lastSelectedRefKey on repo switch so wrong-repo ref ops are disabled", () => {
    usePanelStore.setState({
      selectedRefs: [
        {
          type: "local",
          name: "repo-A-branch",
          fullRef: "refs/heads/repo-A-branch",
        },
      ],
      lastSelectedRefKey: "local\0repo-A-branch",
      branches: [{ name: "repo-A-branch", isCurrent: true } as never],
    });
    usePanelStore.getState().resetForRepoSwitch();
    const s = usePanelStore.getState();
    expect(s.selectedRefs).toEqual([]);
    expect(s.lastSelectedRefKey).toBeNull();
  });

  it("a failed fetchInitialData after reset does NOT resurrect stale repo-A data (F3 fetch-failure guarantee)", async () => {
    const { bridge } = await import("../bridge");
    const mockedRequest = vi.mocked(bridge.request);
    mockedRequest.mockReset();

    // Seed repo-A display data, then switch (clearing it all).
    usePanelStore.setState({
      commits: [{ hash: "a1" } as never],
      branches: [{ name: "main", isCurrent: true } as never],
      tags: [{ name: "v1" } as never],
      selectedCommitHash: "a1",
      graphLayout: { lane0: {} as never },
      filter: {
        searchQuery: "keep",
        branch: "feature-a",
        author: "al",
        dateRange: "7days",
        file: "src/a.ts",
      },
    });
    usePanelStore.getState().resetForRepoSwitch();

    // Simulate repo B's fetch failing entirely.
    mockedRequest.mockRejectedValue(new Error("network down"));
    await usePanelStore.getState().fetchInitialData();

    const s = usePanelStore.getState();
    // Store stays empty — no A data resurrected by the failed fetch.
    expect(s.commits).toEqual([]);
    expect(s.branches).toEqual([]);
    expect(s.tags).toEqual([]);
    expect(s.selectedCommitHash).toBeNull();
    expect(s.graphLayout).toEqual({});
    // Carryover filter still preserved across the failed fetch.
    expect(s.filter.searchQuery).toBe("keep");
    expect(s.filter.branch).toBe("");
    expect(s.filter.file).toBe("");
  });

  it("after reset, fetchInitialData does NOT carry the old repo's branch/file into getGraphData", async () => {
    const { bridge } = await import("../bridge");
    const mockedRequest = vi.mocked(bridge.request);
    mockedRequest.mockReset();
    // Seed the store as if the user had filtered repo A by branch + file.
    usePanelStore.setState({
      filter: {
        searchQuery: "bug",
        branch: "feature-a",
        author: "bob",
        dateRange: "30days",
        file: "src/a.ts",
      },
      commits: [],
    });
    // Resolve all bridge requests with empty-ish payloads so fetchInitialData
    // completes without throwing.
    mockedRequest.mockImplementation(async (cmd: string) => {
      if (cmd === "getGraphData") {
        return {
          graphData: { commits: [], lanes: {} },
          snapshot: { lanes: [], commitLanes: {} },
        };
      }
      if (cmd === "getBranches") return [];
      if (cmd === "getTags") return [];
      return null;
    });

    // Simulate the App switch handler: reset THEN fetch.
    usePanelStore.getState().resetForRepoSwitch();
    await usePanelStore.getState().fetchInitialData();

    // Find the getGraphData call and inspect its params.
    const graphCall = mockedRequest.mock.calls.find(
      (c) => c[0] === "getGraphData",
    );
    expect(graphCall).toBeTruthy();
    const params = (graphCall?.[1] ?? {}) as {
      branch?: string;
      file?: string;
    };
    expect(params.branch).toBeUndefined(); // old repo's branch NOT carried
    expect(params.file).toBeUndefined(); // old repo's file NOT carried
  });
});

describe("panel-store clearForNoRepo", () => {
  beforeEach(() => {
    usePanelStore.setState({
      filter: {
        searchQuery: "",
        branch: "",
        author: "",
        dateRange: "",
        file: "",
      },
      commits: [],
      branches: [],
      tags: [],
      currentBranch: "",
      graphLayout: {},
      laneSnapshot: null,
      selectedCommitHash: null,
      selectedCommitHashes: [],
      commitFiles: [],
      visibleCommits: [],
    });
  });

  it("clears commits/branches/tags and repo-scoped filter when activeRepoId becomes null", () => {
    // Seed stale repo-A data.
    usePanelStore.setState({
      commits: [{ hash: "a1" } as never],
      visibleCommits: [{ hash: "a1" } as never],
      branches: [{ name: "main", isCurrent: true } as never],
      tags: [{ name: "v1" } as never],
      currentBranch: "main",
      graphLayout: { x: {} },
      selectedCommitHash: "a1",
      selectedCommitHashes: ["a1"],
      commitFiles: [{} as never],
      filter: {
        searchQuery: "keep",
        branch: "feature",
        author: "carol",
        dateRange: "today",
        file: "src/a.ts",
      },
    });

    usePanelStore.getState().clearForNoRepo();
    const s = usePanelStore.getState();

    // repo-bound display data cleared
    expect(s.commits).toEqual([]);
    expect(s.visibleCommits).toEqual([]);
    expect(s.branches).toEqual([]);
    expect(s.tags).toEqual([]);
    expect(s.currentBranch).toBe("");
    expect(s.graphLayout).toEqual({});
    expect(s.selectedCommitHash).toBeNull();
    expect(s.selectedCommitHashes).toEqual([]);
    expect(s.commitFiles).toEqual([]);

    // repo-scoped filter cleared, carryover preserved
    expect(s.filter.branch).toBe("");
    expect(s.filter.file).toBe("");
    expect(s.filter.searchQuery).toBe("keep");
    expect(s.filter.author).toBe("carol");
    expect(s.filter.dateRange).toBe("today");
  });
});

describe("panel-store ref selection", () => {
  const localMain: GitRefIdentity = {
    type: "local",
    name: "main",
    fullRef: "refs/heads/main",
  };
  const tagMain: GitRefIdentity = {
    type: "tag",
    name: "main",
    fullRef: "refs/tags/main",
  };

  it("selects same-named refs independently and clears them on repo switch", () => {
    usePanelStore.setState({ selectedRefs: [], lastSelectedRefKey: null });

    usePanelStore
      .getState()
      .selectRef(localMain, "single", [localMain, tagMain]);
    usePanelStore.getState().selectRef(tagMain, "toggle", [localMain, tagMain]);

    expect(usePanelStore.getState().selectedRefs).toEqual([localMain, tagMain]);

    usePanelStore.getState().resetForRepoSwitch();
    expect(usePanelStore.getState().selectedRefs).toEqual([]);
    expect(usePanelStore.getState().lastSelectedRefKey).toBeNull();
  });

  it("persists favorite state and patches only the matching ref type", async () => {
    const request = vi.mocked(bridge.request);
    request.mockResolvedValueOnce({ ref: tagMain, isFavorite: true });
    usePanelStore.setState({
      branches: [
        {
          name: "main",
          fullRef: "refs/heads/main",
          isRemote: false,
          isCurrent: true,
          isFavorite: false,
        } as never,
      ],
      tags: [
        {
          name: "main",
          fullRef: "refs/tags/main",
          isFavorite: false,
        } as never,
      ],
    });

    await usePanelStore.getState().setFavorite(tagMain, true);

    expect(request).toHaveBeenCalledWith("setFavorite", {
      ref: tagMain,
      favorite: true,
    });
    expect(usePanelStore.getState().branches[0].isFavorite).toBe(false);
    expect(usePanelStore.getState().tags[0].isFavorite).toBe(true);
  });

  it("does not patch the newly active repository when an explicit favorite request settles", async () => {
    const request = vi.mocked(bridge.request);
    const pending = deferred<unknown>();
    request.mockImplementationOnce(() => pending.promise);
    useRepoStore.setState({ activeRepoId: "repo-a" });

    const favoriteRequest = usePanelStore
      .getState()
      .setFavorite(localMain, true, "repo-a");

    useRepoStore.setState({ activeRepoId: "repo-b" });
    usePanelStore.setState({
      branches: [
        {
          name: "main",
          fullRef: "refs/heads/main",
          isRemote: false,
          isCurrent: true,
          isFavorite: false,
        } as never,
      ],
      tags: [],
    });
    pending.resolve(undefined);
    await favoriteRequest;

    expect(request).toHaveBeenCalledWith(
      "setFavorite",
      { ref: localMain, favorite: true },
      { repoId: "repo-a" },
    );
    expect(usePanelStore.getState().branches[0].isFavorite).toBe(false);
  });

  it("loads and persists branch dashboard preferences", async () => {
    const request = vi.mocked(bridge.request);
    request
      .mockResolvedValueOnce({ showTags: false, singleClickAction: "navigate" })
      .mockResolvedValueOnce({ showTags: true, singleClickAction: "filter" });

    await usePanelStore.getState().loadBranchDashboardPreferences();
    expect(usePanelStore.getState().showTags).toBe(false);
    expect(usePanelStore.getState().singleClickAction).toBe("navigate");

    await usePanelStore
      .getState()
      .setBranchDashboardPreferences({ showTags: true });
    expect(request).toHaveBeenLastCalledWith(
      "setBranchDashboardPreferences",
      { showTags: true },
      { scope: "global" },
    );
    expect(usePanelStore.getState().showTags).toBe(true);
    expect(usePanelStore.getState().singleClickAction).toBe("filter");
  });

  it("navigates to a loaded ref target and exposes a one-shot scroll target", async () => {
    usePanelStore.setState({
      commits: [{ hash: "tip" } as never],
      visibleCommits: [{ hash: "tip" } as never],
      filter: {
        searchQuery: "",
        branch: "",
        author: "",
        dateRange: "",
        file: "",
      },
      scrollTargetHash: null,
    });

    await usePanelStore.getState().navigateToRef(localMain, "tip");

    expect(usePanelStore.getState().selectedCommitHash).toBe("tip");
    expect(usePanelStore.getState().scrollTargetHash).toBe("tip");
    usePanelStore.getState().clearScrollTarget();
    expect(usePanelStore.getState().scrollTargetHash).toBeNull();
  });

  it("loads additional pages before navigating to an older ref target", async () => {
    const originalLoadMore = usePanelStore.getState().loadMore;
    const loadMore = vi.fn(async () => {
      usePanelStore.setState({
        commits: [{ hash: "old-tip" } as never],
        visibleCommits: [{ hash: "old-tip" } as never],
        hasMore: false,
      });
    });
    usePanelStore.setState({
      commits: [],
      visibleCommits: [],
      hasMore: true,
      loading: false,
      scrollTargetHash: null,
      loadMore,
    });

    await usePanelStore.getState().navigateToRef(localMain, "old-tip");

    expect(loadMore).toHaveBeenCalledTimes(1);
    expect(usePanelStore.getState().selectedCommitHash).toBe("old-tip");
    expect(usePanelStore.getState().scrollTargetHash).toBe("old-tip");
    usePanelStore.setState({ loadMore: originalLoadMore });
  });

  it("clears an existing branch filter before navigating to another ref", async () => {
    const request = vi.mocked(bridge.request);
    request.mockReset();
    request.mockImplementation(async (command, params) => {
      if (command === "getGraphData") {
        expect((params as { branch?: string }).branch).toBeUndefined();
        return graphResult([commit("target-tip")]);
      }
      if (command === "getBranches" || command === "getTags") return [];
      if (command === "getCommitRangeFiles") return [];
      return null;
    });
    usePanelStore.setState({
      commits: [commit("branch-a-tip")],
      visibleCommits: [commit("branch-a-tip")],
      filter: {
        searchQuery: "",
        branch: "refs/heads/branch-a",
        author: "",
        dateRange: "",
        file: "",
      },
      hasMore: false,
      loading: false,
    });

    await usePanelStore.getState().navigateToRef(localMain, "target-tip");

    expect(usePanelStore.getState().filter.branch).toBe("");
    expect(usePanelStore.getState().selectedCommitHash).toBe("target-tip");
    expect(usePanelStore.getState().scrollTargetHash).toBe("target-tip");
    expect(request).not.toHaveBeenCalledWith(
      "showErrorNotification",
      expect.anything(),
      expect.anything(),
    );
  });

  it("waits for an active log load instead of reporting a false navigation miss", async () => {
    const request = vi.mocked(bridge.request);
    const graph = deferred<ReturnType<typeof graphResult>>();
    request.mockReset();
    request.mockImplementation(async (command) => {
      if (command === "getGraphData") return graph.promise;
      if (command === "getBranches" || command === "getTags") return [];
      if (command === "getCommitRangeFiles") return [];
      return null;
    });
    usePanelStore.setState({
      commits: [],
      visibleCommits: [],
      filter: {
        searchQuery: "",
        branch: "",
        author: "",
        dateRange: "",
        file: "",
      },
      hasMore: true,
      loading: false,
      scrollTargetHash: null,
    });

    const loading = usePanelStore.getState().fetchInitialData();
    const navigation = usePanelStore
      .getState()
      .navigateToRef(localMain, "loaded-tip");
    graph.resolve(graphResult([commit("loaded-tip")]));
    await Promise.all([loading, navigation]);

    expect(usePanelStore.getState().selectedCommitHash).toBe("loaded-tip");
    expect(usePanelStore.getState().scrollTargetHash).toBe("loaded-tip");
    expect(request).not.toHaveBeenCalledWith(
      "showErrorNotification",
      expect.anything(),
      expect.anything(),
    );
  });

  it("lets a later filter change cancel an in-flight paginated navigation", async () => {
    const request = vi.mocked(bridge.request);
    const page = deferred<ReturnType<typeof graphResult>>();
    request.mockReset();
    request.mockImplementation(async (command) => {
      if (command === "loadMoreLog") return page.promise;
      if (command === "getCommitRangeFiles") return [];
      return null;
    });
    const current = commit("keep-current");
    usePanelStore.setState({
      commits: [current],
      visibleCommits: [current],
      selectedCommitHash: current.hash,
      selectedCommitHashes: [current.hash],
      filter: {
        searchQuery: "",
        branch: "",
        author: "",
        dateRange: "",
        file: "",
      },
      hasMore: true,
      loading: false,
      scrollTargetHash: null,
    });

    const navigation = usePanelStore
      .getState()
      .navigateToRef(localMain, "target-tip");
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith("loadMoreLog", expect.anything());
    });
    usePanelStore.getState().setFilter({ searchQuery: "keep" });
    page.resolve(graphResult([commit("target-tip")]));
    await navigation;

    expect(usePanelStore.getState().filter.searchQuery).toBe("keep");
    expect(usePanelStore.getState().selectedCommitHash).toBeNull();
    expect(usePanelStore.getState().scrollTargetHash).toBeNull();
    expect(request).not.toHaveBeenCalledWith(
      "showErrorNotification",
      expect.anything(),
      expect.anything(),
    );
  });

  it("lets a later manual commit selection cancel an in-flight navigation", async () => {
    const request = vi.mocked(bridge.request);
    const page = deferred<ReturnType<typeof graphResult>>();
    request.mockReset();
    request.mockImplementation(async (command) => {
      if (command === "loadMoreLog") return page.promise;
      if (command === "getCommitRangeFiles") return [];
      return null;
    });
    const current = commit("current");
    const manual = commit("manual");
    usePanelStore.setState({
      commits: [current, manual],
      visibleCommits: [current, manual],
      selectedCommitHash: current.hash,
      selectedCommitHashes: [current.hash],
      filter: {
        searchQuery: "",
        branch: "",
        author: "",
        dateRange: "",
        file: "",
      },
      hasMore: true,
      loading: false,
      scrollTargetHash: null,
    });

    const navigation = usePanelStore
      .getState()
      .navigateToRef(localMain, "target-tip");
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith("loadMoreLog", expect.anything());
    });
    await usePanelStore
      .getState()
      .selectCommit(manual.hash, "single", [current.hash, manual.hash]);
    page.resolve(graphResult([commit("target-tip")]));
    await navigation;

    expect(usePanelStore.getState().selectedCommitHash).toBe(manual.hash);
    expect(usePanelStore.getState().scrollTargetHash).toBeNull();
  });

  it("expands collapsed sequences to reach a hidden intermediate target", async () => {
    const request = vi.mocked(bridge.request);
    request.mockReset();
    request.mockImplementation(async (command) => {
      if (command === "getCommitRangeFiles") return [];
      return null;
    });
    const head = commit("head");
    const mid = commit("mid");
    const tail = commit("tail");
    usePanelStore.setState({
      commits: [head, mid, tail],
      visibleCommits: [head, tail],
      collapsedSequenceIds: new Set(["seq"]),
      collapsedIntermediates: new Map([["seq", ["mid"]]]),
      filter: {
        searchQuery: "",
        branch: "",
        author: "",
        dateRange: "",
        file: "",
      },
      hasMore: false,
      loading: false,
      scrollTargetHash: null,
    });

    await usePanelStore.getState().navigateToCommit("mid", "mid");

    expect(usePanelStore.getState().collapsedSequenceIds.size).toBe(0);
    expect(usePanelStore.getState().selectedCommitHash).toBe("mid");
    expect(usePanelStore.getState().scrollTargetHash).toBe("mid");
    expect(request).not.toHaveBeenCalledWith(
      "showErrorNotification",
      expect.anything(),
      expect.anything(),
    );
  });
});

describe("panel-store async response ordering", () => {
  beforeEach(() => {
    vi.mocked(bridge.request).mockReset();
    usePanelStore.getState().resetForRepoSwitch();
    usePanelStore.setState({ loading: false, hasMore: true });
  });

  it("defaults initial repository loading to the checked-out branch", async () => {
    const request = vi.mocked(bridge.request);
    const graphBranches: Array<string | undefined> = [];
    request.mockImplementation(async (command, params) => {
      if (command === "getBranches") {
        return [
          {
            name: "main",
            fullRef: "refs/heads/main",
            isRemote: false,
            isCurrent: true,
          },
        ];
      }
      if (command === "getTags") return [];
      if (command === "getGraphData") {
        graphBranches.push((params as { branch?: string }).branch);
        return graphResult([]);
      }
      return null;
    });

    await usePanelStore
      .getState()
      .fetchInitialData({ defaultToCurrentBranch: true });

    expect(graphBranches).toEqual(["refs/heads/main"]);
    expect(usePanelStore.getState().filter.branch).toBe("refs/heads/main");
  });

  it("keeps detached HEAD logs unfiltered across later refreshes", async () => {
    const request = vi.mocked(bridge.request);
    const graphBranches: Array<string | undefined> = [];
    request.mockImplementation(async (command, params) => {
      if (command === "getBranches" || command === "getTags") return [];
      if (command === "getGraphData") {
        graphBranches.push((params as { branch?: string }).branch);
        return graphResult([]);
      }
      return null;
    });

    await usePanelStore
      .getState()
      .fetchInitialData({ defaultToCurrentBranch: true });
    await usePanelStore.getState().refresh();

    expect(graphBranches).toEqual([undefined, undefined]);
    expect(usePanelStore.getState().filter.branch).toBe("");
  });

  it("does not restore the default branch during an ordinary refresh after clearing it", async () => {
    const request = vi.mocked(bridge.request);
    const graphBranches: Array<string | undefined> = [];
    request.mockImplementation(async (command, params) => {
      if (command === "getBranches") {
        return [
          {
            name: "main",
            fullRef: "refs/heads/main",
            isRemote: false,
            isCurrent: true,
          },
        ];
      }
      if (command === "getTags") return [];
      if (command === "getGraphData") {
        graphBranches.push((params as { branch?: string }).branch);
        return graphResult([]);
      }
      return null;
    });

    await usePanelStore
      .getState()
      .fetchInitialData({ defaultToCurrentBranch: true });
    usePanelStore.setState((state) => ({
      filter: { ...state.filter, branch: "" },
    }));
    await usePanelStore.getState().fetchInitialData();

    expect(graphBranches).toEqual(["refs/heads/main", undefined]);
    expect(usePanelStore.getState().filter.branch).toBe("");
  });

  it("preserves pending default-branch initialization when refresh supersedes the first load", async () => {
    const request = vi.mocked(bridge.request);
    const firstBranches = deferred<never[]>();
    const graphBranches: Array<string | undefined> = [];
    let branchRequests = 0;
    const currentBranch = {
      name: "main",
      fullRef: "refs/heads/main",
      isRemote: false,
      isCurrent: true,
    };
    request.mockImplementation(async (command, params) => {
      if (command === "getBranches") {
        branchRequests += 1;
        return branchRequests === 1 ? firstBranches.promise : [currentBranch];
      }
      if (command === "getTags") return [];
      if (command === "getGraphData") {
        graphBranches.push((params as { branch?: string }).branch);
        return graphResult([]);
      }
      return null;
    });

    const initial = usePanelStore
      .getState()
      .fetchInitialData({ defaultToCurrentBranch: true });
    await vi.waitFor(() => expect(branchRequests).toBe(1));
    const refresh = usePanelStore.getState().refresh();
    await refresh;
    firstBranches.resolve([currentBranch] as never[]);
    await initial;

    expect(graphBranches).toEqual(["refs/heads/main"]);
    expect(usePanelStore.getState().filter.branch).toBe("refs/heads/main");
  });

  it("consumes default initialization once the current branch is known", async () => {
    const request = vi.mocked(bridge.request);
    const firstGraph = deferred<ReturnType<typeof graphResult>>();
    const graphBranches: Array<string | undefined> = [];
    const currentBranch = {
      name: "main",
      fullRef: "refs/heads/main",
      isRemote: false,
      isCurrent: true,
    };
    request.mockImplementation(async (command, params) => {
      if (command === "getBranches") return [currentBranch];
      if (command === "getTags") return [];
      if (command === "getGraphData") {
        graphBranches.push((params as { branch?: string }).branch);
        if (graphBranches.length === 1) return firstGraph.promise;
        if (graphBranches.length === 3) {
          return graphResult([commit("feature-tip")]);
        }
        return graphResult([]);
      }
      if (command === "getCommitRangeFiles") return [];
      return null;
    });

    const initial = usePanelStore
      .getState()
      .fetchInitialData({ defaultToCurrentBranch: true });
    await vi.waitFor(() => {
      expect(graphBranches).toEqual(["refs/heads/main"]);
      expect(usePanelStore.getState().filter.branch).toBe("refs/heads/main");
    });
    await usePanelStore.getState().refresh();
    firstGraph.resolve(graphResult([]));
    await initial;

    await usePanelStore.getState().navigateToRef(
      {
        type: "local",
        name: "feature",
        fullRef: "refs/heads/feature",
      },
      "feature-tip",
    );

    expect(graphBranches).toEqual([
      "refs/heads/main",
      "refs/heads/main",
      undefined,
    ]);
  });

  it("discards an older graph response that resolves after a newer filter", async () => {
    const request = vi.mocked(bridge.request);
    const older = deferred<ReturnType<typeof graphResult>>();
    const newer = deferred<ReturnType<typeof graphResult>>();
    request.mockImplementation(async (command, params) => {
      if (command === "getGraphData") {
        return (params as { branch?: string }).branch === "branch-a"
          ? older.promise
          : newer.promise;
      }
      if (command === "getBranches" || command === "getTags") return [];
      if (command === "getCommitRangeFiles") return [];
      return null;
    });

    usePanelStore.setState((state) => ({
      filter: { ...state.filter, branch: "branch-a" },
    }));
    const first = usePanelStore.getState().fetchInitialData();
    usePanelStore.setState((state) => ({
      filter: { ...state.filter, branch: "branch-b" },
    }));
    const second = usePanelStore.getState().fetchInitialData();

    newer.resolve(graphResult([commit("branch-b-tip")]));
    await vi.waitFor(() => {
      expect(usePanelStore.getState().commits[0]?.hash).toBe("branch-b-tip");
    });
    older.resolve(graphResult([commit("branch-a-tip")]));
    await Promise.all([first, second]);

    expect(usePanelStore.getState().filter.branch).toBe("branch-b");
    expect(usePanelStore.getState().commits.map((item) => item.hash)).toEqual([
      "branch-b-tip",
    ]);
    expect(usePanelStore.getState().loading).toBe(false);
  });

  it("keeps commit files aligned with the latest selected commit", async () => {
    const request = vi.mocked(bridge.request);
    const older = deferred<never[]>();
    const newer = deferred<never[]>();
    request.mockImplementation(async (command, params) => {
      if (command !== "getCommitRangeFiles") return null;
      const hashes = (params as { hashes: string[] }).hashes;
      return hashes[0] === "older" ? older.promise : newer.promise;
    });

    const first = usePanelStore.getState().selectCommit("older");
    const second = usePanelStore.getState().selectCommit("newer");
    newer.resolve([{ newPath: "newer.ts" } as never]);
    await second;
    older.resolve([{ newPath: "older.ts" } as never]);
    await first;

    expect(usePanelStore.getState().selectedCommitHash).toBe("newer");
    expect(usePanelStore.getState().commitFiles).toEqual([
      { newPath: "newer.ts" },
    ]);
  });

  it("keeps a toggled multi-selection in visible-row order, not click order", async () => {
    const request = vi.mocked(bridge.request);
    request.mockImplementation(async (command) => {
      if (command === "getCommitRangeFiles") return [];
      return null;
    });
    const visible = ["newest", "middle", "oldest"];

    await usePanelStore.getState().selectCommit("oldest", "single", visible);
    await usePanelStore.getState().selectCommit("newest", "toggle", visible);

    expect(usePanelStore.getState().selectedCommitHashes).toEqual([
      "newest",
      "oldest",
    ]);
    expect(usePanelStore.getState().rangeNewest).toBe("newest");
    expect(usePanelStore.getState().rangeOldest).toBe("oldest");
  });
});

describe("panel-store collapse-all / expand-all", () => {
  function linearChain() {
    // head → i1 → i2 → i3 → tail, all in one lane: i1..i3 are collapsible.
    const hashes = ["head", "i1", "i2", "i3", "tail"];
    const commits = hashes.map((hash, i) => ({
      ...commit(hash),
      parents: i < hashes.length - 1 ? [hashes[i + 1]] : [],
    }));
    const graphLayout = Object.fromEntries(
      hashes.map((hash) => [hash, { column: 0, color: 0, lines: [] }]),
    );
    return { commits, graphLayout };
  }

  it("collapses every linear run and expands them all back", async () => {
    const request = vi.fn(async (command: string) => {
      if (command === "getCommitRangeFiles") return [];
      return null;
    });
    const { bridge: fakeBridge } = createFakeBridge(request);
    const instance = createGitLogStore({
      repoId: "repo-a",
      history: { kind: "ordinary" },
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      bridge: fakeBridge,
    });

    try {
      const { commits, graphLayout } = linearChain();
      instance.store.setState({
        commits,
        visibleCommits: commits,
        graphLayout,
        selectedCommitHash: "head",
        selectedCommitHashes: ["head"],
        lastSelectedCommitHash: "head",
      });

      instance.store.getState().collapseAllSequences();
      expect(
        instance.store.getState().visibleCommits.map((c) => c.hash),
      ).toEqual(["head", "tail"]);
      expect(instance.store.getState().collapsedSequenceIds.size).toBe(1);
      // The selection survives: "head" is still visible.
      expect(instance.store.getState().selectedCommitHash).toBe("head");

      instance.store.getState().expandAllSequences();
      expect(
        instance.store.getState().visibleCommits.map((c) => c.hash),
      ).toEqual(["head", "i1", "i2", "i3", "tail"]);
      expect(instance.store.getState().collapsedSequenceIds.size).toBe(0);
    } finally {
      instance.dispose();
    }
  });

  it("keeps selection on a collapsed commit's nearest visible fallback", () => {
    const { bridge: fakeBridge } = createFakeBridge(vi.fn(async () => []));
    const instance = createGitLogStore({
      repoId: "repo-a",
      history: { kind: "ordinary" },
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      bridge: fakeBridge,
    });

    try {
      const { commits, graphLayout } = linearChain();
      instance.store.setState({
        commits,
        visibleCommits: commits,
        graphLayout,
        selectedCommitHash: "i2",
        selectedCommitHashes: ["i2"],
        lastSelectedCommitHash: "i2",
      });

      instance.store.getState().collapseAllSequences();
      // The selected intermediate vanished; selection falls back to the first
      // visible commit instead of pointing at a hidden row.
      expect(instance.store.getState().selectedCommitHash).toBe("head");
    } finally {
      instance.dispose();
    }
  });
});

describe("panel-store graph modes, paths, and presentation", () => {
  function instanceWith(request: ReturnType<typeof vi.fn>) {
    const { bridge: fakeBridge } = createFakeBridge(request);
    return createGitLogStore({
      repoId: "repo-a",
      history: { kind: "ordinary" },
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      bridge: fakeBridge,
    });
  }

  function stubRequest() {
    return vi.fn(async (command: string) => {
      if (command === "getBranches" || command === "getTags") return [];
      if (command === "getGraphData") return graphResult([]);
      if (command === "getCommitRangeFiles") return [];
      return null;
    });
  }

  it("sends graph modes and pathspecs to the host query", async () => {
    vi.useFakeTimers();
    const request = stubRequest();
    const instance = instanceWith(request);

    try {
      instance.store.getState().setFilter({
        paths: ["src/components", "README.md"],
        sortTopo: true,
        noMerges: true,
      });
      await vi.advanceTimersByTimeAsync(200);

      expect(request).toHaveBeenCalledWith(
        "getGraphData",
        expect.objectContaining({
          paths: ["src/components", "README.md"],
          sortTopo: true,
          noMerges: true,
        }),
        expect.objectContaining({ repoId: "repo-a" }),
      );
      const params = request.mock.calls.find(
        (c) => c[0] === "getGraphData",
      )?.[1] as Record<string, unknown>;
      expect(params.firstParent).toBeUndefined();
    } finally {
      instance.dispose();
      vi.useRealTimers();
    }
  });

  it("persists presentation toggles and fetches the identity for My Commits", async () => {
    const request = vi.fn(async (command: string) => {
      if (command === "getUserIdentity") {
        return { name: "Ada Lovelace", email: "ada@example.com" };
      }
      return null;
    });
    const instance = instanceWith(request);

    try {
      localStorage.removeItem("logPresentation");
      expect(instance.store.getState().presentation.dimMergeCommits).toBe(
        false,
      );
      instance.store.getState().togglePresentation("dimMergeCommits");
      expect(instance.store.getState().presentation.dimMergeCommits).toBe(true);
      expect(
        JSON.parse(localStorage.getItem("logPresentation") ?? "{}")
          .dimMergeCommits,
      ).toBe(true);

      instance.store.getState().togglePresentation("highlightMyCommits");
      await vi.waitFor(() => {
        expect(instance.store.getState().myIdentity).toBe("Ada Lovelace");
      });
    } finally {
      localStorage.removeItem("logPresentation");
      instance.dispose();
    }
  });

  it("navigateToCommit selects and scrolls to a loaded commit", async () => {
    const target = commit("cafebabe");
    const request = vi.fn(async (command: string) => {
      if (command === "getCommitRangeFiles") return [];
      return null;
    });
    const instance = instanceWith(request);

    try {
      instance.store.setState({
        commits: [commit("aaaa"), target],
        visibleCommits: [commit("aaaa"), target],
        hasMore: false,
      });
      await instance.store.getState().navigateToCommit("cafebabe", "cafebabe");
      expect(instance.store.getState().selectedCommitHash).toBe("cafebabe");
      expect(instance.store.getState().scrollTargetHash).toBe("cafebabe");
    } finally {
      instance.dispose();
    }
  });
});
