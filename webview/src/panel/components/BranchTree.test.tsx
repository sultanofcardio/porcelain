import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import type { PropsWithChildren, ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../shared/bridge", () => ({
  bridge: {
    request: vi.fn().mockResolvedValue(undefined),
    onEvent: vi.fn(() => () => {}),
    setRepoContext: vi.fn(),
  },
  bridgeWithProgress: vi.fn().mockResolvedValue(undefined),
}));

const { GitLogStoreProvider } = await import(
  "../../shared/store/git-log-store-context"
);
const { defaultGitLogStore } = await import("../../shared/store/panel-store");
const { bridge, bridgeWithProgress } = await import("../../shared/bridge");
const { useRepoStore } = await import("../../shared/store/repo-store");
const { BranchTree } = await import("./BranchTree");
const panelStore = defaultGitLogStore.store;

const originalState = panelStore.getState();

function StoreWrapper({ children }: PropsWithChildren) {
  return (
    <GitLogStoreProvider store={panelStore}>{children}</GitLogStoreProvider>
  );
}

function renderWithStore(ui: ReactElement) {
  return render(ui, { wrapper: StoreWrapper });
}

function seedTree(showTags = true) {
  useRepoStore.setState({ activeRepoId: "repo-a" });
  panelStore.setState({
    branches: [
      {
        name: "main",
        fullRef: "refs/heads/main",
        isRemote: false,
        isCurrent: true,
        isFavorite: true,
        ahead: 0,
        behind: 0,
        lastCommitHash: "branch-tip",
      },
      {
        name: "favorite",
        fullRef: "refs/heads/favorite",
        isRemote: false,
        isCurrent: false,
        isFavorite: true,
        upstream: "origin/favorite",
        ahead: 0,
        behind: 0,
        lastCommitHash: "favorite-tip",
      },
      {
        name: "feature/plain",
        fullRef: "refs/heads/feature/plain",
        isRemote: false,
        isCurrent: false,
        isFavorite: false,
        ahead: 0,
        behind: 0,
        lastCommitHash: "plain-tip",
      },
    ],
    tags: [
      {
        name: "v1.0.0",
        fullRef: "refs/tags/v1.0.0",
        hash: "tag-object",
        targetCommitHash: "tag-tip",
        isFavorite: true,
        isAnnotated: true,
      },
      {
        name: "v2.0.0",
        fullRef: "refs/tags/v2.0.0",
        hash: "tag-v2-object",
        targetCommitHash: "tag-v2-tip",
        isFavorite: false,
        isAnnotated: false,
      },
    ],
    commits: [],
    currentBranch: "main",
    selectedRefs: [],
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
      paths: [],
      sortTopo: false,
      firstParent: false,
      noMerges: false,
    },
    branchGroupByDirectory: false,
    showTags,
    singleClickAction: "filter",
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  panelStore.setState({
    ...originalState,
    branches: [],
    tags: [],
    commits: [],
    selectedRefs: [],
  });
  useRepoStore.setState({ activeRepoId: null });
});

