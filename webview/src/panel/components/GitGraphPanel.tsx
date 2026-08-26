import { useCallback, useEffect, useRef, useState } from "react";
import { CommitList } from "./CommitList";
import { GitGraphSvg } from "./GitGraphSvg";

export function GitGraphPanel({
  onRefreshComparison,
}: {
  onRefreshComparison?: () => void | Promise<void>;
} = {}) {
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [graphOffset, setGraphOffset] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphScrollGroupRef = useRef<SVGGElement | null>(null);
  const pendingScrollTopRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);

  const handleScroll = useCallback((nextScrollTop: number) => {
    graphScrollGroupRef.current?.setAttribute(
      "transform",
      `translate(0, ${-nextScrollTop})`,
    );
    pendingScrollTopRef.current = nextScrollTop;
    if (scrollFrameRef.current !== null) return;

    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      setScrollTop(pendingScrollTopRef.current);
    });
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    ro.observe(node);
    setContainerHeight(node.clientHeight);

    return () => ro.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
      }
    },
    [],
  );

  const svgHeight = containerHeight - headerHeight;

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        position: "relative",
        overflow: "hidden",
        display: "flex",
        minHeight: 0,
      }}
    >
      <CommitList
        onScroll={handleScroll}
        onHeaderHeight={setHeaderHeight}
        onGraphOffset={setGraphOffset}
        onRefreshComparison={onRefreshComparison}
      />
      <GitGraphSvg
        scrollGroupRef={graphScrollGroupRef}
        scrollTop={scrollTop}
        height={svgHeight > 0 ? svgHeight : 0}
        topOffset={headerHeight}
        leftOffset={graphOffset}
      />
    </div>
  );
}
