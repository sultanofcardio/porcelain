import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useGitLogStore } from "../../shared/store/git-log-store-context";
import type { Commit } from "../../shared/types/git";
import { buildCommitActions } from "../actions/commit-actions";

interface CommitContextMenuProps {
  x: number;
  y: number;
  commit: Commit;
  onClose: () => void;
  onCreateBranch?: (hash: string, defaultName: string) => void;
  onRefreshComparison?: () => void | Promise<void>;
}

export function CommitContextMenu({
  x,
  y,
  commit,
  onClose,
  onCreateBranch,
  onRefreshComparison,
}: CommitContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const currentBranch = useGitLogStore((state) => state.currentBranch);
  const selectedCommitHashes = useGitLogStore(
    (state) => state.selectedCommitHashes,
  );
  const filter = useGitLogStore((state) => state.filter);
  const selectCommit = useGitLogStore((state) => state.selectCommit);
  const setFilter = useGitLogStore((state) => state.setFilter);
  const refresh = useGitLogStore((state) => state.refresh);
  const repoId = useGitLogStore((state) => state.actionRepoId());
  const mutationRefresh = useGitLogStore((state) => state.actionRefreshScope);
  const request = useGitLogStore((state) => state.requestFromSurface);
  const requestWithProgress = useGitLogStore(
    (state) => state.requestWithProgressFromSurface,
  );
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [isRebasing, setIsRebasing] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [isCherryPicking, setIsCherryPicking] = useState(false);

  useEffect(() => {
    const fetchRepoState = async () => {
      try {
        const [rebaseState, mergeState, cherryPickState] = await Promise.all([
          request("getRebaseState") as Promise<{ isRebasing: boolean }>,
          request("getMergeState") as Promise<{ isMerging: boolean }>,
          request("getCherryPickState") as Promise<{
            isCherryPicking: boolean;
          }>,
        ]);
        setIsRebasing(rebaseState?.isRebasing ?? false);
        setIsMerging(mergeState?.isMerging ?? false);
        setIsCherryPicking(cherryPickState?.isCherryPicking ?? false);
      } catch {
        // If repository state cannot be determined, preserve the prior menu behavior.
      }
    };
    void fetchRepoState();
  }, [request]);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      const viewportH = window.innerHeight;
      const viewportW = window.innerWidth;
      let top = y;
      let left = x;

      if (top + rect.height > viewportH) {
        const above = y - rect.height;
        top = above >= 4 ? above : Math.max(4, viewportH - rect.height - 4);
      }
      if (left + rect.width > viewportW) {
        left = Math.max(4, viewportW - rect.width - 4);
      }
      setPosition({ top, left });
    });
  }, [x, y]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const handleBlur = () => onClose();
    const handleScroll = (event: Event) => {
      if (
        menuRef.current &&
        event.target instanceof Node &&
        !menuRef.current.contains(event.target)
      ) {
        onClose();
      }
    };
    const handleContextMenu = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside, true);
    document.addEventListener("contextmenu", handleContextMenu, true);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleBlur);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true);
      document.removeEventListener("contextmenu", handleContextMenu, true);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleBlur);
    };
  }, [onClose]);

  if (!repoId) return null;

  const actions = buildCommitActions({
    repoId,
    commit,
    selectedCommitHashes,
    currentBranch,
    fileFilter: filter.file,
    isRebasing,
    isMerging,
    isCherryPicking,
    mutationRefresh,
    request,
    requestWithProgress,
    confirm: async (options) => {
      const result = (await request("showConfirmMessage", options, {
        scope: "global",
      })) as { confirmed: boolean };
      return result.confirmed;
    },
    input: async (options) => {
      const result = (await request("showInputBox", options, {
        scope: "global",
      })) as { value: string | null };
      return result.value;
    },
    createBranch: async (hash, defaultName) => {
      if (onCreateBranch) {
        onCreateBranch(hash, defaultName);
        return;
      }
      const result = (await request(
        "showInputBox",
        {
          prompt: `Create new branch from ${commit.shortHash || commit.hash.slice(0, 8)}:`,
          placeHolder: "branch-name",
        },
        { scope: "global" },
      )) as { value: string | null };
      if (!result.value?.trim()) return;
      await request("createBranchFromCommit", {
        branchName: result.value.trim(),
        hash,
      });
    },
    showInGitLog: (hash) => {
      setFilter({ file: "" });
      setTimeout(() => {
        void selectCommit(hash);
      }, 500);
    },
  }).filter((action) => action.visible);

  const execute = async (action: (typeof actions)[number]) => {
    if (!action.enabled) return;
    onClose();
    const refreshScope = await action.execute();
    if (refreshScope === "surface") {
      await refresh();
    } else if (refreshScope === "comparison") {
      await onRefreshComparison?.();
    }
  };

  const menu = (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        top: position ? position.top : -9999,
        left: position ? position.left : -9999,
        zIndex: 9999,
        background: "var(--vscode-menu-background, #1e1e1e)",
        border: "1px solid var(--vscode-menu-border, #454545)",
        borderRadius: 4,
        padding: "4px 0",
        minWidth: 200,
        maxHeight: "calc(100vh - 8px)",
        overflowY: "auto",
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
        visibility: position ? "visible" : "hidden",
      }}
    >
      {actions.map((action) =>
        action.separator ? (
          <div
            key={action.id}
            style={{
              height: 1,
              background: "var(--vscode-menu-separatorBackground, #454545)",
              margin: "4px 0",
            }}
          />
        ) : (
          <div
            key={action.id}
            onClick={action.enabled ? () => void execute(action) : undefined}
            style={{
              padding: "6px 12px",
              cursor: action.enabled ? "pointer" : "default",
              opacity: action.enabled ? 1 : 0.5,
              color: "var(--vscode-menu-foreground, #ccc)",
              fontSize: "13px",
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
            onMouseEnter={(event) => {
              if (action.enabled) {
                event.currentTarget.style.background =
                  "var(--vscode-list-hoverBackground, #2a2d2e)";
                event.currentTarget.style.color =
                  "var(--vscode-menu-selectionForeground, #fff)";
              }
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = "transparent";
              event.currentTarget.style.color =
                "var(--vscode-menu-foreground, #ccc)";
            }}
          >
            <span style={{ width: 16, flexShrink: 0, opacity: 0.7 }}>
              {action.icon ?? null}
            </span>
            {action.label}
          </div>
        ),
      )}
    </div>
  );

  return createPortal(menu, document.body);
}
