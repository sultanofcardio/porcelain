import * as assert from "node:assert";
import * as vscode from "vscode";
import { RepoRegistry } from "../../git/repoRegistry";
import { DiffEditorManager } from "../../views/diffEditorManager";
import { DiffWindow } from "../../views/diffWindow";
import {
  GitContentProvider,
  IDEA_GIT_SCHEME,
} from "../../views/gitContentProvider";

/**
 * P2#5 invariant: the git-content/diff providers must be registered even when
 * NO repo is active at activation time (multi-root launch with zero repos, or a
 * repo discovered/disposed after activation). Both GitContentProvider and
 * DiffEditorManager take the mutable repoRegistry and resolve the repo LAZILY per
 * request (via ?repo= query or getActive()), so they must construct and register
 * with an empty registry without throwing.
 *
 * See docs/superpowers/plans/2026-07-16-multi-repo-hardening.md Task 20 — the
 * `if (activeRuntime)` guard that used to gate this registration was removed.
 */
describe("provider registration with no active repo", () => {
  it("constructs GitContentProvider + DiffEditorManager with an empty registry without throwing", () => {
    // Fresh registry: getActive() is null — mirrors activation before any repo
    // is discovered (or after all repos are removed).
    const repoRegistry = new RepoRegistry();
    assert.strictEqual(repoRegistry.getActive(), null);

    // Tier 1: the guard's precondition (active repo needed) is false — these
    // constructors must not throw when no repo is active.
    const contentProvider = new GitContentProvider(repoRegistry);
    const diffManager = new DiffEditorManager(repoRegistry, new DiffWindow());

    assert.ok(
      contentProvider,
      "GitContentProvider should construct with empty registry",
    );
    assert.ok(
      diffManager,
      "DiffEditorManager should construct with empty registry",
    );
  });

  it("registers both content + filesystem providers against the real vscode API with an empty registry", () => {
    // Tier 2: exercises the exact registration calls activate() now makes
    // unconditionally, against a real (empty) registry. Mirrors the removed-guard
    // path end-to-end at the registration layer.
    const repoRegistry = new RepoRegistry();
    assert.strictEqual(repoRegistry.getActive(), null);

    const contentProvider = new GitContentProvider(repoRegistry);
    contentProvider.setExternalContentMap(new Map());

    const textDisposable = vscode.workspace.registerTextDocumentContentProvider(
      IDEA_GIT_SCHEME,
      contentProvider,
    );
    const fsDisposable = vscode.workspace.registerFileSystemProvider(
      IDEA_GIT_SCHEME,
      contentProvider,
      { isReadonly: true },
    );

    assert.ok(
      textDisposable,
      "registerTextDocumentContentProvider should return a disposable",
    );
    assert.ok(
      fsDisposable,
      "registerFileSystemProvider should return a disposable",
    );

    textDisposable.dispose();
    fsDisposable.dispose();
  });
});
