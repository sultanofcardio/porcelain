import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Commit } from "../../shared/types/git";
import {
  InteractiveRebaseDialog,
  type RebaseRow,
} from "./InteractiveRebaseDialog";

afterEach(cleanup);

function commit(hash: string, subject: string): Commit {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents: [],
    authorName: "Ada",
    authorEmail: "ada@example.com",
    authorDate: "2026-08-01T00:00:00.000Z",
    subject,
    body: "",
    refs: [],
  };
}

function ports(
  commits = [commit("aaaaaaa1", "first"), commit("bbbbbbb2", "second")],
) {
  return {
    load: vi.fn(async () => commits),
    run: vi.fn(async (_rows: RebaseRow[]) => undefined),
  };
}

describe("InteractiveRebaseDialog", () => {
  it("lists the commits oldest-first as picks", async () => {
    const p = ports();
    const view = render(
      <InteractiveRebaseDialog ports={p} onClose={vi.fn()} />,
    );

    await waitFor(() => expect(view.getByText("first")).toBeTruthy());
    const actions = view.getAllByLabelText(/^Action for/);
    expect(actions).toHaveLength(2);
    expect((actions[0] as HTMLSelectElement).value).toBe("pick");
  });

  it("sends the chosen actions and edited message", async () => {
    const p = ports();
    const view = render(
      <InteractiveRebaseDialog ports={p} onClose={vi.fn()} />,
    );

    await waitFor(() => expect(view.getByText("second")).toBeTruthy());
    fireEvent.change(view.getByLabelText("Action for bbbbbbb"), {
      target: { value: "reword" },
    });
    fireEvent.change(view.getByLabelText("Message for bbbbbbb"), {
      target: { value: "second, renamed" },
    });
    fireEvent.click(view.getByRole("button", { name: "Start Rebasing" }));

    await waitFor(() => expect(p.run).toHaveBeenCalled());
    expect(p.run.mock.calls[0][0]).toEqual([
      expect.objectContaining({ action: "pick", hash: "aaaaaaa1" }),
      expect.objectContaining({
        action: "reword",
        hash: "bbbbbbb2",
        message: "second, renamed",
      }),
    ]);
  });

  it("reorders rows with the move controls", async () => {
    const p = ports();
    const view = render(
      <InteractiveRebaseDialog ports={p} onClose={vi.fn()} />,
    );

    await waitFor(() => expect(view.getByText("first")).toBeTruthy());
    fireEvent.click(view.getByLabelText("Move bbbbbbb up"));
    fireEvent.click(view.getByRole("button", { name: "Start Rebasing" }));

    await waitFor(() => expect(p.run).toHaveBeenCalled());
    expect(p.run.mock.calls[0][0].map((row) => row.hash)).toEqual([
      "bbbbbbb2",
      "aaaaaaa1",
    ]);
  });

  it("refuses to start when the first row folds upward", async () => {
    const p = ports();
    const view = render(
      <InteractiveRebaseDialog ports={p} onClose={vi.fn()} />,
    );

    await waitFor(() => expect(view.getByText("first")).toBeTruthy());
    fireEvent.change(view.getByLabelText("Action for aaaaaaa"), {
      target: { value: "squash" },
    });

    expect(
      view
        .getByRole("button", { name: "Start Rebasing" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(view.getByText(/nothing above it to fold into/)).toBeTruthy();
    expect(p.run).not.toHaveBeenCalled();
  });

  it("previews the generated todo on request", async () => {
    const p = ports();
    const view = render(
      <InteractiveRebaseDialog ports={p} onClose={vi.fn()} />,
    );

    await waitFor(() => expect(view.getByText("first")).toBeTruthy());
    fireEvent.change(view.getByLabelText("Action for bbbbbbb"), {
      target: { value: "drop" },
    });
    fireEvent.click(view.getByRole("button", { name: "View Git Commands" }));

    const preview = view.getByLabelText("Generated rebase todo");
    expect(preview.textContent).toContain("pick aaaaaaa first");
    expect(preview.textContent).toContain("drop bbbbbbb second");
  });

  it("restores the loaded plan with Reset", async () => {
    const p = ports();
    const view = render(
      <InteractiveRebaseDialog ports={p} onClose={vi.fn()} />,
    );

    await waitFor(() => expect(view.getByText("first")).toBeTruthy());
    const reset = view.getByRole("button", { name: "Reset" });
    expect(reset.hasAttribute("disabled")).toBe(true);

    fireEvent.change(view.getByLabelText("Action for bbbbbbb"), {
      target: { value: "drop" },
    });
    expect(reset.hasAttribute("disabled")).toBe(false);
    fireEvent.click(reset);

    expect(
      (view.getByLabelText("Action for bbbbbbb") as HTMLSelectElement).value,
    ).toBe("pick");
  });

  it("keeps the dialog open and shows why a rebase failed", async () => {
    const p = ports();
    p.run = vi.fn(async () => {
      throw Object.assign(new Error("could not apply"), {
        recovery: "Resolve the conflict, then continue.",
      });
    });
    const onClose = vi.fn();
    const view = render(
      <InteractiveRebaseDialog ports={p} onClose={onClose} />,
    );

    await waitFor(() => expect(view.getByText("first")).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Start Rebasing" }));

    expect(await view.findByText(/could not apply/)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
