import type React from "react";
import { Tooltip } from "../../../shared/components/Tooltip";
import type { GitRefIdentity } from "../../../shared/types/git";
import type { BranchTreeEntry, BranchTreeNode } from "../model/branchTreeTypes";
import {
  IconBranch,
  IconChevronDown,
  IconChevronRight,
  IconFavorite,
  IconFolder,
  IconTag,
  IconTagOutline,
} from "./BranchTreeIcons";

export interface BranchTreeNodeViewProps {
  node: BranchTreeNode;
  depth: number;
  collapsedIds: ReadonlySet<string>;
  selectedRefKeys: ReadonlySet<string>;
  filteredRefs: string[];
  onToggle(id: string): void;
  onRefClick(event: React.MouseEvent, ref: GitRefIdentity): void;
  onRefKeyboardActivate(ref: GitRefIdentity): void;
  onRefDoubleClick(ref: GitRefIdentity): void;
  onRefContextMenu(event: React.MouseEvent, entry: BranchTreeEntry): void;
}

export function BranchTreeNodeView(props: BranchTreeNodeViewProps) {
  const { node, depth, collapsedIds, onToggle } = props;
  if (node.entry) {
    return <RefRow entry={node.entry} name={node.name} {...props} />;
  }

  const isCollapsed = collapsedIds.has(node.id);
  return (
    <div>
      <div
        onClick={() => onToggle(node.id)}
        style={{
          height: 22,
          padding: `0 8px 0 ${20 + depth * 12}px`,
          boxSizing: "border-box",
          cursor: "pointer",
          userSelect: "none",
          opacity: 0.8,
          display: "flex",
          alignItems: "center",
          gap: 2,
        }}
      >
        {isCollapsed ? <IconChevronRight /> : <IconChevronDown />}
        <IconFolder style={{ color: "var(--description-fg)" }} />
        <span style={{ marginLeft: 2 }}>{node.name}</span>
      </div>
      {!isCollapsed &&
        node.children.map((child) => (
          <BranchTreeNodeView
            {...props}
            key={child.id}
            node={child}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}

function RefRow({
  entry,
  name,
  depth,
  selectedRefKeys,
  filteredRefs,
  onRefClick,
  onRefKeyboardActivate,
  onRefDoubleClick,
  onRefContextMenu,
}: BranchTreeNodeViewProps & { entry: BranchTreeEntry; name: string }) {
  const { branch, ref } = entry;
  const isTag = entry.scope === "tag";
  const icon = entry.isCurrent ? (
    <IconTag style={{ color: "#d4a017" }} />
  ) : entry.isFavorite ? (
    <IconFavorite style={{ color: "#d4a017" }} />
  ) : isTag ? (
    <IconTagOutline style={{ color: "var(--description-fg)" }} />
  ) : (
    <IconBranch style={{ color: "var(--description-fg)" }} />
  );
  const iconLabel = entry.isCurrent
    ? "Current branch"
    : entry.isFavorite
      ? isTag
        ? "Favorite tag"
        : "Favorite branch"
      : isTag
        ? "Tag"
        : "Branch";
  const isSelected = selectedRefKeys.has(refIdentityKey(ref));
  const isFiltered = filteredRefs.includes(ref.fullRef);

  return (
    <div
      role="treeitem"
      tabIndex={0}
      aria-label={name}
      aria-selected={isSelected}
      className={`selectable-row${isSelected ? " selected" : ""}`}
      onClick={(event) => onRefClick(event, ref)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onRefKeyboardActivate(ref);
        }
      }}
      onDoubleClick={() => onRefDoubleClick(ref)}
      onContextMenu={(event) => onRefContextMenu(event, entry)}
      style={{
        height: 22,
        padding: `0 8px 0 ${20 + depth * 12 + 16}px`,
        boxSizing: "border-box",
        fontWeight: entry.isCurrent || isFiltered ? 600 : 400,
        background:
          entry.isCurrent && !isSelected
            ? "var(--list-hoverBackground, rgba(0,0,0,0.04))"
            : undefined,
        color: isSelected ? "var(--selected-fg)" : "inherit",
        outline: isFiltered ? "1px solid var(--focus-border, #3574f0)" : "none",
        display: "flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      <span
        role="img"
        aria-label={iconLabel}
        data-ref-status-icon
        style={{
          display: "inline-flex",
          width: 14,
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <Tooltip text={name}>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
      </Tooltip>
      {branch && (branch.ahead > 0 || branch.behind > 0) && (
        <span
          style={{
            marginLeft: 4,
            flexShrink: 0,
            whiteSpace: "nowrap",
            fontSize: "0.85em",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {branch.behind > 0 && (
            <span style={{ color: "#3574f0" }}>
              ↙ {branch.behind > 99 ? "99+" : branch.behind}
            </span>
          )}
          {branch.ahead > 0 && (
            <span style={{ color: "#499c54" }}>
              ↗ {branch.ahead > 99 ? "99+" : branch.ahead}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

function refIdentityKey(ref: GitRefIdentity): string {
  return `${ref.type}:${ref.fullRef}`;
}
