import type {
  CommitSelectionSlice,
  CommitSliceContext,
  TabType,
  WorkingTreeFile,
} from "./types";
import { workingTreeKey } from "./types";

export function createSelectionSlice({
  set,
  get,
}: CommitSliceContext): CommitSelectionSlice {
  return {
    selectedFiles: new Set<string>(),
    highlightedFiles: new Set<string>(),
    activeTab: "commit",
    expandedGroups: new Set(["changes", "unversioned", "conflicts"]),
    groupByDirectory: true,
    showUnversioned: true,
    collapsedDirs: new Set<string>(),

    toggleFileSelection(key) {
      const next = new Set(get().selectedFiles);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      set({ selectedFiles: next });
    },

    setFileKeys(keys, selected) {
      const next = new Set(get().selectedFiles);
      for (const key of keys) {
        if (selected) next.add(key);
        else next.delete(key);
      }
      set({ selectedFiles: next });
    },

    selectAllFiles() {
      set({
        selectedFiles: new Set(get().changes.map(workingTreeKey)),
      });
    },

    deselectAllFiles() {
      set({ selectedFiles: new Set() });
    },

    highlightFile(key, mode) {
      if (mode === "single") {
        set({ highlightedFiles: new Set([key]) });
        return;
      }
      const next = new Set(get().highlightedFiles);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      set({ highlightedFiles: next });
    },

    reconcileSelection(changes: readonly WorkingTreeFile[]) {
      const valid = new Set(changes.map(workingTreeKey));
      set({
        selectedFiles: retainValid(get().selectedFiles, valid),
        highlightedFiles: retainValid(get().highlightedFiles, valid),
      });
    },

    setActiveTab(tab: TabType) {
      set({ activeTab: tab });
      if (tab === "stash") void get().fetchShelves();
      else if (tab === "shelf") void get().fetchIdeaShelves();
    },

    toggleGroup(group) {
      const next = new Set(get().expandedGroups);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      set({ expandedGroups: next });
    },

    toggleDir(dirPath) {
      const next = new Set(get().collapsedDirs);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      set({ collapsedDirs: next });
    },

    expandAllDirs() {
      set({ collapsedDirs: new Set() });
    },

    collapseAllDirs(allDirPaths) {
      set({ collapsedDirs: new Set(allDirPaths) });
    },

    toggleGroupByDirectory() {
      set({
        groupByDirectory: !get().groupByDirectory,
        collapsedDirs: new Set(),
      });
    },

    toggleShowUnversioned() {
      set({ showUnversioned: !get().showUnversioned });
    },
  };
}

function retainValid(values: ReadonlySet<string>, valid: Set<string>) {
  const retained = new Set<string>();
  for (const value of values) {
    if (valid.has(value)) retained.add(value);
  }
  return retained;
}
