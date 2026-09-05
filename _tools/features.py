# Feature inventory for the porcelain roadmap page.
# area | stage | feature
# stage: done = supported, v1 = before 1.0, after = after 1.0, never = not planned

AREAS = {
    "log": ("Log & graph", "#3a8ee6"),
    "branches": ("Branches, tags & remotes", "#59a869"),
    "rewrite": ("History rewriting", "#c75450"),
    "commit": ("Commit, shelf & stash", "#e5c07b"),
    "sync": ("Push, update & fetch", "#2aa198"),
    "blame": ("Blame & file history", "#d19a66"),
    "diff": ("Diff & merge", "#56b6c2"),
    "platform": ("Platform", "#b07cd8"),
}

TIERS = [
    ("Essential", "felt every session", """
log|done|Commit graph with colour-coded lanes and merge bubbles
log|done|Branch tree: local, remote and tags, searchable
commit|done|Commit tool window with checkbox partial commits
log|done|Changed files and details for the selected commit
diff|done|Porcelain diff viewer: paired gutter, curved connectors, per-side revision headers
branches|done|Checkout, and smart checkout when local changes block the switch
sync|done|Push panel with target editing and a commit preview
sync|done|Update Project: fetch, then merge or rebase, with autostash
log|done|Text search with match-case and regex toggles
log|done|Branch filter, multi-select
branches|done|New branch from HEAD or from a commit
commit|done|Amend, and Commit and Push
diff|done|Side-by-side and unified layouts
diff|done|Editable working-tree side with ⌘S to save
commit|done|Per-hunk and line-range inclusion from the diff gutter
log|done|Commit context actions: checkout, reset, revert, cherry-pick, drop
diff|done|Floating diff windows, one reused for every file, pin to keep
branches|done|Ahead/behind and incoming/outgoing counts per branch
diff|done|3-way merge editor with gutter verbs and an editable result
diff|done|Conflicts window: Accept Yours, Accept Theirs, Merge
commit|done|Merge Conflicts group nested in Changes, with a continue/abort banner
log|done|Author, date and paths filters
log|done|Go to hash, branch or tag (⌘G)
log|done|Collapse linear branches, per fragment and all at once
log|done|Resizable, hideable columns
branches|done|Favourites
branches|done|Update (fast-forward) with upstream awareness
branches|done|Merge into current, Rebase current onto
blame|done|Annotate with Git Blame: author and date gutter with a hover card
blame|done|Show File History from the editor or the explorer
sync|done|Force push with --force-with-lease
sync|done|Protected branches refuse force push
commit|done|Rollback, with the option to delete added files
commit|done|Unversioned files group
commit|done|Directory grouping and multi-selection
diff|done|Ignore whitespace: four policies
diff|done|Find in a diff (⌘F)
diff|done|Next and Previous file (⌘F7 / ⌘⇧F7)
platform|done|Multi-root workspaces with a shared active repository
diff|done|Syntax highlighting in diffs and merges, six grammars
diff|v1|Full grammar coverage in diffs, lazy-loaded (D2)
sync|v1|Auto-fetch on an interval, with a last-fetch tooltip
commit|v1|Commit message inspections: subject length, blank line, body wrap, with a quick fix
log|done|"In N branches" in the details pane
rewrite|done|Rebase conflict banner: continue, abort, skip
log|done|Compare with Current: a branch comparison tab with per-side filters
log|done|Compare Versions between two commits
commit|done|Commit message history dropdown
commit|done|Message seeded from commit.template or MERGE_MSG
diff|done|Native diff editor fallback through porcelain.diff.viewer
sync|done|Fetch, with porcelain.fetch.tags
platform|done|Git Operations popup (⌘⌥G)
commit|v1|Commit checks: CRLF, large files, detached HEAD, unset user.name or email
branches|v1|Delete notification with Restore
log|v1|Highlight not-cherry-picked commits
diff|v1|Remember diff settings per place: Changes, Log, Merge
blame|v1|Rename following in file history (--follow)
"""),
    ("Important", "weekly", """
rewrite|done|Interactive rebase editor: pick, reword, edit, squash, fixup, drop, reorder
rewrite|done|Interactively Rebase from Here
rewrite|done|Edit Commit Message on any commit
rewrite|done|Squash N commits under a combined message
rewrite|done|Fixup… the working tree into a chosen commit
rewrite|done|Undo Commit
rewrite|done|Rebase options: --onto, interactive, autosquash, update-refs, rebase-merges
rewrite|done|Merge options: --no-ff, --ff-only, --squash, --no-commit, custom message
rewrite|done|Pull options: rebase, ff-only, no-ff, squash, no-commit
rewrite|done|Multi-commit cherry-pick, oldest first, in one invocation
rewrite|done|View Git Commands: the exact rebase todo before it runs
rewrite|done|Guard rails: verbs disabled while an operation is in progress, with the reason
commit|done|Shelf, IntelliJ-compatible, under .idea/shelf
commit|done|Unshelve: pop, apply, per file, delete; import a patch as a shelf
commit|done|Stash with a message, keep index, include untracked
commit|done|Stash to branch
commit|done|Sign-off, author override, skip hooks
commit|done|Add to .gitignore
branches|done|Recent branches from the reflog
branches|done|Reset to upstream on the checked-out branch
branches|done|Delete safety: force-delete names the commits it would discard
branches|done|Tags: create, checkout, push, delete, delete on remote
branches|done|Annotated tags when a message is given
branches|done|Manage Remotes: add, rename, re-point, remove
branches|done|Clean Up Branches, merged pre-selected, prefix filter, counted force
branches|done|Branch grouping by prefix, or a flat list
branches|done|Rename branch
branches|done|Delete branch on remote
sync|done|Set upstream while pushing, push tags, skip pre-push hooks
sync|done|Rejected push chooser: merge or rebase
sync|done|Arrivals list after Update Project
log|done|Graph modes: Sort Topologically, First Parent Only, No Merge Commits
log|done|Long-edge stubs with jump, and Show Long Edges
log|done|Highlighters: My Commits, Dim Merge Commits, Fade Other Branches
log|done|Presentation: Compact References, Tag Names, Commit Timestamp
log|done|Date presets and a custom After/Before range
log|done|Whole-history author list with "(me)" pinned
log|done|Copy Revision Number, Show in Git Log
blame|done|Blame Options: colour by age or author, name style, ignore whitespace, follow moves
blame|done|Uncommitted lines marked as such
blame|done|History Up to Here, Open Repository Version, Show Diff from history
blame|done|Search Commits by message or hash
diff|done|Highlight granularity: line, word, character, off
diff|done|Collapse unchanged fragments; synchronised scrolling toggle
diff|done|Change stripe with click to jump; live difference count
diff|done|Diff titles carry position and both revisions
diff|done|Binary and image diffs side by side; large-file placeholder with Show anyway
diff|done|Changed-on-disk banner: reload or keep
diff|done|Revert or include a hunk from the working-tree diff gutter
diff|done|Apply non-conflicting changes
diff|done|Resolve automatically for non-overlapping edits
diff|done|Accept, accept both, revert to base, ignore, per conflict
diff|done|One undo/redo timeline across typed edits and gutter verbs
diff|done|Conflict stepping, per-pane find, collapse unchanged in the merge
diff|done|Open in Porcelain Merge Editor from the VS Code Source Control view
platform|done|Worktrees: list, open, create on a new branch, remove, prune
platform|done|Workspace trust: disabled until the folder is trusted
platform|done|Edit Source from any diff
commit|v1|Author completion from history
commit|v1|Shelf: rename, recently deleted with restore
branches|v1|Set or unset the tracked branch from the tree
branches|v1|Show diff with working tree from any ref
sync|v1|Fix tracked branch: pick an upstream when Update has none
sync|v1|Remember the rejected-push choice
sync|v1|Add a remote inline when the push panel finds none
rewrite|v1|Squash Into… (squash! alongside fixup!)
rewrite|v1|"All conflicts resolved, continue?" prompt
rewrite|v1|Warn before rewriting commits already on a protected branch
blame|v1|Annotate previous revision from a blame line
blame|v1|Click a blame line to select the commit in the log
blame|v1|History for a selection (log -L)
diff|v1|Compare with base from the merge editor: Left↔Base, Right↔Base, Left↔Right
diff|v1|Conflict-type labels in the Conflicts window: both modified, deleted by them…
platform|v1|Nested repositories inside one workspace folder
platform|v1|GPG signing: configure the key and show signing status
platform|v1|Create patch from selected commits or changes
log|v1|Branch filter patterns and a..b ranges
platform|v1|Confirmation settings: force push, branch delete, discard
"""),
    ("Useful", "monthly", """
log|after|Diff preview pane inside the log
rewrite|after|Drop or extract changes from a commit (split)
rewrite|after|Rebase --root and --keep-empty
rewrite|after|Cherry-pick and revert without committing
rewrite|after|Terminal-initiated rebases open the editor
commit|after|Co-authored-by trailer completion
commit|after|Changed-file-name completion in the message
commit|after|Reinstate index on unstash
commit|after|Show the diff of a stash before applying it
commit|after|Move changes between shelves
commit|after|Diff preview pane inside the Commit view
branches|after|Remote delete offers to remove tracking locals
branches|after|Update a branch not checked out; worktree-aware fast-forward
sync|after|Update Info tab: received commits, filterable
sync|after|Force-pushed upstream recovery
sync|after|Push all up to here
blame|after|Show repository at a revision (tree browser)
blame|after|Annotate at a chosen revision
blame|after|Blame column aspects: revision, date, author separately
diff|after|Aligned changes mode with filler lines
diff|after|Compare with clipboard
diff|after|Press again to step to the next file
diff|after|Merge finish escape hatch: save with unresolved regions
log|after|Structure filter: pick paths in a tree dialog
log|after|Show changes from a chosen parent of a merge
platform|after|Signature column in the log: verified, bad, expired
platform|after|Apply patch with base mapping; reverse patch
platform|after|Unshallow notice on shallow clones
platform|after|Settings UI for every warning and confirmation
platform|after|Multi-root sync mode: branch operations across every root
"""),
    ("Outside parity", "IntelliJ lacks it, or VS Code already has it", """
platform|never|Bisect, reflog browser, submodules, notes
commit|never|Changelists
commit|never|Staging-area mode (D1)
commit|never|Before-commit code checks: reformat, optimize imports, analyze, run tests
commit|never|Local History
diff|never|External diff and merge tools
diff|never|Directory diff and combined all-in-one diff
platform|never|Clone and init dialogs
platform|never|GitHub, GitLab and Space integration
platform|never|Terminal completion, code-vision authorship, log indexing
log|never|Committed-changes and Incoming tabs
"""),
]

# Feature names (exact) that get the green "next" node.
NEXT = {
    "Full grammar coverage in diffs, lazy-loaded (D2)",
    "Auto-fetch on an interval, with a last-fetch tooltip",
    "Commit message inspections: subject length, blank line, body wrap, with a quick fix",
    "Rename following in file history (--follow)",
}

DEMO = "Commit message inspections: subject length, blank line, body wrap, with a quick fix"


def load():
    rows = []
    n = 0
    for ti, (tier, sub, block) in enumerate(TIERS, start=1):
        for line in block.strip().splitlines():
            area, stage, feat = line.split("|", 2)
            n += 1
            rows.append({"n": n, "tier": ti, "tier_name": tier, "tier_sub": sub,
                         "area": area, "stage": stage, "feat": feat.strip()})
    return rows
