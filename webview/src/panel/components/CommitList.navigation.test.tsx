import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const scrollToIndex = vi.fn();

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 28,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 28,
        size: 28,
        end: (index + 1) * 28,
        lane: 0,
      })),
    scrollToIndex,
  }),
}));

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
const { createGitLogStore, defaultGitLogStore } = await import(
  "../../shared/store/panel-store"
);
const { bridge } = await import("../../shared/bridge");
const { CommitList } = await import("./CommitList");
const panelStore = defaultGitLogStore.store;

function StoreWrapper({ children }: PropsWithChildren) {
  return (
    <GitLogStoreProvider store={panelStore}>{children}</GitLogStoreProvider>
  );
}

afterEach(() => {
  cleanup();
  scrollToIndex.mockClear();
  panelStore.setState({
    visibleCommits: [],
    commits: [],
    scrollTargetHash: null,
  });
});

describe("CommitList ref navigation", () => {
  it("does not paint a container outline when the commit list receives focus", () => {
    const view = render(<CommitList />, { wrapper: StoreWrapper });
    const list = view.getByLabelText("Commit list");

    fireEvent.focus(list);

    expect(list.style.outline).toBe("none");
  });

  it("aligns the Message header with every commit subject", () => {
    const commit = (hash: string, subject: string) =>
      ({
        hash,
        shortHash: hash,
        parents: [],
        authorName: "Ada",
        authorEmail: "ada@example.com",
        authorDate: "2026-07-18T00:00:00.000Z",
        subject,
        body: "",
        refs: [],
      }) as never;
    const commits = [
      commit("lane-zero", "Lane zero"),
      commit("lane-two", "Lane two"),
    ];
    panelStore.setState({
      commits,
      visibleCommits: commits,
      graphLayout: {
        "lane-zero": { column: 0, color: 0, lines: [] },
        "lane-two": { column: 2, color: 1, lines: [] },
      },
    });

    const view = render(<CommitList />, { wrapper: StoreWrapper });
    const header = view.getByText("Message").parentElement as HTMLElement;
    const firstRow = view
      .getByText("Lane zero")
      .closest(".commit-row") as HTMLElement;
    const secondRow = view
      .getByText("Lane two")
      .closest(".commit-row") as HTMLElement;

    expect(firstRow.style.paddingLeft).toBe(header.style.paddingLeft);
    expect(secondRow.style.paddingLeft).toBe(header.style.paddingLeft);
  });

  it("left-aligns the Date header with the commit date values", () => {
    const commit = {
      hash: "date-header",
      shortHash: "date-header",
      parents: [],
      authorName: "Ada",
      authorEmail: "ada@example.com",
      authorDate: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      subject: "Date header",
      body: "",
      refs: [],
    } as never;
    panelStore.setState({ commits: [commit], visibleCommits: [commit] });

    const view = render(<CommitList />, { wrapper: StoreWrapper });
    expect((view.getByText("Date") as HTMLElement).style.textAlign).toBe(
      "left",
    );
    expect((view.getByText("3 hours ago") as HTMLElement).style.textAlign).toBe(
      "left",
    );
  });

  it("scrolls the requested ref target into the center and consumes it", async () => {
    const commit = (hash: string) =>
      ({
        hash,
        shortHash: hash,
        parents: [],
        authorName: "",
        authorEmail: "",
        authorDate: "",
        subject: hash,
        body: "",
        refs: [],
      }) as never;
    panelStore.setState({
      commits: [commit("a"), commit("target")],
      visibleCommits: [commit("a"), commit("target")],
      scrollTargetHash: "target",
    });

    render(<CommitList />, { wrapper: StoreWrapper });

    await waitFor(() =>
      expect(scrollToIndex).toHaveBeenCalledWith(1, { align: "center" }),
    );
    expect(panelStore.getState().scrollTargetHash).toBeNull();
  });

  it("handles Arrow navigation only in the pane where the key event originated", async () => {
    const top = createGitLogStore({
      repoId: "repo-a",
      history: { kind: "ordinary" },
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      bridge,
    });
    const bottom = createGitLogStore({
      repoId: "repo-a",
      history: { kind: "ordinary" },
      followGlobalActiveRepo: false,
      showCurrentReachability: false,
      bridge,
    });
    const commit = (hash: string, subject: string) =>
      ({
        hash,
        shortHash: hash,
        parents: [],
        authorName: "Ada",
        authorEmail: "",
        authorDate: "2026-07-18T00:00:00.000Z",
        subject,
        body: "",
        refs: [],
      }) as never;
    const topCommits = [commit("top-a", "Top A"), commit("top-b", "Top B")];
    const bottomCommits = [
      commit("bottom-a", "Bottom A"),
      commit("bottom-b", "Bottom B"),
    ];
    top.store.setState({
      commits: topCommits,
      visibleCommits: topCommits,
      selectedCommitHash: "top-a",
      selectedCommitHashes: ["top-a"],
      lastSelectedCommitHash: "top-a",
    });
    bottom.store.setState({
      commits: bottomCommits,
      visibleCommits: bottomCommits,
      selectedCommitHash: "bottom-a",
      selectedCommitHashes: ["bottom-a"],
      lastSelectedCommitHash: "bottom-a",
    });

    try {
      const view = render(
        <>
          <div data-testid="top-list">
            <GitLogStoreProvider store={top.store}>
              <CommitList />
            </GitLogStoreProvider>
          </div>
          <div data-testid="bottom-list">
            <GitLogStoreProvider store={bottom.store}>
              <CommitList />
            </GitLogStoreProvider>
          </div>
        </>,
      );
      const topRow = within(view.getByTestId("top-list"))
        .getByText("Top A")
        .closest(".selectable-row");
      expect(topRow).toBeTruthy();

      fireEvent.keyDown(topRow as HTMLElement, { key: "ArrowDown" });

      await waitFor(() =>
        expect(top.store.getState().selectedCommitHash).toBe("top-b"),
      );
      expect(bottom.store.getState().selectedCommitHash).toBe("bottom-a");
    } finally {
      top.dispose();
      bottom.dispose();
    }
  });
});
