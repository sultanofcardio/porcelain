# One hi-fi mock per unimplemented feature, keyed by the exact feature name in features.py.
from mockkit import *  # noqa

M = {}

def add(name, para, html):
    M[name] = (para, html)

# ---------------------------------------------------------------- before 1.0
add("Full grammar coverage in diffs, lazy-loaded (D2)",
    "Six grammars ship today and everything else falls back to plain text. The full Shiki grammar set is loaded on demand, one grammar per language the first time a diff needs it, and cached for the session, so a Python or Go diff colours the same way a TypeScript one does. Nothing is bundled up front; the first diff in a new language pays a one-off load.",
    diffwin("pool.py · 1 of 2 · ac2edb5 ↔ 6ab30ba — repo", "ac2edb5", "6ab30ba", "src/db/pool.py",
        left=[("", KW("class") + " " + TY("Pool") + ":"), ("", "    " + KW("def") + " " + FN("__init__") + "(self, size: " + TY("int") + "):"), ("", "        self.free: " + TY("list") + "[" + TY("Client") + "] = []"), ("", ""),
              ("del", "    " + KW("def") + " " + FN("close") + "(self) -&gt; " + TY("None") + ":"), ("del", "        self.sweeper." + FN("cancel") + "()"), ("", ""), ("", "    " + KW("def") + " " + FN("sweep") + "(self):")],
        right=[("", KW("class") + " " + TY("Pool") + ":"), ("", "    " + KW("def") + " " + FN("__init__") + "(self, size: " + TY("int") + "):"), ("", "        self.free: " + TY("list") + "[" + TY("Client") + "] = []"), ("", ""),
               ("add", "    " + KW("async") + " " + KW("def") + " " + FN("drain") + "(self) -&gt; " + TY("None") + ":"), ("add", "        self.sweeper." + FN("cancel") + "()"), ("add", "        " + KW("await") + " asyncio." + FN("gather") + "(*[c." + FN("close") + "() " + KW("for") + " c " + KW("in") + " self.free])"), ("", "")],
        toolbar_extra='<span class="dw-lang">Python · grammar loaded on demand</span>'))

add("Auto-fetch on an interval, with a last-fetch tooltip",
    "A background fetch on a timer keeps the incoming and outgoing arrows honest without a manual Fetch. The interval is a setting, zero turns it off, and the tree shows when the last fetch ran. It uses the same fetch path as the toolbar button, so protected branches, tag mode and the remote resolution all apply.",
    vsc("[Extension Development Host] repo",
        panel(tree_html=btree([(0, "", "Current Branch: main", "", "bt-head"), (0, "⌄", "Local"), (1, "🏷", "main", '<span class="bt-cnt">↓3</span>'), (1, "⌄", "feature"), (2, "⑂", "rate-limit", '<span class="bt-cnt">↑1</span>'), (2, "⑂", "sessions", '<span class="bt-cnt">↓2 ↑1</span>', "sel"), (2, "⑂", "webhooks"), (0, "⌄", "Remote"), (1, "⌄", "origin"), (2, "★", "main")]),
              overlay='<div class="tip2" style="left:112px;top:196px">Fetched 4 minutes ago · every 15 minutes<br><span class="dim">2 incoming from origin/feature/sessions, 1 outgoing</span></div>', height=300)
        + settings([("Porcelain › Fetch: Interval", "Minutes between automatic fetches. <code>0</code> fetches only when you ask.", inp("15", w="80px"))], pos="margin:10px 12px 0"),
        act=None, height=430))

add("Commit message inspections: subject length, blank line, body wrap, with a quick fix",
    "IntelliJ checks the message as you type: a subject over 72 characters, no blank line before the body, body lines past the wrap. Each gets a squiggle and a quick fix. Limits come from <code>porcelain.commit.subjectLimit</code> and <code>porcelain.commit.bodyWrap</code>, defaulting to 72 like IntelliJ. Warnings only; Commit stays enabled.",
    vsc("[Extension Development Host] repo",
        '<div class="ed-empty"><div class="rule-card"><div class="rule-title">The three rules, and their fixes</div>'
        '<div class="rule"><div class="rule-k"><span class="sq-w"></span>Subject over 72</div><div class="rule-v">Move the rest into the body</div></div>'
        '<div class="rule"><div class="rule-k"><span class="sq-w"></span>No blank line before the body</div><div class="rule-v">Insert one</div></div>'
        '<div class="rule"><div class="rule-k"><span class="sq-w"></span>Body line over 72</div><div class="rule-v">Reflow the paragraph</div></div>'
        '<div class="rule-note">Warnings only. Commit stays enabled, the way IntelliJ leaves it.</div></div></div>',
        side=commitside(msg='feat: return JSON on unmatched routes instead of the <mark class="over">HTML error page from express</mark><span class="caret"></span>',
                        msg_extra='<div class="insp"><div class="insp-head"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5 15 14H1L8 1.5Zm0 3.2L3.6 12.5h8.8L8 4.7ZM7.3 7h1.4v3H7.3V7Zm0 3.8h1.4v1.4H7.3v-1.4Z"/></svg>Subject is 84 characters. Keep the first line under 72.</div><div class="insp-fix"><span class="bulb">💡</span>Move the rest into the body<kbd>⌥⏎</kbd></div></div>'),
        side_w=330, height=560, status=("⑂ main*+", "⑂ Porcelain", "⊗ 0 ⚠ 1"), status_right="Ln 1, Col 84"))

add("Commit checks: CRLF, large files, detached HEAD, unset user.name or email",
    "The git-level checks IntelliJ runs before a commit, as one dialog that lists what it found and offers the fix inline: convert line separators, skip a file over the size limit or keep it, commit on a detached HEAD anyway, or set <code>user.name</code> and <code>user.email</code> right there. Nothing runs until you choose.",
    vsc("[Extension Development Host] repo",
        '<div class="ed-empty">' + dialog("Commit", '<div class="chkrow warn"><i>⚠</i><div><b>2 files use CRLF line separators</b><span>config.ts, server.ts. The repository is set to LF.</span></div><span class="dbtn small">Fix and Commit</span></div>'
            '<div class="chkrow warn"><i>⚠</i><div><b>NOTES.pdf is 14 MB</b><span>Over the 10 MB warning threshold. Git LFS would keep it out of every clone.</span></div><span class="dbtn small">Skip file</span></div>'
            '<div class="chkrow err"><i>⊗</i><div><b>user.name is not set</b><span>The commit needs an author.</span></div><span class="dbtn small">Set…</span></div>',
            buttons=(("Cancel", False), ("Commit Anyway", False), ("Commit", True)), sub="3 checks before the commit runs", width=520) + '</div>',
        side=commitside(), side_w=300, height=480))

add("Delete notification with Restore",
    "Deleting a branch puts its tip hash in the notification, and Restore recreates the branch there. The hash is kept for the session, so the undo works even after the tree has refreshed. Force-deletes carry the same button, which is the point: the counted warning stays, and the mistake becomes cheap.",
    vsc("[Extension Development Host] repo",
        panel(tree_html=btree([(0, "", "Current Branch: main", "", "bt-head"), (0, "⌄", "Local"), (1, "🏷", "main"), (1, "⌄", "feature"), (2, "⑂", "rate-limit"), (2, "⑂", "sessions"), (0, "⌄", "Remote"), (1, "⌄", "origin"), (2, "★", "main")]),
              overlay=toast("info", "Deleted branch <b>feature/webhooks</b>, which was at 5a03f42.", ("Restore", "Delete on origin too"), pos="right:14px;bottom:10px"), height=320),
        act=None, height=360))

add("Highlight not-cherry-picked commits",
    "A fourth highlighter, the one IntelliJ turns on in branch comparisons: commits on the other side whose patch already exists on the current branch are dimmed, and the ones that would actually bring something are left bright. It reads <code>git cherry</code> once per comparison, so it costs nothing on the plain log.",
    vsc("[Extension Development Host] repo",
        panel(tb=toolbar(chips=("Compare: feature/sessions ↔ main",), extra='<span class="pp-dd on">View Options ⌄</span>'),
              log_html=lograw([
                  dict(author="Alan Turing", msg="fix: expire sessions on the server clock", lane="#c75450", date="19 days ago", hash="4182e66", cls="hl"),
                  dict(author="Grace Hopper", msg="fix: reject malformed JSON bodies", lane="#c75450", date="20 days ago", hash="aac7e3b", cls="dim2", chips=[("tag", "picked as 9b12c0e")]),
                  dict(author="Ada Lovelace", msg="docs: document the environment variables", lane="#c75450", date="21 days ago", hash="44aee23", cls="hl"),
                  dict(author="Radia Perlman", msg="test: session expiry", lane="#c75450", date="22 days ago", hash="c3d285e", cls="dim2", chips=[("tag", "picked as 1e0f77a")]),
              ]),
              overlay=ctxmenu([("Graph", {"sub": True}), ("Highlight", {"sel": True, "sub": True}), ("Presentation", {"sub": True}), ("Columns", {"sub": True})], pos="position:absolute;right:250px;top:62px", width=170)
                      + ctxmenu([("My Commits", {"chk": True}), ("Dim Merge Commits", {"unchk": True}), ("Fade Other Branches", {"chk": True}), ("Not Cherry-Picked Commits", {"chk": True, "sel": True})], pos="position:absolute;right:20px;top:88px", width=230),
              details_html=None, height=330),
        act=None, height=370))

add("Remember diff settings per place: Changes, Log, Merge",
    "The settings menu keeps its per-window behaviour, and gains a place: a diff opened from the Commit view, from the log, or inside the merge editor remembers its own ignore policy, granularity and layout, the way IntelliJ keeps three sets. The menu says which place it is saving for, so nothing changes silently.",
    diffwin("pool.ts · 2 of 3 · ac2edb5 ↔ 6ab30ba — repo", "ac2edb5", "6ab30ba", "src/db/pool.ts",
        overlay=ctxmenu([("Side by side", {"chk": True}), ("Unified", {"unchk": True}), "-", ("Do not ignore", {"unchk": True}), ("Ignore whitespace", {"chk": True}), ("Ignore whitespace and empty lines", {"unchk": True}), "-", ("Highlight: word", {"sub": True}), ("Collapse unchanged fragments", {"chk": True}), ("Synchronised scrolling", {"chk": True}), "-", ("Remembered for: Log diffs", {"sel": True, "sub": True})],
                        pos="position:absolute;right:12px;top:34px", width=280), height=380))

add("Rename following in file history (--follow)",
    "Show File History runs <code>git log --follow</code> with rename detection, so the history keeps going past the commit that moved the file. The rename row carries the old path as a chip, and the diff from that row opens with the two paths in its headers instead of an add and a delete.",
    vsc("[Extension Development Host] repo",
        panel(tb=toolbar(chips=("History: src/db/pool.ts",)),
              log_html=lograw([
                  dict(author="Radia Perlman", msg="chore: shut the pool down with the server", date="10 days ago", hash="04c6465"),
                  dict(author="Grace Hopper", msg="feat: pagination for the user list", date="13 days ago", hash="ac2edb5", cls="sel"),
                  dict(author="Ada Lovelace", msg="refactor: move the pool under src/db", chips=[("remote", "renamed from src/pool.ts")], date="24 days ago", hash="7f21a90"),
                  dict(author="Alan Turing", msg="feat: token bucket limiter", date="26 days ago", hash="990169a"),
                  dict(author="Grace Hopper", msg="feat: connection pool", date="31 days ago", hash="1c0a4d2"),
              ]),
              details_html=details("refactor: move the pool under src/db", "7f21a90", "Ada Lovelace", "ada@example.com", "2026-08-09", chips=[("local", "main")],
                                   extra='<div class="pp-det-meta" style="margin-top:8px">src/pool.ts → src/db/pool.ts <span class="dim">(98% similar)</span></div>'), height=330),
        act=None, height=370))

