import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tooltip } from "../../shared/components/Tooltip";
import "../../shared/components/Tooltip.css";
import { useGitLogStore } from "../../shared/store/git-log-store-context";
import type { LogPresentation } from "../../shared/store/panel-store";
import type {
  BranchInfo,
  GitRefIdentity,
  TagInfo,
} from "../../shared/types/git";

export function Toolbar({
  showBranchFilter = true,
}: {
  showBranchFilter?: boolean;
} = {}) {
  const setFilter = useGitLogStore((s) => s.setFilter);
  const filter = useGitLogStore((s) => s.filter);
  const commits = useGitLogStore((s) => s.commits);
  const branches = useGitLogStore((s) => s.branches);
  const tags = useGitLogStore((s) => s.tags);
  const navigateToRef = useGitLogStore((s) => s.navigateToRef);
  const navigateToCommit = useGitLogStore((s) => s.navigateToCommit);
  const currentBranch = useGitLogStore((s) => s.currentBranch);
  const visibleColumns = useGitLogStore((s) => s.visibleColumns);
  const toggleColumnVisibility = useGitLogStore(
    (s) => s.toggleColumnVisibility,
  );
  const collapseAllSequences = useGitLogStore((s) => s.collapseAllSequences);
  const expandAllSequences = useGitLogStore((s) => s.expandAllSequences);
  const presentation = useGitLogStore((s) => s.presentation);
  const togglePresentation = useGitLogStore((s) => s.togglePresentation);
  const requestFromSurface = useGitLogStore((s) => s.requestFromSurface);
  const historyBranch = filter.branch || currentBranch;

  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [showPathsDropdown, setShowPathsDropdown] = useState(false);
  const [showViewOptions, setShowViewOptions] = useState(false);
  const [showGoTo, setShowGoTo] = useState(false);
  const [hostAuthors, setHostAuthors] = useState<{
    authors: string[];
    me: string | null;
  } | null>(null);

  // The loaded page seeds the author list; the host's whole-history list
  // (fetched when the dropdown first opens) replaces it.
  const authors = useMemo(() => {
    if (hostAuthors) {
      const list = [...hostAuthors.authors];
      const { me } = hostAuthors;
      if (me) {
        const meIdx = list.indexOf(me);
        if (meIdx > 0) list.splice(meIdx, 1);
        if (meIdx !== 0) list.unshift(me);
      }
      return list;
    }
    const set = new Set<string>();
    for (const c of commits) {
      if (c.authorName) set.add(c.authorName);
    }
    return Array.from(set).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [commits, hostAuthors]);

  const authorLabels = useMemo(() => {
    const me = hostAuthors?.me;
    return me ? { [me]: `${me} (me)` } : undefined;
  }, [hostAuthors]);

  const openUserDropdown = () => {
    setShowUserDropdown(!showUserDropdown);
    setShowDateDropdown(false);
    setShowBranchDropdown(false);
    if (!showUserDropdown && !hostAuthors) {
      void (async () => {
        try {
          const result = (await requestFromSurface("getLogAuthors")) as {
            authors: string[];
            me: string | null;
          } | null;
          if (result && Array.isArray(result.authors)) {
            setHostAuthors(result);
          }
        } catch (err) {
          console.error("getLogAuthors failed:", err);
        }
      })();
    }
  };

  // Collect branch names for filter
  const branchNames = useMemo(() => {
    return branches
      .map((b) => b.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [branches]);

  const handleSearch = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFilter({ searchQuery: e.target.value });
    },
    [setFilter],
  );

  const handleSelectAuthor = (author: string) => {
    setShowUserDropdown(false);
    setFilter({ author: author === filter.author ? "" : author });
  };

  const handleClearAuthor = () => {
    setShowUserDropdown(false);
    setFilter({ author: "" });
  };

  const handleSelectDate = (range: string) => {
    setShowDateDropdown(false);
    setFilter({ dateRange: range, dateAfter: "", dateBefore: "" });
  };

  const handleClearDate = () => {
    setShowDateDropdown(false);
    setFilter({ dateRange: "", dateAfter: "", dateBefore: "" });
  };

  const handleSelectBranch = (branch: string) => {
    setShowBranchDropdown(false);
    setFilter({ branch: branch === filter.branch ? "" : branch });
  };

  const handleClearBranch = () => {
    setShowBranchDropdown(false);
    setFilter({ branch: "" });
  };

  const handleClearPaths = () => {
    setShowPathsDropdown(false);
    setFilter({ paths: [] });
  };

  // Cmd/Ctrl+G opens the go-to-hash/branch/tag popup, IntelliJ style.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "g") {
        e.preventDefault();
        setShowGoTo(true);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const dateLabels: Record<string, string> = {
    today: "Today",
    "7days": "Last 7 days",
    "30days": "Last 30 days",
    "90days": "Last 90 days",
  };

  const customDateLabel = () => {
    const from = filter.dateAfter;
    const to = filter.dateBefore;
    if (from && to) return `${from} – ${to}`;
    if (from) return `Since ${from}`;
    if (to) return `Until ${to}`;
    return "Custom";
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 8px",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
      }}
    >
      <SearchInput
        placeholder="Search commits..."
        defaultValue={filter.searchQuery}
        onChange={handleSearch}
        matchCase={filter.searchCaseSensitive}
        regex={filter.searchRegex}
        onToggleMatchCase={() =>
          setFilter({ searchCaseSensitive: !filter.searchCaseSensitive })
        }
        onToggleRegex={() => setFilter({ searchRegex: !filter.searchRegex })}
      />

      {/* Fixed revision ranges omit only the branch selector. */}
      {showBranchFilter && (
        <div style={{ position: "relative" }}>
          <FilterButton
            label="Branch"
            active={!!filter.branch}
            activeValue={historyBranch}
            onClick={() => {
              setShowBranchDropdown(!showBranchDropdown);
              setShowUserDropdown(false);
              setShowDateDropdown(false);
            }}
            onClear={handleClearBranch}
          />
          {showBranchDropdown && (
            <SearchableDropdown
              items={branchNames}
              activeItem={filter.branch}
              placeholder="Select branch..."
              onSelect={handleSelectBranch}
              onClear={filter.branch ? handleClearBranch : undefined}
              clearLabel="All branches"
              onClose={() => setShowBranchDropdown(false)}
            />
          )}
        </div>
      )}

      {/* User filter */}
      <div style={{ position: "relative" }}>
        <FilterButton
          label="User"
          active={!!filter.author}
          activeValue={authorLabels?.[filter.author] ?? filter.author}
          onClick={openUserDropdown}
          onClear={handleClearAuthor}
        />
        {showUserDropdown && (
          <SearchableDropdown
            items={authors}
            activeItem={filter.author}
            placeholder="Select user..."
            onSelect={handleSelectAuthor}
            onClear={filter.author ? handleClearAuthor : undefined}
            clearLabel="All users"
            onClose={() => setShowUserDropdown(false)}
            labelMap={authorLabels}
          />
        )}
      </div>

      {/* Date filter */}
      <div style={{ position: "relative" }}>
        <FilterButton
          label="Date"
          active={!!filter.dateRange}
          activeValue={
            filter.dateRange === "custom"
              ? customDateLabel()
              : filter.dateRange
                ? dateLabels[filter.dateRange]
                : undefined
          }
          onClick={() => {
            setShowDateDropdown(!showDateDropdown);
            setShowUserDropdown(false);
            setShowBranchDropdown(false);
          }}
          onClear={handleClearDate}
        />
        {showDateDropdown && (
          <DateFilterDropdown
            active={filter.dateRange}
            dateAfter={filter.dateAfter}
            dateBefore={filter.dateBefore}
            labels={dateLabels}
            onSelect={handleSelectDate}
            onApplyCustom={(after, before) => {
              setShowDateDropdown(false);
              setFilter({
                dateRange: after || before ? "custom" : "",
                dateAfter: after,
                dateBefore: before,
              });
            }}
            onClear={filter.dateRange ? handleClearDate : undefined}
            onClose={() => setShowDateDropdown(false)}
          />
        )}
      </div>

      {/* Paths filter */}
      <div style={{ position: "relative" }}>
        <FilterButton
          label="Paths"
          active={filter.paths.length > 0}
          activeValue={
            filter.paths.length === 1
              ? (filter.paths[0].split("/").filter(Boolean).pop() ??
                filter.paths[0])
              : filter.paths.length > 1
                ? `${filter.paths.length} paths`
                : undefined
          }
          onClick={() => {
            setShowPathsDropdown(!showPathsDropdown);
            setShowUserDropdown(false);
            setShowDateDropdown(false);
            setShowBranchDropdown(false);
          }}
          onClear={handleClearPaths}
        />
        {showPathsDropdown && (
          <PathsFilterDropdown
            paths={filter.paths}
            onApply={(paths) => {
              setShowPathsDropdown(false);
              setFilter({ paths });
            }}
            onClear={filter.paths.length > 0 ? handleClearPaths : undefined}
            onClose={() => setShowPathsDropdown(false)}
          />
        )}
      </div>

      {/* View Options (eye icon) — pushed to far right */}
      <div style={{ flex: 1 }} />
      <div style={{ position: "relative" }}>
        <Tooltip text="Go to Hash / Branch / Tag (⌘G)">
          <button
            type="button"
            aria-label="Go to hash, branch or tag"
            onClick={() => setShowGoTo(!showGoTo)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 24,
              height: 24,
              border: "none",
              borderRadius: 4,
              background: showGoTo
                ? "var(--vscode-toolbar-activeBackground, rgba(90,93,94,0.31))"
                : "transparent",
              color: "var(--app-fg)",
              cursor: "pointer",
              opacity: 0.6,
              padding: 0,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.opacity = "1";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.opacity = "0.6";
            }}
          >
            <GoToIcon />
          </button>
        </Tooltip>
        {showGoTo && (
          <GoToRefPopup
            branches={branches}
            tags={tags}
            onClose={() => setShowGoTo(false)}
            onNavigateRef={(ref, hash) => {
              setShowGoTo(false);
              void navigateToRef(ref, hash);
            }}
            onResolveFreeText={async (input) => {
              setShowGoTo(false);
              try {
                const result = (await requestFromSurface("resolveLogRef", {
                  input,
                })) as { hash: string | null } | null;
                if (result?.hash) {
                  await navigateToCommit(input, result.hash);
                } else {
                  await requestFromSurface(
                    "showErrorNotification",
                    { message: `"${input}" is not a commit, branch, or tag.` },
                    { scope: "global" },
                  );
                }
              } catch (err) {
                console.error("resolveLogRef failed:", err);
                await requestFromSurface(
                  "showErrorNotification",
                  {
                    message: `Could not resolve "${input}": ${err instanceof Error ? err.message : String(err)}`,
                  },
                  { scope: "global" },
                ).catch(() => {});
              }
            }}
          />
        )}
      </div>
      <div style={{ position: "relative" }}>
        <Tooltip text="View Options">
          <button
            type="button"
            onClick={() => {
              setShowViewOptions(!showViewOptions);
              setShowUserDropdown(false);
              setShowDateDropdown(false);
              setShowBranchDropdown(false);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 24,
              height: 24,
              border: "none",
              borderRadius: 4,
              background: showViewOptions
                ? "var(--vscode-toolbar-activeBackground, rgba(90,93,94,0.31))"
                : "transparent",
              color: "var(--app-fg)",
              cursor: "pointer",
              opacity: 0.6,
              padding: 0,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.opacity = "1";
              if (!showViewOptions) {
                (e.currentTarget as HTMLElement).style.background =
                  "var(--vscode-toolbar-hoverBackground, rgba(90,93,94,0.2))";
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.opacity = "0.6";
              if (!showViewOptions) {
                (e.currentTarget as HTMLElement).style.background =
                  "transparent";
              }
            }}
          >
            <ViewOptionsIcon />
          </button>
        </Tooltip>
        {showViewOptions && (
          <ViewOptionsDropdown
            visibleColumns={visibleColumns}
            onToggle={toggleColumnVisibility}
            graphModes={{
              sortTopo: filter.sortTopo,
              firstParent: filter.firstParent,
              noMerges: filter.noMerges,
            }}
            onToggleGraphMode={(key) => setFilter({ [key]: !filter[key] })}
            presentation={presentation}
            onTogglePresentation={togglePresentation}
            onCollapseAll={() => {
              setShowViewOptions(false);
              collapseAllSequences();
            }}
            onExpandAll={() => {
              setShowViewOptions(false);
              expandAllSequences();
            }}
            onClose={() => setShowViewOptions(false)}
          />
        )}
      </div>

      {/* File history tab */}
      {filter.file && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 8px 2px 10px",
            fontSize: "12px",
            borderRadius: 3,
            background: "var(--vscode-tab-activeBackground, #1e1e1e)",
            border: "1px solid var(--vscode-tab-border, #444)",
            color: "var(--vscode-tab-activeForeground, inherit)",
            whiteSpace: "nowrap",
            userSelect: "none",
          }}
        >
          <span style={{ opacity: 0.6 }}>History:</span>
          <span style={{ fontWeight: 500 }}>
            {filter.file.split("/").pop()}
          </span>
          <div
            onClick={() => setFilter({ file: "" })}
            style={{
              display: "flex",
              alignItems: "center",
              cursor: "pointer",
              opacity: 0.5,
              marginLeft: 2,
              padding: 1,
              borderRadius: 3,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.opacity = "1";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.opacity = "0.5";
            }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z" />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SearchInput({
  placeholder,
  defaultValue,
  onChange,
  matchCase,
  regex,
  onToggleMatchCase,
  onToggleRegex,
}: {
  placeholder: string;
  defaultValue: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  matchCase: boolean;
  regex: boolean;
  onToggleMatchCase: () => void;
  onToggleRegex: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
    onChange(e);
  };

  const handleClear = () => {
    setValue("");
    if (inputRef.current) {
      // Trigger onChange with empty value
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeInputValueSetter?.call(inputRef.current, "");
      inputRef.current.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        width: 180,
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        style={{
          position: "absolute",
          left: 7,
          opacity: 0.5,
          pointerEvents: "none",
        }}
      >
        <circle cx="7" cy="7" r="4.5" />
        <line x1="10.5" y1="10.5" x2="14" y2="14" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        placeholder={placeholder}
        defaultValue={defaultValue}
        onChange={handleChange}
        style={{
          width: "100%",
          padding: "4px 58px 4px 24px",
          fontSize: "12px",
          border: "1px solid var(--vscode-input-border, #c4c4c4)",
          background: "var(--vscode-input-background, #1e1e1e)",
          color: "var(--vscode-input-foreground, #ccc)",
          borderRadius: 3,
          outline: "none",
          boxSizing: "border-box",
        }}
        onFocus={(e) => {
          (e.target as HTMLElement).style.borderColor = "#3574f0";
        }}
        onBlur={(e) => {
          (e.target as HTMLElement).style.borderColor =
            "var(--vscode-input-border, #3c3c3c)";
        }}
        onMouseEnter={(e) => {
          (e.target as HTMLElement).style.borderColor = "#3574f0";
        }}
        onMouseLeave={(e) => {
          if (document.activeElement !== e.target) {
            (e.target as HTMLElement).style.borderColor =
              "var(--vscode-input-border, #3c3c3c)";
          }
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 4,
          display: "flex",
          alignItems: "center",
          gap: 2,
        }}
      >
        {value && (
          <div
            onClick={handleClear}
            style={{
              cursor: "pointer",
              opacity: 0.6,
              display: "flex",
              alignItems: "center",
              padding: 2,
              borderRadius: 3,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.opacity = "1";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.opacity = "0.6";
            }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z" />
            </svg>
          </div>
        )}
        <SearchModeToggle
          label="Cc"
          title="Match Case"
          pressed={matchCase}
          onToggle={onToggleMatchCase}
        />
        <SearchModeToggle
          label=".*"
          title="Regex"
          pressed={regex}
          onToggle={onToggleRegex}
        />
      </div>
    </div>
  );
}

function SearchModeToggle({
  label,
  title,
  pressed,
  onToggle,
}: {
  label: string;
  title: string;
  pressed: boolean;
  onToggle: () => void;
}) {
  return (
    <Tooltip text={title}>
      <button
        type="button"
        aria-label={title}
        aria-pressed={pressed}
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: 18,
          height: 16,
          padding: "0 2px",
          fontSize: "10px",
          fontFamily: "var(--vscode-editor-font-family, monospace)",
          lineHeight: 1,
          border: pressed
            ? "1px solid var(--vscode-inputOption-activeBorder, #007fd4)"
            : "1px solid transparent",
          borderRadius: 3,
          background: pressed
            ? "var(--vscode-inputOption-activeBackground, rgba(0,127,212,0.4))"
            : "transparent",
          color: pressed
            ? "var(--vscode-inputOption-activeForeground, #fff)"
            : "var(--vscode-input-foreground, #ccc)",
          cursor: "pointer",
          opacity: pressed ? 1 : 0.7,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.opacity = "1";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.opacity = pressed
            ? "1"
            : "0.7";
        }}
      >
        {label}
      </button>
    </Tooltip>
  );
}

