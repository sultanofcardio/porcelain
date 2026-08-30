import type React from "react";
import { createPortal } from "react-dom";
import { usePreventSelect } from "../../../shared/hooks/usePreventSelect";
import type { GitRefIdentity } from "../../../shared/types/git";
import { CreateBranchDialog } from "../../components/CreateBranchDialog";
import { PushDialog } from "../../components/PushDialog";
import type {
  BranchActionId,
  BranchActionMenuItem,
} from "../actions/branchActionTypes";
import type {
  BranchTreeEntry,
  BranchTreeSnapshot,
} from "../model/branchTreeTypes";
import { BranchContextMenu } from "./BranchContextMenu";
import { IconChevronDown, IconChevronRight } from "./BranchTreeIcons";
import { BranchTreeNodeView } from "./BranchTreeNode";

export interface BranchTreeMenuView {
  x: number;
  y: number;
  name: string;
  items: readonly BranchActionMenuItem[];
  presentation: "branch" | "tag";
}

export interface BranchTreeCreateView {
  startPoint: string;
  defaultName: string;
}

export interface BranchTreePushView {
  branchName: string;
}

export interface BranchTreeViewProps {
  localSnapshot: BranchTreeSnapshot;
  remoteSnapshot: BranchTreeSnapshot;
  tagSnapshot: BranchTreeSnapshot;
  collapsedIds: ReadonlySet<string>;
  selectedRefKeys: ReadonlySet<string>;
  filteredRefs: string[];
  /** Recently checked-out branches, newest first. */
  recentSnapshot?: BranchTreeSnapshot;
  searchQuery: string;
  showTags: boolean;
  showCurrentBranchRow: boolean;
  currentBranchName: string | null;
  currentBranchRowSelected: boolean;
  menu: BranchTreeMenuView | null;
  createDialog: BranchTreeCreateView | null;
  pushDialog: BranchTreePushView | null;
  onSearchChange(query: string): void;
  onToggle(id: string): void;
  onCurrentBranchClick(): void;
  onCurrentBranchDoubleClick(): void;
  onRefClick(event: React.MouseEvent, ref: GitRefIdentity): void;
  onRefKeyboardActivate(ref: GitRefIdentity): void;
  onRefDoubleClick(ref: GitRefIdentity): void;
  onRefContextMenu(event: React.MouseEvent, entry: BranchTreeEntry): void;
  onMenuAction(id: BranchActionId): void;
  onCloseOverlay(): void;
  onCreateConfirm(input: {
    branchName: string;
    checkout: boolean;
    force: boolean;
  }): Promise<string | undefined>;
  onPush(force: boolean): Promise<void>;
}

