import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LineMeasurer } from "../components/metrics";
import { type MatchTarget, useRevealMatch } from "./useRevealMatch";

type Side = "left" | "right";

function Harness({
  target,
  charWidth,
  measure,
  reveal,
}: {
  target: MatchTarget<Side> | null;
  charWidth: number;
  measure: LineMeasurer | null;
  reveal: (pane: Side, from: number, to: number, obscuredLeft?: number) => void;
}) {
  useRevealMatch(target, { charWidth, measure, reveal });
  return null;
}

const match = (
  overrides: Partial<MatchTarget<Side>> = {},
): MatchTarget<Side> => ({
  pane: "right",
  text: "\tconst needle = 1;",
  line: 4,
  start: 7,
  end: 13,
  inset: 10,
  ...overrides,
});

describe("useRevealMatch", () => {
  afterEach(cleanup);

  it("reveals the match's span in cells when nothing can be measured", () => {
    const reveal = vi.fn();
    render(
      <Harness target={match()} charWidth={7} measure={null} reveal={reveal} />,
    );
    // A tab runs to column 8, so col 7 is 14 cells in and col 13 is 20.
    expect(reveal).toHaveBeenCalledWith("right", 10 + 14 * 7, 10 + 20 * 7, 0);
  });

  it("reads rendered pixels through the measurer's prefix when there is one", () => {
    const reveal = vi.fn();
    const measure = ((line: string) => line.length) as LineMeasurer;
    measure.prefix = (_line, col) => col * 3;
    render(
      <Harness
        target={match({ inset: 90, obscuredLeft: 80 })}
        charWidth={7}
        measure={measure}
        reveal={reveal}
      />,
    );
    expect(reveal).toHaveBeenCalledWith("right", 90 + 21, 90 + 39, 80);
  });

  it("runs once per match, not once per render", () => {
    // Scrolling re-renders with a new geometry object every time; re-running
    // then would fight the user's own scrolling.
    const reveal = vi.fn();
    const { rerender } = render(
      <Harness target={match()} charWidth={7} measure={null} reveal={reveal} />,
    );
    rerender(
      <Harness target={match()} charWidth={8} measure={null} reveal={reveal} />,
    );
    expect(reveal).toHaveBeenCalledTimes(1);
    rerender(
      <Harness
        target={match({ start: 14, end: 20 })}
        charWidth={8}
        measure={null}
        reveal={reveal}
      />,
    );
    expect(reveal).toHaveBeenCalledTimes(2);
  });

  it("does nothing without a match", () => {
    const reveal = vi.fn();
    render(
      <Harness target={null} charWidth={7} measure={null} reveal={reveal} />,
    );
    expect(reveal).not.toHaveBeenCalled();
  });
});
