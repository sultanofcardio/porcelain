import * as assert from "node:assert";
import type * as vscode from "vscode";
import type { GitService } from "../../git/gitService";
import type { LogOptions } from "../../git/types";
import { registerLogHandlers } from "../../messages/logHandlers";
import { MessageRouter } from "../../messages/messageRouter";
import type {
  LogQueryParams,
  RequestContext,
  RequestMessage,
  ResponseMessage,
} from "../../messages/protocol";

const mainRef = {
  type: "local" as const,
  name: "main",
  fullRef: "refs/heads/main",
};
const featureRef = {
  type: "local" as const,
  name: "feature",
  fullRef: "refs/heads/feature",
};

interface RouterWithHandleRequest {
  handleRequest(webview: vscode.Webview, msg: RequestMessage): Promise<void>;
}

function fakeWebview(onPost: (msg: ResponseMessage) => void): vscode.Webview {
  return {
    postMessage: onPost,
    onDidReceiveMessage: () => ({ dispose: () => {} }),
  } as unknown as vscode.Webview;
}

async function request(
  router: MessageRouter,
  command: "getGraphData" | "loadMoreLog",
  params: LogQueryParams,
): Promise<ResponseMessage> {
  let response: ResponseMessage | undefined;
  const webview = fakeWebview((message) => {
    response = message;
  });
  await (router as unknown as RouterWithHandleRequest).handleRequest(webview, {
    type: "request",
    id: "log-request",
    command,
    params: params as unknown as Record<string, unknown>,
    repoId: "repo",
  });
  assert.ok(response);
  return response;
}

function setup(overrides: Partial<GitService> = {}): {
  router: MessageRouter;
  service: GitService;
} {
  const service = {
    resolveCommitRef: async (ref: string) => `${ref}-tip`,
    getGraphTopology: async () => ({
      graphData: { commits: [], lanes: {} },
      snapshot: {
        activeLanes: [],
        laneColors: [],
        nextColorIndex: 0,
      },
    }),
    ...overrides,
  } as unknown as GitService;
  const context = {
    repoId: "repo",
    repo: { id: "repo", name: "repo", rootPath: "/repo" },
    paths: {
      workTreeRoot: "/repo",
      gitDir: "/repo/.git",
      commonDir: "/repo/.git",
    },
    gitService: service,
  } satisfies RequestContext;
  const router = new MessageRouter();
  router.setRepoResolver(() => context);
  registerLogHandlers(router);
  return { router, service };
}

describe("structured log handlers", () => {
  it("returns ref-unavailable when the excluded range endpoint is missing", async () => {
    const { router } = setup({
      resolveCommitRef: async (ref: string) =>
        ref === mainRef.fullRef ? null : `${ref}-tip`,
    } as Partial<GitService>);

    const response = await request(router, "getGraphData", {
      revision: {
        kind: "range",
        excludeRef: mainRef,
        includeRef: featureRef,
      },
    });

    assert.strictEqual(response.success, true);
    assert.deepStrictEqual(response.data, {
      status: "ref-unavailable",
      ref: mainRef,
    });
  });

  it("returns ref-unavailable when the included range endpoint is missing", async () => {
    const { router } = setup({
      resolveCommitRef: async (ref: string) =>
        ref === featureRef.fullRef ? null : `${ref}-tip`,
    } as Partial<GitService>);

    const response = await request(router, "loadMoreLog", {
      revision: {
        kind: "range",
        excludeRef: mainRef,
        includeRef: featureRef,
      },
    });

    assert.strictEqual(response.success, true);
    assert.deepStrictEqual(response.data, {
      status: "ref-unavailable",
      ref: featureRef,
    });
  });

  it("returns an ok page and passes structured refs, filters, and current ref", async () => {
    let received:
      | {
          options: LogOptions | undefined;
          snapshot: unknown;
          currentRef: unknown;
        }
      | undefined;
    const snapshot = {
      activeLanes: [null],
      laneColors: [null],
      nextColorIndex: 1,
    };
    const graphResult = {
      graphData: {
        commits: [{ hash: "a" }, { hash: "b" }],
        lanes: {},
      },
      snapshot,
    };
    const { router } = setup({
      getGraphTopology: async (options, previous, currentRef) => {
        received = { options, snapshot: previous, currentRef };
        return graphResult as never;
      },
    } as Partial<GitService>);

    const response = await request(router, "getGraphData", {
      maxCount: 2,
      skip: 3,
      revision: {
        kind: "range",
        excludeRef: mainRef,
        includeRef: featureRef,
      },
      currentRef: mainRef,
      search: "fix",
      searchRegex: true,
      searchCaseSensitive: false,
      author: "Ada",
      since: "2026-01-01",
      until: "2026-02-01",
      file: "src/index.ts",
      snapshot,
    });

    assert.deepStrictEqual(received, {
      options: {
        maxCount: 2,
        skip: 3,
        revision: {
          kind: "range",
          excludeRef: mainRef.fullRef,
          includeRef: featureRef.fullRef,
        },
        search: "fix",
        searchRegex: true,
        searchCaseSensitive: false,
        author: "Ada",
        since: "2026-01-01",
        until: "2026-02-01",
        file: "src/index.ts",
      },
      snapshot,
      currentRef: mainRef.fullRef,
    });
    assert.strictEqual(response.success, true);
    assert.deepStrictEqual(response.data, {
      status: "ok",
      ...graphResult,
      hasMore: true,
    });
  });
});