function FilterButton({
  label,
  active,
  activeValue,
  onClick,
  onClear,
}: {
  label: string;
  active: boolean;
  activeValue?: string;
  onClick: () => void;
  onClear?: () => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        padding: "2px 8px",
        fontSize: "12px",
        cursor: "pointer",
        borderRadius: 3,
        border: "1px solid transparent",
        color: active
          ? "var(--vscode-textLink-foreground, #3794ff)"
          : "var(--description-fg)",
        whiteSpace: "nowrap",
        userSelect: "none",
      }}
    >
      <span onClick={onClick}>
        {active && activeValue ? (
          `${label}: ${activeValue}`
        ) : (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 2 }}
          >
            {label}
            <svg
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              style={{ opacity: 0.7 }}
            >
              <polyline points="4,6 8,10 12,6" />
            </svg>
          </span>
        )}
      </span>
      {active && onClear && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          style={{
            display: "flex",
            alignItems: "center",
            marginLeft: 2,
            opacity: 0.6,
            borderRadius: 3,
            padding: 1,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.opacity = "1";
            (e.currentTarget as HTMLElement).style.background =
              "var(--vscode-toolbar-hoverBackground, rgba(90,93,94,0.31))";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.opacity = "0.6";
            (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z" />
          </svg>
        </div>
      )}
    </div>
  );
}