add("Author completion from history",
    "The Author override in the commit options completes from the authors already in the history, most commits first, in git's <code>Name &lt;email&gt;</code> form. Picking one fills both parts; the option-lookalike check still runs on whatever ends up in the field.",
    vsc("[Extension Development Host] repo", '<div class="ed-empty"></div>',
        side=commitside(extra_opts='', msg_extra='<div class="copt-panel"><div class="fld"><label>Author</label><div>' + inp("Gra", caret=True) + '</div></div>'
                        + quickpick("", [("<b>Gra</b>ce Hopper &lt;grace@example.com&gt;", {"sel": True, "det": "412 commits"}), ("<b>Gra</b>ce Hopper &lt;g.hopper@navy.mil&gt;", {"det": "3 commits"})], pos="position:absolute;left:0;right:0;top:36px", width=None)
                        + '<div class="fld" style="margin-top:76px"><label>Skip commit hooks</label><div>' + cb() + '</div></div></div>'),
        side_w=320, height=600))

add("Shelf: rename, recently deleted with restore",
    "Two shelf conveniences from IntelliJ. Rename edits the shelf's name in place, and the patch directory under <code>.idea/shelf/</code> is renamed with it so IntelliJ still sees the same shelf. Deleting a shelf moves it to a Recently Deleted group, from which Restore brings it back, and it is only really gone when you clear that group.",
    vsc("[Extension Development Host] repo", '<div class="ed-empty"></div>',
        side=commitside(tab="Shelf", buttons=False, msg="", tree="".join([
            crow(0, '<span class="cchev">⌄</span><b>SHELVED</b><span class="cn">2</span>'),
            crow(1, '<span class="ts md">▤</span><span class="fn">wip: pagination cursor</span><span class="cn">3 files · today</span>', "sel"),
            crow(1, '<span class="ts md">▤</span><span class="fn">spike: rate limiter</span><span class="cn">1 file · 2 days ago</span>'),
            crow(0, '<span class="cchev">⌄</span><b>RECENTLY DELETED</b><span class="cn">1</span>'),
            crow(1, '<span class="ts md">▤</span><span class="fn dimf">old: session cookies</span><span class="cn">deleted 1 hour ago</span><span class="lnk">Restore</span>'),
        ]) + ctxmenu([("Unshelve…", {"sc": "⇧⌘U"}), ("Unshelve Silently", {}), "-", ("Rename…", {"sel": True}), ("Show Diff", {"sc": "⌘D"}), "-", ("Delete", {})], pos="position:absolute;left:150px;top:150px", width=200)).replace('<div class="cmsg">', '<div class="cmsg" hidden>'),
        side_w=320, height=380))

add("Set or unset the tracked branch from the tree",
    "A branch's upstream is editable from its context menu instead of only at push time. The picker lists the remote branches, with the same-name one first, and a None entry that unsets it. Update and Reset to upstream light up as soon as a tracked branch exists.",
    vsc("[Extension Development Host] repo",
        panel(tree_html=btree(DEFAULT_TREE, sel=6),
              overlay=ctxmenu([("Checkout", {}), ("Update", {"dis": True}), ("Push…", {}), "-", ("Merge 'sessions' into current", {}), ("Rebase current onto 'sessions'", {}), ("Compare with Current", {}), "-", ("Set Tracked Branch…", {"sel": True}), ("New Branch from 'sessions'…", {}), ("Rename…", {}), ("Delete", {})], pos="position:absolute;left:120px;top:150px")
                      + quickpick("Tracked branch for feature/sessions", [("origin/feature/sessions", {"sel": True, "desc": "same name"}), ("origin/main", {}), ("origin/feature/webhooks", {}), ("None", {"desc": "unset the tracked branch"})], pos="position:absolute;left:380px;top:70px", width=380),
              height=340),
        act=None, height=380))

add("Show diff with working tree from any ref",
    "Compare with Current shows commit lists. This is the file-level diff between any branch, tag or commit and what is on disk right now, opened as a Changes window like Compare Versions, so every file there is double-clickable into the diff viewer with the working-tree side editable.",
    vsc("[Extension Development Host] repo",
        panel(tree_html=btree(DEFAULT_TREE, sel=3),
              overlay=ctxmenu([("Checkout", {"dis": True}), ("Update", {}), ("Push…", {}), "-", ("Compare with Current", {}), ("Show Diff with Working Tree", {"sel": True}), "-", ("New Branch from 'main'…", {}), ("Reset to upstream", {})], pos="position:absolute;left:110px;top:120px")
                      + fw("Changes Between main and Working Tree — repo", '<div class="chg"><div class="chg-h">Changes Between <code>main</code> and <b>working tree</b><span class="dim">3 files</span></div>'
                           + crow(0, '<span class="cchev">⌄</span><span class="fold"></span>src<span class="cn">2 files</span>') + crow(1, '<span class="ts">TS</span><span class="fn">config.ts</span><span class="st">M</span>') + crow(1, '<span class="ts">TS</span><span class="fn">router.ts</span><span class="st">M</span>', "sel") + crow(0, '<span class="ts md">M↓</span><span class="fn unv">NOTES.md</span><span class="st unv">U</span>') + '</div>',
                           height=200, cls="abs", width=380).replace('class="fw abs"', 'class="fw abs" style="position:absolute;right:16px;top:40px;width:380px;height:200px"'),
              height=340),
        act=None, height=380))

add("Fix tracked branch: pick an upstream when Update has none",
    "Update on a branch with no upstream is disabled today, with the reason. IntelliJ instead asks which remote branch to update from and offers to make it the tracked branch. Same picker as Set Tracked Branch, with a checkbox that does the setting.",
    vsc("[Extension Development Host] repo",
        panel(tree_html=btree(DEFAULT_TREE, sel=5),
              overlay=quickpick("feature/rate-limit has no tracked branch. Update from…", [("origin/feature/rate-limit", {"sel": True, "desc": "same name"}), ("origin/main", {}), ("origin/develop", {})], pos="position:absolute;left:300px;top:60px", width=420)
                      + '<div class="qp-foot" style="position:absolute;left:300px;top:200px;width:420px">' + chk("Set as tracked branch", True) + '<span class="dbtn primary small">Update</span></div>',
              height=330),
        act=None, height=370))

add("Remember the rejected-push choice",
    "When a push is rejected the chooser already offers merge or rebase. IntelliJ adds a checkbox that remembers the answer, so later rejections update silently the same way and push again. The memory is per repository and lives in <code>porcelain.push.rejectedAction</code>, which is how you change your mind.",
    vsc("[Extension Development Host] repo", '<div class="ed-empty">' + dialog("Push Rejected",
        '<p>origin/main has moved since your last fetch. Update <b>main</b> first, then push again.</p><div class="dlg-opts"><div class="opt-card sel"><b>Rebase</b><span>Replay your 2 commits on top of origin/main. Keeps the history linear.</span></div><div class="opt-card"><b>Merge</b><span>Bring origin/main in with a merge commit.</span></div></div>' + chk("Remember, and update silently next time", True),
        buttons=(("Cancel", False), ("Rebase and Push", True)), width=480) + '</div>', act=None, height=340))

add("Add a remote inline when the push panel finds none",
    "A fresh repository has nowhere to push. Instead of an empty target list, the push panel shows Name and URL fields in place, adds the remote, sets upstream, and pushes in one go. The same option-lookalike validation as Manage Remotes applies.",
    fw("Push — repo", '<div class="pushp"><div class="push-h">Push <b>main</b> → <span class="dim">no remotes configured</span></div>'
       '<div class="push-inline"><div class="fld"><label>Remote</label><div>' + inp("origin", w="140px") + '</div></div><div class="fld"><label>URL</label><div>' + inp("git@github.com:ada/repo.git", w="100%", caret=True) + '</div></div></div>'
       '<div class="push-list"><div class="tw-h" style="grid-template-columns:90px 1fr 90px"><span>Hash</span><span>Message</span><span>Date</span></div>' + "".join('<div class="tw-r" style="grid-template-columns:90px 1fr 90px"><span class="mono">%s</span><span>%s</span><span>%s</span></div>' % (r["hash"], r["msg"], r["date"]) for r in DEFAULT_ROWS[:4]) + '</div>'
       '<div class="push-opts">' + chk("Set upstream", True) + chk("Push tags") + chk("Skip pre-push hooks") + '</div><div class="dlg-foot"><span class="dbtn">Cancel</span><span class="dbtn primary">Add Remote and Push</span></div></div>', height=400, width=620))

add("Squash Into… (squash! alongside fixup!)",
    "Fixup commits the working tree as <code>fixup!</code> of a chosen commit. Squash Into does the same with <code>squash!</code>, which keeps its message for the autosquash rebase to fold in. Same picker, same guard rails, and the message box is pre-filled with the prefix and the target subject.",
    vsc("[Extension Development Host] repo",
        panel(overlay=ctxmenu([("Interactively Rebase from Here…", {}), ("Edit Commit Message…", {}), ("Fixup…", {}), ("Squash Into…", {"sel": True}), ("Undo Commit", {"dis": True}), "-", ("New Branch…", {}), ("New Tag…", {})], pos="position:absolute;left:330px;top:120px"), log_html=lograw(DEFAULT_ROWS[:6], sel=3), height=330),
        side=commitside(msg='squash! feat: pagination for the user list<br><br>Keep the cursor stable when a page is inserted into<span class="caret"></span>'), side_w=280, act=4, height=460))

add("\"All conflicts resolved, continue?\" prompt",
    "Once the last conflicted file is ticked in the Merge Conflicts group, the banner turns green and asks the question, with the conflict count gone. The Continue verb is the same one; the prompt just makes the moment obvious instead of leaving a resolved rebase sitting there.",
    vsc("[Extension Development Host] repo", '<div class="ed-empty"></div>',
        side=commitside(banner=banner("Rebasing onto <b>main</b> · all conflicts resolved. Continue?", ("Continue Rebase", "Abort", "Skip Commit")).replace('class="cbanner"', 'class="cbanner ok"'),
                        tree="".join([crow(0, cb("on") + '<span class="cchev">⌄</span><b>CHANGES</b><span class="cn">2 FILES</span>'), crow(1, cb("on") + '<span class="cchev">⌄</span><b class="grp">MERGE CONFLICTS</b><span class="cn">0 left</span><span class="lnk">Resolve</span>'), crow(2, cb("on") + '<span class="ts">TS</span><span class="fn">pool.ts</span><span class="st ok">resolved</span>'), crow(1, cb("on") + '<span class="ts">TS</span><span class="fn">users.ts</span><span class="st">M</span>')]),
                        msg="fix: expire sessions on the server clock", buttons=False),
        side_w=330, height=360))

