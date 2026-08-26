import { cleanup, render } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../shared/bridge", () => ({
  bridge: {
    request: vi.fn().mockResolvedValue([]),
    onEvent: vi.fn(() => () => {}),
    setRepoContext: vi.fn(),
  },
}));

const { GitLogStoreProvider } = await import(
  "../../shared/store/git-log-store-context"
);
const { defaultGitLogStore } = await import("../../shared/store/panel-store");
const { CommitRow } = await import("./CommitRow");
const panelStore = defaultGitLogStore.store;

function StoreWrapper({ children }: PropsWithChildren) {
  return (
    <GitLogStoreProvider store={panelStore}>{children}</GitLogStoreProvider>
  );
}

afterEach(() => {
  cleanup();
  panelStore.setState({ selectedCommitHashes: [] });
});

describe("CommitRow reachability styling", () => {
  const rowFor = (reachableFromCurrent?: boolean) => {
    const commit = {
      hash: "abc123",
      shortHash: "abc123",
      parents: [],
      authorName: "Ada",
      authorEmail: "ada@example.com",
      authorDate: "2026-07-18T00:00:00.000Z",
      subject: "Reachability commit",
      body: "",
      refs: [],
      ...(reachableFromCurrent === undefined ? {} : { reachableFromCurrent }),
    };
    const { getByText, unmount } = render(
      <CommitRow
        commit={commit}
        lane={{ column: 0, color: 0, lines: [] }}
        rowMaxColumn={0}
        columnWidths={{ author: 100, date: 130, hash: 70 }}
        visibleColumns={{ author: true, date: true, hash: true }}
        onCommitClick={() => {}}
      />,
      { wrapper: StoreWrapper },
    );
    const row = getByText("Reachability commit").closest(".selectable-row");
    return { row, unmount };
  };

  it("dims only the commits known to be outside the current branch", () => {
    const outside = rowFor(false);
    expect(outside.row?.classList.contains("not-reachable")).toBe(true);
    outside.unmount();

    const inside = rowFor(true);
    expect(inside.row?.classList.contains("not-reachable")).toBe(false);
    inside.unmount();

    // Comparison surfaces do not compute reachability at all; an unknown value
    // must render normally rather than dimming the entire log.
    const unknown = rowFor(undefined);
    expect(unknown.row?.classList.contains("not-reachable")).toBe(false);
    unknown.unmount();
  });

  it("keeps the selected class alongside dimming", () => {
    panelStore.setState({ selectedCommitHashes: ["abc123"] });
    const { row, unmount } = rowFor(false);

    expect(row?.classList.contains("not-reachable")).toBe(true);
    expect(row?.classList.contains("selected")).toBe(true);
    unmount();
  });

  it("reserves the same resize gutter before every visible metadata column", () => {
    const commit = {
      hash: "def456",
      shortHash: "def456",
      parents: [],
      authorName: "Ada",
      authorEmail: "ada@example.com",
      authorDate: "2026-07-18T00:00:00.000Z",
      subject: "Aligned commit",
      body: "",
      refs: [],
    };

    const { getByText } = render(
      <CommitRow
        commit={commit}
        lane={{ column: 0, color: 0, lines: [] }}
        rowMaxColumn={0}
        columnWidths={{ author: 100, date: 130, hash: 70 }}
        visibleColumns={{ author: true, date: true, hash: true }}
        onCommitClick={() => {}}
      />,
      { wrapper: StoreWrapper },
    );
    const row = getByText("Aligned commit").closest(".commit-row");
    const gutters = row?.querySelectorAll("[data-commit-column-gutter]");

    expect(gutters?.length).toBe(3);
    expect(
      [...(gutters ?? [])].every(
        (gutter) => (gutter as HTMLElement).style.width === "9px",
      ),
    ).toBe(true);
  });

  it("left-aligns the date value within its metadata column", () => {
    // A fixed offset from now keeps the rendered text free of the machine's
    // timezone, which an absolute timestamp was not.
    const commit = {
      hash: "date123",
      shortHash: "date123",
      parents: [],
      authorName: "Ada",
      authorEmail: "ada@example.com",
      authorDate: new Date(Date.now() - 5 * 60_000).toISOString(),
      subject: "Date alignment",
      body: "",
      refs: [],
    };

    const { getByText } = render(
      <CommitRow
        commit={commit}
        lane={{ column: 0, color: 0, lines: [] }}
        rowMaxColumn={0}
        columnWidths={{ author: 100, date: 130, hash: 70 }}
        visibleColumns={{ author: true, date: true, hash: true }}
        onCommitClick={() => {}}
      />,
      { wrapper: StoreWrapper },
    );

    const date = getByText("5 minutes ago");
    expect((date as HTMLElement).style.textAlign).toBe("left");
  });
});
