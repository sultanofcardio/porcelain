<a name="readme-top"></a>

<div align="center">

<img src="./images/assets/logo-128.png" width="88" alt="IDEA Git icon" />

<h1>IDEA Git</h1>

**Switch editors, not your Git workflow.**

A JetBrains-style Git workflow for developers moving to **VS Code** or **Cursor**.

</div>

---

IDEA Git keeps the Git habits you already know from JetBrains IDEs: a visual branch tree, compact commit graph, dedicated Commit tool window, Shelf and Stash, branch comparison, history rewriting, merge tools, and conflict resolution—without forcing you to relearn your workflow after changing editors.

> IDEA Git is an independent open-source project and is not affiliated with or endorsed by JetBrains, Microsoft, GitHub, or Cursor.

> This project is a fork of [VitalHex/branchshift](https://github.com/VitalHex/branchshift). Upstream repositories and their contributors remain credited under [Project lineage](#project-lineage).

## Familiar workflow, new editor

| JetBrains workflow | IDEA Git in VS Code |
| --- | --- |
| Commit tool window | Dedicated Commit activity with partial commits, Amend, Commit & Push, Shelf, and Stash |
| Git Log | Branch tree, compact graph, refs, filters, changed files, and commit details |
| Compare with Current | Independent bidirectional comparison tabs with per-side filters |
| Branch actions | Checkout, Update, Push, Merge, Rebase, Rename, Delete, Favorite, and more |
| Merge conflicts | Conflict dashboard and syntax-highlighted 3-way merge editor |
| Multi-repository project | One active repository shared by Commit and Git Log across multi-root workspaces |

## Highlights

### Git Log and branch management

- Local branches, remotes, and tags in a searchable tree
- Favorites, ahead/behind indicators, and upstream-aware Update
- Color-coded commit graph with resizable and hideable columns
- Branch, author, date, and file-history filters
- Shared commit context actions across normal and comparison logs

### Commit, Shelf, and Stash

- Select individual files for partial commits
- Commit, Commit and Push, and Amend workflows
- Directory grouping, multi-selection, rollback, and diff navigation
- JetBrains-compatible Shelf data stored under `.idea/shelf/`
- Native Git stash management

### Branch comparison

Compare a local branch, remote branch, or tag with the current branch. IDEA Git opens a dedicated editor tab with commits unique to each side, independent filters, changed files, and commit details.

### Compare Versions

Select two commits in the Git Log, right-click, and choose **Compare Versions** to see everything that differs between them. The result is the net difference between the two snapshots, always read oldest to newest whichever order you selected them in, so work that was added and later reverted between them correctly shows as no change.

### Floating diff windows

Diffs open in their own window instead of competing with your code for editor space. Compare Versions opens a Changes window listing the files that differ; double-clicking a file opens the diff in a second window that every later diff reuses, so you never accumulate diff tabs. Pin a diff to keep it out of that cycle.

Set `ideaGit.diff.openIn` to `editorTab` if you would rather keep diffs in the main window. On editor builds that cannot open a separate window, IDEA Git falls back to editor tabs and says so once.

### Context menus where you expect them

Right-click branches, commits, and changed files to access checkout, cherry-pick, reset, revert, merge, rebase, diff, history, source navigation, and other repository-bound actions.

### Conflicts and 3-way merge

- Dedicated conflict list with Accept Yours, Accept Theirs, and Merge actions
- Three-column Theirs / Result / Yours editor
- Per-conflict actions and syntax highlighting
- Integration with the built-in VS Code Source Control view

### Multi-root workspace support

IDEA Git discovers one Git repository per workspace folder and exposes a shared active-repository selector in both Commit and Git Log. Nested repositories inside a single workspace folder are intentionally deferred to a later release.

## Installation

> IDEA Git uses the extension ID `sultanofcardio.idea-git` and the `ideaGit.*` command IDs. It is a separate extension from BranchShift, so keybindings bound to `branchshift.*` commands need repointing.

### VS Code Marketplace

Search for **IDEA Git** or **Git** in the Extensions view.

### VSIX

1. Download the latest `.vsix` from [Releases](https://github.com/sultanofcardio/idea-git/releases).
2. Run **Extensions: Install from VSIX...** from the Command Palette.

## Requirements

- VS Code 1.85.0 or later
- Git available on `PATH`

## Local development

```bash
git clone https://github.com/sultanofcardio/idea-git.git
cd idea-git
pnpm install
cd webview && pnpm install && cd ..
```

Press **F5** to launch the Extension Development Host.

```bash
pnpm run watch          # Development watch mode
pnpm run build          # Extension host + webview production build
pnpm run vsce:package   # Build a VSIX package
```

## Project lineage

IDEA Git is a fork of [VitalHex/branchshift](https://github.com/VitalHex/branchshift), which itself began as a fork of [zhyc9de/jet-git](https://github.com/zhyc9de/jet-git). Both upstream projects are MIT licensed and retain credit for the Git graph, merge, and JetBrains-style Commit/Shelf/Stash foundations this fork builds on.

Eighteen icons in the Commit tool window are used verbatim from [IntelliJ Platform Icons](https://intellij-icons.jetbrains.design/), copyright JetBrains s.r.o. and contributors, under the Apache 2.0 license. They are unmodified. The IDEA Git application icon is an original project asset.

## License

IDEA Git is available under the [MIT License](./LICENSE), which preserves the copyright notices of both upstream projects.

Third-party material in the packaged extension, including the JetBrains icons above, the Visual Studio Code Codicons, and every bundled npm dependency, is listed with its required notices in `THIRD-PARTY-NOTICES.md`, which ships inside the extension package. Neither the MIT nor the Apache 2.0 license grants trademark rights; IDEA Git is not affiliated with or endorsed by JetBrains, Microsoft, GitHub, or Cursor.