add("Warn before rewriting commits already on a protected branch",
    "The rewriting verbs check whether the commit is reachable from a branch in <code>porcelain.push.protectedBranches</code> on the remote. If it is, the operation warns first: rewriting it means a force push that main will refuse. The guard reuses the same setting, so there is one list to keep.",
    vsc("[Extension Development Host] repo", '<div class="ed-empty">' + dialog("Edit Commit Message",
        '<div class="chkrow warn"><i>⚠</i><div><b>ac2edb5 is already on origin/main</b><span>Rewriting it creates a new commit that origin/main does not have. Pushing that needs a force push, and <code>main</code> is a protected branch, so Porcelain will refuse it.</span></div></div><p class="dim small">You can still rewrite it locally, for example to move the branch elsewhere afterwards.</p>',
        buttons=(("Cancel", False), ("Rewrite Anyway", False)), width=500) + '</div>', act=None, height=300))

add("Annotate previous revision from a blame line",
    "From any blame line: annotate the file as it was in that line's parent commit, so you can walk backwards through who changed what, the way IntelliJ's gutter menu does. The gutter header names the revision you are looking at, and Show Diff opens that commit's change to the file.",
    vsc("[Extension Development Host] repo", editor_tabs(["pool.ts", "router.ts"]) + blame([
        ("Ada Lovelace", "2026-08-24", 1, KW("export") + " " + KW("class") + " " + TY("Pool") + " {"), ("Ada Lovelace", "2026-08-24", 1, "  " + KW("private") + " " + KW("readonly") + " free: " + TY("Client") + "[] = [];"),
        ("Grace Hopper", "2026-08-20", 2, "  " + KW("async") + " " + FN("acquire") + "(): " + TY("Promise") + "&lt;" + TY("Client") + "&gt; {"), ("Grace Hopper", "2026-08-20", 2, "    " + KW("const") + " client = " + KW("this") + ".free." + FN("pop") + "() ?? " + KW("new") + " " + TY("Client") + "();"),
        ("Radia Perlman", "2026-08-11", 3, "    " + KW("this") + ".busy." + FN("add") + "(client);"), ("Alan Turing", "2026-07-30", 4, "    " + KW("return") + " client;"), ("Alan Turing", "2026-07-30", 4, "  }"),
    ], header="Blame: <b>HEAD</b> · src/db/pool.ts") + ctxmenu([("Annotate Previous Revision (7697272)", {"sel": True}), ("Show Diff for ac2edb5", {}), ("Select in Git Log", {}), ("Copy Revision Number", {}), "-", ("Blame Options…", {}), ("Hide Blame", {})], pos="position:absolute;left:180px;top:110px", width=290),
        act=None, height=330))

add("Click a blame line to select the commit in the log",
    "A click on the blame gutter selects that commit in the Porcelain panel: the log navigates to it, the details pane shows it, and the file's change in it is one double-click away. The hover card keeps working; the click is the shortcut IntelliJ users reach for.",
    vsc("[Extension Development Host] repo", editor_tabs(["pool.ts"]) + blame([
        ("Ada Lovelace", "2026-08-24", 1, KW("export") + " " + KW("class") + " " + TY("Pool") + " {"), ("Grace Hopper", "2026-08-20", 2, "  " + KW("async") + " " + FN("acquire") + "(): " + TY("Promise") + "&lt;" + TY("Client") + "&gt; {"), ("Grace Hopper", "2026-08-20", 2, "    " + KW("const") + " client = " + KW("this") + ".free." + FN("pop") + "();"),
    ]).replace('<div class="bl-row"><span class="bl-g age2">Grace Hopper', '<div class="bl-row sel"><span class="bl-g age2">Grace Hopper', 1)
        + panel(log_html=lograw(DEFAULT_ROWS[:4], sel=3), details_html=details("feat: pagination for the user list", "ac2edb5", "Grace Hopper", "grace@example.com", "2026-08-20 16:28", chips=[("local", "main")]), height=210, tree_w=150, det_w=200),
        act=None, height=430))

add("History for a selection (log -L)",
    "Select a range in an editor and ask for its history: <code>git log -L</code> follows those lines through every commit that touched them, moves included. The log shows the filtered commits with a chip naming the range, and each diff opens scrolled to it. The git layer already has the call; this is the menu item and the chip.",
    vsc("[Extension Development Host] repo", editor_tabs(["pool.ts"]) + code([("", "  " + FN("release") + "(client: " + TY("Client") + "): " + TY("void") + " {"), ("selx", "    " + KW("this") + ".busy." + FN("delete") + "(client);"), ("selx", "    client.lastUsed = Date." + FN("now") + "();"), ("selx", "    " + KW("this") + ".free." + FN("push") + "(client);"), ("", "  }")], start=23)
        + ctxmenu([("Show File History", {}), ("Show History for Selection", {"sel": True}), ("Annotate with Git Blame", {}), "-", ("(Porcelain) Edit Source", {"dis": True})], pos="position:absolute;left:260px;top:70px", width=250)
        + panel(tb=toolbar(chips=("History: pool.ts:24–26",)), log_html=lograw([DEFAULT_ROWS[1], DEFAULT_ROWS[3], dict(author="Alan Turing", msg="feat: token bucket limiter", date="24 days ago", hash="990169a")], sel=0), height=190, tree_w=150),
        act=None, height=430))

add("Compare with base from the merge editor: Left↔Base, Right↔Base, Left↔Right",
    "Three two-pane diffs reachable from the merge toolbar, for when the three-pane view hides what a side actually changed. Each opens in the reused diff window with the merge's own labels, so Yours ↔ Base reads as main against the merge base rather than two hashes.",
    mergewin("Merge: pool.ts — repo", toolbar_extra='<span class="on">⇄</span>',
        overlay=ctxmenu([("Yours ↔ Base", {"sel": True, "desc": "main against the merge base"}), ("Theirs ↔ Base", {}), ("Yours ↔ Theirs", {})], pos="position:absolute;left:150px;top:34px", width=220)
                + fw("pool.ts · main ↔ base — repo", '<div class="dw"><div class="dw-heads"><span>🔒 <b>main</b> src/db/pool.ts <i class="tagp">YOURS</i></span><span>🔒 <b>base</b> 814f249</span></div><div class="dw-panes"><div class="dw-pane">' + code(POOL_L[3:7], start=29) + '</div><div class="dw-pane">' + code([("", "  " + KW("private") + " " + FN("sweep") + "(): " + TY("void") + " {"), ("", "    " + KW("const") + " cutoff = …;"), ("", "  }"), ("", "")], start=29) + '</div></div></div>', height=170, cls="abs").replace('class="fw abs"', 'class="fw abs" style="position:absolute;right:16px;bottom:12px;width:520px"'),
        height=380))

add("Conflict-type labels in the Conflicts window: both modified, deleted by them…",
    "The Conflicts window says Modified / Modified for everything today. Git knows more: both modified, both added, deleted by you, deleted by them, added by each. The label changes what Accept Yours or Theirs will do, which is why IntelliJ prints it, and a deleted-by-them row makes Accept Theirs read as delete.",
    fw("Conflicts — repo", '<div class="cw"><div class="cw-h"><b>Conflicts — repo</b><span>Merge in progress</span><span class="dim">4 files with conflicts</span>' + chk("Group files by directory", True) + '</div>'
       + tw(("Name", "Yours", "Theirs", "Type"), [
           ('<span class="fold"></span> src/db', "", "", '<span class="dim">2 files</span>'),
           ('&nbsp;&nbsp;&nbsp;<i class="ts">TS</i> pool.ts', '<span class="red">Modified</span>', '<span class="red">Modified</span>', "Both modified"),
           ('&nbsp;&nbsp;&nbsp;<i class="ts">TS</i> users.ts', '<span class="red">Modified</span>', '<span class="red">Deleted</span>', "Deleted by them"),
           ('<i class="ts">TS</i> router.ts', '<span class="green">Added</span>', '<span class="green">Added</span>', "Both added"),
           ('<i class="ts md">M↓</i> NOTES.md', '<span class="red">Deleted</span>', '<span class="red">Modified</span>', "Deleted by you"),
       ], sel=2, widths="1fr 90px 90px 130px")
       + '<div class="cw-btns"><span class="dbtn">Accept Yours</span><span class="dbtn">Accept Theirs <span class="dim">(delete)</span></span><span class="dbtn primary">Merge…</span></div></div>', height=300, width=760))

add("Nested repositories inside one workspace folder",
    "Discovery stops at one repository per workspace folder. IntelliJ scans for nested roots and lists them alongside. The active-repository selector gains the nested ones, labelled by their path under the folder, and each behaves as its own repository in Commit and Git Log.",
    vsc("[Extension Development Host] repo", panel(tb=toolbar(chips=(), extra='<span class="pp-dd on">Repository: repo ⌄</span>'), overlay=quickpick("Active repository", [("repo", {"sel": True, "desc": "/Users/ada/repo", "det": "main"}), ("repo › vendor/limiter", {"desc": "nested", "det": "v2.1.0"}), ("repo › tools/cli", {"desc": "nested", "det": "feature/init"}), ("docs", {"desc": "/Users/ada/docs", "det": "main"})], pos="position:absolute;left:220px;top:56px", width=460), height=300), act=None, height=340))

add("GPG signing: configure the key and show signing status",
    "The config read already exists. This puts it somewhere: a settings row for the signing key, a toggle for <code>commit.gpgsign</code>, and a status line in the commit options that says which key will sign and whether the program was found, so a signed commit does not fail at the last second.",
    vsc("[Extension Development Host] repo", settings([
        ("Porcelain › Signing: Sign Commits", "Sign commits with GPG or SSH (<code>commit.gpgsign</code>).", chk("", True)),
        ("Porcelain › Signing: Key", "Key id or fingerprint (<code>user.signingkey</code>). Empty uses gpg's default.", inp("3AA5C34371567BD2", w="240px")),
        ("Porcelain › Signing: Format", "<code>openpgp</code> or <code>ssh</code>.", select("openpgp", w="140px")),
    ]), side=commitside(msg_extra='<div class="sign-status"><i>🔏</i> Signing with <b>3AA5C343…7BD2</b> <span class="ok">gpg 2.4.5 found</span></div>'), side_w=300, height=480))

add("Create patch from selected commits or changes",
    "Create Patch from the commit context menu and from the Commit view: a unified diff of the selected commits or the ticked changes, written to a file or the clipboard. The reverse option is the git one. Apply lives with the shelf's import today and grows its own dialog after 1.0.",
    vsc("[Extension Development Host] repo", panel(log_html=lograw(DEFAULT_ROWS[:6], sel=[2, 3]), overlay=ctxmenu([("Copy Revision Numbers", {}), ("Cherry-Pick 2 Commits", {}), ("Create Patch…", {"sel": True}), "-", ("Compare Versions", {}), ("Squash 2 Commits…", {})], pos="position:absolute;left:330px;top:100px")
        + dialog("Create Patch", field("From", '<span class="dim">2 commits: 72fd1fb, ac2edb5</span>') + field("To", '<div class="radio-row"><label><i class="rd on"></i> File</label><label><i class="rd"></i> Clipboard</label></div>') + field("Patch file", inp("/Users/ada/pagination.patch")) + field("", chk("Reverse patch") + chk("Include base revision for each file", True)), buttons=(("Cancel", False), ("Create", True)), pos="position:absolute;right:16px;top:40px", width=400), height=340), act=None, height=380))

