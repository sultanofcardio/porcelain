import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeHoverPosition, HoverCard } from "./HoverCard";

const viewport = { width: 1000, height: 600 };

describe("computeHoverPosition", () => {
  const anchor = { left: 300, right: 360, top: 200, bottom: 220 };

  it("sits above the line, left-aligned on the word, when there is room", () => {
    expect(
      computeHoverPosition({
        anchor,
        card: { width: 200, height: 80 },
        viewport,
      }),
    ).toEqual({
      top: 200 - 2 - 80,
      left: 300,
      placement: "above",
      maxHeight: 194,
    });
  });

  it("flips below when the card would not fit above", () => {
    const placed = computeHoverPosition({
      anchor,
      card: { width: 200, height: 250 },
      viewport,
    });
    expect(placed.placement).toBe("below");
    expect(placed.top).toBe(222);
    expect(placed.maxHeight).toBe(600 - 4 - 220 - 2);
  });

  it("takes the roomier side and caps its height when neither side fits", () => {
    const low = { left: 300, right: 360, top: 500, bottom: 520 };
    const placed = computeHoverPosition({
      anchor: low,
      card: { width: 200, height: 900 },
      viewport,
    });
    expect(placed.placement).toBe("above");
    expect(placed.maxHeight).toBe(500 - 2 - 4);
    expect(placed.top).toBe(4);
  });

  it("keeps the card inside the viewport sideways", () => {
    const edge = { left: 950, right: 990, top: 200, bottom: 220 };
    expect(
      computeHoverPosition({
        anchor: edge,
        card: { width: 200, height: 40 },
        viewport,
      }).left,
    ).toBe(1000 - 4 - 200);
    const wide = computeHoverPosition({
      anchor: edge,
      card: { width: 1200, height: 40 },
      viewport,
    });
    expect(wide.left).toBe(4);
  });
});

describe("HoverCard", () => {
  afterEach(cleanup);
  const anchor = { left: 40, right: 100, top: 300, bottom: 320 };

  it("renders each content as its own part, and the hint as a status line", () => {
    render(
      <HoverCard
        anchor={anchor}
        contents={["```ts\nconst a = 1\n```", "The **doc**"]}
        hint="⌘ click to go to definition"
        highlighter={null}
      />,
    );
    const card = screen.getByRole("tooltip");
    expect(card.querySelectorAll(".diff-hover-part")).toHaveLength(2);
    expect(card.querySelector("pre code")?.textContent).toBe("const a = 1");
    expect(card.querySelector("strong")?.textContent).toBe("doc");
    expect(card.querySelector(".diff-hover-status")?.textContent).toBe(
      "⌘ click to go to definition",
    );
    // Placed after its measure, over everything, and visible.
    expect(card.style.visibility).toBe("visible");
    expect(card.style.position).toBe("");
  });

  it("says its notice in place of contents", () => {
    render(
      <HoverCard
        anchor={anchor}
        contents={[]}
        notice="Save to enable hover"
        highlighter={null}
      />,
    );
    const card = screen.getByRole("tooltip");
    expect(card.querySelector(".diff-hover-notice")?.textContent).toBe(
      "Save to enable hover",
    );
    expect(card.querySelector(".diff-hover-part")).toBeNull();
    expect(card.querySelector(".diff-hover-status")).toBeNull();
  });

  it("tells the pointer's coming and going", () => {
    const onPointerEnter = vi.fn();
    const onPointerLeave = vi.fn();
    render(
      <HoverCard
        anchor={anchor}
        contents={["x"]}
        highlighter={null}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      />,
    );
    const card = screen.getByRole("tooltip");
    fireEvent.mouseEnter(card);
    fireEvent.mouseLeave(card);
    expect(onPointerEnter).toHaveBeenCalledTimes(1);
    expect(onPointerLeave).toHaveBeenCalledTimes(1);
  });
});
