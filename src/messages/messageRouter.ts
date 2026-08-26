import type * as vscode from "vscode";
import { PorcelainError } from "../git/errors";
import {
  type CommandType,
  ErrorCode,
  type EventMessage,
  type EventType,
  type RequestContext,
  type RequestMessage,
  type ResponseMessage,
} from "./protocol";

export type CommandHandler = (
  params: Record<string, unknown>,
  context?: RequestContext,
) => Promise<unknown>;

export type RepoResolver = (
  repoId: string | undefined,
) => RequestContext | null;

/** Commands that never touch a repo and must not require repoId. */
const REPO_AGNOSTIC_COMMANDS = new Set<CommandType>([
  "showInputBox",
  "showConfirmMessage",
  "showErrorNotification",
  "showInfoNotification",
  "copyToClipboard",
  "getBranchDashboardPreferences",
  "setBranchDashboardPreferences",
  "getRepos",
  "selectRepo",
  // Closing a webview panel (Push/Rollback) touches no repo and is sent
  // with { scope: "global" } (no repoId). Must stay agnostic so the strict
  // repo gate doesn't reject it with REPO_NOT_FOUND.
  "closePushPanel",
  "closeRollbackPanel",
]);

export class MessageRouter {
  private webviews = new Set<vscode.Webview>();
  private handlers = new Map<string, CommandHandler>();
  private repoResolver: RepoResolver | null = null;
  private strictRepoContext = false;

  handle(command: CommandType, handler: CommandHandler): void {
    this.handlers.set(command, handler);
  }

  /** Set how repoId → RequestContext is resolved. Undefined means active repo in compatibility mode. */
  setRepoResolver(resolver: RepoResolver): void {
    this.repoResolver = resolver;
  }

  /** Call only after every repo-bound webview initializes Bridge repo context. */
  enableStrictRepoContext(): void {
    this.strictRepoContext = true;
  }

  registerWebview(webview: vscode.Webview): vscode.Disposable {
    this.webviews.add(webview);
    const messageDisposable = webview.onDidReceiveMessage(
      (msg: RequestMessage) => this.handleRequest(webview, msg),
    );
    return {
      dispose: () => {
        this.webviews.delete(webview);
        messageDisposable.dispose();
      },
    };
  }

  broadcastEvent(event: EventType, data: unknown): void {
    const msg: EventMessage = { type: "event", event, data };
    for (const webview of this.webviews) {
      webview.postMessage(msg);
    }
  }

  private async handleRequest(
    webview: vscode.Webview,
    msg: RequestMessage,
  ): Promise<void> {
    if (msg.type !== "request") return;

    const handler = this.handlers.get(msg.command);
    if (!handler) {
      this.sendResponse(webview, msg.id, false, undefined, {
        code: ErrorCode.UNKNOWN,
        message: `Unknown command: ${msg.command}`,
      });
      return;
    }

    let context: RequestContext | undefined;
    if (!REPO_AGNOSTIC_COMMANDS.has(msg.command)) {
      if (!msg.repoId && this.strictRepoContext) {
        this.sendResponse(webview, msg.id, false, undefined, {
          code: ErrorCode.REPO_NOT_FOUND,
          message: "No repository context for this request",
        });
        return;
      }

      // Without a resolver, only requests without an explicit repo continue on
      // the active-repository path. An explicit id is never allowed to fall through.
      if (!this.repoResolver && msg.repoId) {
        this.sendResponse(webview, msg.id, false, undefined, {
          code: ErrorCode.REPO_NOT_FOUND,
          message: `Repository not available: ${msg.repoId}`,
        });
        return;
      }
      if (this.repoResolver) {
        const resolved = this.repoResolver(msg.repoId);
        if (!resolved) {
          this.sendResponse(webview, msg.id, false, undefined, {
            code: ErrorCode.REPO_NOT_FOUND,
            message: msg.repoId
              ? `Repository not available: ${msg.repoId}`
              : "No active repository",
          });
          return;
        }
        context = resolved;
      }
    }

    try {
      const data = await handler(msg.params, context);
      this.sendResponse(webview, msg.id, true, data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendResponse(webview, msg.id, false, undefined, {
        code:
          err instanceof PorcelainError
            ? (err.code as ErrorCode)
            : ErrorCode.UNKNOWN,
        message,
        ...(err instanceof PorcelainError && err.recovery !== undefined
          ? { recovery: err.recovery }
          : {}),
      });
    }
  }

  private sendResponse(
    webview: vscode.Webview,
    id: string,
    success: boolean,
    data?: unknown,
    error?: { code: ErrorCode; message: string; recovery?: string },
  ): void {
    const response: ResponseMessage = {
      type: "response",
      id,
      success,
      data,
      error,
    };
    webview.postMessage(response);
  }
}
