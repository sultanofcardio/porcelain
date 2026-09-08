import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyReveals, computeChunks, computeFolds } from "../utils/diff-model";
import { FoldRow } from "./FoldRow";

const lines = (...values: string[]) => `${values.join("\n")}\n`;

describe("FoldRow", () => {
  afterEach(cleanup);

  // A change, forty equal lines, a change: 34 lines hidden behind the row.
  const body = Array.from({ length: 40 }, (_, i) => `line${i}`);
  const chunks = computeChunks(
    lines("old", ...body, "tail-old"),
    lines("new", ...body, "tail-new"),
  );
  const [fold] = computeFolds(chunks);
  const revealedBy = (head: number, tail: number) =>
    applyReveals([fold], new Map([[fold.key, { head, tail }]]))[0];

  it("shows the count, and names the next step with where its lines appear", () => {
    const { container } = render(<FoldRow fold={fold} end="tail" />);
    const button = screen.getByRole("button", {
      name: "Show 4 of 34 unchanged lines below",
    });
    expect(button.classList.contains("diff-fold-row-tail")).toBe(true);
    // The count is the row's only text: the step lives in the name alone.
    expect(button.textContent).toBe("34 unchanged lines");
  });

  it("counts each end's steps on its own, and calls the last the rest", () => {
    const { rerender } = render(<FoldRow fold={revealedBy(0, 4)} end="head" />);
    expect(
      screen.getByRole("button", {
        name: "Show 4 of 30 unchanged lines above",
      }),
    ).toBeTruthy();
    rerender(<FoldRow fold={revealedBy(0, 4)} end="tail" />);
    expect(
      screen.getByRole("button", {
        name: "Show 8 of 30 unchanged lines below",
      }),
    ).toBeTruthy();
    rerender(<FoldRow fold={revealedBy(4, 12)} end="tail" />);
    expect(
      screen.getByRole("button", {
        name: "Show all 18 unchanged lines below",
      }),
    ).toBeTruthy();
  });

  it("hands its fold to the reveal callback on click", () => {
    const onReveal = vi.fn();
    render(<FoldRow fold={fold} end="head" onReveal={onReveal} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onReveal).toHaveBeenCalledWith(fold);
  });

  it("sizes itself to the pane it is pinned in, after any parked columns", () => {
    render(<FoldRow fold={fold} end="head" width={420} inset={60} />);
    const button = screen.getByRole("button") as HTMLButtonElement;
    expect(button.style.width).toBe("420px");
    expect(button.style.paddingLeft).toBe("72px");
  });
});
