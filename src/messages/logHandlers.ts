import type { GitRefIdentity } from "../git/branchDashboardState";
import type { GitService } from "../git/gitService";
import type { LogOptions, LogRevision } from "../git/types";
import type { MessageRouter } from "./messageRouter";
import type {
  LogQueryParams,
  LogQueryResult,
  LogQueryRevision,
  RequestContext,
} from "./protocol";

const NOT_GIT_REPO = { status: "not_git_repo" as const, data: null };

export function registerLogHandlers(router: MessageRouter): void {
  router.handle("getGraphData", (params, context) =>
    handleGraphPage("getGraphData", params, context),
  );
  router.handle("loadMoreLog", (params, context) =>
    handleGraphPage("loadMoreLog", params, context),
  );
  router.handle("getLog", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    return context.gitService.getLog(
      params as Record<string, unknown> & { maxCount?: number },
    );
  });
  router.handle("getLogAuthors", async (_params, context) => {
    if (!context) return NOT_GIT_REPO;
    return context.gitService.getLogAuthors();
  });
  router.handle("getUserIdentity", async (_params, context) => {
    if (!context) return NOT_GIT_REPO;
    return context.gitService.getUserIdentity();
  });
  router.handle("resolveLogRef", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const input = params.input;
    if (typeof input !== "string") {
      throw new Error("resolveLogRef requires an input string");
    }
    const hash = await context.gitService.resolveRevisionInput(input);
    return { hash };
  });
  router.handle("getContainingBranches", async (params, context) => {
    if (!context) return NOT_GIT_REPO;
    const hash = params.hash;
    if (typeof hash !== "string" || !hash) {
      throw new Error("getContainingBranches requires a commit hash");
    }
    return context.gitService.getContainingBranches(hash);
  });
}

async function handleGraphPage(
  command: "getGraphData" | "loadMoreLog",
  rawParams: Record<string, unknown>,
  context: RequestContext | undefined,
): Promise<unknown> {
  if (!context) return NOT_GIT_REPO;
  const params = rawParams as LogQueryParams;
  const structured =
    params.revision !== undefined || params.currentRef !== undefined;
  const revision = params.revision
    ? await resolveRevision(context.gitService, params.revision)
    : undefined;
  if (revision && "unavailable" in revision) {
    return unavailable(revision.unavailable);
  }

  if (params.currentRef) {
    assertRefIdentity(params.currentRef);
    if (
      !(await context.gitService.resolveCommitRef(params.currentRef.fullRef))
    ) {
      return unavailable(params.currentRef);
    }
  }

  const maxCount =
    command === "loadMoreLog"
      ? (params.count ?? params.maxCount ?? 200)
      : (params.maxCount ?? 200);
  const options: LogOptions = {
    maxCount,
    skip: command === "loadMoreLog" ? (params.skip ?? 0) : params.skip,
    revision: revision && "value" in revision ? revision.value : undefined,
    ...(params.revision
      ? {}
      : { branch: params.branch, branches: params.branches }),
    search: params.search,
    searchRegex: params.searchRegex,
    searchCaseSensitive: params.searchCaseSensitive,
    author: params.author,
    since: params.since,
    until: params.until,
    file: params.file,
    paths: params.paths,
    sortTopo: params.sortTopo,
    firstParent: params.firstParent,
    noMerges: params.noMerges,
  };
  const result = await context.gitService.getGraphTopology(
    options,
    params.snapshot,
    params.currentRef?.fullRef,
  );
  if (!structured) return result;

  const response: LogQueryResult = {
    status: "ok",
    ...result,
    hasMore: result.graphData.commits.length >= maxCount,
  };
  return response;
}

async function resolveRevision(
  service: GitService,
  revision: LogQueryRevision,
): Promise<{ value: LogRevision } | { unavailable: GitRefIdentity }> {
  switch (revision.kind) {
    case "all":
      return { value: revision };
    case "ref":
      assertRefIdentity(revision.ref);
      if (!(await service.resolveCommitRef(revision.ref.fullRef))) {
        return { unavailable: revision.ref };
      }
      return { value: { kind: "ref", ref: revision.ref.fullRef } };
    case "range":
      for (const ref of [revision.excludeRef, revision.includeRef]) {
        assertRefIdentity(ref);
        if (!(await service.resolveCommitRef(ref.fullRef))) {
          return { unavailable: ref };
        }
      }
      return {
        value: {
          kind: "range",
          excludeRef: revision.excludeRef.fullRef,
          includeRef: revision.includeRef.fullRef,
        },
      };
  }
}

function assertRefIdentity(ref: GitRefIdentity): void {
  if (
    !ref ||
    !["local", "remote", "tag", "detached"].includes(ref.type) ||
    typeof ref.name !== "string" ||
    !ref.name ||
    typeof ref.fullRef !== "string" ||
    !ref.fullRef
  ) {
    throw new Error("Invalid structured Git ref");
  }
}

function unavailable(ref: GitRefIdentity): LogQueryResult {
  return { status: "ref-unavailable", ref };
}
