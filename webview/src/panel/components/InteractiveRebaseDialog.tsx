import { useCallback, useEffect, useMemo, useState } from "react";
import type { Commit } from "../../shared/types/git";
import { DialogButton, DialogShell } from "./DialogShell";

export type RebaseAction =
  | "pick"
  | "reword"
  | "edit"
  | "squash"
  | "fixup"
  | "drop";

export interface RebaseRow {
  action: RebaseAction;
  hash: string;
  shortHash: string;
  subject: string;
  /** Edited subject for reword, or the combined message for a squash. */
  message?: string;
}

export interface InteractiveRebasePorts {
  /** Commits to rewrite, oldest first — the order git writes the todo in. */
  load(): Promise<Commit[]>;
  run(rows: RebaseRow[]): Promise<void>;
}

const ACTION_LABELS: Record<RebaseAction, string> = {
  pick: "Pick",
  reword: "Reword",
  edit: "Stop to Edit",
  squash: "Squash",
  fixup: "Fixup",
  drop: "Drop",
};

/**
 * IntelliJ's "Rebasing Commits" editor: a table of the commits about to be
 * rewritten, each with an action, inline message editing for reword and
 * squash, reordering, a reset, and a preview of the generated todo.
 */
export function InteractiveRebaseDialog({
  ports,
  onClose,
}: {
  ports: InteractiveRebasePorts;
  onClose: () => void;
}) {
  const [initial, setInitial] = useState<RebaseRow[] | null>(null);
  const [rows, setRows] = useState<RebaseRow[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [showCommands, setShowCommands] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const commits = await ports.load();
      const loaded = commits.map<RebaseRow>((commit) => ({
        action: "pick",
        hash: commit.hash,
        shortHash: commit.shortHash,
        subject: commit.subject,
      }));
      setInitial(loaded);
      setRows(loaded);
    } catch (err) {
      setError(errorMessage(err));
      setInitial([]);
    }
  }, [ports]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(
    () => initial !== null && JSON.stringify(initial) !== JSON.stringify(rows),
    [initial, rows],
  );

  const setAction = (hash: string, action: RebaseAction) => {
    setRows((current) =>
      current.map((row) =>
        row.hash === hash
          ? {
              ...row,
              action,
              // Squash and reword edit a message; the others carry none.
              message:
                action === "reword" || action === "squash"
                  ? (row.message ?? row.subject)
                  : undefined,
            }
          : row,
      ),
    );
    if (action === "reword" || action === "squash") setEditing(hash);
  };

  const move = (hash: string, delta: -1 | 1) => {
    setRows((current) => {
      const index = current.findIndex((row) => row.hash === hash);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const todoPreview = useMemo(
    () =>
      rows
        .map((row) => `${row.action} ${row.shortHash} ${row.subject}`)
        .join("\n"),
    [rows],
  );

  // Git cannot fold the first commit into anything above it.
  const invalidLead =
    rows.length > 0 &&
    (rows[0].action === "squash" || rows[0].action === "fixup");

  const start = useCallback(() => {
    if (invalidLead) return;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        await ports.run(rows);
        onClose();
      } catch (err) {
        setError(errorMessage(err));
        setBusy(false);
      }
    })();
  }, [invalidLead, onClose, ports, rows]);

  return (
    <DialogShell
      title="Rebasing Commits"
      error={
        error ??
        (invalidLead
          ? "The first commit has nothing above it to fold into. Choose another action, or move a picked commit above it."
          : null)
      }
      onClose={onClose}
      width={620}
      footer={
        <>
          <DialogButton
            onClick={() => setShowCommands((value) => !value)}
            disabled={busy}
          >
            {showCommands ? "Hide Git Commands" : "View Git Commands"}
          </DialogButton>
          <DialogButton
            onClick={() => {
              if (initial) setRows(initial);
              setEditing(null);
            }}
            disabled={busy || !dirty}
          >
            Reset
          </DialogButton>
          <DialogButton onClick={onClose} disabled={busy}>
            Cancel
          </DialogButton>
          <DialogButton
            variant="primary"
            onClick={start}
            disabled={busy || rows.length === 0 || invalidLead}
          >
            Start Rebasing
          </DialogButton>
        </>
      }
    >
      {initial === null ? (
        <div style={{ fontSize: 12, opacity: 0.6 }}>Loading commits…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.6 }}>
          No commits to rebase from here.
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <Th>Action</Th>
              <Th>Hash</Th>
              <Th>Subject</Th>
              <Th>Order</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.hash}
                style={{ opacity: row.action === "drop" ? 0.45 : 1 }}
              >
                <Td>
                  <select
                    aria-label={`Action for ${row.shortHash}`}
                    value={row.action}
                    onChange={(event) =>
                      setAction(row.hash, event.target.value as RebaseAction)
                    }
                    style={{
                      fontSize: 12,
                      padding: "2px 4px",
                      background: "var(--vscode-dropdown-background, #3c3c3c)",
                      color: "var(--vscode-dropdown-foreground, #ccc)",
                      border:
                        "1px solid var(--vscode-dropdown-border, #3c3c3c)",
                      borderRadius: 3,
                    }}
                  >
                    {Object.entries(ACTION_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Td>
                <Td>
                  <code style={{ fontSize: 11, opacity: 0.7 }}>
                    {row.shortHash}
                  </code>
                </Td>
                <Td>
                  {editing === row.hash ? (
                    <input
                      type="text"
                      aria-label={`Message for ${row.shortHash}`}
                      value={row.message ?? row.subject}
                      autoFocus
                      onChange={(event) =>
                        setRows((current) =>
                          current.map((candidate) =>
                            candidate.hash === row.hash
                              ? { ...candidate, message: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === "Escape") {
                          setEditing(null);
                        }
                      }}
                      onBlur={() => setEditing(null)}
                      style={{
                        width: "100%",
                        padding: "2px 6px",
                        fontSize: 12,
                        border: "1px solid var(--vscode-input-border, #3c3c3c)",
                        background: "var(--vscode-input-background, #3c3c3c)",
                        color: "var(--vscode-input-foreground, #ccc)",
                        borderRadius: 3,
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                  ) : (
                    <span
                      onDoubleClick={() => {
                        if (
                          row.action === "reword" ||
                          row.action === "squash"
                        ) {
                          setEditing(row.hash);
                        }
                      }}
                      style={{
                        textDecoration:
                          row.action === "drop" ? "line-through" : undefined,
                      }}
                    >
                      {row.message ?? row.subject}
                    </span>
                  )}
                </Td>
                <Td>
                  <div style={{ display: "flex", gap: 4 }}>
                    <MoveButton
                      label={`Move ${row.shortHash} up`}
                      glyph="↑"
                      disabled={index === 0 || busy}
                      onClick={() => move(row.hash, -1)}
                    />
                    <MoveButton
                      label={`Move ${row.shortHash} down`}
                      glyph="↓"
                      disabled={index === rows.length - 1 || busy}
                      onClick={() => move(row.hash, 1)}
                    />
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showCommands && (
        <pre
          aria-label="Generated rebase todo"
          style={{
            marginTop: 12,
            padding: 10,
            fontSize: 11,
            background: "var(--vscode-textCodeBlock-background, #1e1e1e)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            overflowX: "auto",
            whiteSpace: "pre",
          }}
        >
          {todoPreview}
        </pre>
      )}
    </DialogShell>
  );
}

function MoveButton({
  label,
  glyph,
  disabled,
  onClick,
}: {
  label: string;
  glyph: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 22,
        height: 20,
        fontSize: 11,
        border: "1px solid var(--border)",
        borderRadius: 3,
        background: "transparent",
        color: "var(--app-fg)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.35 : 0.8,
      }}
    >
      {glyph}
    </button>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        opacity: 0.6,
        padding: "4px 8px",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td
      style={{
        padding: "5px 8px",
        fontSize: 12,
        borderBottom: "1px solid var(--border-soft, #333)",
        verticalAlign: "middle",
      }}
    >
      {children}
    </td>
  );
}

function errorMessage(error: unknown): string {
  const value = error as { message?: unknown; recovery?: unknown };
  const message =
    typeof value?.message === "string"
      ? value.message
      : error instanceof Error
        ? error.message
        : String(error);
  return typeof value?.recovery === "string"
    ? `${message} ${value.recovery}`
    : message;
}