add("Branch filter patterns and a..b ranges",
    "The branch filter's field accepts what git accepts: a glob like <code>feature/*</code> selects every matching ref, and <code>main..release/1.2</code> is a range. Both sit alongside the checkboxes, and the chip shows what was typed rather than expanding it.",
    vsc("[Extension Development Host] repo", panel(tb=toolbar(chips=("Branch: feature/* main..release/1.2",)), overlay='<div class="qp" style="position:absolute;left:220px;top:56px;width:420px"><div class="qp-in">feature/* main..release/1.2<span class="caret"></span></div>' + "".join('<div class="qp-item"><span class="qp-chk %s"></span><span class="qp-l">%s</span>%s</div>' % (c, l, ('<span class="qp-desc">%s</span>' % d) if d else "") for c, l, d in [("on", "feature/rate-limit", "matches feature/*"), ("on", "feature/sessions", "matches feature/*"), ("on", "feature/webhooks", "matches feature/*"), ("on", "main..release/1.2", "range · 14 commits"), ("", "fix/pool-leak", ""), ("", "origin/main", "")]) + '</div>', height=300), act=None, height=340))

add("Confirmation settings: force push, branch delete, discard",
    "IntelliJ's Confirmation page, reduced to the three that matter: force push, deleting a branch, and discarding changes. Each dialog gains a Don't ask again box that writes the setting, and the settings page is where you turn a confirmation back on.",
    vsc("[Extension Development Host] repo", settings([
        ("Porcelain › Confirm: Force Push", "Ask before a force push to a branch that is not protected.", chk("", True)),
        ("Porcelain › Confirm: Delete Branch", "Ask before deleting a fully merged branch. Unmerged branches always ask.", chk("", True)),
        ("Porcelain › Confirm: Discard Changes", "Ask before Rollback throws away local changes.", chk("", False)),
    ]) + dialog("Force Push", "<p>Push <b>feature/webhooks</b> to origin with <code>--force-with-lease</code>? The remote branch will move back by 2 commits.</p>" + chk("Don't ask again"), buttons=(("Cancel", False), ("Force Push", True)), pos="position:absolute;right:20px;top:60px", width=380), act=None, height=380))

# ---------------------------------------------------------------- after 1.0
add("Diff preview pane inside the log",
    "A toggle on the details pane swaps the changed-files list for the selected file's diff, inline, the way IntelliJ's log can show a diff preview without opening a window. Same viewer, read-only, with the file list collapsed to a strip above it.",
    vsc("[Extension Development Host] repo", panel(details_html='<div class="pp-det-h">Changed files <span class="pp-det-tg"><b class="on">⧉</b><b>☰</b></span></div><div class="pp-file sel"><i>TS</i> src/db/pool.ts</div><div class="pp-file"><i class="md">M↓</i> README.md</div><div class="dw mini"><div class="dw-panes"><div class="dw-pane">' + code(POOL_L[3:7], start=29) + '</div><div class="dw-pane">' + code(POOL_R[3:7], start=29) + '</div></div></div>', det_w=320, height=330), act=None, height=370))

add("Drop or extract changes from a commit (split)",
    "Pick files out of a commit: drop them from it, or extract them into a new commit right after it. Under the hood it is an interactive rebase with an edit stop, so the guard rails and the conflict banner are the same ones. Stretch in the roadmap; still stretch.",
    vsc("[Extension Development Host] repo", '<div class="ed-empty">' + dialog("Extract Changes from ac2edb5", '<p class="dim small">feat: pagination for the user list · 4 files</p>' + "".join(crow(0, cb(s) + '<span class="ts">TS</span><span class="fn">%s</span><span class="st">M</span>' % f) for s, f in [("on", "src/db/pool.ts"), ("on", "src/db/users.ts"), ("", "src/handlers/users.ts"), ("", "README.md")]) + '<div class="radio-row" style="margin-top:10px"><label><i class="rd on"></i> Extract into a new commit after it</label><label><i class="rd"></i> Drop from the commit</label></div>' + field("New commit message", inp("refactor: pool cursor helpers")), buttons=(("Cancel", False), ("Extract", True)), width=500) + '</div>', act=None, height=380))

add("Rebase --root and --keep-empty",
    "Two more boxes in the rebase dialog: <code>--root</code> rebases everything from the first commit, which is how you rewrite an initial commit, and <code>--keep-empty</code> stops git dropping commits that become empty. Both are passed through verbatim like the existing options.",
    vsc("[Extension Development Host] repo", '<div class="ed-empty">' + dialog("Rebase feature/sessions", field("Onto", select("main")) + field("Options", chk("Interactive", True) + chk("Autosquash", True) + chk("Update refs") + chk("Rebase merges") + chk("From root (--root)", True, "rewrite from the first commit") + chk("Keep empty commits (--keep-empty)", True)), buttons=(("Cancel", False), ("Rebase", True)), width=460) + '</div>', act=None, height=360))

add("Cherry-pick and revert without committing",
    "The no-commit variants: the change lands in the working tree, ticked, with the message seeded, and you commit when ready. Useful for combining several picks into one commit, or for editing a revert before it lands.",
    vsc("[Extension Development Host] repo", panel(log_html=lograw(DEFAULT_ROWS[:5], sel=3), overlay=ctxmenu([("Cherry-Pick", {}), ("Cherry-Pick Without Committing", {"sel": True}), ("Revert Commit", {}), ("Revert Without Committing", {}), "-", ("Drop Commit", {})], pos="position:absolute;left:330px;top:100px", width=270), height=330), side=commitside(msg="(cherry picked from commit ac2edb5)<br>feat: pagination for the user list", tree="".join([crow(0, cb("on") + '<span class="cchev">⌄</span><b>CHANGES</b><span class="cn">2 FILES</span>'), crow(1, cb("on") + '<span class="ts">TS</span><span class="fn">pool.ts</span><span class="st">M</span>'), crow(1, cb("on") + '<span class="ts">TS</span><span class="fn">users.ts</span><span class="st">M</span>')])), side_w=270, height=430))

add("Terminal-initiated rebases open the editor",
    "Because Porcelain already registers as the sequence editor, a <code>git rebase -i</code> typed in the integrated terminal can open the same Rebasing Commits table instead of vim. The terminal waits on the editor; Cancel aborts the rebase the way an empty todo does.",
    vsc("[Extension Development Host] repo", terminal(['<span class="dim">~/repo</span> <b>$</b> git rebase -i main', '<span class="dim">hint: Waiting for Porcelain to close the rebase plan…</span>']) + dialog("Rebasing Commits", tw(("Action", "Hash", "Message"), [(select("pick", w="90px"), "72fd1fb", "fix: keep pagination stable across inserts"), (select("squash", w="90px"), "ac2edb5", "feat: pagination for the user list"), (select("reword", w="90px"), "7697272", "refactor: split the router table")], widths="100px 80px 1fr") + '<div class="dlg-links"><span>↑ Move up</span><span>↓ Move down</span><span>Reset</span><span>View Git Commands</span></div>', buttons=(("Cancel", False), ("Start Rebasing", True)), pos="position:absolute;left:40px;top:70px", width=560), act=None, height=380))

add("Co-authored-by trailer completion",
    "Typing a trailer name in the message box completes it: <code>Co-authored-by:</code> with the same author list as the Author override, and <code>Signed-off-by:</code> with your own identity. Trailers stay on their own lines at the end, which the blank-line inspection also enforces.",
    vsc("[Extension Development Host] repo", '<div class="ed-empty"></div>', side=commitside(msg='feat: pagination for the user list<br><br>Co-au<span class="caret"></span>', msg_extra=quickpick("", [("<b>Co-au</b>thored-by: Radia Perlman &lt;radia@example.com&gt;", {"sel": True}), ("<b>Co-au</b>thored-by: Alan Turing &lt;alan@example.com&gt;", {}), ("<b>Co-au</b>thored-by: Grace Hopper &lt;grace@example.com&gt;", {})], pos="position:absolute;left:10px;right:10px;bottom:calc(100% - 4px)", width=None)), side_w=320, height=480))

add("Changed-file-name completion in the message",
    "The names of the ticked files complete in the message box, so a subject can name the file it touches without retyping it. Basenames first, full paths on a second press.",
    vsc("[Extension Development Host] repo", '<div class="ed-empty"></div>', side=commitside(msg='fix: rou<span class="caret"></span>', msg_extra=quickpick("", [("<b>rou</b>ter.ts", {"sel": True, "desc": "src/handlers/router.ts"}), ("<b>rou</b>tes.test.ts", {"desc": "src/handlers/routes.test.ts"})], pos="position:absolute;left:10px;right:10px;bottom:calc(100% - 4px)", width=None)), side_w=320, height=480))

add("Reinstate index on unstash",
    "Git's <code>stash pop --index</code>: restore what was staged as staged. Porcelain's checkbox model does not show the index, so the option matters only when something else staged files, which is exactly when IntelliJ users expect it. It is a box in the unstash dialog, off by default.",
    vsc("[Extension Development Host] repo", '<div class="ed-empty">' + dialog("Unstash", '<p><b>stash@{0}</b> · WIP on main: 6ab30ba docs: expand the README</p><div class="radio-row"><label><i class="rd on"></i> Pop (apply and drop)</label><label><i class="rd"></i> Apply (keep the stash)</label></div>' + chk("Reinstate index", True, "restore staged files as staged") + chk("Apply as a new branch") , buttons=(("Cancel", False), ("Unstash", True)), width=440) + '</div>', act=None, height=300))

add("Show the diff of a stash before applying it",
    "A stash entry expands to its files, and each file opens in the diff viewer against the stash's base, so you can see what you are about to pop. The same view IntelliJ gives from the Stash node.",
    vsc("[Extension Development Host] repo", '<div class="ed-empty"></div>', side=commitside(tab="Stash", buttons=False, msg="", tree="".join([crow(0, '<span class="cchev">⌄</span><span class="ts md">▤</span><span class="fn">stash@{0}</span><span class="cn">WIP on main · 2 files</span>'), crow(1, '<span class="ts">TS</span><span class="fn">pool.ts</span><span class="st">M</span>', "sel"), crow(1, '<span class="ts">TS</span><span class="fn">router.ts</span><span class="st">M</span>'), crow(0, '<span class="cchev">›</span><span class="ts md">▤</span><span class="fn">stash@{1}</span><span class="cn">On feature/sessions · 1 file</span>')]) ).replace('<div class="cmsg">', '<div class="cmsg" hidden>') + fw("pool.ts · stash@{0} ↔ 6ab30ba — repo", '<div class="dw"><div class="dw-heads"><span>🔒 <b>6ab30ba</b> src/db/pool.ts</span><span>🔒 <b>stash@{0}</b> src/db/pool.ts</span></div><div class="dw-panes"><div class="dw-pane">' + code(POOL_L[3:7], start=29) + '</div><div class="dw-pane">' + code(POOL_R[3:7], start=29) + '</div></div></div>', cls="abs").replace('class="fw abs"', 'class="fw abs" style="position:absolute;left:340px;top:40px;right:20px"'), side_w=320, height=340))

