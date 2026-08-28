import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChangesApp } from "./changes/App";
import { CommitApp } from "./commit/App";
import { CompareApp } from "./compare/App";
import { ConflictsApp } from "./conflicts/App";
import { MergeStandaloneApp } from "./conflicts/MergeStandaloneApp";
import { DiffApp } from "./diff/App";
import { PanelApp } from "./panel/App";
import { PushApp } from "./push/App";
import { RollbackApp } from "./rollback/App";
import { bridge } from "./shared/bridge";
import "./shared/theme/variables.css";

// Fix Cmd+A/Ctrl+A not working in webview inputs (VS Code intercepts it)
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "a") {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
      e.stopPropagation();
      (target as HTMLInputElement).select();
    }
  }
});

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");
const mode = root.dataset.mode as
  | "panel"
  | "merge"
  | "conflicts"
  | "commit"
  | "push"
  | "rollback"
  | "compare"
  | "changes"
  | "diff"
  | undefined;

// Initialize the bridge's repo context from the host-supplied data-repo-id
// before React renders, so the first batch of requests target the right repo.
const initialRepoId = root.dataset.repoId ?? null;
if (initialRepoId) bridge.setRepoContext(initialRepoId);

createRoot(root).render(
  <StrictMode>
    {mode === "diff" ? (
      <DiffApp />
    ) : mode === "merge" ? (
      <MergeStandaloneApp />
    ) : mode === "conflicts" ? (
      <ConflictsApp />
    ) : mode === "commit" ? (
      <CommitApp />
    ) : mode === "push" ? (
      <PushApp />
    ) : mode === "rollback" ? (
      <RollbackApp />
    ) : mode === "compare" ? (
      <CompareApp />
    ) : mode === "changes" ? (
      <ChangesApp />
    ) : (
      <PanelApp />
    )}
  </StrictMode>,
);
