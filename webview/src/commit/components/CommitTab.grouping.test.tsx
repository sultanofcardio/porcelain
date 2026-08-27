import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../shared/bridge", () => ({
  bridge: {
    request: vi.fn().mockResolvedValue([]),
    onEvent: vi.fn(() => () => {}),
    setRepoContext: vi.fn(),
  },
}));

const { useCommitStore } = await import("../../shared/store/commit-store");
const { CommitTab } = await import("./CommitTab");
const { bridge } = await import("../../shared/bridge");

afterEach(cleanup);

/** Git reports a file with both indexed and working-tree changes twice. */
const changes = [
  { path: "src/router.ts", status: "modified", staged: true },
  { path: "src/router.ts", status: "modified", staged: false },
  { path: "src/handlers/webhooks.ts", status: "added", staged: true },
  { path: "src/handlers/webhooks.ts", status: "modified", staged: false },
  { path: "src/config.ts", status: "modified", staged: false },
  { path: "NOTES.md", status: "untracked", staged: false },
] as never;

function renderTab() {
  useCommitStore.setState({
    changes,
    selectedFiles: new Set<string>(),
    highlightedFiles: new Set<string>(),
    loading: false,
  });
  return render(<CommitTab />);
}

describe("Commit panel grouping", () => {
  it("has no Staged group", () => {
    const { queryByText } = renderTab();
    expect(queryByText(/^Staged$/i)).toBeNull();
  });

  it("shows one row per path, not one per index side", () => {
    const { getAllByText } = renderTab();

    // Three distinct tracked paths, even though git reported five records.
    expect(getAllByText("router.ts")).toHaveLength(1);
    expect(getAllByText("webhooks.ts")).toHaveLength(1);
    expect(getAllByText("config.ts")).toHaveLength(1);
  });

  it("keeps the indexed status so an add is not flattened to a modification", () => {
    // The working-tree duplicate of a staged record is always reported as
    // "modified"; picking that one would turn an add into a modification.
    const { getByText } = renderTab();
    const row = getByText("webhooks.ts").closest(".commit-file-item");
    expect(row?.querySelector(".commit-file-status")?.textContent).toBe("A");

    const plain = getByText("config.ts").closest(".commit-file-item");
    expect(plain?.querySelector(".commit-file-status")?.textContent).toBe("M");
  });

  it("still separates unversioned files from changes", () => {
    const { getByText } = renderTab();
    expect(getByText(/Unversioned Files/i)).toBeTruthy();
    expect(getByText("NOTES.md")).toBeTruthy();
  });

  it("nests merge conflicts inside Changes rather than beside it", () => {
    useCommitStore.setState({
      changes: [
        // Git reports an unmerged path as UU, which also yields a working-tree
        // record flattened to "modified".
        { path: "src/db/pool.ts", status: "conflicted", staged: true },
        { path: "src/db/pool.ts", status: "modified", staged: false },
        { path: "src/config.ts", status: "modified", staged: false },
      ] as never,
      selectedFiles: new Set<string>(),
      highlightedFiles: new Set<string>(),
      loading: false,
    });
    const { getByText, getAllByText } = render(<CommitTab />);

    const conflicts = getByText("Merge Conflicts").closest(".commit-group");
    const changes = getByText("Changes").closest(".commit-group");

    expect(changes).not.toBeNull();
    expect(conflicts).not.toBeNull();
    expect(changes?.contains(conflicts as Node)).toBe(true);

    // The conflicted path appears once, under the nested group, not also as an
    // ordinary change in the parent.
    expect(getAllByText("pool.ts")).toHaveLength(1);
    expect(conflicts?.contains(getByText("pool.ts"))).toBe(true);
  });

  it("counts the nested conflicts in the parent group total", () => {
    useCommitStore.setState({
      changes: [
        { path: "src/db/pool.ts", status: "conflicted", staged: true },
        { path: "src/db/pool.ts", status: "modified", staged: false },
        { path: "src/config.ts", status: "modified", staged: false },
      ] as never,
      selectedFiles: new Set<string>(),
      highlightedFiles: new Set<string>(),
      loading: false,
    });
    const { getByText } = render(<CommitTab />);

    const header = getByText("Changes").closest(".commit-group-header");
    expect(header?.textContent).toContain("2 files");
  });

  it("still shows Changes when a conflict is the only entry", () => {
    useCommitStore.setState({
      changes: [
        { path: "src/db/pool.ts", status: "conflicted", staged: true },
        { path: "src/db/pool.ts", status: "modified", staged: false },
      ] as never,
      selectedFiles: new Set<string>(),
      highlightedFiles: new Set<string>(),
      loading: false,
    });
    const { getByText } = render(<CommitTab />);

    // Without this the conflicts would have nowhere to nest and vanish.
    expect(getByText("Changes")).toBeTruthy();
    expect(getByText("Merge Conflicts")).toBeTruthy();
  });

  it("opens a conflicted file in the merge editor, not a diff", async () => {
    vi.mocked(bridge.request).mockClear();
    useCommitStore.setState({
      changes: [
        { path: "src/db/pool.ts", status: "conflicted", staged: true },
      ] as never,
      selectedFiles: new Set<string>(),
      highlightedFiles: new Set<string>(),
      loading: false,
    });
    const { getByText } = render(<CommitTab />);

    await useCommitStore.getState().openMergeEditor("src/db/pool.ts");
    expect(getByText("Merge Conflicts")).toBeTruthy();
    expect(bridge.request).toHaveBeenCalledWith("openMergeEditor", {
      file: "src/db/pool.ts",
    });
  });
});
