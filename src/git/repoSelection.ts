import type {
  DiscoveredRepo,
  RepoDescriptor,
  RepoRegistry,
} from "./repoRegistry";

/**
 * A promise-chain mutex: `chain(fn)` runs `fn` only after every previously
 * chained `fn` has settled (fulfilled OR rejected). A failing link is absorbed
 * (`.catch(() => undefined)`) so one rejection can never wedge the chain —
 * later links still run. This is the single lowest-level concurrency primitive
 * in this module.
 *
 * Fix-5 (F5): {@link RepoSelectionCoordinator} and {@link FolderReconciler}
 * historically each kept their OWN private `tail` promise-chain. That meant a
 * `select(B)` and a `reconcile(folders-without-B)` ran on two INDEPENDENT
 * mutexes and could interleave: `select` would `setActive(B)`, read
 * `activeId=B`, then `await persist(B)`; DURING that await a reconciliation
 * could remove B (registry falling back to A); when `select` resumed,
 * `registry.get(B)` returned null → it broadcast `null` and returned
 * `{activeId:B}` while the registry held A — three divergent values. Sharing
 * ONE `Serializer` instance between the coordinator and the reconciler makes
 * `select` and `reconcile`'s pass mutually exclusive: neither can mutate the
 * registry (or read a half-applied registry) while the other is mid-flight.
 */
export class Serializer {
  private tail: Promise<unknown> = Promise.resolve();
  chain<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn);
    // A failing link must not break the chain: the caller observes `run`'s
    // rejection, but `this.tail` continues on the swallowed value.
    this.tail = run.catch(() => undefined);
    return run;
  }
}

/**
 * Task 24 (P2#6) + Fix-5 (F5): serialize concurrent repo selections so the
 * broadcast always reflects the truly-active repo and persisted state never
 * disagrees with it.
 *
 * The original `selectRepo` handler did `setActive(repoId)` (sync), then
 * `await workspaceState.update(...)`, then `broadcastEvent`. The `await` yields
 * the event loop between `setActive` and the broadcast, so two rapid selects
 * (B then C) interleave: C's `setActive(C)` can run before B's broadcast fires,
 * emitting `activeRepoChanged{B}` while the registry's active repo is actually
 * C — a stale broadcast lands last and the webview ends on the wrong repo after
 * reload. Persisted state can likewise disagree with the last broadcast.
 *
 * Design — selections are chained on a (shared) {@link Serializer} promise-chain
 * mutex: each `select()` awaits the previous link before running, so selections
 * execute one-at-a-time IN SUBMISSION ORDER. Because a selection now runs
 * atomically (setActive -> persist -> broadcast) with no interleaving `await`
 * gap between setActive and broadcast, B fully completes before C starts; the
 * final broadcast is C and matches both the registry active and the persisted
 * value. `setActive` is the single source of truth: the broadcast payload and
 * the returned `activeId` are re-read from the registry (not the captured
 * `repoId`), so they can never disagree with `getActiveId()`.
 *
 * Because the SAME shared `Serializer` is also used by {@link FolderReconciler},
 * a `select` and a folder-reconciliation pass can NEVER interleave: whichever is
 * chained first runs fully (including its `await persist` / `await discover`)
 * before the other begins. This closes the F5 three-way-split window.
 *
 * Persist-before-broadcast is preserved: the persisted value is written before
 * any webview learns of the change, so a reload always observes the same active
 * repo the UI was showing.
 *
 * Dependencies (including the `Serializer`) are injected so this is unit-testable
 * without `activate`.
 */
export class RepoSelectionCoordinator {
  constructor(
    private readonly registry: RepoRegistry,
    private readonly persist: (
      activeId: string | null,
    ) => PromiseLike<void> | void,
    private readonly broadcastActive: (repo: RepoDescriptor | null) => void,
    private readonly serializer: Serializer,
  ) {}

