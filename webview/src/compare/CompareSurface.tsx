import { Allotment } from "allotment";
import type { StoreApi } from "zustand/vanilla";
import { DetailPanel } from "../panel/components/DetailPanel";
import { GitGraphPanel } from "../panel/components/GitGraphPanel";
import { Toolbar } from "../panel/components/Toolbar";
import {
  GitLogStoreProvider,
  useGitLogStore,
} from "../shared/store/git-log-store-context";
import {
  hasActiveLogFilter,
  type PanelStore,
} from "../shared/store/panel-store";
import type { GitRefIdentity } from "../shared/types/git";

interface CompareSurfaceProps {
  id: "top" | "bottom";
  store: StoreApi<PanelStore>;
  fromRef: GitRefIdentity;
  toRef: GitRefIdentity;
  onRefreshComparison: () => void | Promise<void>;
}

type SurfaceState =
  | "repository-unavailable"
  | "load-error"
  | "ref-unavailable"
  | "empty-range"
  | "empty-filter";

function EmptyState({
  id,
  state,
  message,
}: {
  id: CompareSurfaceProps["id"];
  state: SurfaceState;
  message: string;
}) {
  return (
    <div
      className="compare-surface-state"
      data-testid={`compare-${id}-state`}
      data-state={state}
    >
      {message}
    </div>
  );
}

function CompareSurfaceContent({
  id,
  fromRef,
  toRef,
  onRefreshComparison,
}: Omit<CompareSurfaceProps, "store">) {
  const commits = useGitLogStore((state) => state.commits);
  const filter = useGitLogStore((state) => state.filter);
  const loading = useGitLogStore((state) => state.loading);
  const operationInProgress = useGitLogStore(
    (state) => state.operationInProgress,
  );
  const unavailableRef = useGitLogStore((state) => state.unavailableRef);
  const loadError = useGitLogStore((state) => state.loadError);
  const hasActiveFilter = hasActiveLogFilter(filter);

  let surfaceState: { state: SurfaceState; message: string } | null = null;
  if (loadError?.kind === "repository-unavailable") {
    surfaceState = {
      state: "repository-unavailable",
      message: "Repository unavailable.",
    };
  } else if (loadError) {
    surfaceState = {
      state: "load-error",
      message: `Unable to load this range: ${loadError.message}`,
    };
  } else if (unavailableRef) {
    surfaceState = {
      state: "ref-unavailable",
      message: `Ref ${unavailableRef.name} is unavailable.`,
    };
  } else if (!loading && commits.length === 0) {
    surfaceState = hasActiveFilter
      ? { state: "empty-filter", message: "No commits match these filters." }
      : { state: "empty-range", message: "No commits in this range." };
  }

  return (
    <section
      className="compare-surface"
      data-testid={`compare-${id}`}
      aria-label={`${toRef.name} compared with ${fromRef.name}`}
    >
      <header className="compare-surface-header">
        <span className="compare-surface-title">{toRef.name}</span>
        <span className="compare-surface-range">
          commits in {toRef.name}, not in {fromRef.name}
        </span>
      </header>
      {(loading || operationInProgress) && (
        <div className="compare-surface-progress" aria-label="Loading" />
      )}
      <div className="compare-surface-body">
        <Allotment proportionalLayout={false}>
          <Allotment.Pane minSize={400}>
            <div className="compare-surface-log">
              <Toolbar showBranchFilter={false} />
              <div className="compare-surface-graph">
                {surfaceState ? (
                  <EmptyState id={id} {...surfaceState} />
                ) : (
                  <GitGraphPanel onRefreshComparison={onRefreshComparison} />
                )}
              </div>
            </div>
          </Allotment.Pane>
          <Allotment.Pane preferredSize={350} minSize={220} maxSize={600}>
            <div
              className="compare-surface-detail"
              data-testid={`compare-${id}-detail`}
            >
              <DetailPanel />
            </div>
          </Allotment.Pane>
        </Allotment>
      </div>
    </section>
  );
}

export function CompareSurface({ store, ...props }: CompareSurfaceProps) {
  return (
    <GitLogStoreProvider store={store}>
      <CompareSurfaceContent {...props} />
    </GitLogStoreProvider>
  );
}
