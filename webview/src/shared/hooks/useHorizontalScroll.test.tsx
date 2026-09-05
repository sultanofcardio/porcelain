import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useHorizontalScroll } from "./useHorizontalScroll";

const KEYS = ["a", "b"] as const;

/** Two panes on one axis, wired the way the diff surfaces wire theirs. */
function Harness({
  synced,
  mountB = true,
}: {
  synced: boolean;
  mountB?: boolean;
}) {
  const axis = useHorizontalScroll(KEYS, synced);
  return (
    <div>
      <div
        data-testid="a"
        ref={axis.refFor("a")}
        onScroll={(event) =>
          axis.onScrollX("a", event.currentTarget.scrollLeft)
        }
      />
      {mountB && (
        <div
          data-testid="b"
          ref={axis.refFor("b")}
          onScroll={(event) =>
            axis.onScrollX("b", event.currentTarget.scrollLeft)
          }
        />
      )}
      <output data-testid="positions">{JSON.stringify(axis.positions)}</output>
      <div
        data-testid="viewport"
        tabIndex={0}
        onKeyDown={(event) => axis.arrowScroll("a", event)}
      >
        <button type="button">inner</button>
      </div>
      <button type="button" onClick={() => axis.reveal("a", 500, 520)}>
        reveal far right
      </button>
      <button type="button" onClick={() => axis.reveal("a", 100, 120)}>
        reveal left
      </button>
      <button type="button" onClick={() => axis.reveal("a", 150, 160, 76)}>
        reveal past the numbers
      </button>
    </div>
  );
}

const pane = (id: string) => screen.getByTestId(id) as HTMLDivElement;
const read = () =>
  JSON.parse(screen.getByTestId("positions").textContent ?? "");
const scrollTo = (node: HTMLDivElement, x: number) => {
  node.scrollLeft = x;
  fireEvent.scroll(node);
};

describe("useHorizontalScroll", () => {
  afterEach(cleanup);

  it("carries the other panes along while synchronised", () => {
    render(<Harness synced />);
    scrollTo(pane("a"), 120);
    expect(pane("b").scrollLeft).toBe(120);
    expect(read()).toEqual({ a: 120, b: 0 });
  });

  it("leaves the other panes alone while decoupled", () => {
    render(<Harness synced={false} />);
    scrollTo(pane("a"), 120);
    expect(pane("b").scrollLeft).toBe(0);
  });

  it("does not broadcast a pane's echo of the write that moved it", () => {
    // A wheel animates the source pane through many positions; each is
    // written to the other pane, whose own scroll event then reports it a
    // frame later. Sent back, that stale value would yank the source pane
    // and end the gesture a few pixels in.
    render(<Harness synced />);
    scrollTo(pane("a"), 120);
    expect(pane("b").scrollLeft).toBe(120);
    pane("a").scrollLeft = 160;
    fireEvent.scroll(pane("b"));
    expect(pane("a").scrollLeft).toBe(160);
    // The echo is still recorded, and the pane's next real scroll is not
    // mistaken for one.
    expect(read()).toEqual({ a: 120, b: 120 });
    scrollTo(pane("b"), 300);
    expect(pane("a").scrollLeft).toBe(300);
  });

  it("forgets a pane's position when the pane goes away", () => {
    // Toggling split to unified and back replaces a pane with a fresh node
    // that mounts at 0 and fires no scroll event. A position left over from
    // the old node would be handed to the editor as its scroll offset, and
    // it would draw the caret and read clicks that far out of step.
    const view = render(<Harness synced={false} />);
    scrollTo(pane("b"), 400);
    expect(read()).toEqual({ a: 0, b: 400 });
    view.rerender(<Harness synced={false} mountB={false} />);
    expect(read()).toEqual({ a: 0 });
    view.rerender(<Harness synced={false} />);
    expect(read()).toEqual({ a: 0, b: 0 });
  });

  it("does not chase a sub-pixel disagreement between panes", () => {
    // Device-pixel snapping can leave two panes a fraction apart; writing the
    // fraction back would bounce scroll events between them forever.
    render(<Harness synced />);
    pane("b").scrollLeft = 120.4;
    scrollTo(pane("a"), 120);
    expect(pane("b").scrollLeft).toBe(120.4);
  });

  it("scrolls the owning pane by a browser step on the viewport's arrows", () => {
    render(<Harness synced={false} />);
    const viewport = screen.getByTestId("viewport");
    fireEvent.keyDown(viewport, { key: "ArrowRight" });
    fireEvent.keyDown(viewport, { key: "ArrowRight" });
    expect(pane("a").scrollLeft).toBe(80);
    fireEvent.keyDown(viewport, { key: "ArrowLeft" });
    expect(pane("a").scrollLeft).toBe(40);
    // Modified arrows and arrows aimed at something inside stay theirs.
    fireEvent.keyDown(viewport, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(screen.getByRole("button", { name: "inner" }), {
      key: "ArrowRight",
    });
    expect(pane("a").scrollLeft).toBe(40);
  });

  it("reveals a span with the least scroll that brings it into view", () => {
    render(<Harness synced={false} />);
    Object.defineProperty(pane("a"), "clientWidth", { value: 300 });
    fireEvent.click(screen.getByRole("button", { name: "reveal far right" }));
    // Past the right edge: the span's end lands a margin inside the pane.
    expect(pane("a").scrollLeft).toBe(520 - 300 + 24);
    fireEvent.click(screen.getByRole("button", { name: "reveal left" }));
    // Past the left edge: its start lands a margin inside the pane.
    expect(pane("a").scrollLeft).toBe(100 - 24);
    fireEvent.click(screen.getByRole("button", { name: "reveal left" }));
    // Already in view: nothing moves.
    expect(pane("a").scrollLeft).toBe(76);
  });

  it("counts content under sticky columns as out of view", () => {
    render(<Harness synced={false} />);
    Object.defineProperty(pane("a"), "clientWidth", { value: 300 });
    pane("a").scrollLeft = 100;
    // Visible text starts 76px in, at 176: a span at 150 is hidden under the
    // numbers, and comes out a margin past them.
    fireEvent.click(
      screen.getByRole("button", { name: "reveal past the numbers" }),
    );
    expect(pane("a").scrollLeft).toBe(150 - 24 - 76);
  });
});