  /**
   * Select `repoId` as active. Resolves once the selection has been fully
   * applied (persisted + broadcast). Rejects with {@link RepoSelectionError}
   * if the repo is no longer registered (e.g. removed by a concurrent folder
   * reconciliation while this select was queued) — in that case the
   * previously-active repo is left untouched and NO broadcast fires.
   */
  select(repoId: string): Promise<{ activeId: string; changed: boolean }> {
    // Chain onto the shared serializer. Each link runs to completion (incl. its
    // broadcast) before the next starts, and — critically — before/after any
    // reconciler pass chained on the SAME serializer, so there is no
    // interleaving window between select and reconcile.
    return this.serializer.chain(async () => {
      // Fix-10: transactional select. Capture the PREVIOUS active id BEFORE
      // setActive mutates the registry, so a persist failure can roll the
      // registry back to a state the webview is still showing (rather than
      // leaving the registry on the new repo while the persisted value and the
      // webview are both still on the old one — a three-way divergence with no
      // signal to the caller).
      const previous = this.registry.getActiveId();
      if (!this.registry.setActive(repoId)) {
        // The repo vanished while queued (folder reconciliation removed it).
        // Leave the current active as-is; signal failure to the caller.
        // (`previous` is unchanged by a failed setActive; nothing to roll back.)
        throw new RepoSelectionError(`Repository not available: ${repoId}`);
      }
      // Persist BEFORE broadcasting so a reload observes the same active repo
      // the (about-to-be) broadcast claims. Persisting can throw (e.g. a
      // workspaceState I/O error): in that case roll the registry back to
      // `previous` and rethrow the RAW persist error (do NOT wrap it in
      // RepoSelectionError — it is a persistence failure, not a missing-repo;
      // the `selectRepo` handler distinguishes the two and rethrows non-
      // RepoSelectionError errors as-is). No broadcast fires on this failure
      // path: the registry is back to `previous`, which the webview already
      // reflects, and the failed select's caller re-syncs via `load()` on error.
      try {
        await this.persist(this.registry.getActiveId());
      } catch (err) {
        // INVARIANT — `previous` is guaranteed non-null on this failure path:
        // `setActive(repoId)` just returned `true` ⇒ `repoId` is registered ⇒
        // the registry holds ≥1 repo ⇒ `activeId` was non-null before this
        // select. In `RepoRegistry`, `activeId` is `null` ONLY when the
        // registry is empty (set on first `add`, falls back to `order[0]` on
        // remove, never null-with-repos). The shared `Serializer` mutex
        // guarantees NO `reconcile` ran between the `previous` capture and this
        // rollback (select and reconcile share ONE serializer), so `previous`
        // cannot have been removed mid-flight. The `if (previous !== null)`
        // guard is defensive belt-and-suspenders (matches the existing
        // defensive-null-guard style in select).
        if (previous !== null) {
          this.registry.setActive(previous);
        }
        throw err;
      }
      // Re-read the active id AFTER the await. The shared mutex guarantees no
      // reconciler mutated the registry during the persist, so in practice this
      // equals the pre-await value — but reading here is the correct
      // belt-and-suspenders: the descriptor lookup, the broadcast payload, and
      // the returned `activeId` all reflect post-persist registry reality, so
      // they can never diverge from one another (the F5 invariant).
      const activeId = this.registry.getActiveId();
      // setActive(repoId) just returned true, so the registry holds repoId as
      // active and getActiveId() is necessarily non-null here. The guard both
      // narrows the type and documents the invariant defensively.
      if (activeId === null) {
        throw new RepoSelectionError(`Repository not available: ${repoId}`);
      }
      const runtime = this.registry.get(activeId);
      this.broadcastActive(runtime ? runtime.descriptor : null);
      return { activeId, changed: true };
    });
  }
}

/**
 * Fix-10: the post-reconcile "persist best-effort, then ALWAYS broadcast the
 * active repo" step. Persisting the active id is best-effort: if it throws (e.g.
 * a workspaceState I/O error) we log and STILL broadcast, so the UI stays
 * consistent with the in-memory registry. A stale persisted value is corrected
 * on the next reconcile / select / reload. Extracted (rather than an inline
 * closure in extension.ts) so the always-broadcast-on-persist-failure guarantee
 * is unit-testable — the host suite is unit-style with injected deps and has no
 * `activate()`-level harness, so an inline closure could never be exercised.
 *
 * This mirrors exactly what `RepoSelectionCoordinator.select` already does for
 * the descriptor lookup (`this.registry.get(activeId)` → `.descriptor`) and uses
 * the same `broadcast` callback shape as the coordinator's `broadcastActive`. It
 * is invoked from the reconciler's `onSettled` tail, which runs UNDER the shared
 * serializer mutex (inside runPass's finally), so a concurrently-queued `select`
 * cannot interleave between this persist and broadcast.
 */
