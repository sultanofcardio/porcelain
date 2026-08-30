import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

/** What the rebase todo list can do with one commit. */
export type RebaseAction =
  | "pick"
  | "reword"
  | "edit"
  | "squash"
  | "fixup"
  | "drop";

export interface RebaseTodoEntry {
  action: RebaseAction;
  /** Full commit hash. */
  hash: string;
  /** Subject, written as the todo comment so the file reads like git's own. */
  subject: string;
  /**
   * Replacement message for `reword`, or the combined message for the commit
   * a `squash` group folds into. Ignored for other actions.
   */
  message?: string;
}

/**
 * The generated `git-rebase-todo` content, exactly as git will read it.
 * Rendering is separate from running so the plan can be previewed ("View Git
 * Commands") and asserted in tests without touching a repository.
 */
export function renderRebaseTodo(entries: readonly RebaseTodoEntry[]): string {
  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.action === "drop") {
      // Dropping is expressed by omission plus an explicit `drop` line, which
      // keeps the file readable when the user inspects it.
      lines.push(`drop ${entry.hash} ${entry.subject}`);
      continue;
    }
    lines.push(`${entry.action} ${entry.hash} ${entry.subject}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Messages git will ask for, in the order it will ask. A `reword` prompts
 * once for its own commit; a `squash` prompts once for the combined message
 * of the group it closes. `fixup` and the rest never prompt.
 */
export function collectEditorMessages(
  entries: readonly RebaseTodoEntry[],
): string[] {
  const messages: string[] = [];
  const folds = (action: RebaseAction) =>
    action === "squash" || action === "fixup";

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry.action === "reword") {
      messages.push(entry.message ?? entry.subject);
      continue;
    }
    if (!folds(entry.action)) continue;
    // Only handle a fold run once, from its first line.
    if (index > 0 && folds(entries[index - 1].action)) continue;

    let end = index;
    while (end + 1 < entries.length && folds(entries[end + 1].action)) end++;
    const run = entries.slice(index, end + 1);
    // A run prompts only if it contains a squash; a pure fixup run never
    // asks, because fixup discards the folded messages outright.
    if (!run.some((item) => item.action === "squash")) continue;
    const carrier =
      [...run].reverse().find((item) => item.message !== undefined) ??
      run[run.length - 1];
    messages.push(carrier.message ?? carrier.subject);
  }
  return messages;
}

/**
 * The environment that makes `git rebase -i` non-interactive.
 *
 * `GIT_SEQUENCE_EDITOR` is invoked as `<editor> <todo-path>`, so a script that
 * copies our rendered todo over that path is all the sequencer needs.
 * `GIT_EDITOR` is invoked once per message prompt; the same script serves the
 * queued messages in order, tracking position in a counter file so each
 * invocation — a separate process — picks up where the last left off.
 */
export interface RebaseEditorSetup {
  env: NodeJS.ProcessEnv;
  /** Remove the scratch files; safe to call twice. */
  cleanup(): Promise<void>;
}

const EDITOR_SCRIPT = `
const fs = require("node:fs");
const mode = process.argv[2];
const dataPath = process.argv[3];
// Git appends the file it wants edited as the final argument.
const target = process.argv[process.argv.length - 1];

if (mode === "sequence") {
  fs.copyFileSync(dataPath, target);
  process.exit(0);
}

// Message mode: serve queued messages in order. Each prompt is its own
// process, so the position lives in a counter file next to the queue.
const counterPath = dataPath + ".position";
let position = 0;
try {
  position = Number.parseInt(fs.readFileSync(counterPath, "utf8"), 10) || 0;
} catch {}
const messages = JSON.parse(fs.readFileSync(dataPath, "utf8"));
if (position < messages.length) {
  fs.writeFileSync(target, messages[position]);
  fs.writeFileSync(counterPath, String(position + 1));
}
// Past the end, leave git's own message in place rather than blanking it,
// which git would read as an instruction to abort.
process.exit(0);
`;

/**
 * Write the scratch files and build the environment for one rebase run.
 * Paths live in a private temp directory, never in the repository.
 */
export async function createRebaseEditorSetup(
  todo: string,
  messages: readonly string[],
): Promise<RebaseEditorSetup> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "porcelain-rebase-"));
  const scriptPath = path.join(dir, "editor.js");
  const todoPath = path.join(dir, "todo");
  const messagesPath = path.join(dir, "messages.json");

  await Promise.all([
    fs.writeFile(scriptPath, EDITOR_SCRIPT),
    fs.writeFile(todoPath, todo),
    fs.writeFile(messagesPath, JSON.stringify(messages)),
  ]);

  const node = quoteForShell(process.execPath);
  return {
    env: {
      GIT_SEQUENCE_EDITOR: `${node} ${quoteForShell(scriptPath)} sequence ${quoteForShell(todoPath)}`,
      GIT_EDITOR: `${node} ${quoteForShell(scriptPath)} message ${quoteForShell(messagesPath)}`,
    },
    async cleanup() {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

/**
 * Git runs the editor through a shell, so paths with spaces need quoting.
 * Double quotes work on both POSIX shells and cmd.exe; a path containing a
 * double quote cannot be expressed safely and is rejected instead.
 */
function quoteForShell(value: string): string {
  if (value.includes('"')) {
    throw new Error(`Path is not safe to pass through a shell: ${value}`);
  }
  return `"${value}"`;
}
