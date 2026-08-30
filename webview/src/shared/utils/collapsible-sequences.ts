import type { CollapsibleSequence, Commit, LaneInfo } from "../types/git";

export interface SequenceResult {
  sequences: CollapsibleSequence[];
  hashToSequenceId: Record<string, string>;
  sequencesById: Record<string, CollapsibleSequence>;
}

/**
 * Detect linear runs of ref-less commits that stay in one lane, the units the
 * graph collapses into dotted edges. Shared by the graph's per-fragment
 * click-to-collapse and the toolbar's collapse-all action. O(n).
 */
export function computeCollapsibleSequences(
  commits: Commit[],
  graphLayout: Record<string, LaneInfo>,
): SequenceResult {
  const empty: SequenceResult = {
    sequences: [],
    hashToSequenceId: {},
    sequencesById: {},
  };
  if (commits.length === 0) return empty;

  const commitByHash: Record<string, Commit> = {};
  for (const c of commits) {
    commitByHash[c.hash] = c;
  }

  // Build childCount and single-child map from currently loaded commits.
  const childCount: Record<string, number> = {};
  const onlyChildByParent: Record<string, string | undefined> = {};
  for (const c of commits) {
    for (const p of c.parents) {
      if (!commitByHash[p]) continue;
      childCount[p] = (childCount[p] || 0) + 1;
      if (!onlyChildByParent[p]) {
        onlyChildByParent[p] = c.hash;
      } else {
        onlyChildByParent[p] = undefined;
      }
    }
  }

  // A commit can be an intermediate node only if it is linear and remains
  // in the same visible lane with its parent/child.
  const isIntermediate = (c: Commit): boolean => {
    if (c.parents.length !== 1) return false;
    if ((childCount[c.hash] ?? 0) !== 1) return false;
    if (c.refs.length > 0) return false;

    const parent = commitByHash[c.parents[0]];
    const childHash = onlyChildByParent[c.hash];
    const child = childHash ? commitByHash[childHash] : undefined;
    if (!parent || !child) return false;

    const lane = graphLayout[c.hash];
    const parentLane = graphLayout[parent.hash];
    const childLane = graphLayout[child.hash];
    if (!lane || !parentLane || !childLane) return false;

    if (lane.column !== parentLane.column || lane.column !== childLane.column) {
      return false;
    }
    if (lane.color !== parentLane.color || lane.color !== childLane.color) {
      return false;
    }
    return true;
  };

  // Walk topology-connected linear chains.
  const sequences: CollapsibleSequence[] = [];
  const hashToSequenceId: Record<string, string> = {};
  const sequencesById: Record<string, CollapsibleSequence> = {};
  const visited = new Set<string>();

  for (const seed of commits) {
    if (visited.has(seed.hash) || !isIntermediate(seed)) continue;

    // Move upward to the topmost intermediate in this chain.
    let top = seed;
    while (true) {
      const childHash = onlyChildByParent[top.hash];
      const child = childHash ? commitByHash[childHash] : undefined;
      if (!child || !isIntermediate(child)) break;
      if (child.parents[0] !== top.hash) break;
      top = child;
    }

    // Walk down from top through intermediate parents.
    const intermediates: string[] = [];
    let current = top;
    while (isIntermediate(current) && !visited.has(current.hash)) {
      intermediates.push(current.hash);
      visited.add(current.hash);
      const parentHash = current.parents[0];
      const parent = commitByHash[parentHash];
      if (!parent || !isIntermediate(parent)) break;
      if (onlyChildByParent[parent.hash] !== current.hash) break;
      current = parent;
    }

    if (intermediates.length < 2) continue;

    const headHash = onlyChildByParent[top.hash];
    const tailHash = current.parents[0];
    if (!headHash || !tailHash) continue;
    if (!commitByHash[headHash] || !commitByHash[tailHash]) continue;

    const lane = graphLayout[top.hash];
    if (!lane) continue;

    const id = `seq-${headHash}-${tailHash}`;
    const seq: CollapsibleSequence = {
      id,
      headHash,
      tailHash,
      intermediates,
      column: lane.column,
      color: lane.color,
    };
    sequences.push(seq);
    sequencesById[id] = seq;
    for (const h of intermediates) {
      hashToSequenceId[h] = id;
    }
  }

  return { sequences, hashToSequenceId, sequencesById };
}
