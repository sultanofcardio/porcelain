import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bridge } from "../../shared/bridge";
import { useCommitStore } from "../../shared/store/commit-store";
import { Toolbar } from "./Toolbar";

vi.mock("../../shared/bridge", () => ({
  bridge: {
    request: vi.fn(),
    onEvent: vi.fn(() => () => {}),
  },
}));

function renderToolbar() {
  return render(
    <Toolbar
      onRefresh={vi.fn()}
      onShelve={vi.fn()}
      onRollback={vi.fn()}
      hasChanges
    />,
  );
}

describe("Commit toolbar actions", () => {
  beforeEach(() => {
    vi.mocked(bridge.request).mockReset();
    useCommitStore.setState({
      changes: [
        { path: "one.txt", status: "modified", staged: false },
        { path: "two.txt", status: "modified", staged: true },
      ],
      highlightedFiles: new Set(),
      currentBranchHasUpstream: false,
      showDiff: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(cleanup);

  it("enables Diff for exactly one highlighted row and opens that row", () => {
    useCommitStore.setState({
      highlightedFiles: new Set(["two.txt"]),
    });
    const view = renderToolbar();
    const button = view.getByRole("button", { name: "Show Diff" });

    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);

    // No side is named: the Commit panel always diffs the whole change
    // against HEAD, because staging is not part of its model.
    expect(useCommitStore.getState().showDiff).toHaveBeenCalledWith("two.txt");
  });

  it("disables Diff for zero or multiple highlighted rows", () => {
    const empty = renderToolbar();
    expect(
      (empty.getByRole("button", { name: "Show Diff" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    empty.unmount();

    useCommitStore.setState({
      highlightedFiles: new Set(["one.txt", "two.txt"]),
    });
    const multiple = renderToolbar();
    expect(
      (
        multiple.getByRole("button", {
          name: "Show Diff",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("disables Pull without an upstream and enables it when one is available", () => {
    const missing = renderToolbar();
    expect(
      (missing.getByRole("button", { name: "Pull" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    missing.unmount();

    useCommitStore.setState({ currentBranchHasUpstream: true });
    const available = renderToolbar();
    const pull = available.getByRole("button", { name: "Pull" });
    expect((pull as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(pull);
    expect(bridge.request).toHaveBeenCalledWith("pullBranch", {});
  });
});