function DropdownItem({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "5px 12px",
        fontSize: "12px",
        cursor: "pointer",
        color: active
          ? "var(--vscode-menu-selectionForeground, #fff)"
          : "var(--vscode-menu-foreground, #ccc)",
        background: active
          ? "var(--vscode-menu-selectionBackground, #04395e)"
          : "transparent",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.background =
            "var(--vscode-list-hoverBackground, #2a2d2e)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.background = "transparent";
        }
      }}
    >
      {label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SearchableDropdown — dropdown with search input for filtering items
// ---------------------------------------------------------------------------

function SearchableDropdown({
  items,
  activeItem,
  placeholder,
  onSelect,
  onClear,
  clearLabel,
  onClose,
  labelMap,
}: {
  items: string[];
  activeItem: string;
  placeholder: string;
  onSelect: (item: string) => void;
  onClear?: () => void;
  clearLabel?: string;
  onClose: () => void;
  labelMap?: Record<string, string>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleScroll = (e: Event) => {
      if (
        ref.current &&
        e.target instanceof Node &&
        !ref.current.contains(e.target)
      ) {
        onClose();
      }
    };
    const handleBlur = () => onClose();
    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("scroll", handleScroll, true);
    window.addEventListener("blur", handleBlur);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("blur", handleBlur);
    };
  }, [onClose]);

  const filtered = query
    ? items.filter((item) => {
        const display = labelMap?.[item] ?? item;
        return display.toLowerCase().includes(query.toLowerCase());
      })
    : items;

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        marginTop: 4,
        zIndex: 9999,
        background: "var(--vscode-menu-background, #1e1e1e)",
        border: "1px solid var(--vscode-menu-border, #454545)",
        borderRadius: 4,
        padding: "4px 0",
        minWidth: 200,
        maxHeight: 280,
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
      }}
    >
      <div style={{ padding: "4px 8px" }}>
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
          style={{
            width: "100%",
            padding: "4px 8px",
            fontSize: "12px",
            border: "1px solid var(--vscode-input-border, #3c3c3c)",
            background: "var(--vscode-input-background, #3c3c3c)",
            color: "var(--vscode-input-foreground, #ccc)",
            borderRadius: 3,
            outline: "none",
            boxSizing: "border-box",
          }}
          onFocus={(e) => {
            (e.target as HTMLElement).style.borderColor = "#3574f0";
          }}
          onBlur={(e) => {
            (e.target as HTMLElement).style.borderColor =
              "var(--vscode-input-border, #3c3c3c)";
          }}
        />
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {onClear && clearLabel && (
          <DropdownItem label={clearLabel} active={false} onClick={onClear} />
        )}
        {filtered.map((item) => (
          <DropdownItem
            key={item}
            label={labelMap?.[item] ?? item}
            active={item === activeItem}
            onClick={() => onSelect(item)}
          />
        ))}
        {filtered.length === 0 && (
          <div
            style={{
              padding: "8px 12px",
              fontSize: "12px",
              opacity: 0.5,
            }}
          >
            No matches
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DateFilterDropdown — presets plus a custom after/before range
// ---------------------------------------------------------------------------

function DateFilterDropdown({
  active,
  dateAfter,
  dateBefore,
  labels,
  onSelect,
  onApplyCustom,
  onClear,
  onClose,
}: {
  active: string;
  dateAfter: string;
  dateBefore: string;
  labels: Record<string, string>;
  onSelect: (range: string) => void;
  onApplyCustom: (after: string, before: string) => void;
  onClear?: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [after, setAfter] = useState(dateAfter);
  const [before, setBefore] = useState(dateBefore);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const dateInputStyle: React.CSSProperties = {
    width: "100%",
    padding: "3px 6px",
    fontSize: "12px",
    border: "1px solid var(--vscode-input-border, #3c3c3c)",
    background: "var(--vscode-input-background, #3c3c3c)",
    color: "var(--vscode-input-foreground, #ccc)",
    borderRadius: 3,
    outline: "none",
    boxSizing: "border-box",
    colorScheme: "dark light",
  };

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        marginTop: 4,
        zIndex: 9999,
        background: "var(--vscode-menu-background, #1e1e1e)",
        border: "1px solid var(--vscode-menu-border, #454545)",
        borderRadius: 4,
        padding: "4px 0",
        minWidth: 220,
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
      }}
    >
      {onClear && (
        <DropdownItem label="All time" active={false} onClick={onClear} />
      )}
      {Object.entries(labels).map(([range, label]) => (
        <DropdownItem
          key={range}
          label={label}
          active={range === active}
          onClick={() => onSelect(range)}
        />
      ))}
      <div
        style={{
          borderTop:
            "1px solid var(--vscode-menu-separatorBackground, #454545)",
          margin: "4px 0",
        }}
      />
      <div
        style={{
          padding: "2px 12px 6px",
          fontSize: "11px",
          fontWeight: 600,
          opacity: 0.6,
        }}
      >
        Custom range
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: "0 12px 8px",
        }}
      >
        <label style={{ fontSize: "12px" }}>
          <span style={{ display: "block", opacity: 0.7, marginBottom: 2 }}>
            After
          </span>
          <input
            type="date"
            value={after}
            onChange={(e) => setAfter(e.target.value)}
            style={dateInputStyle}
          />
        </label>
        <label style={{ fontSize: "12px" }}>
          <span style={{ display: "block", opacity: 0.7, marginBottom: 2 }}>
            Before
          </span>
          <input
            type="date"
            value={before}
            onChange={(e) => setBefore(e.target.value)}
            style={dateInputStyle}
          />
        </label>
        <button
          type="button"
          disabled={!after && !before}
          onClick={() => onApplyCustom(after, before)}
          style={{
            alignSelf: "flex-end",
            padding: "3px 12px",
            fontSize: "12px",
            border: "none",
            borderRadius: 3,
            background: "var(--vscode-button-background, #0e639c)",
            color: "var(--vscode-button-foreground, #fff)",
            cursor: !after && !before ? "default" : "pointer",
            opacity: !after && !before ? 0.5 : 1,
          }}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PathsFilterDropdown — free-text pathspecs, one per line