describe("BranchTree unified refs", () => {
  it("honors Show Tags and selects a tag as a typed ref", () => {
    seedTree(false);
    const selectRef = vi.fn();
    const setFilter = vi.fn();
    panelStore.setState({ selectRef, setFilter });
    const { queryByText, rerender, getByText } = renderWithStore(
      <BranchTree />,
    );

    expect(queryByText("Tags")).toBeNull();

    panelStore.setState({ showTags: true });
    rerender(<BranchTree />);
    fireEvent.click(getByText("v1.0.0"));

    const tag = {
      type: "tag",
      name: "v1.0.0",
      fullRef: "refs/tags/v1.0.0",
    };
    expect(selectRef).toHaveBeenCalledWith(tag, "single", expect.any(Array));
    expect(setFilter).toHaveBeenCalledWith({ branch: tag.fullRef });
  });

  it("renders one prioritized status icon for current, favorite, and ordinary refs", () => {
    seedTree(true);
    const { getByText } = renderWithStore(<BranchTree />);

    const iconFor = (name: string) => {
      const row = getByText(name).closest(".selectable-row");
      if (!row) throw new Error(`missing row for ${name}`);
      expect(row.querySelectorAll("[data-ref-status-icon]")).toHaveLength(1);
      expect(
        within(row).queryByRole("button", { name: /as favorite/i }),
      ).toBeNull();
      return within(row).getByRole("img");
    };

    // Current wins even when main is also a persisted favorite.
    expect(iconFor("main").getAttribute("aria-label")).toBe("Current branch");
    expect(iconFor("favorite").getAttribute("aria-label")).toBe(
      "Favorite branch",
    );
    expect(iconFor("feature/plain").getAttribute("aria-label")).toBe("Branch");
    expect(iconFor("v1.0.0").getAttribute("aria-label")).toBe("Favorite tag");
    expect(iconFor("v2.0.0").getAttribute("aria-label")).toBe("Tag");
  });

  it("uses compact fixed heights for ref and directory rows", () => {
    seedTree(true);
    panelStore.setState({ branchGroupByDirectory: true });
    const { getByText } = renderWithStore(<BranchTree />);

    const branchRow = getByText("plain").closest(".selectable-row");
    expect((branchRow as HTMLElement).style.height).toBe("22px");
    expect(
      (getByText("feature").parentElement as HTMLElement).style.height,
    ).toBe("22px");
    expect(
      (getByText("v1.0.0").closest(".selectable-row") as HTMLElement).style
        .height,
    ).toBe("22px");
    expect((getByText("Local") as HTMLElement).style.height).toBe("24px");
    expect(
      (getByText("Current Branch: main") as HTMLElement).style.height,
    ).toBe("24px");
  });

  it("keeps a long current branch label inside its fixed-height row", () => {
    seedTree(true);
    const longBranch = "feat/0.5.1-branch-ux-reliability";
    panelStore.setState({
      branches: [
        {
          name: longBranch,
          fullRef: `refs/heads/${longBranch}`,
          isRemote: false,
          isCurrent: true,
          isFavorite: false,
          ahead: 0,
          behind: 0,
          lastCommitHash: "branch-tip",
        },
      ],
      currentBranch: longBranch,
    });
    const label = `Current Branch: ${longBranch}`;
    const { getByText } = renderWithStore(<BranchTree />);

    const row = getByText(label) as HTMLElement;
    expect(row.style.height).toBe("24px");
    expect(row.style.whiteSpace).toBe("nowrap");
    expect(row.style.overflow).toBe("hidden");
    expect(row.style.textOverflow).toBe("ellipsis");
    expect(row.title).toBe(label);
  });

  it("allows a ref row to be selected from the keyboard", () => {
    seedTree(true);
    const selectRef = vi.fn();
    const setFilter = vi.fn();
    panelStore.setState({ selectRef, setFilter });
    const { getByRole } = renderWithStore(<BranchTree />);

    const row = getByRole("treeitem", { name: /main/i });
    fireEvent.keyDown(row, { key: "Enter" });

    expect(selectRef).toHaveBeenCalledWith(
      { type: "local", name: "main", fullRef: "refs/heads/main" },
      "single",
      expect.any(Array),
    );
    expect(setFilter).toHaveBeenCalledWith({ branch: "refs/heads/main" });
  });

  it("offers Mark/Unmark as Favorite from a tag context menu", async () => {
    seedTree(true);
    const setFavorite = vi.fn().mockResolvedValue(undefined);
    panelStore.setState({ setFavorite });
    const { getByText } = renderWithStore(<BranchTree />);

    fireEvent.contextMenu(getByText("v1.0.0"), {
      clientX: 20,
      clientY: 30,
    });
    fireEvent.click(getByText("Unmark as Favorite"));

    await waitFor(() =>
      expect(setFavorite).toHaveBeenCalledWith(
        {
          type: "tag",
          name: "v1.0.0",
          fullRef: "refs/tags/v1.0.0",
        },
        false,
        "repo-a",
      ),
    );
  });

  it("keeps disabled menu actions focusable without dispatching them", () => {
    seedTree(true);
    const { getByText, getByLabelText } = renderWithStore(<BranchTree />);

    fireEvent.contextMenu(getByText("feature/plain"), {
      clientX: 20,
      clientY: 30,
    });
    const update = getByLabelText("Update");
    expect(update.getAttribute("role")).toBe("menuitem");
    expect(update.getAttribute("aria-disabled")).toBe("true");
    expect(update.hasAttribute("disabled")).toBe(false);
    expect((update as HTMLElement).tabIndex).toBe(0);
    (update as HTMLElement).focus();
    expect(document.activeElement).toBe(update);

    fireEvent.click(update);
    fireEvent.keyDown(update, { key: "Enter" });
    fireEvent.keyDown(update, { key: " " });

    expect(bridgeWithProgress).not.toHaveBeenCalledWith(
      "updateBranch",
      expect.anything(),
    );
  });

  it.each([
    ["Enter", "Enter"],
    ["Space", " "],
  ])("activates an enabled menu action exactly once with %s", async (_label, key) => {
    seedTree(true);
    useRepoStore.setState({ activeRepoId: "repo-tree" });
    const view = renderWithStore(<BranchTree />);

    fireEvent.contextMenu(view.getByText("feature/plain"), {
      clientX: 20,
      clientY: 30,
    });
    fireEvent.keyDown(
      view.getByRole("menuitem", { name: "Compare with Current" }),
      { key },
    );

    await waitFor(() => expect(bridge.request).toHaveBeenCalledTimes(1));
    expect(bridge.request).toHaveBeenCalledWith(
      "openCompareWithCurrent",
      {
        ref: {
          type: "local",
          name: "feature/plain",
          fullRef: "refs/heads/feature/plain",
        },
      },
      { repoId: "repo-tree" },
    );
  });

  it("exposes one interactive control per menu action and activates it once", async () => {
    seedTree(true);
    useRepoStore.setState({ activeRepoId: "repo-tree" });
    const view = renderWithStore(<BranchTree />);

    fireEvent.contextMenu(view.getByText("feature/plain"), {
      clientX: 20,
      clientY: 30,
    });

    const menu = view.getByRole("menu");
    const actions = within(menu).getAllByRole("menuitem");
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((action) => action.tagName === "BUTTON")).toBe(true);
    expect(within(menu).queryAllByRole("button")).toHaveLength(0);

    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "Compare with Current" }),
    );

    await waitFor(() => expect(bridge.request).toHaveBeenCalledTimes(1));
    expect(bridge.request).toHaveBeenCalledWith(
      "openCompareWithCurrent",
      {
        ref: {
          type: "local",
          name: "feature/plain",
          fullRef: "refs/heads/feature/plain",
        },
      },
      { repoId: "repo-tree" },
    );
  });

  it("compares the right-clicked local branch instead of prior multi-selection", async () => {
    seedTree(true);
    useRepoStore.setState({ activeRepoId: "repo-tree" });
    panelStore.setState({
      selectedRefs: [
        { type: "local", name: "main", fullRef: "refs/heads/main" },
        {
          type: "local",
          name: "favorite",
          fullRef: "refs/heads/favorite",
        },
      ],
    });
    const { getByText, getByLabelText } = renderWithStore(<BranchTree />);

    fireEvent.contextMenu(getByText("feature/plain"), {
      clientX: 20,
      clientY: 30,
    });
    fireEvent.click(getByLabelText("Compare with Current"));

    await waitFor(() =>
      expect(bridge.request).toHaveBeenCalledWith(
        "openCompareWithCurrent",
        {
          ref: {
            type: "local",
            name: "feature/plain",
            fullRef: "refs/heads/feature/plain",
          },
        },
        { repoId: "repo-tree" },
      ),
    );
  });

  it("compares the right-clicked remote branch through the bound surface", async () => {
    seedTree(true);
    useRepoStore.setState({ activeRepoId: "repo-tree" });
    panelStore.setState((state) => ({
      branches: [
        ...state.branches,
        {
          name: "origin/feature",
          fullRef: "refs/remotes/origin/feature",
          isRemote: true,
          isCurrent: false,
          isFavorite: false,
          ahead: 0,
          behind: 0,
          lastCommitHash: "remote-tip",
        },
      ],
    }));
    const { getByText, getByLabelText } = renderWithStore(<BranchTree />);

    fireEvent.contextMenu(getByText("origin/feature"), {
      clientX: 20,
      clientY: 30,
    });
    fireEvent.click(getByLabelText("Compare with Current"));

    await waitFor(() =>
      expect(bridge.request).toHaveBeenCalledWith(
        "openCompareWithCurrent",
        {
          ref: {
            type: "remote",
            name: "origin/feature",
            fullRef: "refs/remotes/origin/feature",
          },
        },
        { repoId: "repo-tree" },
      ),
    );
  });

  it("compares the right-clicked tag through the bound surface", async () => {
    seedTree(true);
    useRepoStore.setState({ activeRepoId: "repo-tree" });
    const { getByText, getByRole } = renderWithStore(<BranchTree />);

    fireEvent.contextMenu(getByText("v2.0.0"), {
      clientX: 20,
      clientY: 30,
    });
    fireEvent.click(getByRole("menuitem", { name: "Compare with Current" }));

    await waitFor(() =>
      expect(bridge.request).toHaveBeenCalledWith(
        "openCompareWithCurrent",
        {
          ref: {
            type: "tag",
            name: "v2.0.0",
            fullRef: "refs/tags/v2.0.0",
          },
        },
        { repoId: "repo-tree" },
      ),
    );
  });

  it("disables Compare with Current for the checked-out local branch", () => {
    seedTree(true);
    useRepoStore.setState({ activeRepoId: "repo-tree" });
    const { getByText, getByLabelText } = renderWithStore(<BranchTree />);

    fireEvent.contextMenu(getByText("main"), {
      clientX: 20,
      clientY: 30,
    });
    const compare = getByLabelText("Compare with Current");
    expect(compare.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(compare);

    expect(bridge.request).not.toHaveBeenCalledWith(
      "openCompareWithCurrent",
      expect.anything(),
      expect.anything(),
    );
  });

  it("does not toggle the configured single-click action back on a double click", () => {
    seedTree(true);
    const setFilter = vi.fn();
    panelStore.setState({ setFilter });
    const { getByText } = renderWithStore(<BranchTree />);
    const tag = getByText("v1.0.0");

    fireEvent.click(tag, { detail: 1 });
    fireEvent.click(tag, { detail: 2 });
    fireEvent.doubleClick(tag);

    expect(setFilter).toHaveBeenCalledTimes(1);
    expect(setFilter).toHaveBeenCalledWith({ branch: "refs/tags/v1.0.0" });
  });

  it("rebuilds repeated grouped and flat presentations without duplicating branches", () => {
    seedTree(false);
    panelStore.setState({
      branches: [
        ...panelStore.getState().branches,
        {
          name: "feature/other",
          fullRef: "refs/heads/feature/other",
          isRemote: false,
          isCurrent: false,
          isFavorite: false,
          ahead: 0,
          behind: 0,
          lastCommitHash: "other-tip",
        },
      ],
      branchGroupByDirectory: true,
    });
    const { getAllByText, rerender } = renderWithStore(<BranchTree />);

    expect(getAllByText("plain")).toHaveLength(1);
    expect(getAllByText("other")).toHaveLength(1);

    panelStore.setState({ branchGroupByDirectory: false });
    rerender(<BranchTree />);
    panelStore.setState({ branchGroupByDirectory: true });
    rerender(<BranchTree />);

    expect(getAllByText("plain")).toHaveLength(1);
    expect(getAllByText("other")).toHaveLength(1);
  });

  it("keeps a rebuilt remote directory foldable", () => {
    seedTree(false);
    panelStore.setState({
      branchGroupByDirectory: true,
      branches: [
        ...panelStore.getState().branches,
        {
          name: "origin/feature/one",
          fullRef: "refs/remotes/origin/feature/one",
          isRemote: true,
          isCurrent: false,
          isFavorite: false,
          ahead: 0,
          behind: 0,
          lastCommitHash: "remote-one",
        },
      ],
    });
    const { getByText, queryByText, rerender } = renderWithStore(
      <BranchTree />,
    );

    fireEvent.click(getByText("origin"));
    expect(queryByText("one")).toBeNull();

    panelStore.setState((state) => ({
      branches: [
        ...state.branches,
        {
          name: "origin/feature/two",
          fullRef: "refs/remotes/origin/feature/two",
          isRemote: true,
          isCurrent: false,
          isFavorite: false,
          ahead: 0,
          behind: 0,
          lastCommitHash: "remote-two",
        },
      ],
    }));
    rerender(<BranchTree />);
    expect(queryByText("two")).toBeNull();

    fireEvent.click(getByText("origin"));
    expect(getByText("one")).toBeTruthy();
    expect(getByText("two")).toBeTruthy();
  });

  it("restores grouped collapse state after a flat round trip", () => {
    seedTree(false);
    useRepoStore.setState({ activeRepoId: "repo-a" });
    panelStore.setState({ branchGroupByDirectory: true });
    const view = renderWithStore(<BranchTree />);

    fireEvent.click(view.getByText("feature"));
    expect(view.queryByText("plain")).toBeNull();

    panelStore.setState({ branchGroupByDirectory: false });
    view.rerender(<BranchTree />);
    expect(view.getByText("feature/plain")).toBeTruthy();

    panelStore.setState({ branchGroupByDirectory: true });
    view.rerender(<BranchTree />);
    expect(view.queryByText("plain")).toBeNull();
  });

  it("temporarily expands matching directories without losing collapse state", () => {
    seedTree(false);
    useRepoStore.setState({ activeRepoId: "repo-a" });
    panelStore.setState({ branchGroupByDirectory: true });
    const view = renderWithStore(<BranchTree />);
    const search = view.getByPlaceholderText("Branch or tag");

    fireEvent.click(view.getByText("feature"));
    expect(view.queryByText("plain")).toBeNull();
    fireEvent.change(search, { target: { value: "plain" } });
    expect(view.getByText("plain")).toBeTruthy();
    fireEvent.change(search, { target: { value: "" } });
    expect(view.queryByText("plain")).toBeNull();
  });

  it("closes a repository-bound menu when the active repository changes", async () => {
    seedTree(false);
    useRepoStore.setState({ activeRepoId: "repo-a" });
    const view = renderWithStore(<BranchTree />);
    fireEvent.contextMenu(view.getByText("feature/plain"), {
      clientX: 20,
      clientY: 30,
    });
    expect(view.getByRole("menu")).toBeTruthy();

    act(() => useRepoStore.setState({ activeRepoId: "repo-b" }));
    view.rerender(<BranchTree />);
    await waitFor(() => expect(view.queryByRole("menu")).toBeNull());
  });

  it("closes a menu when the checked-out branch changes", async () => {
    seedTree(false);
    const view = renderWithStore(<BranchTree />);
    fireEvent.contextMenu(view.getByText("feature/plain"), {
      clientX: 20,
      clientY: 30,
    });
    expect(view.getByRole("menu")).toBeTruthy();

    act(() => panelStore.setState({ currentBranch: "favorite" }));
    view.rerender(<BranchTree />);

    await waitFor(() => expect(view.queryByRole("menu")).toBeNull());
  });

  it("does not carry current-row selection into another repository", () => {
    seedTree(false);
    const view = renderWithStore(<BranchTree />);
    const currentRow = view.getByText("Current Branch: main");
    fireEvent.click(currentRow);
    expect((currentRow as HTMLElement).style.background).toBe(
      "var(--selected-bg)",
    );

    act(() => useRepoStore.setState({ activeRepoId: "repo-b" }));
    view.rerender(<BranchTree />);

    expect(
      (view.getByText("Current Branch: main") as HTMLElement).style.background,
    ).toBe("transparent");
  });

  it("creates a branch from detached HEAD through the captured repository", async () => {
    seedTree(false);
    useRepoStore.setState({ activeRepoId: "repo-detached" });
    panelStore.setState((state) => ({
      branches: state.branches.map((branch) => ({
        ...branch,
        isCurrent: false,
      })),
      currentBranch: "",
      commits: [
        {
          hash: "detached-tip",
          parents: [],
          authorName: "Test Author",
          authorEmail: "test@example.com",
          authorDate: "2026-08-03T00:00:00.000Z",
          commitDate: "2026-08-03T00:00:00.000Z",
          subject: "Detached commit",
          body: "",
          refs: [{ type: "HEAD", name: "HEAD", fullRef: "HEAD" }],
        },
      ] as never[],
    }));
    const view = renderWithStore(<BranchTree />);

    fireEvent.click(view.getByRole("button", { name: "New Branch" }));
    expect(view.getByText("Create Branch from 'HEAD'")).toBeTruthy();
    fireEvent.change(view.getByLabelText("Branch Name:"), {
      target: { value: "detached-work" },
    });
    fireEvent.click(view.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(bridge.request).toHaveBeenCalledWith(
        "createBranch",
        {
          newBranchName: "detached-work",
          startPoint: "HEAD",
          checkout: true,
          force: false,
        },
        { repoId: "repo-detached" },
      ),
    );
  });

  it("shows the real create-branch error", async () => {
    seedTree(false);
    useRepoStore.setState({ activeRepoId: "repo-a" });
    vi.mocked(bridge.request).mockRejectedValueOnce(
      Object.assign(new Error("Repository unavailable"), {
        code: "REPO_NOT_FOUND",
        recovery: "Choose an available repository.",
      }),
    );
    const view = renderWithStore(<BranchTree />);
    fireEvent.contextMenu(view.getByText("feature/plain"), {
      clientX: 20,
      clientY: 30,
    });
    fireEvent.click(view.getByText("New Branch from 'feature/plain'..."));
    fireEvent.change(view.getByLabelText("Branch Name:"), {
      target: { value: "feature/new" },
    });
    fireEvent.click(view.getByRole("button", { name: "Create" }));

    expect(await view.findByText(/Repository unavailable/)).toBeTruthy();
    expect(view.queryByText(/already exists/)).toBeNull();
  });
});
