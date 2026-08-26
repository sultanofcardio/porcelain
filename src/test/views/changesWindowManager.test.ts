import * as assert from "node:assert";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { GitService } from "../../git/gitService";
import type { RequestContext } from "../../messages/protocol";
import { ChangesWindowManager } from "../../views/changesWindowManager";
import { CONFIG_SECTION, OPEN_IN_SETTING } from "../../views/floatingWindow";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout.trim();
}

/** Minimal MessageRouter stand-in that records registrations and handlers. */
function fakeRouter() {
  const handlers = new Map<
    string,
    (params: Record<string, unknown>, ctx?: RequestContext) => Promise<unknown>
  >();
  let registered = 0;
  return {
    handlers,
    get registeredWebviews() {
      return registered;
    },
    handle(
      command: string,
      handler: typeof handlers extends Map<string, infer H> ? H : never,
    ) {
      handlers.set(command, handler);
    },
    registerWebview(): vscode.Disposable {
      registered += 1;
      return { dispose: () => undefined };
    },
    broadcastEvent(): void {},
  };
}

/** Every webview tab Porcelain opened, across every window. */
function webviewTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs.filter((tab) => tab.input instanceof vscode.TabInputWebview),
  );
}

/**
 * Tab state reaches the extension host asynchronously, so opening a panel and
 * reading `tabGroups` in the same turn races. Poll until the count settles.
 */
async function waitForWebviewTabs(
  expected: number,
  what: string,
): Promise<vscode.Tab[]> {
  const deadline = Date.now() + 5000;
  let tabs = webviewTabs();
  while (tabs.length !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    tabs = webviewTabs();
  }
  assert.strictEqual(tabs.length, expected, what);
  return tabs;
}

async function waitForNoWebviewTabs(): Promise<void> {
  const deadline = Date.now() + 5000;
  while (webviewTabs().length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("Changes window", () => {
  let base: string;
  let repo: string;
  let service: GitService;
  let first: string;
  let second: string;

  before(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    base = await fs.mkdtemp(path.join(os.tmpdir(), "porcelain-changeswin-"));
    repo = path.join(base, "repo");
    await git(base, "init", "-b", "main", repo);
    await git(repo, "config", "user.name", "Porcelain Test");
    await git(repo, "config", "user.email", "porcelain@example.com");
    await fs.writeFile(path.join(repo, "a.txt"), "one\n");
    await git(repo, "add", "a.txt");
    await git(repo, "commit", "-m", "first");
    first = await git(repo, "rev-parse", "HEAD");
    await fs.writeFile(path.join(repo, "b.txt"), "two\n");
    await git(repo, "add", "b.txt");
    await git(repo, "commit", "-m", "second");
    second = await git(repo, "rev-parse", "HEAD");
    service = new GitService({
      workTreeRoot: repo,
      gitDir: path.join(repo, ".git"),
      commonDir: path.join(repo, ".git"),
    });
  });

  after(async () => {
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update(OPEN_IN_SETTING, undefined, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await fs.rm(base, { recursive: true, force: true });
  });

  afterEach(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await waitForNoWebviewTabs();
  });

  it("opens one window per comparison and reveals it again on repeat", async () => {
    // Editor tabs keep the surfaces in this window so the assertions do not
    // depend on the host being able to create an auxiliary window.
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update(OPEN_IN_SETTING, "editorTab", vscode.ConfigurationTarget.Global);
    const router = fakeRouter();
    const manager = new ChangesWindowManager(
      vscode.Uri.file(path.join(base, "ext")),
      router as never,
    );

    const spec = { repoId: "repo-a", fromHash: first, toHash: second };
    await manager.open(spec);
    await manager.open(spec);

    const tabs = await waitForWebviewTabs(
      1,
      "reopening the same comparison must reveal the existing window",
    );
    assert.strictEqual(
      tabs[0].label,
      `Changes Between ${first.slice(0, 8)} and ${second.slice(0, 8)}`,
    );
    assert.strictEqual(
      router.registeredWebviews,
      1,
      "the revealed window must not register a second webview",
    );

    await manager.open({ ...spec, fromHash: second, toHash: first });
    await waitForWebviewTabs(2, "a different comparison gets its own window");

    manager.dispose();
  });

  it("seeds the window with the repo and both endpoints", async () => {
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update(OPEN_IN_SETTING, "editorTab", vscode.ConfigurationTarget.Global);
    const created: vscode.WebviewPanel[] = [];
    const original = vscode.window.createWebviewPanel;
    (vscode.window as { createWebviewPanel: unknown }).createWebviewPanel = ((
      ...args: Parameters<typeof vscode.window.createWebviewPanel>
    ) => {
      const panel = original(...args);
      created.push(panel);
      return panel;
    }) as typeof vscode.window.createWebviewPanel;

    try {
      const manager = new ChangesWindowManager(
        vscode.Uri.file(path.join(base, "ext")),
        fakeRouter() as never,
      );
      await manager.open({
        repoId: "repo-a",
        fromHash: first,
        toHash: second,
      });

      assert.strictEqual(created.length, 1);
      const html = created[0].webview.html;
      assert.match(html, /data-mode="changes"/);
      assert.match(html, /data-repo-id="repo-a"/);
      assert.match(html, new RegExp(`data-from-hash="${first}"`));
      assert.match(html, new RegExp(`data-to-hash="${second}"`));
      manager.dispose();
    } finally {
      (vscode.window as { createWebviewPanel: unknown }).createWebviewPanel =
        original;
    }
  });

  it("lists the files the window will show for its endpoints", async () => {
    assert.deepStrictEqual(
      (await service.getComparisonFiles(first, second)).map(
        (file) => file.newPath,
      ),
      ["b.txt"],
    );
  });
});
