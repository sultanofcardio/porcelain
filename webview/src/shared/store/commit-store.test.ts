import { beforeEach, describe, expect, it, vi } from "vitest";
import { bridge } from "../bridge";
import {
  applyRepoSwitch,
  pruneRemovedDrafts,
  useCommitStore,
} from "./commit-store";
import { useRepoStore } from "./repo-store";

const bridgeEvents = vi.hoisted(() => ({
  listener: null as
    | ((event: string, data: Record<string, unknown>) => void)
    | null,
}));

vi.mock("../bridge", () => ({
  bridge: {
    request: vi.fn(),
    onEvent: vi.fn(
      (listener: (event: string, data: Record<string, unknown>) => void) => {
        bridgeEvents.listener = listener;
        return () => {};
      },
    ),
    setRepoContext: vi.fn(),
  },
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  for (let step = 0; step < 12; step += 1) {
    await Promise.resolve();
  }
}

describe("commit-store per-repo isolation", () => {
  beforeEach(() => {
    pruneRemovedDrafts([]);
    useCommitStore.setState({
      commitMessage: "",
      selectedFiles: new Set(),
      highlightedFiles: new Set(),
      amend: false,
      operationError: null,
      changes: [],
      expandedGroups: new Set(["changes", "unversioned", "staged"]),
      collapsedDirs: new Set(),
      fetchChanges: vi.fn(),
    });
    vi.mocked(bridge.request).mockReset();
  });

  it("saves and restores a draft across a repo switch", async () => {
    useCommitStore.setState({
      commitMessage: "draft for A",
      selectedFiles: new Set(["a.ts"]),
      operationError: {
        code: "COMMIT_REJECTED",
        message: "old repo error",
      },
    });
    await applyRepoSwitch("/a", "/b", false);
    expect(useCommitStore.getState().commitMessage).toBe(""); // B had no draft
    expect(useCommitStore.getState().operationError).toBeNull();
    useCommitStore.setState({ commitMessage: "draft for B" });
    await applyRepoSwitch("/b", "/a", false);
    expect(useCommitStore.getState().commitMessage).toBe("draft for A"); // A restored
  });

  it("prunes drafts for removed repos", async () => {
    await applyRepoSwitch(null, "/gone", false);
    useCommitStore.setState({ commitMessage: "x" });
    await applyRepoSwitch("/gone", null, false);
    pruneRemovedDrafts([]); // /gone removed
    useRepoStore.setState({ activeRepoId: null, repos: [] });
    await applyRepoSwitch(null, "/gone", false);
    expect(useCommitStore.getState().commitMessage).toBe("");
  });

  it("discards an older repository response and restores only its draft", async () => {
    await applyRepoSwitch(null, "/a", false);
    useCommitStore.setState({
      commitMessage: "draft for A",
      changes: [{ path: "a.ts", status: "modified", staged: false }],
      selectedFiles: new Set(["a.ts"]),
      highlightedFiles: new Set(["a.ts"]),
    });
    const oldChanges =
      deferred<
        Array<{
          path: string;
          status: "modified";
          staged: boolean;
        }>
      >();
    vi.mocked(bridge.request).mockImplementation((command) => {
      if (command === "getWorkingTreeChanges") return oldChanges.promise;
      return Promise.resolve([]);
    });

    const oldFetch = useCommitStore.getState().fetchChanges();
    await applyRepoSwitch("/a", "/b", false);
    await applyRepoSwitch("/b", "/a", false);

    expect(useCommitStore.getState().commitMessage).toBe("draft for A");
    expect(useCommitStore.getState().changes).toEqual([]);
    expect(useCommitStore.getState().selectedFiles.size).toBe(0);
    expect(useCommitStore.getState().highlightedFiles.size).toBe(0);

    oldChanges.resolve([
      { path: "stale.ts", status: "modified", staged: false },
    ]);
    await oldFetch;

    expect(useCommitStore.getState().changes).toEqual([]);
  });

  it("does not apply a completed operation after the repository changes", async () => {
    await applyRepoSwitch(null, "/a", false);
    const commitResponse = deferred<unknown>();
    vi.mocked(bridge.request).mockImplementation((command) => {
      if (command === "commitChanges") return commitResponse.promise;
      return Promise.resolve([]);
    });
    useCommitStore.setState({
      commitMessage: "draft for A",
      changes: [{ path: "a.ts", status: "modified", staged: false }],
      selectedFiles: new Set(["a.ts"]),
    });

    const commit = useCommitStore.getState().commit();
    await applyRepoSwitch("/a", "/b", false);
    useCommitStore.setState({ commitMessage: "draft for B" });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    commitResponse.resolve({ success: true });

    await expect(commit).resolves.toBe(false);
    expect(useCommitStore.getState().commitMessage).toBe("draft for B");
    consoleError.mockRestore();
  });
});

describe("commit-store request coordination", () => {
  beforeEach(async () => {
    pruneRemovedDrafts([]);
    vi.mocked(bridge.request).mockReset();
    useCommitStore.setState({
      changes: [],
      selectedFiles: new Set(),
      highlightedFiles: new Set(),
      shelves: [],
      ideaShelves: [],
      currentBranch: "",
      currentBranchHasUpstream: false,
      loading: false,
    });
    useRepoStore.setState({ activeRepoId: "/repo" });
    await applyRepoSwitch(null, "/repo", false);
  });

  it("coalesces duplicate repository invalidations", async () => {
    vi.mocked(bridge.request).mockResolvedValue([]);

    bridgeEvents.listener?.("gitStateChanged", { repoId: "/repo" });
    bridgeEvents.listener?.("commitStateChanged", { repoId: "/repo" });
    await flushMicrotasks();

    const commands = vi
      .mocked(bridge.request)
      .mock.calls.map(([command]) => command);
    expect(
      commands.filter((command) => command === "getWorkingTreeChanges"),
    ).toHaveLength(1);
    expect(
      commands.filter((command) => command === "getBranches"),
    ).toHaveLength(1);
    expect(commands.filter((command) => command === "getShelves")).toHaveLength(
      1,
    );
    expect(
      commands.filter((command) => command === "getIdeaShelves"),
    ).toHaveLength(1);
  });

  it("runs one dirty follow-up for an in-flight working-tree refresh", async () => {
    const first = deferred<unknown[]>();
    const second = deferred<unknown[]>();
    vi.mocked(bridge.request).mockImplementation((command) => {
      if (command === "getWorkingTreeChanges") {
        const count = vi
          .mocked(bridge.request)
          .mock.calls.filter(([called]) => called === command).length;
        return count === 1 ? first.promise : second.promise;
      }
      return Promise.resolve([]);
    });

    bridgeEvents.listener?.("gitStateChanged", { repoId: "/repo" });
    await flushMicrotasks();
    bridgeEvents.listener?.("commitStateChanged", { repoId: "/repo" });
    bridgeEvents.listener?.("gitStateChanged", { repoId: "/repo" });

    first.resolve([]);
    await flushMicrotasks();
    expect(
      vi
        .mocked(bridge.request)
        .mock.calls.filter(([command]) => command === "getWorkingTreeChanges"),
    ).toHaveLength(2);

    second.resolve([]);
    await flushMicrotasks();
    expect(
      vi
        .mocked(bridge.request)
        .mock.calls.filter(([command]) => command === "getWorkingTreeChanges"),
    ).toHaveLength(2);
  });

  it("keeps the shelf refresh domain active until both shelf reads settle", async () => {
    const patchShelves = deferred<unknown[]>();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    let nativeCalls = 0;
    let patchCalls = 0;
    vi.mocked(bridge.request).mockImplementation((command) => {
      if (command === "getShelves") {
        nativeCalls += 1;
        if (nativeCalls === 1) {
          return Promise.reject(new Error("native shelf refresh failed"));
        }
        return Promise.resolve([]);
      }
      if (command === "getIdeaShelves") {
        patchCalls += 1;
        if (patchCalls === 1) return patchShelves.promise;
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    bridgeEvents.listener?.("gitStateChanged", { repoId: "/repo" });
    await flushMicrotasks();
    bridgeEvents.listener?.("commitStateChanged", { repoId: "/repo" });
    bridgeEvents.listener?.("gitStateChanged", { repoId: "/repo" });
    await flushMicrotasks();

    const callsBeforePatchSettled = {
      native: nativeCalls,
      patch: patchCalls,
    };

    patchShelves.resolve([]);
    await flushMicrotasks();

    expect(callsBeforePatchSettled.native).toBe(1);
    expect(callsBeforePatchSettled.patch).toBe(1);
    expect(nativeCalls).toBe(2);
    expect(patchCalls).toBe(2);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("retains valid working-tree data when a refresh fails", async () => {
    const existing = [
      { path: "kept.ts", status: "modified" as const, staged: false },
    ];
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    useCommitStore.setState({ changes: existing });
    vi.mocked(bridge.request).mockImplementation((command) => {
      if (command === "getWorkingTreeChanges") {
        return Promise.reject(new Error("refresh failed"));
      }
      return Promise.resolve([]);
    });

    bridgeEvents.listener?.("gitStateChanged", { repoId: "/repo" });
    await flushMicrotasks();

    expect(useCommitStore.getState().changes).toEqual(existing);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("keeps loading active until overlapping reads settle", async () => {
    const changes = deferred<unknown[]>();
    const shelves = deferred<unknown[]>();
    vi.mocked(bridge.request).mockImplementation((command) => {
      if (command === "getWorkingTreeChanges") return changes.promise;
      if (command === "getShelves") return shelves.promise;
      return Promise.resolve([]);
    });

    const changesRequest = useCommitStore.getState().fetchChanges();
    const shelvesRequest = useCommitStore.getState().fetchShelves();
    expect(useCommitStore.getState().loading).toBe(true);

    changes.resolve([]);
    await changesRequest;
    expect(useCommitStore.getState().loading).toBe(true);

    shelves.resolve([]);
    await shelvesRequest;
    expect(useCommitStore.getState().loading).toBe(false);
  });

  it("derives upstream availability from the refreshed current branch", async () => {
    vi.mocked(bridge.request).mockResolvedValueOnce([
      {
        name: "main",
        fullRef: "refs/heads/main",
        isRemote: false,
        isCurrent: true,
        isFavorite: false,
        upstream: "origin/main",
        ahead: 0,
        behind: 0,
        lastCommitHash: "abc",
      },
    ]);

    await useCommitStore.getState().refreshRefs();
    expect(useCommitStore.getState().currentBranch).toBe("main");
    expect(useCommitStore.getState().currentBranchHasUpstream).toBe(true);

    vi.mocked(bridge.request).mockResolvedValueOnce([
      {
        name: "local-only",
        fullRef: "refs/heads/local-only",
        isRemote: false,
        isCurrent: true,
        isFavorite: false,
        ahead: 0,
        behind: 0,
        lastCommitHash: "def",
      },
    ]);

    await useCommitStore.getState().refreshRefs();
    expect(useCommitStore.getState().currentBranch).toBe("local-only");
    expect(useCommitStore.getState().currentBranchHasUpstream).toBe(false);
  });
});

describe("commit-store selected commit payload", () => {
  beforeEach(() => {
    useCommitStore.setState({
      commitMessage: "",
      selectedFiles: new Set(),
      highlightedFiles: new Set(),
      amend: false,
      changes: [],
      loading: false,
      fetchChanges: vi.fn(),
    });
    vi.mocked(bridge.request).mockReset();
  });

  it("sends both rows of a path when its single row is checked", async () => {
    vi.mocked(bridge.request).mockResolvedValue({ success: true });
    useCommitStore.setState({
      commitMessage: "selected changes",
      amend: true,
      changes: [
        {
          path: "partial.txt",
          status: "modified",
          staged: true,
        },
        {
          path: "partial.txt",
          status: "modified",
          staged: false,
        },
        {
          path: "new-name.txt",
          oldPath: "old-name.txt",
          status: "renamed",
          staged: true,
        },
        {
          path: "ignored.txt",
          status: "modified",
          staged: false,
        },
      ],
      // One tick per path. partial.txt has an indexed and a working-tree
      // record, and both must reach the host so the commit takes the file as
      // it is on disk rather than only half of its change.
      selectedFiles: new Set(["partial.txt", "new-name.txt"]),
    });

    await expect(useCommitStore.getState().commit()).resolves.toBe(true);

    expect(bridge.request).toHaveBeenCalledWith("commitChanges", {
      message: "selected changes",
      amend: true,
      selections: [
        {
          path: "partial.txt",
          status: "modified",
          staged: true,
        },
        {
          path: "partial.txt",
          status: "modified",
          staged: false,
        },
        {
          path: "new-name.txt",
          oldPath: "old-name.txt",
          status: "renamed",
          staged: true,
        },
      ],
    });
    expect(useCommitStore.getState().commitMessage).toBe("");
    expect(useCommitStore.getState().amend).toBe(false);
  });

  it("keeps the draft and amend mode when the selected commit fails", async () => {
    vi.mocked(bridge.request).mockRejectedValue({
      code: "COMMIT_REJECTED",
      message: "hook rejected",
      recovery: "Review the hook output and retry.",
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    useCommitStore.setState({
      commitMessage: "keep this draft",
      amend: true,
      changes: [
        {
          path: "selected.txt",
          status: "modified",
          staged: false,
        },
      ],
      selectedFiles: new Set(["selected.txt"]),
    });

    await expect(useCommitStore.getState().commit()).resolves.toBe(false);

    expect(useCommitStore.getState().commitMessage).toBe("keep this draft");
    expect(useCommitStore.getState().amend).toBe(true);
    expect(useCommitStore.getState().operationError).toEqual({
      code: "COMMIT_REJECTED",
      message: "hook rejected",
      recovery: "Review the hook output and retry.",
    });
    consoleError.mockRestore();
  });

  it("sends the same selected identities through commit and push", async () => {
    vi.mocked(bridge.request).mockResolvedValue({ success: true });
    useCommitStore.setState({
      commitMessage: "selected and push",
      changes: [
        {
          path: "selected.txt",
          status: "added",
          staged: true,
        },
      ],
      selectedFiles: new Set(["selected.txt"]),
    });

    await expect(useCommitStore.getState().commitAndPush()).resolves.toBe(true);

    expect(bridge.request).toHaveBeenCalledWith("commitAndPush", {
      message: "selected and push",
      amend: false,
      selections: [
        {
          path: "selected.txt",
          status: "added",
          staged: true,
        },
      ],
    });
  });
});
