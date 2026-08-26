# Porcelain Roadmap

This file records intentionally deferred Git dashboard work so temporary UI removals do not become forgotten features.

## Foundation stability

The 0.6.2 stability work establishes reusable boundaries for command execution, reference modeling, path parsing, index transactions, shelf mutations, repository-bound requests, commit state, diff actions, and Push state. Future maintenance should continue moving behavior behind these boundaries until each responsibility can be tested and evolved independently.

Branch-tree presentation decomposition is complete. The next decomposition passes should prioritize graph layout and rendering, comparison sessions, and shared file-tree/detail presentation. Each pass should preserve the existing public behavior and add focused regression coverage before moving to the next responsibility.

## Branch dashboard

### Show My Branches

Reintroduce this only after its semantics can match JetBrains closely. A branch qualifies when the commits exclusive to that branch are authored by the current Git user; identity matching must respect configured name/email and `.mailmap`. The implementation needs graph-aware ancestry queries, a cached per-repository author index, multi-repo invalidation, and acceptable performance on large histories. Until then, no placeholder button should be shown.

### Extended commit actions

After 0.5.2 introduces the shared commit action registry, add the remaining JetBrains-style actions through that single registry so the ordinary Git Log and branch comparison views gain them together. Deferred actions include Create Patch, Compare with Local, Show Repository at Revision, Undo/Edit/Fixup/Squash and interactive rebase, Push commits up to the selection, move a branch to the selected commit, and child/parent commit navigation.

Do not add view-specific copies of these menus. Each action must declare repository-bound execution context, visibility and enabled-state rules, and the refresh scope required after mutation.

### Batch and strategy-aware Update

Consider multi-selection update and user-selectable merge/rebase strategies after single-branch upstream-safe Update has proven stable. Batch execution must report per-branch outcomes and must never update a branch checked out in another worktree.

## Repository discovery

The first multi-repo release intentionally discovers Git repositories only from multi-root workspace folders. A later milestone may discover multiple repositories nested inside one workspace folder, followed by more complex nested repository layouts. Discovery must preserve stable repository identities, deterministic de-duplication, explicit user control, and worktree-safe Git directory watching.