add("Move changes between shelves",
    "Move a file from one shelf to another, or into a new one, from the shelved file's context menu. Both patches are rewritten, and the XML entries with them, so IntelliJ sees the same result.",
    vsc("[Extension Development Host] repo", '<div class="ed-empty"></div>', side=commitside(tab="Shelf", buttons=False, msg="", tree="".join([crow(0, '<span class="cchev">⌄</span><span class="ts md">▤</span><span class="fn">wip: pagination cursor</span><span class="cn">3 files</span>'), crow(1, '<span class="ts">TS</span><span class="fn">pool.ts</span><span class="st">M</span>', "sel"), crow(1, '<span class="ts">TS</span><span class="fn">users.ts</span><span class="st">M</span>'), crow(0, '<span class="cchev">›</span><span class="ts md">▤</span><span class="fn">spike: rate limiter</span><span class="cn">1 file</span>')]) + ctxmenu([("Unshelve Selected…", {}), ("Show Diff", {"sc": "⌘D"}), "-", ("Move to Shelf", {"sel": True, "sub": True}), ("Delete from Shelf", {})], pos="position:absolute;left:120px;top:150px", width=200) + ctxmenu([("spike: rate limiter", {}), ("New Shelf…", {"sel": True})], pos="position:absolute;left:322px;top:196px", width=170)).replace('<div class="cmsg">', '<div class="cmsg" hidden>'), side_w=320, height=340))

add("Diff preview pane inside the Commit view",
    "Selecting a file in the Commit view shows its diff in the editor area without opening a window, the way IntelliJ's Commit tool window can. The pane is the real viewer with the working-tree side editable and the hunk checkboxes live, so ticking a hunk here is the same as ticking it in the window.",
    vsc("[Extension Development Host] repo", '<div class="dw"><div class="dw-heads"><span>🔒 <b>HEAD</b> src/handlers/router.ts</span><span>✎ <b>Working tree</b> src/handlers/router.ts <i class="tagp">editable</i></span></div><div class="dw-panes"><div class="dw-pane">' + code(POOL_L[3:8], start=12) + '</div><div class="dw-pane">' + code(POOL_R[3:8], start=12) + '</div></div><div class="hunkbar">' + cb("on") + ' Include this change <span class="dim">· 1 of 2 hunks ticked</span><span class="lnk">Revert</span></div></div>', side=commitside(), side_w=290, height=480))

add("Remote delete offers to remove tracking locals",
    "Deleting a remote branch asks about the local branches that track it, pre-ticked, so a finished feature disappears in one go. The local delete goes through the same unmerged check.",
    vsc("[Extension Development Host] repo", panel(tree_html=btree(DEFAULT_TREE, sel=12), overlay=dialog("Delete origin/feature/webhooks", "<p>The branch will be deleted on <b>origin</b>.</p><p class=\"small dim\">Local branches tracking it:</p>" + chk("feature/webhooks", True, "merged into main") + chk("spike/webhooks-v2", False, "2 unmerged commits"), buttons=(("Cancel", False), ("Delete", True)), pos="position:absolute;left:260px;top:50px", width=420), height=320), act=None, height=360))

add("Update a branch not checked out; worktree-aware fast-forward",
    "Update on a branch that is not checked out fast-forwards it in place, without switching. If another worktree has it checked out, the update happens there, and the notification says so. Anything that is not a fast-forward is refused with the reason.",
    vsc("[Extension Development Host] repo", panel(tree_html=btree(DEFAULT_TREE, sel=6), overlay=ctxmenu([("Checkout", {}), ("Update", {"sel": True}), ("Push…", {}), "-", ("Compare with Current", {})], pos="position:absolute;left:120px;top:150px", width=200) + toast("info", "<b>feature/sessions</b> fast-forwarded to origin/feature/sessions (2 commits). It is checked out in <code>../sessions-wt</code>, which was updated.", pos="right:14px;bottom:10px"), height=320), act=None, height=360))

add("Update Info tab: received commits, filterable",
    "After Update Project, a tab in the Porcelain panel lists what arrived: the commits, with the same graph rows and filters as the log, and the files they touched. The arrivals notification stays; the tab is where you read it properly.",
    vsc("[Extension Development Host] repo", panel(tabs=("PROBLEMS", "TERMINAL", "PORCELAIN", "UPDATE INFO"), tabs_active="UPDATE INFO", tb=toolbar(chips=("Update: 4 commits · 12 files",), search="Filter…"), log_html=lograw([dict(author="Radia Perlman", msg="chore: shut the pool down with the server", date="10 days ago", hash="04c6465", chips=[("remote", "origin/main")]), dict(author="Alan Turing", msg="fix: keep pagination stable across inserts", date="11 days ago", hash="72fd1fb"), dict(author="Grace Hopper", msg="feat: pagination for the user list", date="13 days ago", hash="ac2edb5"), dict(author="Ada Lovelace", msg="refactor: split the router table", date="14 days ago", hash="7697272")], sel=0), tree_html='<div class="bt"><div class="bt-row bt-head" style="--d:0"><span class="bt-l">Updated by rebase</span></div><div class="bt-row" style="--d:0"><span class="bt-l dim">2026-09-05 10:12</span></div><div class="bt-row" style="--d:0"><span class="bt-l dim">main ← origin/main</span></div></div>', details_html='<div class="pp-det-h">Files updated</div><div class="pp-file"><i>TS</i> src/db/pool.ts</div><div class="pp-file"><i>TS</i> src/db/users.ts</div><div class="pp-file"><i>TS</i> src/handlers/router.ts</div><div class="pp-file"><i class="md">M↓</i> README.md</div>', height=320), act=None, height=360))

add("Force-pushed upstream recovery",
    "When a fetch shows the upstream moved backwards, Porcelain names the commits of yours that are no longer on it and offers the two sane recoveries: rebase onto the new upstream, or cherry-pick your commits onto it. Stretch in the roadmap; still stretch.",
    vsc("[Extension Development Host] repo", panel(tree_html=btree([(0, "", "Current Branch: feature/sessions", "", "bt-head"), (0, "⌄", "Local"), (1, "🏷", "feature/sessions", '<span class="bt-cnt warn">⚠ ↓3 ↑2</span>', "sel"), (1, "⑂", "main")]), overlay=toast("warn", "<b>origin/feature/sessions</b> was force-pushed. 2 of your commits (4182e66, aac7e3b) are no longer on it.", ("Rebase onto new upstream", "Cherry-pick mine", "Ignore"), pos="right:14px;bottom:10px", width=420), height=320), act=None, height=360))

add("Push all up to here",
    "From a commit in the log: push the branch only as far as that commit. The push panel opens with the later commits greyed out of the preview, and pushes a <code>hash:branch</code> refspec. Handy for landing the reviewed half of a branch.",
    vsc("[Extension Development Host] repo", panel(log_html=lograw(DEFAULT_ROWS[:5], sel=2), overlay=ctxmenu([("Checkout Revision", {}), ("Push All up to Here…", {"sel": True}), "-", ("Interactively Rebase from Here…", {})], pos="position:absolute;left:330px;top:100px") + fw("Push — repo", '<div class="pushp"><div class="push-h">Push <b>main</b> → <b>origin/main</b> <span class="dim">up to 72fd1fb</span></div><div class="push-list">' + "".join('<div class="tw-r %s" style="grid-template-columns:80px 1fr 90px"><span class="mono">%s</span><span>%s</span><span>%s</span></div>' % (c, r["hash"], r["msg"], r["date"]) for c, r in [("dim2", DEFAULT_ROWS[0]), ("dim2", DEFAULT_ROWS[1]), ("", DEFAULT_ROWS[2]), ("", DEFAULT_ROWS[3])]) + '</div><div class="dlg-foot"><span class="dbtn">Cancel</span><span class="dbtn primary">Push 2 commits</span></div></div>', cls="abs").replace('class="fw abs"', 'class="fw abs" style="position:absolute;right:14px;top:36px;width:440px"'), height=330), act=None, height=370))

add("Show repository at a revision (tree browser)",
    "Browse the whole tree as it was at a commit, read-only, in the explorer. Every file opens through the <code>porcelain:</code> content scheme that already serves single files, so this is a tree over an existing door.",
    vsc("[Extension Development Host] repo", editor_tabs(["pool.ts @ ac2edb5"]) + code(POOL_L[:6]), side='<div class="side-head">Explorer</div><div class="bt"><div class="bt-row bt-head" style="--d:0"><span class="bt-l">Repository at ac2edb5 <i class="tagp">read-only</i></span></div>' + "".join('<div class="bt-row %s" style="--d:%d"><span class="bt-i">%s</span><span class="bt-l">%s</span></div>' % (c, d, i, l) for d, i, l, c in [(0, "⌄", "src", ""), (1, "⌄", "db", ""), (2, "TS", "pool.ts", "sel"), (2, "TS", "users.ts", ""), (1, "›", "handlers", ""), (0, "M↓", "README.md", ""), (0, "{}", "package.json", "")]) + '</div>', act=0, side_w=240, height=330))

add("Annotate at a chosen revision",
    "Blame the file as it was at any commit or tag, picked from the same ref picker as Go to. The gutter header names the revision, and Annotate Previous Revision walks back from there.",
    vsc("[Extension Development Host] repo", editor_tabs(["pool.ts"]) + blame([("Alan Turing", "2026-07-30", 4, KW("export") + " " + KW("class") + " " + TY("Pool") + " {"), ("Alan Turing", "2026-07-30", 4, "  " + KW("private") + " " + KW("readonly") + " free: " + TY("Client") + "[] = [];"), ("Grace Hopper", "2026-07-22", 4, "  " + FN("acquire") + "(): " + TY("Client") + " {")], header="Blame: <b>v0.2.0</b> · src/db/pool.ts <span class=\"lnk\">Change revision…</span>") + quickpick("Annotate at revision", [("v0.2.0", {"sel": True, "desc": "tag · 22 days ago"}), ("v0.1.0", {"desc": "tag"}), ("origin/main", {"desc": "remote branch"}), ("ac2edb5", {"desc": "feat: pagination for the user list"})], pos="position:absolute;left:200px;top:40px", width=380), act=None, height=330))

add("Blame column aspects: revision, date, author separately",
    "Blame Options gains three toggles for what the gutter shows: the short hash, the date, the author. IntelliJ users who keep only the revision get a narrow gutter; the hover card still carries everything.",
    vsc("[Extension Development Host] repo", editor_tabs(["pool.ts"]) + blame([("ac2edb5", "2026-08-20 GH", 2, KW("export") + " " + KW("class") + " " + TY("Pool") + " {"), ("ac2edb5", "2026-08-20 GH", 2, "  " + KW("private") + " " + KW("readonly") + " free: " + TY("Client") + "[] = [];"), ("7697272", "2026-08-11 RP", 3, "  " + FN("acquire") + "(): " + TY("Client") + " {")]) + quickpick("Annotation options", [("Show revision", {"chk": True}), ("Show date", {"chk": True}), ("Show author", {"chk": True, "sel": True}), ("Colour by: age", {"desc": "age · author · none"}), ("Names: initials", {"desc": "initials · full · email"}), ("Ignore whitespace", {"chk": False}), ("Follow moves across files", {"chk": True})], pos="position:absolute;left:200px;top:40px", width=380), act=None, height=340))

