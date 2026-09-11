import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Highlighter } from "shiki";
import { renderMarkdown } from "../utils/hover-markdown";
import type { TextAnchor } from "../utils/text-target";

/** Where the card goes relative to the text it explains. */
export type HoverPlacement = "above" | "below";

interface HoverPositionInput {
  anchor: TextAnchor;
  card: { width: number; height: number };
  viewport: { width: number; height: number };
}

/** The gap between the card and the line, and the card's distance from the viewport edge. */
const GAP = 2;
const MARGIN = 4;

/**
 * Where the card sits: its left edge on the word's, kept inside the
 * viewport; above the line when there is room, else below, and where
 * neither fits on the side with more room, with the height it may use
 * there. The same flip-and-clamp the tooltip does, left-aligned to the
 * word the way the editor's hover widget is.
 */
export function computeHoverPosition({
  anchor,
  card,
  viewport,
}: HoverPositionInput): {
  top: number;
  left: number;
  placement: HoverPlacement;
  maxHeight: number;
} {
  const roomAbove = anchor.top - GAP - MARGIN;
  const roomBelow = viewport.height - MARGIN - anchor.bottom - GAP;
  let placement: HoverPlacement = "above";
  if (card.height > roomAbove) {
    placement =
      card.height <= roomBelow || roomBelow > roomAbove ? "below" : "above";
  }
  const room = placement === "above" ? roomAbove : roomBelow;
  const maxHeight = Math.max(0, room);
  const height = Math.min(card.height, maxHeight);
  const top =
    placement === "above" ? anchor.top - GAP - height : anchor.bottom + GAP;
  const maxLeft = Math.max(MARGIN, viewport.width - MARGIN - card.width);
  const left = Math.min(maxLeft, Math.max(MARGIN, anchor.left));
  return { top, left, placement, maxHeight };
}

interface HoverCardProps {
  anchor: TextAnchor;
  /** Markdown parts, one per provider content, rendered in order. */
  contents: readonly string[];
  /** A plain sentence in place of contents: what the card says when it cannot ask. */
  notice?: string | null;
  /** The status line under the contents, when there is one. */
  hint?: string | null;
  highlighter: Highlighter | null;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}

/**
 * The hover card, styled after VS Code's editor hover widget and portalled
 * over everything the way the tooltip is. Measured once after it renders
 * and then placed, in a layout effect, so it never paints at a stand-in
 * position first.
 */
export function HoverCard({
  anchor,
  contents,
  notice = null,
  hint = null,
  highlighter,
  onPointerEnter,
  onPointerLeave,
}: HoverCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<{
    top: number;
    left: number;
    placement: HoverPlacement;
    maxHeight: number;
  } | null>(null);

  // Measured after every render, since any change to the contents can change
  // the card's size; the placement is only written when it moved, so the
  // render it causes is the last one.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    // Measured unconstrained: a card placed before knows nothing of the room
    // it will have, and its previous clamp would otherwise feed the next.
    card.style.maxHeight = "";
    const box = card.getBoundingClientRect();
    const next = computeHoverPosition({
      anchor,
      card: { width: box.width, height: box.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    setPlaced((previous) =>
      previous &&
      previous.top === next.top &&
      previous.left === next.left &&
      previous.placement === next.placement &&
      previous.maxHeight === next.maxHeight
        ? previous
        : next,
    );
  });

  let body: ReactNode;
  if (notice !== null) {
    body = <div className="diff-hover-notice">{notice}</div>;
  } else {
    body = contents.map((markdown, index) => (
      <div
        // Parts are positional: a provider's contents have no identity of
        // their own beyond their order.
        key={index}
        className="diff-hover-part"
      >
        {renderMarkdown(markdown, { highlighter })}
      </div>
    ));
  }

  return createPortal(
    <div
      ref={cardRef}
      className={`diff-hover diff-hover-${placed?.placement ?? "above"}`}
      role="tooltip"
      style={{
        top: placed?.top ?? 0,
        left: placed?.left ?? 0,
        maxHeight: placed ? placed.maxHeight : undefined,
        visibility: placed ? "visible" : "hidden",
      }}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
    >
      {body}
      {hint && <div className="diff-hover-status">{hint}</div>}
    </div>,
    document.body,
  );
}
