import { useState } from "react";
import { Tooltip } from "../../shared/components/Tooltip";
import { useDiffStore } from "../../shared/store/diff-store";
import { DiffSettingsMenu } from "./DiffSettingsMenu";

interface DiffToolbarProps {
  onStep: (delta: number) => void;
  onEditSource: () => void;
  onFile: (delta: number) => void;
}

export function DiffToolbar({
  onStep,
  onEditSource,
  onFile,
}: DiffToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const differences = useDiffStore((s) => s.differences);
  const collapse = useDiffStore((s) => s.collapseUnchanged);
  const toggleCollapse = useDiffStore((s) => s.toggleCollapseUnchanged);
  const sync = useDiffStore((s) => s.syncScroll);
  const toggleSync = useDiffStore((s) => s.toggleSyncScroll);

  return (
    <div className="diff-toolbar">
      <Tooltip text="Previous difference">
        <button type="button" className="diff-btn" onClick={() => onStep(-1)}>
          ↑
        </button>
      </Tooltip>
      <Tooltip text="Next difference">
        <button type="button" className="diff-btn" onClick={() => onStep(1)}>
          ↓
        </button>
      </Tooltip>
      <span className="diff-sep" />
      <Tooltip text="Edit source">
        <button type="button" className="diff-btn" onClick={onEditSource}>
          ✎
        </button>
      </Tooltip>
      <span className="diff-sep" />
      <Tooltip text="Previous file">
        <button type="button" className="diff-btn" onClick={() => onFile(-1)}>
          ‹
        </button>
      </Tooltip>
      <Tooltip text="Next file">
        <button type="button" className="diff-btn" onClick={() => onFile(1)}>
          ›
        </button>
      </Tooltip>
      <span className="diff-sep" />
      <Tooltip text="Collapse unchanged fragments">
        <button
          type="button"
          className={`diff-btn ${collapse ? "diff-btn-on" : ""}`}
          onClick={toggleCollapse}
        >
          ⤢
        </button>
      </Tooltip>
      <Tooltip text="Synchronise scrolling">
        <button
          type="button"
          className={`diff-btn ${sync ? "diff-btn-on" : ""}`}
          onClick={toggleSync}
        >
          ⇅
        </button>
      </Tooltip>

      <span className="diff-spring" />
      <span className="diff-count">
        {differences === 0
          ? "No differences"
          : `${differences} difference${differences === 1 ? "" : "s"}`}
      </span>
      <span className="diff-sep" />
      <div className="diff-menu-anchor">
        <Tooltip text="Diff settings">
          <button
            type="button"
            className={`diff-btn ${menuOpen ? "diff-btn-on" : ""}`}
            onClick={() => setMenuOpen((open) => !open)}
          >
            ⚙
          </button>
        </Tooltip>
        {menuOpen && <DiffSettingsMenu onClose={() => setMenuOpen(false)} />}
      </div>
    </div>
  );
}