add("Aligned changes mode with filler lines",
    "A layout option that inserts filler rows so matching lines sit at the same height on both sides, the way IntelliJ's Align Changes does. The merge editor's shared axis already does this for three panes; this ports it to the two-pane diff.",
    diffwin("pool.ts · 2 of 3 · ac2edb5 ↔ 6ab30ba — repo", "ac2edb5", "6ab30ba", "src/db/pool.ts", left=[("", KW("export") + " " + KW("class") + " " + TY("Pool") + " {"), ("", "  " + KW("private") + " " + KW("readonly") + " free: " + TY("Client") + "[] = [];"), ("del", "  " + FN("close") + "(): " + TY("void") + " {"), ("del", "    " + FN("clearInterval") + "(" + KW("this") + ".sweeper);"), ("del", "  }"), ("fill", ""), ("", ""), ("", "  " + KW("private") + " " + FN("sweep") + "(): " + TY("void") + " {")], right=[("", KW("export") + " " + KW("class") + " " + TY("Pool") + " {"), ("", "  " + KW("private") + " " + KW("readonly") + " free: " + TY("Client") + "[] = [];"), ("add", "  " + KW("async") + " " + FN("drain") + "(): " + TY("Promise") + "&lt;" + TY("void") + "&gt; {"), ("add", "    " + FN("clearInterval") + "(" + KW("this") + ".sweeper);"), ("add", "    " + KW("await") + " Promise." + FN("all") + "(…);"), ("add", "  }"), ("", ""), ("", "  " + KW("private") + " " + FN("sweep") + "(): " + TY("void") + " {")], overlay=ctxmenu([("Side by side", {"chk": True}), ("Unified", {"unchk": True}), ("Align changes", {"chk": True, "sel": True})], pos="position:absolute;right:12px;top:34px", width=200), height=320))

add("Compare with clipboard",
    "Diff the current file, or the selection, against whatever is on the clipboard, in the reused diff window. Cheap, and the thing IntelliJ users reach for when a colleague pastes a snippet into chat.",
    vsc("[Extension Development Host] repo", editor_tabs(["pool.ts"]) + code(POOL_L[:5]) + ctxmenu([("Show File History", {}), ("Annotate with Git Blame", {}), ("Compare with Clipboard", {"sel": True}), "-", ("(Porcelain) Edit Source", {"dis": True})], pos="position:absolute;left:220px;top:60px", width=250) + fw("pool.ts · clipboard ↔ working tree — repo", '<div class="dw"><div class="dw-heads"><span>🔒 <b>Clipboard</b> 9 lines</span><span>✎ <b>Working tree</b> src/db/pool.ts</span></div><div class="dw-panes"><div class="dw-pane">' + code(POOL_L[3:7], start=1) + '</div><div class="dw-pane">' + code(POOL_R[3:7], start=29) + '</div></div></div>', cls="abs").replace('class="fw abs"', 'class="fw abs" style="position:absolute;right:16px;bottom:12px;width:540px"'), act=None, height=340))

add("Press again to step to the next file",
    "On the last change in a file, the next-change action shows a hint instead of doing nothing: press it again to move to the next file. The file steppers stay; this is the IntelliJ habit of holding one key through a whole review.",
    diffwin("pool.ts · 2 of 3 · ac2edb5 ↔ 6ab30ba — repo", "ac2edb5", "6ab30ba", "src/db/pool.ts", overlay='<div class="hint-pill">Last change in this file. Press <kbd>↓</kbd> again for <b>users.ts</b> (3 of 3)</div>', height=320))

add("Merge finish escape hatch: save with unresolved regions",
    "Apply is gated on every conflict being resolved, which is stricter than IntelliJ. This adds the way out: save what you have and mark the file resolved anyway, after a dialog that counts what is left. Cancel keeps offering to restore the original.",
    mergewin("Merge: pool.ts — repo", counter="2 conflicts · 0 resolved", overlay=dialog("Apply with Unresolved Conflicts", "<p><b>2 changes left unprocessed.</b> Save the result as it is and mark <code>pool.ts</code> resolved anyway?</p><p class=\"small dim\">The conflict markers are not in the result; the unprocessed regions keep the base text.</p>", buttons=(("Keep Editing", False), ("Save Anyway", True)), pos="position:absolute;left:50%;top:80px;transform:translateX(-50%)", width=440), height=360))

add("Structure filter: pick paths in a tree dialog",
    "The Paths filter takes free text today. IntelliJ's structure filter is a tree of the repository with checkboxes, plus recent selections. Ticking a folder narrows the log to it; the free-text field stays for pathspecs the tree cannot express.",
    vsc("[Extension Development Host] repo", panel(tb=toolbar(chips=("Paths: src/db, README.md",)), overlay='<div class="qp" style="position:absolute;left:300px;top:56px;width:380px"><div class="qp-in">src/handlers/*.test.ts<span class="caret"></span></div><div class="qp-title">Repository</div>' + "".join('<div class="qp-item" style="padding-left:%dpx"><span class="qp-chk %s"></span><span class="qp-l">%s %s</span></div>' % (10 + d * 14, c, i, l) for d, c, i, l in [(0, "on", "⌄ 📁", "src"), (1, "on", "📁", "db"), (1, "", "📁", "handlers"), (0, "on", "M↓", "README.md"), (0, "", "{}", "package.json")]) + '<div class="qp-title">Recent</div><div class="qp-item"><span class="qp-chk"></span><span class="qp-l">src/db/pool.ts</span></div></div>', height=320), act=None, height=360))

add("Show changes from a chosen parent of a merge",
    "A merge commit's changed files depend on which parent you compare against. The details pane gets a parent picker for merges: first parent by default, the way git shows it, and the second parent one click away.",
    vsc("[Extension Development Host] repo", panel(log_html=lograw([DEFAULT_ROWS[0], dict(author="Radia Perlman", msg="Merge branch 'fix/session-expiry'", date="19 days ago", hash="814f249", lane="#3a8ee6"), dict(author="Alan Turing", msg="fix: expire sessions on the server clock", lane="#c75450", chips=[("local", "fix/session-expiry")], date="19 days ago", hash="4182e66")], sel=1), details_html='<div class="pp-det-h">Changed files <span class="pp-det-tg">vs <b class="on">first parent aac7e3b</b> · <b>4182e66</b></span></div><div class="pp-file"><i>TS</i> src/handlers/sessions.ts</div><div class="pp-file"><i>TS</i> src/db/sessions.ts</div>' + '<div class="pp-det-c"><b>Merge branch \'fix/session-expiry\'</b><div class="pp-det-meta">814f249 Radia Perlman on 2026-08-14</div></div>', det_w=300, height=300), act=None, height=340))

add("Signature column in the log: verified, bad, expired",
    "A column for commit signatures, read from <code>%G?</code> in the same log format: verified, bad, expired key, unknown key, unsigned. The hover names the key and the signer. Off by default, like IntelliJ's.",
    vsc("[Extension Development Host] repo", panel(log_html=lograw([dict(DEFAULT_ROWS[0], x='<span class="sig ok">✓</span>'), dict(DEFAULT_ROWS[1], x='<span class="sig ok">✓</span>'), dict(DEFAULT_ROWS[2], x='<span class="sig bad">✗</span>'), dict(DEFAULT_ROWS[3], x='<span class="sig exp">⚠</span>'), dict(DEFAULT_ROWS[4], x="")], sel=0, cols=("Author", "Message", "Sig", "Date", "Hash"), extra_col=("110px 24px minmax(0,1fr) 34px 84px 64px",)), overlay='<div class="tip2" style="left:520px;top:120px">Bad signature<br><span class="dim">Key 3AA5C34371567BD2 · alan@example.com</span></div>', height=300), act=None, height=340))

add("Apply patch with base mapping; reverse patch",
    "Apply Patch as its own dialog: the files in the patch, each mapped to where it now lives in the tree when the path moved, a reverse option, and a preview of what will not apply cleanly before anything is written. Import as shelf stays for the IntelliJ round trip.",
    vsc("[Extension Development Host] repo", '<div class="ed-empty">' + dialog("Apply Patch: pagination.patch", tw(("File in patch", "Apply to", "Status"), [("src/pool.ts", "src/db/pool.ts <span class=\"dim\">(moved)</span>", '<span class="green">applies</span>'), ("src/db/users.ts", "src/db/users.ts", '<span class="green">applies</span>'), ("README.md", "README.md", '<span class="red">2 hunks fail</span>')], widths="1fr 1fr 110px") + '<div style="margin-top:8px">' + chk("Reverse patch") + chk("Apply as a shelf instead") + '</div>', buttons=(("Cancel", False), ("Apply", True)), width=560) + '</div>', act=None, height=340))

add("Unshallow notice on shallow clones",
    "A shallow clone stops blame and history at its depth without saying so. Porcelain notices the <code>shallow</code> file, says where history ends, and offers the fetch that deepens it. Clone itself stays VS Code's.",
    vsc("[Extension Development Host] repo", panel(height=300, overlay=toast("warn", "This repository is a shallow clone (depth 50). Blame and history stop at 2026-07-01.", ("Unshallow", "Don't show again"), pos="right:14px;bottom:10px")), act=None, height=340))

add("Settings UI for every warning and confirmation",
    "The rest of IntelliJ's VCS settings page, as <code>porcelain.*</code> contributions: the warnings and confirmations that the Confirmation trio does not cover, each with the same Don't ask again round trip.",
    vsc("[Extension Development Host] repo", settings([
        ("Porcelain › Warn: Detached Head", "Warn before committing on a detached HEAD.", chk("", True)),
        ("Porcelain › Warn: Large Files", "Warn when a file over this many MB is ticked for commit.", inp("10", w="80px")),
        ("Porcelain › Warn: CRLF", "Warn when ticked files use CRLF and the repository is set to LF.", select("Ask", w="120px")),
        ("Porcelain › Confirm: Move to Another Branch", "Ask before smart checkout carries changes across.", chk("", True)),
        ("Porcelain › Update: Show Update Info", "Open the Update Info tab after Update Project.", chk("", True)),
    ]), act=None, height=420))

add("Multi-root sync mode: branch operations across every root",
    "IntelliJ's Control repositories synchronously: one checkout, branch or update applied to every root at once, with a per-repository status and a rollback of the ones that succeeded when one fails. Porcelain's per-repository model is coherent, which is why this is deferred until someone needs it.",
    vsc("[Extension Development Host] repo", '<div class="ed-empty">' + dialog("Checkout feature/sessions in 3 repositories", tw(("Repository", "Status"), [("repo", '<span class="green">✓ switched</span>'), ("docs", '<span class="green">✓ switched</span>'), ("tools/cli", '<span class="red">✗ local changes would be overwritten</span>')], widths="1fr 1fr") + '<p class="small dim" style="margin-top:8px">One repository failed. Roll back the two that switched, or leave them on feature/sessions.</p>', buttons=(("Leave as is", False), ("Roll back all", True)), width=520) + '</div>', act=None, height=330))