export async function persistAndBroadcastActive(
  registry: RepoRegistry,
  persist: (activeId: string | null) => PromiseLike<void> | void,
  broadcast: (repo: RepoDescriptor | null) => void,
): Promise<void> {
  const activeId = registry.getActiveId();
  try {
    await persist(activeId);
  } catch (err) {
    // Best-effort persist: log and continue so the broadcast ALWAYS fires.
    // Without this catch a persist throw would skip the broadcast, leaving the
    // UI tracking a stale active repo while the in-memory registry moved on.
    console.error(
      "[porcelain] persist activeRepoId failed:",
      err instanceof Error ? (err.stack ?? err) : err,
    );
  }
  const activeRepo =
    activeId !== null ? (registry.get(activeId)?.descriptor ?? null) : null;
  broadcast(activeRepo);
}

/** Raised when a queued selection targets a repo that no longer exists. */
export class RepoSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepoSelectionError";
  }
}

/**
 * Task 24 (P2#9) + Fix-5/6 (F5/F6): serialize workspace-folder reconciliation so
 * a slow earlier `discoverRepos` cannot complete AFTER a later one and
 * resurrect a repo that the later change removed — and so a reconciliation pass
 * never interleaves with a {@link RepoSelectionCoordinator.select}.
 *
 * The original `onDidChangeWorkspaceFolders` handler ran
 * `await discoverRepos(foldersNow)` with no serialization. If two folder
 * changes arrived quickly, a slower first discovery could finish after a faster
 * second one and re-`add` a repo the second change had removed.
 *
 * Design — single in-flight discovery with "re-discover the latest if a change
 * arrived during flight", all chained on a (shared) {@link Serializer}:
 * - At most one `discoverRepos` runs at a time.
 * - If `reconcile(folders)` is called while a discovery is in flight, the new
 *   folders replace any previously-stashed pending folders (coalescing — only
 *   the LATEST folders matter, not how many changes arrived).
 * - The whole pass (discover + apply + the re-discover loop) runs under the
 *   shared serializer mutex, so it can NEVER interleave with a concurrent
 *   `select` (F5): whichever was chained first completes fully before the other
 *   starts.
 *
 * F6 runPass invariants (vs. the old "apply initial then drain pending" loop):
 * - A discovery result is applied ONLY if no newer change arrived DURING that
 *   discovery. If `pendingFolders` is non-null when discovery resolves, the
 *   just-finished result is STALE (it reflects folders that have since been
 *   superseded) and is discarded; the latest folders are re-discovered. This
 *   removes the old window where the initial (stale) result was applied +
 *   broadcast BEFORE the latest pass — which briefly re-registered + watched a
 *   repo that the latest change had removed.
 * - On `discover` OR `applyDiscovered` failure, a pending is NEVER dropped
 *   (Fix-9). `pendingFolders` only ever holds the LATEST change that arrived
 *   during the in-flight scan (it is overwritten on every `reconcile()` and
 *   consumed only on a successful discover), so if one is present when a scan
 *   fails the loop re-discovers it rather than clearing it; the pass bails ONLY
 *   when the scan failed AND no newer change arrived. (This reverses the Fix-5
 *   "clear-on-failure", which was an over-correction: the restructured loop has
 *   no separate stale-drain step, so there is no stale stash to protect against
 *   — clearing here dropped the newest update on the floor.)
 *
 * `discover` is injected so tests can introduce deterministic delays, and
 * `applyDiscovered` (the registry mutation) is injected so the same
 * serialization can wrap the activation bootstrap.
 */
export class FolderReconciler {
  // Folders stashed by a `reconcile()` that arrived while a pass was in flight.
  // `null` while no re-run is requested. See runPass for how this is consumed.
  private pendingFolders: Array<{ fsPath: string; name: string }> | null = null;
  private tail: Promise<void> = Promise.resolve();
  private running = false;