// ---------------------------------------------------------------------------

function PathsFilterDropdown({
  paths,
  onApply,
  onClear,
  onClose,
}: {
  paths: string[];
  onApply: (paths: string[]) => void;
  onClear?: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(paths.join("\n"));

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const apply = () => {
    const next = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    onApply(next);
  };

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        marginTop: 4,
        zIndex: 9999,
        background: "var(--vscode-menu-background, #1e1e1e)",
        border: "1px solid var(--vscode-menu-border, #454545)",
        borderRadius: 4,
        padding: "8px 12px",
        minWidth: 260,
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ fontSize: "11px", fontWeight: 600, opacity: 0.6 }}>
        Filter by paths
      </div>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            apply();
          }
        }}
        placeholder={"src/components\nREADME.md"}
        rows={4}
        style={{
          width: "100%",
          resize: "vertical",
          padding: "4px 8px",
          fontSize: "12px",
          fontFamily: "var(--vscode-editor-font-family, monospace)",
          border: "1px solid var(--vscode-input-border, #3c3c3c)",
          background: "var(--vscode-input-background, #3c3c3c)",
          color: "var(--vscode-input-foreground, #ccc)",
          borderRadius: 3,
          outline: "none",
          boxSizing: "border-box",
        }}
      />
      <div style={{ fontSize: "11px", opacity: 0.5 }}>
        One file or folder per line, relative to the repository root
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            style={{
              padding: "3px 12px",
              fontSize: "12px",
              border: "1px solid var(--vscode-button-border, transparent)",
              borderRadius: 3,
              background:
                "var(--vscode-button-secondaryBackground, transparent)",
              color: "var(--vscode-button-secondaryForeground, #ccc)",
              cursor: "pointer",
            }}
          >
            Clear
          </button>
        )}
        <button
          type="button"
          onClick={apply}
          style={{
            padding: "3px 12px",
            fontSize: "12px",
            border: "none",
            borderRadius: 3,
            background: "var(--vscode-button-background, #0e639c)",
            color: "var(--vscode-button-foreground, #fff)",
            cursor: "pointer",
          }}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GoToRefPopup — jump to a hash, branch, or tag with completion