MOCK_CSS = r"""
  .fw { border-radius: 10px; overflow: hidden; border: 1px solid #333; background: #1f1f1f; box-shadow: 0 20px 50px rgba(0,0,0,.5); font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #ccc; width: 100%; }
  .fw-title { height: 30px; background: #181818; border-bottom: 1px solid #2b2b2b; display: flex; align-items: center; justify-content: center; position: relative; font-size: 12px; color: #9d9d9d; }
  .fw-title .tl { position: absolute; left: 12px; top: 9px; display: flex; gap: 7px; }
  .fw-title .tl i { width: 12px; height: 12px; border-radius: 50%; }
  .fw-title .tl i:nth-child(1) { background: #ff5f57; } .fw-title .tl i:nth-child(2) { background: #febc2e; } .fw-title .tl i:nth-child(3) { background: #28c840; }
  .fw-t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%; }
  .fw-signin { margin-left: 8px; background: #3574f0; color: #fff; border-radius: 4px; padding: 1px 7px; font-size: 11px; }
  .fw-body { position: relative; height: calc(100% - 30px); overflow: hidden; }
  .fw.abs { position: absolute; z-index: 3; }
  .vsc-ed { overflow: hidden; }
  .pd-mock .vsc { min-width: 0; }
  /* Porcelain panel */
  .pp { display: flex; flex-direction: column; background: #181818; border-top: 1px solid #2b2b2b; margin-top: auto; position: relative; overflow: hidden; height: 100%; }
  .pp-tabs { display: flex; gap: 18px; padding: 8px 14px 6px; font-size: 11px; letter-spacing: .04em; color: #9d9d9d; border-bottom: 1px solid #2b2b2b; }
  .pp-tabs .on { color: #fff; box-shadow: 0 6px 0 -5px #fff; }
  .pp-tabs-r { margin-left: auto; letter-spacing: .2em; }
  .pp-body { display: grid; flex: 1; min-height: 0; }
  .pp-tree { border-right: 1px solid #2b2b2b; overflow: hidden; }
  .pp-tree-tb { padding: 6px 8px; }
  .pp-log { display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
  .pp-det { border-left: 1px solid #2b2b2b; padding: 8px 10px; font-size: 11.5px; overflow: hidden; }
  .pp-det-h { font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; color: #ccc; margin-bottom: 6px; display: flex; gap: 8px; align-items: center; }
  .pp-det-tg { margin-left: auto; color: #9d9d9d; } .pp-det-tg b { font-weight: 400; padding: 0 4px; border-radius: 3px; } .pp-det-tg b.on { background: #2e436e; color: #fff; }
  .pp-file { color: #4a90d9; padding: 2px 0 2px 8px; white-space: nowrap; } .pp-file.sel { background: #04395e; color: #fff; border-radius: 3px; }
  .pp-file i { font: 700 9px var(--mono); color: #4a90d9; margin-right: 4px; font-style: normal; } .pp-file i.md { color: #6a8bd0; }
  .pp-det-c { border-top: 1px solid #2b2b2b; margin-top: 8px; padding-top: 8px; }
  .pp-det-meta { color: #9d9d9d; margin: 3px 0; } .pp-det-meta a { color: #4a90d9; }
  .pp-det-chips { margin-top: 4px; }
  .pp-tb { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid #2b2b2b; white-space: nowrap; overflow: hidden; }
  .pp-search { display: inline-flex; align-items: center; gap: 5px; background: #313131; border: 1px solid #3c3c3c; border-radius: 4px; padding: 2px 8px; color: #9d9d9d; font-size: 11.5px; }
  .pp-search i { font-style: normal; } .pp-search b { font-weight: 400; font-size: 10px; background: #3c3c3c; border-radius: 3px; padding: 0 3px; color: #ccc; }
  .pp-search.small { width: 100%; }
  .pp-chip { color: #4a90d9; font-size: 11.5px; } .pp-chip b { font-weight: 400; color: #9d9d9d; margin-left: 2px; }
  .pp-dd { color: #ccc; font-size: 11.5px; } .pp-dd.on { color: #fff; }
  .pp-ic { color: #9d9d9d; margin-left: auto; } .pp-ic + .pp-ic { margin-left: 0; }
  .pp-cols, .pp-row { display: grid; grid-template-columns: 110px 24px minmax(0,1fr) 84px 64px; align-items: center; gap: 0 6px; padding: 0 8px; height: 26px; font-size: 12px; white-space: nowrap; }
  .pp-cols { color: #9d9d9d; font-size: 11px; height: 22px; border-bottom: 1px solid #2b2b2b; }
  .pp-cols span:nth-child(2) { grid-column: 2 / 4; }
  .pp-row.sel { background: #2e436e; color: #fff; outline: 1px solid #3574f0; outline-offset: -1px; }
  .pp-row.hl .pp-m { color: #fff; font-weight: 600; }
  .pp-row.dim2, .tw-r.dim2 { opacity: .45; }
  .pp-a, .pp-m, .pp-d, .pp-h { overflow: hidden; text-overflow: ellipsis; }
  .pp-h { font-family: var(--mono); font-size: 11px; color: #9d9d9d; } .pp-row.sel .pp-h { color: #ddd; }
  .pp-d { color: #9d9d9d; } .pp-row.sel .pp-d { color: #ddd; }
  .pp-g { position: relative; height: 26px; } .pp-g::before { content: ""; position: absolute; left: 11px; top: 0; bottom: 0; width: 2px; background: var(--lc); display: var(--lt, block); }
  .pp-g i { position: absolute; left: 8px; top: 9px; width: 8px; height: 8px; border-radius: 50%; background: var(--lc); }
  .pp-x { text-align: center; }
  .rc { display: inline-block; font-size: 10.5px; border-radius: 3px; padding: 0 5px; margin-left: 6px; border: 1px solid transparent; vertical-align: 1px; }
  .rc.head { color: #f2a9a6; border-color: rgba(199,84,80,.5); } .rc.local { color: #a6dfa9; border-color: rgba(95,173,101,.5); } .rc.tag { color: #f0d9a0; border-color: rgba(229,192,123,.5); } .rc.remote { color: #d8bff0; border-color: rgba(176,124,216,.5); }
  .bt { padding: 2px 0; font-size: 12px; }
  .bt-row { display: flex; align-items: center; gap: 6px; height: 23px; padding-left: calc(10px + var(--d) * 14px); padding-right: 8px; white-space: nowrap; overflow: hidden; }
  .bt-row.sel { background: #2e436e; color: #fff; } .bt-row.bt-head { font-weight: 600; }
  .bt-i { width: 14px; color: #9d9d9d; font-size: 11px; text-align: center; flex: none; font-family: var(--mono); }
  .bt-cnt { margin-left: auto; color: #9d9d9d; font-size: 11px; } .bt-cnt.warn { color: #e5c07b; }
  .tip2 { position: absolute; z-index: 4; background: #252526; border: 1px solid #454545; border-radius: 4px; padding: 6px 9px; font-size: 11.5px; color: #e6e6e6; box-shadow: 0 6px 20px rgba(0,0,0,.5); white-space: nowrap; }
  .tip2 .dim { color: #9d9d9d; }
  /* commit extras */
  .cbanner { display: flex; align-items: center; gap: 8px; margin: 0 10px 6px; padding: 7px 10px; background: rgba(53,116,240,.16); border: 1px solid rgba(53,116,240,.4); border-radius: 6px; font-size: 11.5px; flex-wrap: wrap; }
  .cbanner.ok { background: rgba(95,173,101,.14); border-color: rgba(95,173,101,.45); }
  .cbanner b { font-weight: 400; color: #ccc; border: 1px solid #4e5157; border-radius: 4px; padding: 1px 8px; } .cbanner b.p { background: #3574f0; border-color: #3574f0; color: #fff; }
  .crow b.grp { color: #f2a9a6; }
  .st.ok { color: #6fb37a; } .fn.dimf { color: #8a8a8a; }
  .lnk { margin-left: auto; color: #4a90d9; font-size: 11px; }
  .copt-panel { position: relative; padding: 8px 0 4px; }
  .sign-status { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #ccc; padding: 6px 0 2px; } .sign-status .ok { color: #6fb37a; margin-left: auto; }
  .hunkbar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-top: 1px solid #2b2b2b; font-size: 11.5px; }
  /* code + diff */
  .codeblk { font: 11.5px/19px var(--mono); color: #bcbec4; }
  .cl { display: flex; height: 19px; white-space: pre; overflow: hidden; }
  .cn2 { width: 34px; flex: none; text-align: right; padding-right: 10px; color: #5c5c5c; }
  .cl.add { background: rgba(78,201,160,.16); } .cl.del { background: rgba(199,84,80,.18); } .cl.conf { background: rgba(199,84,80,.2); box-shadow: inset 0 0 0 1px rgba(199,84,80,.35); }
  .cl.fill { background: repeating-linear-gradient(135deg, rgba(255,255,255,.05) 0 3px, transparent 3px 8px); }
  .cl.selx { background: #264f78; }
  .kw { color: #cf8e6d; } .str { color: #6aab73; } .fn2 { color: #56a8f5; } .ty { color: #c77dbb; } .cm2 { color: #7a7e85; }
  .dw { display: flex; flex-direction: column; height: 100%; position: relative; background: #1f1f1f; }
  .dw.mini { border: 1px solid #2b2b2b; border-radius: 4px; margin-top: 6px; height: auto; }
  .dw-tb { display: flex; align-items: center; gap: 12px; padding: 6px 12px; border-bottom: 1px solid #2b2b2b; color: #ccc; font-size: 12px; }
  .dw-tb .on { background: #37373d; border-radius: 4px; padding: 0 4px; } .dw-cnt { margin-left: auto; color: #9d9d9d; }
  .dw-btn { border: 1px solid #4e5157; border-radius: 4px; padding: 1px 8px; } .dw-btn.p { background: #3574f0; border-color: #3574f0; color: #fff; }
  .dw-lang { color: #9d9d9d; font-size: 11px; }
  .dw-heads { display: grid; grid-template-columns: 1fr 1fr; font-size: 11.5px; border-bottom: 1px solid #2b2b2b; }
  .dw-heads.three { grid-template-columns: 1fr 1fr 1fr; }
  .dw-heads span { padding: 5px 10px; border-right: 1px solid #2b2b2b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .dw-heads span:last-child { border-right: 0; }
  .tagp { font: 700 9px/1 var(--mono); color: #ccc; background: #3c3c3c; border-radius: 2px; padding: 2px 4px; margin-left: 6px; font-style: normal; }
  .dw-panes { display: grid; grid-template-columns: 1fr 1fr; flex: 1; min-height: 0; overflow: hidden; }
  .dw-panes.three { grid-template-columns: 1fr 28px 1fr 28px 1fr; }
  .dw-pane { overflow: hidden; border-right: 1px solid #2b2b2b; } .dw-pane:last-child { border-right: 0; }
  .dw-gut { display: flex; flex-direction: column; align-items: center; gap: 2px; padding-top: 60px; font-size: 10px; color: #ccc; background: #1a1a1a; border-right: 1px solid #2b2b2b; }
  .dw-gut span { border: 1px solid #555; border-radius: 3px; width: 16px; text-align: center; line-height: 14px; background: #2b2b2b; }
  .hint-pill { position: absolute; left: 50%; top: 40px; transform: translateX(-50%); background: #252526; border: 1px solid #454545; border-radius: 999px; padding: 4px 12px; font-size: 11.5px; box-shadow: 0 6px 20px rgba(0,0,0,.5); white-space: nowrap; }
  .hint-pill kbd { font-size: 10px; padding: 0 4px; }
  /* menus etc */
  .cm { position: absolute; z-index: 5; background: #252526; border: 1px solid #454545; border-radius: 6px; box-shadow: 0 4px 16px rgba(0,0,0,.4); padding: 4px 0; font-size: 12px; color: #ccc; }
  .cm-item { display: flex; align-items: center; gap: 4px; padding: 4px 10px 4px 6px; white-space: nowrap; }
  .cm-item.sel { background: #04395e; color: #fff; } .cm-item.dis { color: #6b6b6b; }
  .cm-ic { width: 18px; flex: none; text-align: center; font-size: 11px; }
  .cm-item.chk .cm-ic::before { content: "✓"; } .cm-item.unchk .cm-ic::before { content: ""; }
  .cm-sc { margin-left: auto; color: #9d9d9d; font-size: 11px; padding-left: 14px; } .cm-item.sel .cm-sc { color: #ddd; }
  .cm-sub { margin-left: auto; color: #9d9d9d; } .cm-sep { border-top: 1px solid #454545; margin: 4px 8px; }
  .qp { position: absolute; z-index: 5; background: #252526; border: 1px solid #454545; border-radius: 6px; box-shadow: 0 6px 24px rgba(0,0,0,.5); padding: 6px; font-size: 12px; color: #ccc; }
  .qp-in { background: #313131; border: 1px solid #3574f0; border-radius: 3px; padding: 3px 8px; margin-bottom: 4px; color: #fff; min-height: 22px; }
  .qp-ph { color: #9d9d9d; } .qp-title { font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; color: #9d9d9d; padding: 6px 8px 2px; }
  .qp-item { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 3px; white-space: nowrap; overflow: hidden; }
  .qp-item.sel { background: #04395e; color: #fff; }
  .qp-l b { color: #4a90d9; font-weight: 600; } .qp-item.sel .qp-l b { color: #9fc4f2; }
  .qp-desc { color: #9d9d9d; font-size: 11px; } .qp-det { margin-left: auto; color: #9d9d9d; font-size: 11px; }
  .qp-chk { width: 13px; height: 13px; border: 1px solid #6b6b6b; border-radius: 3px; flex: none; position: relative; }
  .qp-chk.on { background: #3574f0; border-color: #3574f0; } .qp-chk.on::after { content: ""; position: absolute; left: 4px; top: 1px; width: 3px; height: 7px; border-right: 2px solid #fff; border-bottom: 2px solid #fff; transform: rotate(45deg); }
  .qp-foot { display: flex; align-items: center; justify-content: space-between; background: #252526; border: 1px solid #454545; border-top: 0; border-radius: 0 0 6px 6px; padding: 6px 10px; font-size: 12px; z-index: 5; }
  .toast { position: absolute; z-index: 5; background: #252526; border: 1px solid #454545; border-radius: 4px; box-shadow: 0 6px 24px rgba(0,0,0,.5); padding: 10px 12px; font-size: 12px; color: #ccc; }
  .toast-h { display: flex; gap: 8px; align-items: flex-start; } .toast-h i { font-style: normal; flex: none; } .toast-h i.info { color: #3574f0; } .toast-h i.warn { color: #e5c07b; } .toast-h i.err { color: #f26d78; }
  .toast-h b { margin-left: auto; color: #9d9d9d; font-weight: 400; }
  .toast-src { color: #9d9d9d; font-size: 11px; margin: 6px 0 0 22px; }
  .toast-b { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; } .toast-b span { border: 1px solid #4e5157; border-radius: 3px; padding: 2px 10px; } .toast-b span.p { background: #3574f0; border-color: #3574f0; color: #fff; }
  .dlg2 { position: relative; z-index: 4; background: #2b2d30; border: 1px solid #43454a; border-radius: 10px; box-shadow: 0 24px 60px rgba(0,0,0,.6); padding: 14px 16px 12px; color: #dfe1e5; font-size: 12px; max-width: 100%; }
  .dlg-body p { margin: 0 0 8px; }
  .dlg-opts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 8px 0; }
  .opt-card { border: 1px solid #43454a; border-radius: 6px; padding: 8px 10px; } .opt-card.sel { border-color: #3574f0; background: rgba(53,116,240,.12); }
  .opt-card b { display: block; margin-bottom: 2px; } .opt-card span { color: #9da0a8; font-size: 11.5px; }
  .dlg-links { display: flex; gap: 14px; color: #4a90d9; font-size: 11.5px; margin-top: 8px; }
  .dbtn.small { padding: 2px 8px; font-size: 11px; margin-left: auto; flex: none; }
  .fld { display: grid; grid-template-columns: 110px minmax(0,1fr); gap: 8px; align-items: start; margin: 6px 0; font-size: 12px; }
  .fld label { color: #9da0a8; padding-top: 3px; } .fld-note { color: #9da0a8; font-size: 11px; margin-top: 2px; }
  .in { display: inline-flex; align-items: center; justify-content: space-between; background: #1e1f22; border: 1px solid #43454a; border-radius: 4px; padding: 3px 8px; color: #dfe1e5; min-height: 24px; box-sizing: border-box; white-space: nowrap; overflow: hidden; }
  .in i { color: #7d7d7d; font-style: normal; } .in b { color: #9da0a8; font-weight: 400; margin-left: 6px; }
  .chkl { display: flex; align-items: center; gap: 7px; margin: 4px 0; font-size: 12px; } .chk-note { color: #9da0a8; font-size: 11px; }
  .radio-row { display: flex; gap: 16px; margin: 4px 0; } .radio-row label { display: inline-flex; align-items: center; gap: 6px; }
  .rd { width: 13px; height: 13px; border-radius: 50%; border: 1px solid #6b6b6b; display: inline-block; position: relative; } .rd.on { border-color: #3574f0; } .rd.on::after { content: ""; position: absolute; inset: 3px; border-radius: 50%; background: #3574f0; }
  .chkrow { display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; border: 1px solid #43454a; border-radius: 6px; margin-bottom: 6px; }
  .chkrow i { font-style: normal; flex: none; } .chkrow.warn i { color: #e5c07b; } .chkrow.err i { color: #f26d78; }
  .chkrow > div { flex: 1; min-width: 0; } .chkrow b { display: block; } .chkrow span { color: #9da0a8; font-size: 11.5px; }
  .setp { padding: 10px 16px; font-size: 12px; color: #ccc; }
  .setp-h { margin-bottom: 8px; } .setp-h .pp-search { width: 100%; }
  .set-row { padding: 10px 0; border-bottom: 1px solid #2b2b2b; }
  .set-t { color: #e6e6e6; margin-bottom: 3px; } .set-t b { font-weight: 600; }
  .set-d { color: #9d9d9d; margin-bottom: 6px; } .set-d code { font-size: 11px; }
  .set-c .chkl { margin: 0; }
  .tw { border: 1px solid #2b2b2b; border-radius: 4px; overflow: hidden; font-size: 12px; }
  .tw-h, .tw-r { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; padding: 5px 10px; align-items: center; white-space: nowrap; }
  .tw-h { color: #9d9d9d; font-size: 11px; background: #232323; } .tw-r { border-top: 1px solid #2b2b2b; } .tw-r.sel { background: #2e436e; color: #fff; }
  .tw-r span { overflow: hidden; text-overflow: ellipsis; } .mono { font-family: var(--mono); font-size: 11px; }
  .red { color: #f2a9a6; } .green { color: #6fb37a; }
  .bl { font: 11.5px/20px var(--mono); color: #bcbec4; }
  .bl-h { font: 11.5px/1.4 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; padding: 5px 10px; border-bottom: 1px solid #2b2b2b; color: #ccc; display: flex; gap: 10px; }
  .bl-row { display: flex; height: 20px; white-space: pre; } .bl-row.sel { background: #264f78; }
  .bl-g { width: 190px; flex: none; padding: 0 10px; border-right: 1px solid #2b2b2b; font-size: 10.5px; color: #ccc; } .bl-g i { font-style: normal; color: #9d9d9d; }
  .bl-g.age1 { background: rgba(53,116,240,.28); } .bl-g.age2 { background: rgba(53,116,240,.18); } .bl-g.age3 { background: rgba(53,116,240,.10); } .bl-g.age4 { background: rgba(53,116,240,.04); }
  .bl-row .ct { padding-left: 10px; }
  .term { font: 11.5px/20px var(--mono); padding: 8px 12px; color: #ccc; background: #181818; border-bottom: 1px solid #2b2b2b; }
  .chg { padding: 8px 10px; font-size: 12px; } .chg-h { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; } .chg-h .dim { margin-left: auto; }
  .cw { padding: 10px 12px; font-size: 12px; height: 100%; display: flex; flex-direction: column; }
  .cw-h { display: flex; gap: 12px; align-items: baseline; margin-bottom: 8px; flex-wrap: wrap; } .cw-h b { font-size: 14px; }
  .cw-btns { display: flex; gap: 8px; justify-content: flex-end; margin-top: auto; padding-top: 10px; }
  .pushp { padding: 10px 14px; font-size: 12px; display: flex; flex-direction: column; height: 100%; }
  .push-h { font-size: 13px; margin-bottom: 8px; }
  .push-inline { display: grid; grid-template-columns: 200px 1fr; gap: 12px; border: 1px solid rgba(229,192,123,.4); background: rgba(229,192,123,.06); border-radius: 6px; padding: 6px 10px; margin-bottom: 8px; }
  .push-inline .fld { grid-template-columns: 60px 1fr; }
  .push-list { border: 1px solid #2b2b2b; border-radius: 4px; overflow: hidden; }
  .push-opts { display: flex; gap: 18px; margin: 8px 0; } .push-opts .chkl { margin: 0; }
  .sig { font-weight: 700; } .sig.ok { color: #6fb37a; } .sig.bad { color: #f26d78; } .sig.exp { color: #e5c07b; }
  .ed-empty { flex: 1; display: grid; place-items: center; padding: 20px; }
  .dlg-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
  .dbtn { display: inline-block; padding: 4px 12px; border-radius: 6px; border: 1px solid #4e5157; font-size: 12px; color: #dfe1e5; white-space: nowrap; }
  .dbtn.primary { background: #3574f0; border-color: #3574f0; color: #fff; }
  .dlg-title { font-weight: 600; font-size: 13px; margin-bottom: 2px; }
  .dlg-sub { font-size: 12px; color: #9da0a8; margin-bottom: 8px; }
"""