  constructor(
    private readonly discover: (
      folders: Array<{ fsPath: string; name: string }>,
    ) => Promise<DiscoveredRepo[]>,
    private readonly applyDiscovered: (repos: DiscoveredRepo[]) => void,
    private readonly serializer: Serializer,
    /**
     * Fix-5 revision (I1): optional hook invoked at the end of EVERY `runPass`
     * — including the failure path — UNDER the shared serializer (before
     * `running` resets and before the mutex releases). The host uses it to run
     * the post-reconcile persist + broadcast of the active repo INSIDE the same
     * critical section that `select` uses, so a concurrently-queued `select`
     * cannot interleave its own persist/broadcast between the reconciler's
     * registry mutation and this tail (which would otherwise let the stale
     * pre-select active id land as the LAST broadcast / persisted value). The
     * closure must NOT itself acquire the serializer (no `select`/`reconcile`
     * calls) — it only reads the registry + persists + broadcasts — so no
     * nested acquisition / deadlock.
     */
    private readonly onSettled?: () => Promise<void> | void,
  ) {}

  /**
   * Reconcile the registry against `folders`. Resolves once the registry
   * reflects these folders (and any later folders supplied via concurrent
   * `reconcile` calls). Safe to call concurrently; only one discovery runs at a
   * time and the final state always matches the latest folders.
   */
  reconcile(folders: Array<{ fsPath: string; name: string }>): Promise<void> {
    if (this.running) {
      // Coalesce: a discovery is in flight — stash the latest folders so a
      // single follow-up pass runs after it. N rapid changes collapse to one
      // extra pass with the newest folders. Return the current tail so the
      // caller awaits the in-flight pass (which will re-discover the latest
      // via runPass's pendingFolders check).
      this.pendingFolders = folders;
      return this.tail;
    }
    // NOT in flight. Note this branch also covers a `reconcile()` arriving
    // during the `onSettled` tail: `running` is reset BEFORE that tail awaits
    // (N1), so a mid-tail call sees `running===false` and starts a FRESH pass
    // here (chained on the serializer, queued behind the still-held mutex)
    // rather than coalescing onto the already-loop-exited pass. The tail is
    // therefore never an orphan window — late folders are always applied by a
    // follow-up pass.
    this.running = true;
    // Chain the whole pass on the SHARED serializer so it cannot interleave
    // with a concurrent `select` (F5), and so multiple reconciles stay ordered.
    // `running` is reset inside runPass's `finally`; the serializer's own
    // `.catch(()=>undefined)` keeps the shared chain alive even if runPass
    // itself ever rejected (it doesn't — it catches internally).
    this.tail = this.serializer.chain(() => this.runPass(folders));
    return this.tail;
  }