export function BranchTreeView({
  localSnapshot,
  remoteSnapshot,
  tagSnapshot,
  collapsedIds,
  selectedRefKeys,
  filteredRefs,
  recentSnapshot,
  searchQuery,
  showTags,
  showCurrentBranchRow,
  currentBranchName,
  currentBranchRowSelected,
  menu,
  createDialog,
  pushDialog,
  onSearchChange,
  onToggle,
  onCurrentBranchClick,
  onCurrentBranchDoubleClick,
  onRefClick,
  onRefKeyboardActivate,
  onRefDoubleClick,
  onRefContextMenu,
  onMenuAction,
  onCloseOverlay,
  onCreateConfirm,
  onPush,
}: BranchTreeViewProps) {
  const containerRef = usePreventSelect();
  const nodeProps = {
    depth: 0,
    collapsedIds,
    selectedRefKeys,
    filteredRefs,
    onToggle,
    onRefClick,
    onRefKeyboardActivate,
    onRefDoubleClick,
    onRefContextMenu,
  };

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, height: "100%", overflow: "auto" }}
    >
      <SearchInput value={searchQuery} onChange={onSearchChange} />

      {showCurrentBranchRow && (
        <div
          title={`Current Branch: ${currentBranchName ?? "detached"}`}
          onClick={onCurrentBranchClick}
          onDoubleClick={onCurrentBranchDoubleClick}
          style={{
            height: 24,
            padding: "0 8px 0 20px",
            boxSizing: "border-box",
            cursor: "pointer",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            background: currentBranchRowSelected
              ? "var(--selected-bg)"
              : "transparent",
            color: currentBranchRowSelected
              ? "var(--selected-fg)"
              : "var(--description-fg)",
          }}
        >
          Current Branch: {currentBranchName ?? "detached"}
        </div>
      )}

      {recentSnapshot && recentSnapshot.roots.length > 0 && (
        <GroupSection
          title="Recent"
          collapsed={collapsedIds.has("section:recent")}
          onToggle={() => onToggle("section:recent")}
        >
          {recentSnapshot.roots.map((node) => (
            <BranchTreeNodeView
              {...nodeProps}
              key={`recent-${node.id}`}
              node={node}
            />
          ))}
        </GroupSection>
      )}

      <GroupSection
        title="Local"
        collapsed={collapsedIds.has("section:local")}
        onToggle={() => onToggle("section:local")}
      >
        {localSnapshot.roots.map((node) => (
          <BranchTreeNodeView {...nodeProps} key={node.id} node={node} />
        ))}
      </GroupSection>

      <GroupSection
        title="Remote"
        collapsed={collapsedIds.has("section:remote")}
        onToggle={() => onToggle("section:remote")}
      >
        {remoteSnapshot.roots.map((node) => (
          <BranchTreeNodeView {...nodeProps} key={node.id} node={node} />
        ))}
      </GroupSection>

      {showTags && (
        <GroupSection
          title="Tags"
          collapsed={collapsedIds.has("section:tags")}
          onToggle={() => onToggle("section:tags")}
        >
          {tagSnapshot.roots.map((node) => (
            <BranchTreeNodeView {...nodeProps} key={node.id} node={node} />
          ))}
        </GroupSection>
      )}

      {menu &&
        createPortal(
          <BranchContextMenu
            {...menu}
            onAction={onMenuAction}
            onClose={onCloseOverlay}
          />,
          document.body,
        )}
      {createDialog &&
        createPortal(
          <CreateBranchDialog
            title={`Create Branch from '${createDialog.startPoint}'`}
            defaultName={createDialog.defaultName}
            placeholder="branch-name"
            onClose={onCloseOverlay}
            onConfirm={onCreateConfirm}
          />,
          document.body,
        )}
      {pushDialog &&
        createPortal(
          <PushDialog
            branchName={pushDialog.branchName}
            onClose={onCloseOverlay}
            onPush={onPush}
          />,
          document.body,
        )}
    </div>
  );
}

function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange(query: string): void;
}) {
  return (
    <div
      style={{
        padding: "4px 8px",
        display: "flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          flex: 1,
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
          type="text"
          placeholder="Branch or tag"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          style={{
            width: "100%",
            padding: "4px 24px",
            fontSize: "12px",
            border: "1px solid var(--vscode-input-border, #c4c4c4)",
            background: "var(--vscode-input-background, #1e1e1e)",
            color: "var(--vscode-input-foreground, #ccc)",
            borderRadius: 3,
            outline: "none",
            boxSizing: "border-box",
          }}
          onFocus={(event) => {
            event.currentTarget.style.borderColor = "#3574f0";
          }}
          onBlur={(event) => {
            event.currentTarget.style.borderColor =
              "var(--vscode-input-border, #3c3c3c)";
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.borderColor = "#3574f0";
          }}
          onMouseLeave={(event) => {
            if (document.activeElement !== event.currentTarget) {
              event.currentTarget.style.borderColor =
                "var(--vscode-input-border, #3c3c3c)";
            }
          }}
        />
        {value && (
          <div
            onClick={() => onChange("")}
            style={{
              position: "absolute",
              right: 4,
              cursor: "pointer",
              opacity: 0.6,
              display: "flex",
              alignItems: "center",
              padding: 2,
              borderRadius: 3,
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.opacity = "1";
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.opacity = "0.6";
            }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}

function GroupSection({
  title,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  collapsed: boolean;
  onToggle(): void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        onClick={onToggle}
        style={{
          height: 24,
          padding: "0 8px",
          boxSizing: "border-box",
          cursor: "pointer",
          userSelect: "none",
          opacity: 0.8,
          fontWeight: 500,
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        {collapsed ? <IconChevronRight /> : <IconChevronDown />} {title}
      </div>
      {!collapsed && children}
    </div>
  );
}
