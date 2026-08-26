import * as assert from "node:assert";
import type * as vscode from "vscode";
import { IdeaGitError, IdeaGitErrorCode } from "../../git/errors";
import { GitService } from "../../git/gitService";
import {
  type CommandHandler,
  MessageRouter,
} from "../../messages/messageRouter";
import type {
  RequestContext,
  RequestMessage,
  ResponseMessage,
} from "../../messages/protocol";

// Minimal fake webview — MessageRouter uses only postMessage + onDidReceiveMessage.
function fakeWebview(onPost: (msg: ResponseMessage) => void): vscode.Webview {
  return {
    postMessage: onPost,
    onDidReceiveMessage: () => ({ dispose: () => {} }),
  } as unknown as vscode.Webview;
}

// Expose the private handler entry point so tests can drive the resolution path
// without going through the real webview message bus.
interface RouterWithHandleRequest {
  handleRequest(webview: vscode.Webview, msg: RequestMessage): Promise<void>;
}

describe("MessageRouter repo context", () => {
  it("preserves the typed selected-commit error code and recovery", async () => {
    const router = new MessageRouter();
    router.handle("getStatus", async () => {
      throw new IdeaGitError(
        IdeaGitErrorCode.PARTIAL_FILE_SELECTION_UNSUPPORTED,
        "Cannot commit only the workspace row.",
        "Include the staged row and retry.",
      );
    });
    const responses: ResponseMessage[] = [];
    const webview = fakeWebview((message) => responses.push(message));

    await (router as unknown as RouterWithHandleRequest).handleRequest(
      webview,
      { type: "request", id: "recovery", command: "getStatus", params: {} },
    );

    assert.deepStrictEqual(responses[0].error, {
      code: "PARTIAL_FILE_SELECTION_UNSUPPORTED",
      message: "Cannot commit only the workspace row.",
      recovery: "Include the staged row and retry.",
    });
  });

  it("resolves and passes RequestContext to handler", async () => {
    const router = new MessageRouter();
    const paths = {
      workTreeRoot: "/r",
      gitDir: "/r/.git",
      commonDir: "/r/.git",
    };
    const ctx: RequestContext = {
      repoId: "/r",
      repo: { id: "/r", name: "r", rootPath: "/r" },
      paths,
      gitService: new GitService(paths),
    };
    router.setRepoResolver((id) => (id === "/r" ? ctx : null));
    let received: RequestContext | undefined;
    router.handle("getStatus", ((_p, c) => {
      received = c;
      return {};
    }) as CommandHandler);

    const received2: ResponseMessage[] = [];
    const wv = fakeWebview((m) => received2.push(m));
    router.registerWebview(wv);
    // handleRequest is private; call it directly to exercise the resolution path.
    (router as unknown as RouterWithHandleRequest).handleRequest(wv, {
      type: "request",
      id: "1",
      command: "getStatus",
      params: {},
      repoId: "/r",
    });
    await new Promise((r) => setTimeout(r, 0));
    assert.strictEqual(received, ctx);
    assert.strictEqual(received2[0].success, true);
  });

  it("rejects an explicit unknown repoId even in compatibility mode", async () => {
    const router = new MessageRouter();
    router.setRepoResolver((id) =>
      id === undefined ? ({ repoId: "/active" } as RequestContext) : null,
    );
    router.handle("getStatus", (async () => ({})) as CommandHandler);
    const received: ResponseMessage[] = [];
    const wv = fakeWebview((m) => received.push(m));
    router.registerWebview(wv);
    (router as unknown as RouterWithHandleRequest).handleRequest(wv, {
      type: "request",
      id: "2",
      command: "getStatus",
      params: {},
      repoId: "/missing",
    });
    await new Promise((r) => setTimeout(r, 0));
    assert.strictEqual(received[0].success, false);
    assert.strictEqual(received[0].error?.code, "REPO_NOT_FOUND");
  });

  it("keeps legacy requests runnable before a resolver is installed", async () => {
    const router = new MessageRouter();
    let called = false;
    router.handle("getStatus", async (_params, context) => {
      called = true;
      assert.strictEqual(context, undefined);
      return {};
    });
    const responses: ResponseMessage[] = [];
    const wv = fakeWebview((message) => responses.push(message));
    (router as unknown as RouterWithHandleRequest).handleRequest(wv, {
      type: "request",
      id: "3",
      command: "getStatus",
      params: {},
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(called, true);
    assert.strictEqual(responses[0].success, true);
  });

  it("requires repoId only after the explicit strict-mode flip", async () => {
    const router = new MessageRouter();
    router.setRepoResolver(() => ({ repoId: "/active" }) as RequestContext);
    router.enableStrictRepoContext();
    router.handle("getStatus", async () => ({}));
    const responses: ResponseMessage[] = [];
    const wv = fakeWebview((message) => responses.push(message));
    (router as unknown as RouterWithHandleRequest).handleRequest(wv, {
      type: "request",
      id: "4",
      command: "getStatus",
      params: {},
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(responses[0].error?.code, "REPO_NOT_FOUND");
  });

  it("allows repo-agnostic commands without repoId in strict mode", async () => {
    const router = new MessageRouter();
    router.enableStrictRepoContext();
    router.handle("getRepos", async () => ({ repos: [], activeId: null }));
    const responses: ResponseMessage[] = [];
    const wv = fakeWebview((message) => responses.push(message));
    (router as unknown as RouterWithHandleRequest).handleRequest(wv, {
      type: "request",
      id: "strict-agnostic",
      command: "getRepos",
      params: {},
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(responses[0].success, true);
  });

  // F4: closing a panel is repo-agnostic (sent with { scope: "global" }, no repoId).
  // Under strict mode it must still route to the handler, not REPO_NOT_FOUND.
  it("routes closePushPanel without repoId in strict mode (F4)", async () => {
    const router = new MessageRouter();
    router.enableStrictRepoContext();
    router.handle("closePushPanel", (async () => ({
      closed: true,
    })) as CommandHandler);
    const responses: ResponseMessage[] = [];
    const wv = fakeWebview((message) => responses.push(message));
    (router as unknown as RouterWithHandleRequest).handleRequest(wv, {
      type: "request",
      id: "f4-push",
      command: "closePushPanel",
      params: {},
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(responses[0].success, true);
    assert.deepStrictEqual(responses[0].data, { closed: true });
  });

  it("routes closeRollbackPanel without repoId in strict mode (F4)", async () => {
    const router = new MessageRouter();
    router.enableStrictRepoContext();
    router.handle("closeRollbackPanel", (async () => ({
      closed: true,
    })) as CommandHandler);
    const responses: ResponseMessage[] = [];
    const wv = fakeWebview((message) => responses.push(message));
    (router as unknown as RouterWithHandleRequest).handleRequest(wv, {
      type: "request",
      id: "f4-rollback",
      command: "closeRollbackPanel",
      params: {},
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(responses[0].success, true);
    assert.deepStrictEqual(responses[0].data, { closed: true });
  });

  // Precision guard: the F4 fix must not weaken the strict gate for genuinely
  // repo-bound commands. getBranches without repoId still rejects.
  it("still rejects repo-bound commands without repoId in strict mode (F4 precision)", async () => {
    const router = new MessageRouter();
    router.enableStrictRepoContext();
    router.setRepoResolver(() => ({ repoId: "/active" }) as RequestContext);
    router.handle("getBranches", async () => ({ branches: [] }));
    const responses: ResponseMessage[] = [];
    const wv = fakeWebview((message) => responses.push(message));
    (router as unknown as RouterWithHandleRequest).handleRequest(wv, {
      type: "request",
      id: "f4-precision",
      command: "getBranches",
      params: {},
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(responses[0].success, false);
    assert.strictEqual(responses[0].error?.code, "REPO_NOT_FOUND");
  });
});
