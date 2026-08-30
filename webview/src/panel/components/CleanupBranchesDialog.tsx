import { useCallback, useEffect, useMemo, useState } from "react";
import { DialogButton, DialogShell } from "./DialogShell";

export interface MergedBranchRow {
  name: string;
  lastCommitDate: string;
  upstream?: string;
  merged: boolean;
}

export interface CleanupBranchesPorts {
  list(prefix: string): Promise<MergedBranchRow[]>;
  remove(name: string, force: boolean): Promise<void>;
}

/**
 * IntelliJ's Clean Up Branches: the local branches with their last-commit
 * date, tracked branch, and merge status, filtered by a directory-style
 * prefix. Only merged branches are pre-selected — deleting an unmerged one
 * needs force, so it stays an explicit choice.
 */
export function CleanupBranchesDialog({
  ports,
  targetLabel,
  onClose,
}: {
  ports: CleanupBranchesPorts;
  /** The branch merge status is measured against, e.g. "main". */
  targetLabel: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<MergedBranchRow[] | null>(null);
  const [prefix, setPrefix] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (nextPrefix: string) => {
      setError(null);
      try {
        const result = await ports.list(nextPrefix);
        setRows(result);
        // Merged branches are the safe default selection.
        setSelected(
          new Set(result.filter((row) => row.merged).map((row) => row.name)),
        );
      } catch (err) {
        setError(errorMessage(err));
        setRows([]);
      }
    },
    [ports],
  );

  useEffect(() => {
    void load("");
  }, [load]);

  const selectedRows = useMemo(
    () => (rows ?? []).filter((row) => selected.has(row.name)),
    [rows, selected],
  );
  const unmergedSelected = selectedRows.filter((row) => !row.merged).length;

  const toggle = (name: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const deleteSelected = useCallback(() => {
    if (selectedRows.length === 0) return;
    setBusy(true);
    setError(null);
    void (async () => {
      const failures: string[] = [];
      for (const row of selectedRows) {
        try {
          // An unmerged branch can only go with force, which the count in
          // the button label already warned about.
          await ports.remove(row.name, !row.merged);
        } catch (err) {
          failures.push(`${row.name}: ${errorMessage(err)}`);
        }
      }
      setBusy(false);
      // The refresh clears the error banner, so report failures after it.
      await load(prefix);
      if (failures.length) setError(failures.join("\n"));
    })();
  }, [load, ports, prefix, selectedRows]);

  return (
    <DialogShell
      title="Clean Up Branches"
      error={error}
      onClose={onClose}
      width={560}
      footer={
        <>
          <DialogButton onClick={onClose} disabled={busy}>
            Close
          </DialogButton>
          <DialogButton
            variant="danger"
            onClick={deleteSelected}
            disabled={busy || selectedRows.length === 0}
          >
            {unmergedSelected > 0
              ? `Delete ${selectedRows.length} (${unmergedSelected} unmerged)`
              : `Delete ${selectedRows.length}`}
          </DialogButton>
        </>
      }
    >
      <div style={{ marginBottom: 10 }}>
        <label
          htmlFor="cleanup-prefix"
          style={{ fontSize: 12, display: "block", marginBottom: 4 }}
        >
          Filter by prefix
        </label>
        <input
          id="cleanup-prefix"
          type="text"
          value={prefix}
          placeholder="feature/"
          onChange={(event) => setPrefix(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void load(prefix);
          }}
          onBlur={() => void load(prefix)}
          style={{
            width: "100%",
            padding: "4px 8px",
            fontSize: 12,
            border: "1px solid var(--vscode-input-border, #3c3c3c)",
            background: "var(--vscode-input-background, #3c3c3c)",
            color: "var(--vscode-input-foreground, #ccc)",
            borderRadius: 3,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      {rows === null ? (
        <div style={{ fontSize: 12, opacity: 0.6 }}>Loading branches…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.6 }}>
          No branches match this prefix.
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <Th> </Th>
              <Th>Branch</Th>
              <Th>Last commit</Th>
              <Th>Tracked</Th>
              <Th>Merged to {targetLabel}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <Td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.name}`}
                    checked={selected.has(row.name)}
                    onChange={() => toggle(row.name)}
                    style={{ accentColor: "#3574f0" }}
                  />
                </Td>
                <Td>{row.name}</Td>
                <Td>{formatDate(row.lastCommitDate)}</Td>
                <Td>
                  <span style={{ opacity: row.upstream ? 0.85 : 0.4 }}>
                    {row.upstream ?? "—"}
                  </span>
                </Td>
                <Td>
                  <span
                    style={{
                      color: row.merged
                        ? "var(--vscode-testing-iconPassed, #59a869)"
                        : "var(--vscode-editorWarning-foreground, #e5c07b)",
                    }}
                  >
                    {row.merged ? "Merged" : "Not merged"}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </DialogShell>
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
        whiteSpace: "nowrap",
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
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </td>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || "—";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function errorMessage(error: unknown): string {
  const value = error as { message?: unknown };
  return typeof value?.message === "string"
    ? value.message
    : error instanceof Error
      ? error.message
      : String(error);
}
