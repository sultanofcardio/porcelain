import { useCallback, useEffect, useState } from "react";
import { DialogButton, DialogShell } from "./DialogShell";

export interface RemoteEntry {
  name: string;
  url: string;
}

export interface ManageRemotesPorts {
  list(): Promise<RemoteEntry[]>;
  add(name: string, url: string): Promise<void>;
  rename(oldName: string, newName: string): Promise<void>;
  setUrl(name: string, url: string): Promise<void>;
  remove(name: string): Promise<void>;
}

type Draft = { name: string; url: string; original?: RemoteEntry };

/**
 * IntelliJ's Manage Remotes: a Name/URL table with add, edit, and remove.
 * Editing a row can change both fields, so a save issues a rename, a URL
 * change, or both.
 */
export function ManageRemotesDialog({
  ports,
  onClose,
}: {
  ports: ManageRemotesPorts;
  onClose: () => void;
}) {
  const [remotes, setRemotes] = useState<RemoteEntry[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setRemotes(await ports.list());
    } catch (err) {
      setError(errorMessage(err));
      setRemotes([]);
    }
  }, [ports]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = useCallback(
    async (operation: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await operation();
        setDraft(null);
        await reload();
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const saveDraft = useCallback(() => {
    if (!draft) return;
    const name = draft.name.trim();
    const url = draft.url.trim();
    if (!name || !url) {
      setError("A remote needs both a name and a URL.");
      return;
    }
    const original = draft.original;
    void run(async () => {
      if (!original) {
        await ports.add(name, url);
        return;
      }
      // A rename must land before the URL edit, which addresses the new name.
      if (original.name !== name) await ports.rename(original.name, name);
      if (original.url !== url) await ports.setUrl(name, url);
    });
  }, [draft, ports, run]);

  return (
    <DialogShell
      title="Manage Remotes"
      error={error}
      onClose={onClose}
      width={520}
      footer={
        <>
          <DialogButton
            onClick={() => setDraft({ name: "", url: "" })}
            disabled={busy || draft !== null}
          >
            Add Remote
          </DialogButton>
          <DialogButton variant="primary" onClick={onClose}>
            Done
          </DialogButton>
        </>
      }
    >
      {remotes === null ? (
        <div style={{ fontSize: 12, opacity: 0.6 }}>Loading remotes…</div>
      ) : remotes.length === 0 && !draft ? (
        <div style={{ fontSize: 12, opacity: 0.6 }}>
          No remotes configured yet.
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <HeaderCell>Name</HeaderCell>
              <HeaderCell>URL</HeaderCell>
              <HeaderCell> </HeaderCell>
            </tr>
          </thead>
          <tbody>
            {remotes.map((remote) => {
              const editing = draft?.original?.name === remote.name;
              return (
                <tr key={remote.name}>
                  <BodyCell>
                    {editing ? (
                      <TextInput
                        label={`Name for ${remote.name}`}
                        value={draft.name}
                        onChange={(name) => setDraft({ ...draft, name })}
                      />
                    ) : (
                      remote.name
                    )}
                  </BodyCell>
                  <BodyCell>
                    {editing ? (
                      <TextInput
                        label={`URL for ${remote.name}`}
                        value={draft.url}
                        onChange={(url) => setDraft({ ...draft, url })}
                      />
                    ) : (
                      <span style={{ wordBreak: "break-all", opacity: 0.85 }}>
                        {remote.url}
                      </span>
                    )}
                  </BodyCell>
                  <BodyCell>
                    <div style={{ display: "flex", gap: 6 }}>
                      {editing ? (
                        <>
                          <DialogButton
                            variant="primary"
                            onClick={saveDraft}
                            disabled={busy}
                          >
                            Save
                          </DialogButton>
                          <DialogButton
                            onClick={() => setDraft(null)}
                            disabled={busy}
                          >
                            Cancel
                          </DialogButton>
                        </>
                      ) : (
                        <>
                          <DialogButton
                            onClick={() =>
                              setDraft({
                                name: remote.name,
                                url: remote.url,
                                original: remote,
                              })
                            }
                            disabled={busy || draft !== null}
                          >
                            Edit
                          </DialogButton>
                          <DialogButton
                            variant="danger"
                            onClick={() =>
                              void run(() => ports.remove(remote.name))
                            }
                            disabled={busy || draft !== null}
                          >
                            Remove
                          </DialogButton>
                        </>
                      )}
                    </div>
                  </BodyCell>
                </tr>
              );
            })}
            {draft && !draft.original && (
              <tr>
                <BodyCell>
                  <TextInput
                    label="New remote name"
                    value={draft.name}
                    placeholder="origin"
                    onChange={(name) => setDraft({ ...draft, name })}
                  />
                </BodyCell>
                <BodyCell>
                  <TextInput
                    label="New remote URL"
                    value={draft.url}
                    placeholder="git@example.com:owner/repo.git"
                    onChange={(url) => setDraft({ ...draft, url })}
                  />
                </BodyCell>
                <BodyCell>
                  <div style={{ display: "flex", gap: 6 }}>
                    <DialogButton
                      variant="primary"
                      onClick={saveDraft}
                      disabled={busy}
                    >
                      Save
                    </DialogButton>
                    <DialogButton
                      onClick={() => setDraft(null)}
                      disabled={busy}
                    >
                      Cancel
                    </DialogButton>
                  </div>
                </BodyCell>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </DialogShell>
  );
}

function HeaderCell({ children }: { children: React.ReactNode }) {
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

function BodyCell({ children }: { children: React.ReactNode }) {
  return (
    <td
      style={{
        padding: "6px 8px",
        fontSize: 12,
        borderBottom: "1px solid var(--border-soft, #333)",
        verticalAlign: "middle",
      }}
    >
      {children}
    </td>
  );
}

function TextInput({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type="text"
      aria-label={label}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      style={{
        width: "100%",
        padding: "3px 6px",
        fontSize: 12,
        border: "1px solid var(--vscode-input-border, #3c3c3c)",
        background: "var(--vscode-input-background, #3c3c3c)",
        color: "var(--vscode-input-foreground, #ccc)",
        borderRadius: 3,
        outline: "none",
        boxSizing: "border-box",
      }}
    />
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
