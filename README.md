<a name="readme-top"></a>

<div align="center">

<img src="./images/assets/logo-128.png" width="88" alt="Porcelain icon" />

<h1>Porcelain</h1>

**Switch editors, not your Git workflow.**

A JetBrains-style Git workflow for developers moving to **VS Code** or **Cursor**.

[![Open in VS Code](https://img.shields.io/static/v1?label=&message=Open%20in%20VS%20Code&color=007acc&labelColor=2c2c32)](https://vscode.dev/redirect?url=vscode%3Aextension%2Fsultanofcardio.porcelain)
[![Marketplace](https://vsmarketplacebadges.dev/version/sultanofcardio.porcelain.svg?label=marketplace&color=3574f0)](https://marketplace.visualstudio.com/items?itemName=sultanofcardio.porcelain)
[![Installs](https://vsmarketplacebadges.dev/installs-short/sultanofcardio.porcelain.svg?color=3574f0)](https://marketplace.visualstudio.com/items?itemName=sultanofcardio.porcelain)
![Status](https://img.shields.io/badge/status-preview%20%C2%B7%20pre--1.0-e5a50a)
![License](https://img.shields.io/badge/license-MIT-blue)

</div>

---

Porcelain keeps the Git habits you already know from JetBrains IDEs: a visual branch tree, compact commit graph, dedicated Commit tool window, Shelf and Stash, branch comparison, history rewriting, merge tools and conflict resolution, without forcing you to relearn your workflow after changing editors.

<div align="center">
  <img src="./images/screenshots/git-log-panel.png" width="920" alt="The Porcelain panel across the bottom of VS Code. On the left a branch tree lists local branches, remotes and tags. In the middle a colour-coded commit graph shows merge bubbles and parallel lanes, with author, message, relative date and hash columns. On the right, the changed files and details of the selected commit." />
  <br />
  <sub>Branch tree, commit graph, changed files and commit details, in one panel.</sub>
</div>

> **Preview.** Porcelain is pre-1.0: everything described below is shipped, but rough edges remain, and settings or command IDs may still change in a minor version before 1.0. Found something off? [Open an issue](https://github.com/sultanofcardio/porcelain/issues).

> **Docs.** The full documentation is at [sultanofcardio.github.io/porcelain](https://sultanofcardio.github.io/porcelain/): one page per surface, the known limits, the changelog and the roadmap with where 1.0 gets cut.

> Porcelain is an independent open-source project and is not affiliated with or endorsed by JetBrains, Microsoft, GitHub, or Cursor.

> This project is a fork of [VitalHex/branchshift](https://github.com/VitalHex/branchshift). Upstream repositories and their contributors remain credited under [Project lineage](#project-lineage).

## Familiar workflow, new editor

| JetBrains workflow | Porcelain in VS Code |
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
- Color-coded commit graph with resizable and hideable columns, collapsible linear branches, and long-edge stubs
- Text search with match-case and regex toggles; multi-branch, author, date, paths, and file-history filters
- Go to hash / branch / tag, graph modes (topological order, first parent, no merges), highlighters, and presentation toggles
- Shared commit context actions across normal and comparison logs

### Commit, Shelf, and Stash

- Select individual files for partial commits
- Commit, Commit and Push, and Amend workflows
- Directory grouping, multi-selection, rollback, and diff navigation
- JetBrains-compatible Shelf data stored under `.idea/shelf/`
- Native Git stash management

![The Commit tool window. A Changes group lists five files with checkboxes, some ticked and some not, each marked with its status letter. Unversioned files sit in their own group below. A commit message is typed underneath, above Commit and Commit and Push buttons.](./images/screenshots/commit-tool-window.png)

*Tick the files you want. Staging never enters into it: the checkboxes are the commit, and the file is committed as it is on disk.*

### Branch comparison

Compare a local branch, remote branch, or tag with the current branch. Porcelain opens a dedicated editor tab with commits unique to each side, independent filters, changed files, and commit details.

### Compare Versions

Select two commits in the Git Log, right-click, and choose **Compare Versions** to see everything that differs between them. The result is the net difference between the two snapshots, always read oldest to newest whichever order you selected them in, so work that was added and later reverted between them correctly shows as no change.

![The commit list with two commits highlighted and the context menu open. Compare Versions is highlighted. Copy Revision Numbers, Cherry-Pick 2 Commits and Squash 2 Commits stay available, while the single-commit actions, Checkout Revision, the three Reset variants, Revert, Drop, Interactively Rebase, Edit Commit Message, Fixup and Undo Commit, are greyed out. New Branch and New Tag sit at the bottom.](./images/screenshots/compare-versions.png)

*With two commits selected the single-commit actions grey out, because the row you happened to right-click is not an obvious target for a reset or a revert.*

### Floating diff windows

Diffs open in their own window instead of competing with your code for editor space. Compare Versions opens a Changes window listing the files that differ; double-clicking a file opens the diff in a second window that every later diff reuses, so you never accumulate diff tabs. Pin a diff to keep it out of that cycle.

![Two compact floating windows. The smaller one lists the three files that differ between two commits, grouped by directory, with pool.ts selected. The larger one shows pool.ts in Porcelain's diff viewer: each side headed by its own revision, paired line numbers down the centre gutter, an added block highlighted in green on the right, and a curved connector joining it to the matching point on the left.](./images/screenshots/floating-diff-windows-transparent.png)

*Both windows open compact, stripped back to their content. The file list stays put while the diff window is reused for every file you open.*

Set `porcelain.diff.openIn` to `editorTab` if you would rather keep everything in the main window. On editor builds that cannot open a separate window, Porcelain falls back to editor tabs and says so once.

### Context menus where you expect them

Right-click branches, commits, and changed files to access checkout, cherry-pick, reset, revert, merge, rebase, diff, history, source navigation, and other repository-bound actions.

### Conflicts and 3-way merge

A conflicted merge is three steps, and Porcelain gives each one a surface.

**1. Notice.** Unmerged files appear as a Merge Conflicts group nested inside Changes, the way IntelliJ shows them, rather than a separate list that repeats the same file twice. A banner names the branch being merged and offers to continue or abort.

![The Commit tool window during a merge. A banner reads Merging fix/pool-leak with continue and abort buttons. Below it, a Changes group contains a nested Merge Conflicts group with a Resolve link, holding a single conflicted file, pool.ts.](./images/screenshots/merge-conflicts-commit-window.png)

**2. Triage.** **Resolve** opens the conflict list in its own compact window, showing how each side touched every file. Take one side wholesale, or open the file to work through it.

![A compact floating window titled Conflicts. It lists one conflicted file, pool.ts under src/db, with columns showing that both Yours and Theirs modified it, and buttons for Accept Yours, Accept Theirs and Merge.](./images/screenshots/merge-conflicts-floating-window.png)

**3. Resolve.** Double-clicking a conflicted file opens the three-way editor in its own window: your side on the left, the working result in the middle, Theirs on the right, with each conflict individually acceptable.

![The three-way merge editor in a compact window. Three syntax-highlighted columns: main on the left, marked Yours; the editable Result in the middle; fix/pool-leak on the right, marked Theirs. The conflicting region is highlighted in red on both outer columns, with accept and ignore controls in the gutters beside it, and the toolbar reads 1 conflict, 0 resolved.](./images/screenshots/merge-conflicts-3-way-resolution.png)

Each conflict can be taken individually rather than the whole file at once, the result column can be edited directly while you work, and everything stays syntax-highlighted throughout. Porcelain also integrates with the built-in VS Code Source Control view, so conflicts raised elsewhere land here too.

### Multi-root workspace support

Porcelain discovers one Git repository per workspace folder and exposes a shared active-repository selector in both Commit and Git Log. Nested repositories inside a single workspace folder are intentionally deferred to a later release.

## Installation

[![Open in VS Code](https://img.shields.io/static/v1?label=&message=Open%20Porcelain%20in%20VS%20Code&color=007acc&labelColor=2c2c32&style=for-the-badge)](https://vscode.dev/redirect?url=vscode%3Aextension%2Fsultanofcardio.porcelain)

The button opens Porcelain's page inside VS Code; press **Install** there. You can also install from the [Marketplace listing](https://marketplace.visualstudio.com/items?itemName=sultanofcardio.porcelain) or from a terminal:

```sh
code --install-extension sultanofcardio.porcelain
```

> Porcelain uses the extension ID `sultanofcardio.porcelain` and the `porcelain.*` command IDs. It is a separate extension from BranchShift, so keybindings bound to `branchshift.*` commands need repointing.

### VSIX

1. Download the latest `.vsix` from [Releases](https://github.com/sultanofcardio/porcelain/releases).
2. Run **Extensions: Install from VSIX...** from the Command Palette.

Works in VS Code and Cursor alike, and needs no account.

### Open VSX

Once published, search for **Porcelain** in the Extensions view. This is the
registry Cursor reads, so it is the route that gets you search-and-install
there rather than a manual download.

## Requirements

- VS Code 1.86.0 or later, for the detached windows the diff surfaces use
- Git available on `PATH`

## Local development

```bash
git clone https://github.com/sultanofcardio/porcelain.git
cd porcelain
pnpm install
cd webview && pnpm install && cd ..
```

Press **F5** to launch the Extension Development Host. The launch configurations
all pass `--disable-extensions`, so nothing else you have installed can appear
alongside Porcelain; there is a third one that adds `--profile-temp` for a
throwaway profile, which is what the screenshots above were taken with.

```bash
pnpm run watch          # Rebuild host and webview on change
pnpm run build          # Production build of both
pnpm run test           # Extension host suite, in a real host
pnpm run test:web       # Webview suite
pnpm run verify         # All of the above. The release gate.
```

Everything here is also a run configuration. Open the **Run and Debug** view
(<kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd>), pick one from the dropdown
at the top, and press the green play button or <kbd>F5</kbd>:

| Group | Configurations |
| --- | --- |
| Run | Run Porcelain, and the no-rebuild and clean-profile variants |
| Check | Build, Verify, Test: extension host, Test: webview |
| Release | Package VSIX, Publish to Open VSX, Open VSX: verify token |

The same commands are VS Code tasks as well, which is what
<kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> runs and where the release
pipeline is expressed as task dependencies. Reach them from **Terminal → Run
Task…**, or **Tasks: Run Task** in the Command Palette.

### Releasing

CI runs on every push to `main` and on every pull request: build, both test
suites, and a `vsce package` dry run that checks the manifest and
`.vscodeignore`. A release is a tag:

```bash
npm version minor -m "release: %s"   # commits and tags vX.Y.Z
git push --follow-tags origin main
```

`npm version` also turns the Unreleased section of CHANGELOG.md into the new
version's section, dated today, and carries that into the release commit.

The `v*` tag triggers the release workflow, which checks that the tag matches
`package.json`, runs the same build and tests, packages
`porcelain-<version>.vsix`, publishes it to the VS Code Marketplace, and
creates the GitHub release with the VSIX attached and that version's
CHANGELOG section as the notes. It needs a `VSCE_PAT` repository secret: an
Azure DevOps personal access token with the Marketplace (Manage) scope for the
`sultanofcardio` publisher. Azure DevOps retires personal access tokens on
1 December 2026, so before then the secret has to move to a Microsoft Entra ID
credential built for CI pipelines.

An existing tag can also be released by hand from the Actions tab, or with:

```bash
gh workflow run release.yml --ref main -f tag=vX.Y.Z
```

Versions must strictly increase and can never be reused, so a bad publish is
fixed by bumping rather than replacing.

#### Open VSX

Cursor reads Open VSX, and publishing there is still a local step. `Verify` has to pass before the release task will package
anything, and packaging happens before publishing:

```bash
pnpm run vsce:package   # Build porcelain-<version>.vsix
pnpm run ovsx:publish   # Publish that VSIX to Open VSX
```

Open VSX reads its token from `OVSX_PAT` in the environment, so it never
reaches a command line or a config file. Before the first publish, claim the
namespace once with `pnpm run ovsx:namespace`, and check the token works
without publishing anything using `pnpm run ovsx:verify`.

## Project lineage

Porcelain is a fork of [VitalHex/branchshift](https://github.com/VitalHex/branchshift), which itself began as a fork of [zhyc9de/jet-git](https://github.com/zhyc9de/jet-git). Both upstream projects are MIT licensed and retain credit for the Git graph, merge, and JetBrains-style Commit/Shelf/Stash foundations this fork builds on.

Eighteen icons in the Commit tool window are used verbatim from [IntelliJ Platform Icons](https://intellij-icons.jetbrains.design/), copyright JetBrains s.r.o. and contributors, under the Apache 2.0 license. They are unmodified. The Porcelain application icon is an original project asset.

## License

Porcelain is available under the [MIT License](./LICENSE), which preserves the copyright notices of both upstream projects.

Third-party material in the packaged extension, including the JetBrains icons above, the Visual Studio Code Codicons, and every bundled npm dependency, is listed with its required notices in `THIRD-PARTY-NOTICES.md`, which ships inside the extension package. Neither the MIT nor the Apache 2.0 license grants trademark rights; Porcelain is not affiliated with or endorsed by JetBrains, Microsoft, GitHub, or Cursor.
