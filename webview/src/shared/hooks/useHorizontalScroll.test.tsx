import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
      <output data-testid="padding">{JSON.stringify(axis.padding)}</output>
      <button type="button" onClick={() => axis.realign("a")}>
        realign on a
      </button>
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
const padding = () =>
  JSON.parse(screen.getByTestId("padding").textContent ?? "");
/** A pane that refuses to scroll past `max`, the way a short range does. */
const clampAt = (node: HTMLDivElement, max: number) => {
  let value = 0;
  Object.defineProperty(node, "scrollLeft", {
    configurable: true,
    get: () => value,
    set: (next: number) => {
      value = Math.min(next, max);
    },
  });
};
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

  it("does not let a pane that clamped the write drag the leader back", () => {
    // Panes of unequal width have unequal maxima. The follower clamps the
    // write short, and its scroll event is still that write coming back: sent
    // on, it would pull the pane the user is dragging down to the clamped
    // value and leave the two out of lockstep for good.
    render(<Harness synced />);
    clampAt(pane("b"), 300);
    scrollTo(pane("a"), 400);
    expect(pane("b").scrollLeft).toBe(300);
    fireEvent.scroll(pane("b"));
    expect(pane("a").scrollLeft).toBe(400);
  });

  it("does not leave a pending echo behind for the pane's next mount", () => {
    // The write marks an echo the pane never gets to deliver; kept, the mark
    // would swallow the first real scroll of whatever mounts there next.
    const view = render(<Harness synced />);
    scrollTo(pane("a"), 120);
    expect(pane("b").scrollLeft).toBe(120);
    view.rerender(<Harness synced mountB={false} />);
    view.rerender(<Harness synced />);
    scrollTo(pane("b"), 500);
    expect(pane("a").scrollLeft).toBe(500);
  });

  it("pads the wider panes so every synchronised range ends together", () => {
    // 260px of content in a 200px pane and a 300px pane stops at 60 and at
    // -40: without the padding the narrow pane outruns the wide one by 100px
    // and the tail of the widest line is unreachable there.
    let announce: ((entries: { target: Element }[]) => void) | null = null;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: (entries: { target: Element }[]) => void) {
          announce = callback;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    try {
      const view = render(<Harness synced />);
      Object.defineProperty(pane("a"), "clientWidth", { value: 200 });
      Object.defineProperty(pane("b"), "clientWidth", { value: 300 });
      act(() => announce?.([{ target: pane("a") }, { target: pane("b") }]));
      expect(padding()).toEqual({ a: 0, b: 100 });
      // Decoupled, each pane keeps its own range and needs no padding.
      view.rerender(<Harness synced={false} />);
      expect(padding()).toEqual({});
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("brings the panes back together on realign", () => {
    render(<Harness synced={false} />);
    scrollTo(pane("a"), 300);
    expect(pane("b").scrollLeft).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "realign on a" }));
    expect(pane("b").scrollLeft).toBe(300);
    // The follower's echo of that write is swallowed like any other.
    fireEvent.scroll(pane("b"));
    expect(pane("a").scrollLeft).toBe(300);
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