  private async runPass(
    initialFolders: Array<{ fsPath: string; name: string }>,
  ): Promise<void> {
    try {
      let current = initialFolders;
      // Re-discover loop. One uniform rule drives every iteration: `pendingFolders`
      // holds ONLY the latest workspace state that arrived DURING an in-flight
      // discover (it is overwritten on every `reconcile()` and consumed only by a
      // `continue` below — there is NO separate stale-drain step). So a non-null
      // pending always means "a newer change superseded what we just (tried to)
      // discover" and must be re-discovered; a null pending always means "no newer
      // change arrived" and the pass may settle (apply the result or bail on
      // failure). This holds on BOTH the success path (a newer change during a
      // successful discover → discard the stale result, re-discover) and the
      // failure paths (a newer change during a FAILING discover → re-discover it;
      // the newest state is never dropped just because the scan threw).
      //
      // Boundedness (re-derived): each iteration either (a) `break`s, or (b)
      // `continue`s only when `pendingFolders` was non-null, consuming exactly one
      // pending (set it to null before continuing). A pending is PRODUCED only by
      // an external `reconcile()` call that arrives while a discover is `await`ed
      // (the `running===true` coalescing branch), and each such call OVERWRITES
      // `pendingFolders` (coalescing to the latest). So the number of `continue`s
      // is bounded by the number of distinct concurrent `reconcile()` calls that
      // arrive during discoveries — finite in practice (workspace-folder changes
      // arrive in bursts). With no new input, the next discover completes with
      // `pendingFolders === null` → apply (success) or break (failure). There is
      // no structural infinite loop.
      while (true) {
        let discovered: DiscoveredRepo[];
        try {
          discovered = await this.discover(current);
        } catch (err) {
          // Fix-9 (reverses the Fix-5 "F6 clear-on-failure", which was an
          // over-correction): a discovery failure must NOT drop a pending that
          // arrived DURING this scan. `pendingFolders` is the LATEST workspace
          // state (overwritten on every `reconcile()` and consumed only on a
          // successful discover / a `continue`), so in the restructured loop
          // there is no separate stale-drain step and thus no stale stash to
          // protect against — the ONLY thing a non-null pending can hold here is
          // the newest change that arrived during this failing `await discover`.
          // Clearing it (the pre-Fix-9 behavior) was pure data loss of the newest
          // update. Instead: if a pending exists, re-discover it (latest wins);
          // only bail when the scan failed AND nothing newer arrived.
          console.error(
            "[porcelain] folder discovery failed:",
            err instanceof Error ? (err.stack ?? err) : err,
          );
          if (this.pendingFolders !== null) {
            current = this.pendingFolders;
            this.pendingFolders = null;
            continue;
          }
          break;
        }
        if (this.pendingFolders !== null) {
          // A newer change arrived DURING this discovery → the result we just
          // got is stale (it describes superseded folders). Discard it WITHOUT
          // applying and re-discover the latest. This is the F6 stale-result
          // fix: the old code applied the stale result first (briefly
          // re-registering/watching removed repos) before the follow-up.
          current = this.pendingFolders;
          this.pendingFolders = null;
          continue;
        }
        try {
          this.applyDiscovered(discovered);
        } catch (err) {
          // Fix-9: same rule as the discovery catch — never drop a pending on
          // failure; if one exists, re-discover the latest; only bail when the
          // apply failed AND nothing newer arrived. (The rule "a pending is never
          // dropped on failure" holds uniformly regardless of which step threw.)
          //
          // In practice `applyDiscovered` is an injected SYNCHRONOUS void, so no
          // `reconcile()` can interleave during it — `pendingFolders` is
          // necessarily null here (a concurrent `reconcile` would only be able to
          // set it during the `await discover` above), so this branch breaks in
          // the real host. The re-discover is belt-and-suspenders for
          // correctness/uniformity: IF apply ever became async and a newer change
          // did arrive during it, the latest folders would still be re-discovered
          // rather than dropped — the same guarantee the discovery catch gives.
          console.error(
            "[porcelain] folder apply failed:",
            err instanceof Error ? (err.stack ?? err) : err,
          );
          if (this.pendingFolders !== null) {
            current = this.pendingFolders;
            this.pendingFolders = null;
            continue;
          }
        }
        // No newer change arrived → we've applied the latest. Done.
        break;
      }
    } finally {
      // Fix-5 revision (I1): run the post-reconcile tail (persist + broadcast of
      // the active repo) UNDER the shared serializer, before the mutex releases.
      // runPass is invoked via `this.serializer.chain(() => this.runPass(...))`,
      // so its entire body — including this finally — holds the mutex. A
      // concurrently-queued `select` therefore cannot run between the registry
      // mutation above and this tail, eliminating the stale-last-broadcast /
      // stale-persist-overwrite window. The tail is awaited even on the failure
      // path so a pass that discovered+applied partially still re-broadcasts a
      // consistent active repo before yielding.
      //
      // Fix-5 revision 2 (N1): reset `running` BEFORE awaiting onSettled. This
      // flag is the reconciler's OWN coalescing gate, SEPARATE from the shared
      // serializer mutex (which is still held for this whole finally via the
      // chain above). I1's serialization guarantee is unaffected: onSettled
      // still runs under the mutex, and a `select` queued during the tail still
      // waits for the mutex. But a `reconcile()` arriving mid-tail now sees
      // `running===false`, so instead of stashing onto `pendingFolders` and
      // coalescing onto THIS (already-loop-exited) pass — which would never
      // re-enter the loop to apply the stash, orphaning the late folders — it
      // sets `running=true` and chains a FRESH `runPass` on the serializer,
      // which queues behind the current pass (still holding the mutex) and runs
      // after it, applying the late folders. Pre-fix (running reset after
      // onSettled) the tail was an orphan window for a mid-tail reconcile.
      this.running = false;
      try {
        await this.onSettled?.();
      } catch (err) {
        console.error(
          "[porcelain] folder reconcile onSettled failed:",
          err instanceof Error ? (err.stack ?? err) : err,
        );
      }
    }
  }
}
