import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CleanupBranchesDialog,
  type MergedBranchRow,
} from "./CleanupBranchesDialog";
import { ManageRemotesDialog, type RemoteEntry } from "./ManageRemotesDialog";

afterEach(cleanup);

function remotePorts(initial: RemoteEntry[]) {
  const state = [...initial];
  return {
    list: vi.fn(async () => [...state]),
    add: vi.fn(async (name: string, url: string) => {
      state.push({ name, url });
    }),
    rename: vi.fn(async (oldName: string, newName: string) => {
      const row = state.find((r) => r.name === oldName);
      if (row) row.name = newName;
    }),
    setUrl: vi.fn(async (name: string, url: string) => {
      const row = state.find((r) => r.name === name);
      if (row) row.url = url;
    }),
    remove: vi.fn(async (name: string) => {
      const index = state.findIndex((r) => r.name === name);
      if (index >= 0) state.splice(index, 1);
    }),
  };
}

describe("ManageRemotesDialog", () => {
  it("lists remotes and adds a new one", async () => {
    const ports = remotePorts([]);
    const view = render(
      <ManageRemotesDialog ports={ports} onClose={vi.fn()} />,
    );

    await waitFor(() => expect(ports.list).toHaveBeenCalled());
    fireEvent.click(view.getByRole("button", { name: "Add Remote" }));
    fireEvent.change(view.getByLabelText("New remote name"), {
      target: { value: "origin" },
    });
    fireEvent.change(view.getByLabelText("New remote URL"), {
      target: { value: "git@example.com:owner/repo.git" },
    });
    fireEvent.click(view.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(ports.add).toHaveBeenCalledWith(
        "origin",
        "git@example.com:owner/repo.git",
      ),
    );
    expect(await view.findByText("origin")).toBeTruthy();
  });

  it("renames before re-pointing so the URL edit addresses the new name", async () => {
    const ports = remotePorts([
      { name: "origin", url: "https://example.com/one.git" },
    ]);
    const view = render(
      <ManageRemotesDialog ports={ports} onClose={vi.fn()} />,
    );

    await waitFor(() => expect(view.getByText("origin")).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Edit" }));
    fireEvent.change(view.getByLabelText("Name for origin"), {
      target: { value: "upstream" },
    });
    fireEvent.change(view.getByLabelText("URL for origin"), {
      target: { value: "https://example.com/two.git" },
    });
    fireEvent.click(view.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(ports.setUrl).toHaveBeenCalled());
    expect(ports.rename).toHaveBeenCalledWith("origin", "upstream");
    expect(ports.setUrl).toHaveBeenCalledWith(
      "upstream",
      "https://example.com/two.git",
    );
    expect(ports.rename.mock.invocationCallOrder[0]).toBeLessThan(
      ports.setUrl.mock.invocationCallOrder[0],
    );
  });

  it("refuses to save a remote missing a name or URL", async () => {
    const ports = remotePorts([]);
    const view = render(
      <ManageRemotesDialog ports={ports} onClose={vi.fn()} />,
    );

    await waitFor(() => expect(ports.list).toHaveBeenCalled());
    fireEvent.click(view.getByRole("button", { name: "Add Remote" }));
    fireEvent.change(view.getByLabelText("New remote name"), {
      target: { value: "origin" },
    });
    fireEvent.click(view.getByRole("button", { name: "Save" }));

    expect(await view.findByText(/needs both a name and a URL/)).toBeTruthy();
    expect(ports.add).not.toHaveBeenCalled();
  });

  it("surfaces a rejected remote operation", async () => {
    const ports = remotePorts([]);
    ports.add = vi.fn(async () => {
      throw Object.assign(new Error("A remote named 'origin' already exists"), {
        recovery: "Pick another name.",
      });
    });
    const view = render(
      <ManageRemotesDialog ports={ports} onClose={vi.fn()} />,
    );

    await waitFor(() => expect(ports.list).toHaveBeenCalled());
    fireEvent.click(view.getByRole("button", { name: "Add Remote" }));
    fireEvent.change(view.getByLabelText("New remote name"), {
      target: { value: "origin" },
    });
    fireEvent.change(view.getByLabelText("New remote URL"), {
      target: { value: "u" },
    });
    fireEvent.click(view.getByRole("button", { name: "Save" }));

    expect(await view.findByText(/already exists/)).toBeTruthy();
    expect(await view.findByText(/Pick another name/)).toBeTruthy();
  });
});

describe("CleanupBranchesDialog", () => {
  const rows: MergedBranchRow[] = [
    {
      name: "feature/done",
      lastCommitDate: "2026-08-01 10:00:00 -0500",
      upstream: "origin/feature/done",
      merged: true,
    },
    {
      name: "feature/open",
      lastCommitDate: "2026-08-20 11:00:00 -0500",
      merged: false,
    },
  ];

  function cleanupPorts(initial = rows) {
    return {
      list: vi.fn(async () => [...initial]),
      remove: vi.fn(async () => undefined),
    };
  }

  it("preselects merged branches only and shows their metadata", async () => {
    const ports = cleanupPorts();
    const view = render(
      <CleanupBranchesDialog
        ports={ports}
        targetLabel="main"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(view.getByText("feature/done")).toBeTruthy());
    expect(
      (view.getByLabelText("Select feature/done") as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (view.getByLabelText("Select feature/open") as HTMLInputElement).checked,
    ).toBe(false);
    // The ISO date is rendered as a plain calendar day.
    expect(view.getByText("2026-08-01")).toBeTruthy();
    expect(view.getByText("origin/feature/done")).toBeTruthy();
    expect(view.getByRole("button", { name: "Delete 1" })).toBeTruthy();
  });

  it("forces only the unmerged rows and warns in the button label", async () => {
    const ports = cleanupPorts();
    const view = render(
      <CleanupBranchesDialog
        ports={ports}
        targetLabel="main"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(view.getByText("feature/open")).toBeTruthy());
    fireEvent.click(view.getByLabelText("Select feature/open"));

    const button = view.getByRole("button", { name: /Delete 2/ });
    expect(button.textContent).toContain("1 unmerged");
    fireEvent.click(button);

    await waitFor(() => expect(ports.remove).toHaveBeenCalledTimes(2));
    expect(ports.remove).toHaveBeenCalledWith("feature/done", false);
    expect(ports.remove).toHaveBeenCalledWith("feature/open", true);
  });

  it("re-queries when the prefix filter changes", async () => {
    const ports = cleanupPorts();
    const view = render(
      <CleanupBranchesDialog
        ports={ports}
        targetLabel="main"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(ports.list).toHaveBeenCalledWith(""));
    fireEvent.change(view.getByLabelText("Filter by prefix"), {
      target: { value: "feature/" },
    });
    fireEvent.keyDown(view.getByLabelText("Filter by prefix"), {
      key: "Enter",
    });

    await waitFor(() => expect(ports.list).toHaveBeenCalledWith("feature/"));
  });

  it("reports which deletions failed without blocking the rest", async () => {
    const ports = cleanupPorts();
    ports.remove = vi.fn(async (name: string) => {
      if (name === "feature/done") throw new Error("still checked out");
    });
    const view = render(
      <CleanupBranchesDialog
        ports={ports}
        targetLabel="main"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(view.getByText("feature/done")).toBeTruthy());
    fireEvent.click(view.getByLabelText("Select feature/open"));
    fireEvent.click(view.getByRole("button", { name: /Delete 2/ }));

    expect(await view.findByText(/still checked out/)).toBeTruthy();
    // The second deletion still ran.
    expect(ports.remove).toHaveBeenCalledWith("feature/open", true);
  });
});