// ---------------------------------------------------------------------------

const GO_TO_MAX_SUGGESTIONS = 20;

interface GoToSuggestion {
  key: string;
  label: string;
  kind: "branch" | "remote" | "tag";
  ref: GitRefIdentity;
  hash: string;
}

function GoToRefPopup({
  branches,
  tags,
  onClose,
  onNavigateRef,
  onResolveFreeText,
}: {
  branches: BranchInfo[];
  tags: TagInfo[];
  onClose: () => void;
  onNavigateRef: (ref: GitRefIdentity, hash: string) => void;
  onResolveFreeText: (input: string) => Promise<void>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown, true);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true);
    };
  }, [onClose]);

  const suggestions = useMemo<GoToSuggestion[]>(() => {
    const all: GoToSuggestion[] = [
      ...branches.map(
        (branch): GoToSuggestion => ({
          key: `${branch.isRemote ? "remote" : "branch"}:${branch.name}`,
          label: branch.name,
          kind: branch.isRemote ? "remote" : "branch",
          ref: {
            type: branch.isRemote ? "remote" : "local",
            name: branch.name,
            fullRef: branch.fullRef,
          },
          hash: branch.lastCommitHash,
        }),
      ),
      ...tags.map(
        (tag): GoToSuggestion => ({
          key: `tag:${tag.name}`,
          label: tag.name,
          kind: "tag",
          ref: { type: "tag", name: tag.name, fullRef: tag.fullRef },
          hash: tag.targetCommitHash,
        }),
      ),
    ];
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? all.filter((s) => s.label.toLowerCase().includes(needle))
      : all;
    return filtered.slice(0, GO_TO_MAX_SUGGESTIONS);
  }, [branches, tags, query]);

  const clampedIndex = Math.min(activeIndex, suggestions.length - 1);

  const submit = () => {
    const chosen = clampedIndex >= 0 ? suggestions[clampedIndex] : undefined;
    if (chosen) {
      onNavigateRef(chosen.ref, chosen.hash);
      return;
    }
    const input = query.trim();
    if (input) void onResolveFreeText(input);
  };

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "100%",
        right: 0,
        marginTop: 4,
        zIndex: 9999,
        background: "var(--vscode-menu-background, #1e1e1e)",
        border: "1px solid var(--vscode-menu-border, #454545)",
        borderRadius: 4,
        padding: "8px 0 4px",
        minWidth: 280,
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
      }}
    >
      <div style={{ padding: "0 10px 6px" }}>
        <input
          ref={inputRef}
          type="text"
          placeholder="Enter hash or branch/tag name…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onClose();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          style={{
            width: "100%",
            padding: "4px 8px",
            fontSize: "12px",
            border: "1px solid var(--vscode-input-border, #3c3c3c)",
            background: "var(--vscode-input-background, #3c3c3c)",
            color: "var(--vscode-input-foreground, #ccc)",
            borderRadius: 3,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>
      <div style={{ maxHeight: 260, overflowY: "auto" }}>
        {suggestions.map((suggestion, index) => (
          <div
            key={suggestion.key}
            onClick={() => onNavigateRef(suggestion.ref, suggestion.hash)}
            onMouseEnter={() => setActiveIndex(index)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "4px 12px",
              fontSize: "12px",
              cursor: "pointer",
              whiteSpace: "nowrap",
              color:
                index === clampedIndex
                  ? "var(--vscode-menu-selectionForeground, #fff)"
                  : "var(--vscode-menu-foreground, #ccc)",
              background:
                index === clampedIndex
                  ? "var(--vscode-menu-selectionBackground, #04395e)"
                  : "transparent",
            }}
          >
            <span
              style={{
                fontSize: "10px",
                opacity: 0.6,
                width: 44,
                flexShrink: 0,
              }}
            >
              {suggestion.kind}
            </span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {suggestion.label}
            </span>
          </div>
        ))}
        {suggestions.length === 0 && (
          <div style={{ padding: "6px 12px", fontSize: "12px", opacity: 0.5 }}>
            Press Enter to resolve as a commit hash
          </div>
        )}
      </div>
    </div>
  );
}

function GoToIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
      <path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// ViewOptionsIcon — eye icon with small triangle (JetBrains show.svg style)
// ---------------------------------------------------------------------------

function ViewOptionsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M8 4C4.5 4 2 8 2 8C2 8 4.5 12 8 12C11.5 12 14 8 14 8C14 8 11.5 4 8 4Z"
        stroke="currentColor"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2" stroke="currentColor" />
      <path d="M9 12L10 14H8L9 12Z" fill="currentColor" opacity="0.6" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// ViewOptionsDropdown — column visibility menu from the eye icon
// ---------------------------------------------------------------------------

type GraphModeKey = "sortTopo" | "firstParent" | "noMerges";

function MenuSectionLabel({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: "4px 12px 6px",
        fontSize: "11px",
        fontWeight: 600,
        opacity: 0.6,
      }}
    >
      {label}
    </div>
  );
}

function MenuSeparator() {
  return (
    <div
      style={{
        borderTop: "1px solid var(--vscode-menu-separatorBackground, #454545)",
        margin: "4px 0",
      }}
    />
  );
}

function CheckMenuItem({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      role="menuitemcheckbox"
      aria-checked={checked}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 12px",
        fontSize: "12px",
        cursor: "pointer",
        color: "var(--vscode-menu-foreground, #ccc)",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background =
          "var(--vscode-list-hoverBackground, #2a2d2e)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      <span style={{ width: 16, textAlign: "center", flexShrink: 0 }}>
        {checked ? "✓" : ""}
      </span>
      <span>{label}</span>
    </div>
  );
}

