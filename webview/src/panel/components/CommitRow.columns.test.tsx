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

afterEach(cleanup);

const commit = {
  hash: "0123456789abcdef",
  shortHash: "01234567",
  parents: [],
  authorName: "Ada",
  authorEmail: "ada@example.com",
  authorDate: new Date(Date.now() - 2 * 60_000).toISOString(),
  subject: "Column order",
  body: "",
  refs: [],
};

function renderRow(visibleColumns: {
  author: boolean;
  date: boolean;
  hash: boolean;
}) {
  return render(
    <CommitRow
      commit={commit}
      lane={{ column: 0, color: 0, lines: [] }}
      rowMaxColumn={0}
      columnWidths={{ author: 100, date: 130, hash: 70 }}
      visibleColumns={visibleColumns}
      onCommitClick={() => {}}
    />,
    { wrapper: StoreWrapper },
  );
}

/** Left-to-right order of the row's direct children that carry text. */
function textOrder(container: HTMLElement): string[] {
  const row = container.querySelector(".commit-row");
  return [...(row?.children ?? [])]
    .map((child) => (child.textContent ?? "").trim())
    .filter((text) => text.length > 0);
}

describe("CommitRow column order", () => {
  it("reads author, graph, summary, date, hash", () => {
    const { container } = renderRow({ author: true, date: true, hash: true });

    expect(textOrder(container)).toEqual([
      "Ada",
      "Column order",
      "2 minutes ago",
      "01234567",
    ]);
  });

  it("puts the graph strip between the author and the summary", () => {
    const { container } = renderRow({ author: true, date: true, hash: true });
    const row = container.querySelector(".commit-row");
    const children = [...(row?.children ?? [])];

    const author = children.findIndex((c) => c.textContent?.trim() === "Ada");
    const summary = children.findIndex(
      (c) => c.textContent?.trim() === "Column order",
    );
    // The graph is an overlay; the row reserves an empty strip for it to
    // draw into, and that strip is what keeps the two aligned.
    const strip = children.findIndex(
      (c) =>
        c.getAttribute("aria-hidden") === "true" &&
        !c.hasAttribute("data-commit-column-gutter"),
    );

    expect(author).toBeGreaterThanOrEqual(0);
    expect(strip).toBeGreaterThan(author);
    expect(summary).toBeGreaterThan(strip);
  });

  it("drops the author column and its gutter when it is hidden", () => {
    const { container } = renderRow({ author: false, date: true, hash: true });

    expect(textOrder(container)).toEqual([
      "Column order",
      "2 minutes ago",
      "01234567",
    ]);
    expect(
      container.querySelectorAll("[data-commit-column-gutter]"),
    ).toHaveLength(2);
  });
});
