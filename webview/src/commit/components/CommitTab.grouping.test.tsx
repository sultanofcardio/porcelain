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
});
