import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { bridge } from "../../shared/bridge";
import { Tooltip } from "../../shared/components/Tooltip";
import "../../shared/components/Tooltip.css";
import { useCommitStore } from "../../shared/store/commit-store";

export function CommitMessageArea() {
  const {
    commitMessage,
    setCommitMessage,
    amend,
    setAmend,
    commit,
    loading,
    selectedFiles,
    signOff,
    setSignOff,
    noVerify,
    setNoVerify,
    author,
    setAuthor,
    loadMessageTemplate,
  } = useCommitStore();
  const [showOptions, setShowOptions] = useState(false);

  const [showDropdown, setShowDropdown] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [recentMessages, setRecentMessages] = useState<string[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const historyBtnRef = useRef<HTMLSpanElement>(null);
  const historyDropdownRef = useRef<HTMLDivElement>(null);

  // An empty draft is seeded from commit.template, or git's own MERGE_MSG
  // mid-merge. A message the user already typed is never overwritten.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || commitMessage) return;
    seededRef.current = true;
    void loadMessageTemplate();
  }, [commitMessage, loadMessageTemplate]);

  const hasSelectedFiles = selectedFiles.size > 0;
  const canCommit =
    commitMessage.trim().length > 0 && hasSelectedFiles && !loading;

  const handleCommit = useCallback(async () => {
    if (!canCommit) return;
    await commit();
  }, [canCommit, commit]);

  const handleCommitAndPush = useCallback(async () => {
    if (!canCommit) return;
    setShowDropdown(false);
    const committed = await commit();
    if (committed) {
      await bridge.request("openPushPanel");
    }
  }, [canCommit, commit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Ctrl/Cmd + Enter to commit
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleCommit();
      }
    },
    [handleCommit],
  );

  const handleHistoryClick = useCallback(async () => {
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    try {
      const messages = (await bridge.request(
        "getRecentCommitMessages",
      )) as string[];
      setRecentMessages(messages ?? []);
    } catch {
      setRecentMessages([]);
    }
    setShowHistory(true);
  }, [showHistory]);

  const handleSelectMessage = useCallback(
    (msg: string) => {
      setCommitMessage(msg);
      setShowHistory(false);
    },
    [setCommitMessage],
  );

  // Close history dropdown on outside click
  useEffect(() => {
    if (!showHistory) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      // Check if click is inside the dropdown or the button
      if (historyBtnRef.current?.contains(target)) return;
      if (historyDropdownRef.current?.contains(target)) return;
      setShowHistory(false);
    };
    // Use setTimeout to avoid the current click event triggering close immediately
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside, true);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside, true);
    };
  }, [showHistory]);

  return (
    <div className="commit-message-area">
      <textarea
        className="commit-message-textarea"
        placeholder="Commit message (Ctrl+Enter to commit)"
        value={commitMessage}
        onChange={(e) => setCommitMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
      />

      <div className="commit-amend-row">
        <label>
          <input
            type="checkbox"
            checked={amend}
            onChange={(e) => setAmend(e.target.checked)}
          />
          Amend
        </label>
        <label>
          <input
            type="checkbox"
            checked={signOff}
            onChange={(e) => setSignOff(e.target.checked)}
          />
          Sign-off
        </label>
        <Tooltip text="Commit options">
          <span
            onClick={() => setShowOptions((value) => !value)}
            aria-label="Commit options"
            style={{
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              borderRadius: 3,
              padding: 2,
              opacity: showOptions ? 1 : 0.6,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="2" stroke="currentColor" />
              <path
                d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2"
                stroke="currentColor"
              />
            </svg>
          </span>
        </Tooltip>
        {showOptions && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              width: "100%",
              padding: "6px 0 2px",
            }}
          >
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={noVerify}
                onChange={(e) => setNoVerify(e.target.checked)}
              />
              Skip commit hooks
            </label>
            <label
              style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}
            >
              <span style={{ whiteSpace: "nowrap" }}>Author</span>
              <input
                type="text"
                aria-label="Commit author"
                value={author}
                placeholder="Name &lt;email&gt; (defaults to you)"
                onChange={(e) => setAuthor(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: "2px 6px",
                  fontSize: "12px",
                  border: "1px solid var(--vscode-input-border, #3c3c3c)",
                  background: "var(--vscode-input-background, #3c3c3c)",
                  color: "var(--vscode-input-foreground, #ccc)",
                  borderRadius: 3,
                  outline: "none",
                }}
              />
            </label>
          </div>
        )}
        <Tooltip text="Recent commit messages">
          <span
            ref={historyBtnRef}
            onClick={handleHistoryClick}
            style={{
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              borderRadius: 3,
              padding: 2,
              transition: "background 0.15s, opacity 0.15s",
              opacity: showHistory ? 1 : 0.6,
              background: showHistory
                ? "var(--vscode-toolbar-activeBackground, rgba(0,0,0,0.1))"
                : "transparent",
            }}
            onMouseEnter={(e) => {
              if (!showHistory)
                (e.currentTarget as HTMLElement).style.opacity = "1";
            }}
            onMouseLeave={(e) => {
              if (!showHistory)
                (e.currentTarget as HTMLElement).style.opacity = "0.6";
            }}
            onMouseDown={(e) => {
              (e.currentTarget as HTMLElement).style.background =
                "var(--vscode-toolbar-activeBackground, rgba(0,0,0,0.15))";
            }}
            onMouseUp={(e) => {
              (e.currentTarget as HTMLElement).style.background = showHistory
                ? "var(--vscode-toolbar-activeBackground, rgba(0,0,0,0.1))"
                : "transparent";
            }}
          >
            <HistoryIcon />
          </span>
        </Tooltip>
        {showHistory &&
          createPortal(
            <HistoryDropdown
              ref={historyDropdownRef}
              anchorRef={historyBtnRef}
              messages={recentMessages}
              onSelect={handleSelectMessage}
              onClose={() => setShowHistory(false)}
            />,
            document.body,
          )}
      </div>

      <div className="commit-buttons">
        <button
          type="button"
          className="commit-btn commit-btn-primary"
          disabled={!canCommit}
          onClick={handleCommit}
        >
          Commit
        </button>

        <div className="commit-dropdown" ref={dropdownRef}>
          <button
            type="button"
            className="commit-btn commit-btn-secondary commit-split-main"
            disabled={!canCommit}
            onClick={handleCommitAndPush}
          >
            Commit and Push...
          </button>
          <button
            type="button"
            className="commit-btn commit-btn-secondary commit-split-arrow"
            disabled={!canCommit}
            onClick={() => setShowDropdown(!showDropdown)}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="4,6 8,10 12,6" />
            </svg>
          </button>
          {showDropdown && (
            <div className="commit-dropdown-menu">
              <button
                type="button"
                className="commit-dropdown-item"
                onClick={handleCommitAndPush}
              >
                Commit and Push
              </button>
              <div className="commit-dropdown-separator" />
              <button
                type="button"
                className="commit-dropdown-item"
                onClick={() => {
                  setShowDropdown(false);
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface HistoryDropdownProps {
  anchorRef: React.RefObject<HTMLSpanElement | null>;
  messages: string[];
  onSelect: (msg: string) => void;
  onClose: () => void;
}

const HistoryDropdown = React.forwardRef<HTMLDivElement, HistoryDropdownProps>(
  ({ anchorRef, messages, onSelect, onClose }, ref) => {
    const innerRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState<{ bottom: number; left: number } | null>(
      null,
    );

    // Combine forwarded ref and inner ref
    const setRefs = useCallback(
      (node: HTMLDivElement | null) => {
        (innerRef as React.MutableRefObject<HTMLDivElement | null>).current =
          node;
        if (typeof ref === "function") ref(node);
        else if (ref)
          (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      },
      [ref],
    );

    useEffect(() => {
      if (anchorRef.current) {
        const rect = anchorRef.current.getBoundingClientRect();
        // Position above the button, align right edge to viewport
        const bottom = window.innerHeight - rect.top + 4;
        const left = Math.min(rect.left, window.innerWidth - 8);
        setPos({ bottom, left });
      }
    }, [anchorRef]);

    useEffect(() => {
      const handleKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
      };
      document.addEventListener("keydown", handleKey);
      return () => document.removeEventListener("keydown", handleKey);
    }, [onClose]);

    if (!pos) return null;

    return (
      <div
        ref={setRefs}
        style={{
          position: "fixed",
          bottom: pos.bottom,
          left: 4,
          right: 4,
          zIndex: 99999,
          background: "var(--vscode-menu-background, #1e1e1e)",
          border: "1px solid var(--vscode-menu-border, #454545)",
          borderRadius: 4,
          padding: "4px 0",
          maxHeight: 250,
          overflowY: "auto",
          boxShadow: "0 -3px 12px rgba(0,0,0,0.1), 0 1px 4px rgba(0,0,0,0.06)",
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              padding: "8px 12px",
              opacity: 0.5,
              fontSize: 12,
            }}
          >
            No recent commit messages
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={`${i}-${msg}`}
              onClick={() => onSelect(msg)}
              style={{
                padding: "6px 12px",
                cursor: "pointer",
                fontSize: 12,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: "var(--vscode-menu-foreground, #ccc)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background =
                  "var(--vscode-list-hoverBackground, #2a2d2e)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background =
                  "transparent";
              }}
              title={msg}
            >
              {msg}
            </div>
          ))
        )}
      </div>
    );
  },
);

function HistoryIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      style={{ opacity: 0.5 }}
    >
      <path d="M13.507 12.324a7 7 0 0 0 .065-8.56A7 7 0 0 0 2 4.393V2H1v3.5l.5.5H5V5H2.811a6.008 6.008 0 1 1-.135 5.77l-.887.462a7 7 0 0 0 11.718 1.092zM8 4v4.5l.5.5H12v-1H9V4H8z" />
    </svg>
  );
}