function ViewOptionsDropdown({
  visibleColumns,
  onToggle,
  graphModes,
  onToggleGraphMode,
  presentation,
  onTogglePresentation,
  onCollapseAll,
  onExpandAll,
  onClose,
}: {
  visibleColumns: { author: boolean; date: boolean; hash: boolean };
  onToggle: (col: "author" | "date" | "hash") => void;
  graphModes: Record<GraphModeKey, boolean>;
  onToggleGraphMode: (key: GraphModeKey) => void;
  presentation: LogPresentation;
  onTogglePresentation: (key: keyof LogPresentation) => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick, true);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const columns: { key: "author" | "date" | "hash"; label: string }[] = [
    { key: "author", label: "Author" },
    { key: "date", label: "Date" },
    { key: "hash", label: "Hash" },
  ];

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "100%",
        right: 0,
        marginTop: 4,
        zIndex: 9999,
        background: "var(--vscode-menu-background, #1e1e1e)",
        border: "1px solid var(--vscode-menu-border, #454545)",
        borderRadius: 4,
        padding: "4px 0",
        minWidth: 220,
        maxHeight: 420,
        overflowY: "auto",
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
      }}
    >
      <MenuSectionLabel label="Columns" />
      {columns.map((col) => (
        <CheckMenuItem
          key={col.key}
          label={col.label}
          checked={visibleColumns[col.key]}
          onToggle={() => onToggle(col.key)}
        />
      ))}
      <MenuSeparator />
      <MenuSectionLabel label="Graph" />
      <CheckMenuItem
        label="Sort Topologically"
        checked={graphModes.sortTopo}
        onToggle={() => onToggleGraphMode("sortTopo")}
      />
      <CheckMenuItem
        label="First Parent Only"
        checked={graphModes.firstParent}
        onToggle={() => onToggleGraphMode("firstParent")}
      />
      <CheckMenuItem
        label="No Merge Commits"
        checked={graphModes.noMerges}
        onToggle={() => onToggleGraphMode("noMerges")}
      />
      <CheckMenuItem
        label="Show Long Edges"
        checked={presentation.showLongEdges}
        onToggle={() => onTogglePresentation("showLongEdges")}
      />
      <DropdownItem
        label="Collapse Linear Branches"
        active={false}
        onClick={onCollapseAll}
      />
      <DropdownItem
        label="Expand Linear Branches"
        active={false}
        onClick={onExpandAll}
      />
      <MenuSeparator />
      <MenuSectionLabel label="Presentation" />
      <CheckMenuItem
        label="Compact References"
        checked={presentation.compactRefs}
        onToggle={() => onTogglePresentation("compactRefs")}
      />
      <CheckMenuItem
        label="Tag Names"
        checked={presentation.showTagNames}
        onToggle={() => onTogglePresentation("showTagNames")}
      />
      <CheckMenuItem
        label="Commit Timestamp"
        checked={presentation.preferCommitDate}
        onToggle={() => onTogglePresentation("preferCommitDate")}
      />
      <MenuSeparator />
      <MenuSectionLabel label="Highlight" />
      <CheckMenuItem
        label="My Commits"
        checked={presentation.highlightMyCommits}
        onToggle={() => onTogglePresentation("highlightMyCommits")}
      />
      <CheckMenuItem
        label="Dim Merge Commits"
        checked={presentation.dimMergeCommits}
        onToggle={() => onTogglePresentation("dimMergeCommits")}
      />
      <CheckMenuItem
        label="Fade Other Branches"
        checked={presentation.fadeOtherBranches}
        onToggle={() => onTogglePresentation("fadeOtherBranches")}
      />
    </div>
  );
}
