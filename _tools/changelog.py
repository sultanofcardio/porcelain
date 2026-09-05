# Render CHANGELOG.md (never hand-edited) into the site's changelog page.
import html
import os
import re
from datetime import date

SRC = os.environ.get("CHANGELOG", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "idea-git", "CHANGELOG.md"))
REPO = "https://github.com/sultanofcardio/porcelain"
TAGS = {"v0.8.0", "v0.9.0"}  # tags that exist on GitHub
CJK = re.compile(r"[　-鿿＀-￯]")
e = html.escape

# 0.9.0 bullets that have a real screenshot on the site, by title prefix
SHOTS = {
    "Search modes on the log filter": ("log-branch-filter", "The log toolbar: search with the Cc and .* toggles, and the multi-select Branch filter."),
    "Go to hash / branch / tag": ("log-goto", "Go to, filtering tags as you type."),
    "Graph modes": ("log-view-options", "View Options: graph modes, highlighters and presentation toggles."),
    "Multi-branch filter": ("log-branch-filter", "The Branch filter stays open while you tick branches."),
    "Worktrees": ("worktrees", "Worktrees…: the list, then New worktree… and Prune stale records."),
    "Git Operations popup": ("git-operations", "The Git Operations popup."),
    "Diff ignore policies": ("diff-settings-window", "The diff settings menu, with the four whitespace policies."),
    "Blame": ("blame", "Annotate with Git Blame: initials and date per line, shaded by age, and the hover card."),
    "Push options and sync counts": ("push-panel", "The push panel, with the options under the Push dropdown."),
    "Per-hunk staging": ("diff-working-tree-window", "A working-tree diff from the Commit view: the gutter checkbox is the hunk's inclusion."),
    "Stash options and .gitignore": ("stash-tab", "The Stash tab."),
    "Interactive rebase editor": ("interactive-rebase", "Rebasing Commits."),
    "Manage Remotes": ("manage-remotes", "Manage Remotes."),
    "Clean Up Branches": ("cleanup-branches", "Clean Up Branches, merged branches pre-selected."),
    "Porcelain diff viewer": ("floating-diff-windows-transparent", "The diff viewer in its own window, beside the Changes window."),
    "Unified view": ("diff-unified-window", "The unified layout."),
    "3-way merge editor rebuilt on the diff stack": ("merge-conflicts-3-way-resolution", "Yours, Result, Theirs, with the verbs on the gutter connectors."),
    "Compare Versions": ("compare-versions", "Compare Versions with two commits selected."),
    "Floating diff windows": ("floating-diff-windows-transparent", "The Changes window and the diff window, detached."),
}

def english(text):
    """Bilingual entries carry ' / 中文' after the English; keep the English half."""
    if CJK.search(text):
        parts = re.split(r"\s/\s", text)
        eng = [p for p in parts if not CJK.search(p)]
        return " / ".join(eng) if eng else text
    return text

def inline(md):
    s = e(md)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r'<a href="\2">\1</a>', s)
    return s

def bullet(md):
    md = english(md.strip())
    m = re.match(r"\*\*(.+?)\*\*\s*(?:—|–|-|:)\s*(.*)", md, re.S)
    if m:
        title, body = m.group(1), m.group(2)
        return '<strong>%s.</strong> %s' % (inline(title), inline(body)), title
    return inline(md), None

def parse():
    releases = []
    cur = None
    kind = None
    for raw in open(SRC, encoding="utf-8"):
        line = raw.rstrip("\n")
        m = re.match(r"## \[([^\]]+)\]\s*-\s*(.*)", line)
        if m:
            cur = {"version": m.group(1), "date": m.group(2).strip(), "kinds": [], "intro": []}
            releases.append(cur); kind = None; continue
        if cur is None: continue
        m = re.match(r"### (.+)", line)
        if m:
            kind = {"name": english(m.group(1)).strip(), "items": []}
            cur["kinds"].append(kind); continue
        m = re.match(r"^\s{2,}[-*] (.*)", line)
        if m and kind is not None and kind["items"]:
            kind["items"][-1]["subs"].append(m.group(1)); continue
        m = re.match(r"^[-*] (.*)", line)
        if m:
            if kind is None:
                kind = {"name": "Notes", "items": []}; cur["kinds"].append(kind)
            kind["items"].append({"text": m.group(1), "subs": []}); continue
        if line.strip() and kind is not None and kind["items"] and (line.startswith("  ") or line.startswith("\t")):
            if CJK.search(line): continue  # a translated continuation line
            kind["items"][-1]["text"] += " " + line.strip(); continue
        if line.strip() and kind is None:
            cur["intro"].append(line.strip())
    return releases

def nice_date(d):
    try:
        y, mo, da = (int(x) for x in d.split("-"))
        return date(y, mo, da).strftime("%-d %B %Y")
    except Exception:
        return d

def render():
    rels = parse()
    latest = rels[0]
    out = []
    out.append('<div class="cl-links"><span class="cl-now">Current <b>%s</b> · %s</span>'
               '<a href="https://marketplace.visualstudio.com/items?itemName=sultanofcardio.porcelain">Marketplace<span>↗</span></a>'
               '<a href="%s/releases">Releases and .vsix downloads<span>↗</span></a>'
               '<a href="%s/blob/main/CHANGELOG.md">CHANGELOG.md on main<span>↗</span></a></div>' % (e(latest["version"]), e(nice_date(latest["date"])), REPO, REPO))

    def release_html(r, i, latest_flag):
        v = r["version"]; tag = "v" + v
        ver = '<a class="cl-ver" href="%s/releases/tag/%s">%s</a>' % (REPO, tag, e(v)) if tag in TAGS else '<span class="cl-ver">%s</span>' % e(v)
        badges = ('<span class="badge gold">Latest</span>' if latest_flag else "")
        if v.startswith("0.7") or v.startswith("0.8"): badges += '<span class="badge blue">Rename</span>'
        prev = rels[i + 1]["version"] if i + 1 < len(rels) else None
        compare = ('<a class="cl-compare" href="%s/compare/v%s...v%s">Compare on GitHub<span>↗</span></a>' % (REPO, prev, v)) if prev and tag in TAGS and ("v" + prev) in TAGS else ""
        body = []
        for k in r["kinds"]:
            kn = k["name"].split("/")[0].strip()
            cls = kn.lower().split()[0] if kn else "notes"
            body.append('<div class="cl-kind %s">%s</div><ul>' % (e(cls), e(kn)))
            for it in k["items"]:
                h, title = bullet(it["text"])
                if it["subs"]:
                    h += "<ul>" + "".join("<li>%s</li>" % bullet(x)[0] for x in it["subs"]) + "</ul>"
                shot = ""
                if title and v in ("0.9.0", "0.7.0"):
                    for key, (name, cap) in SHOTS.items():
                        if title.startswith(key):
                            shot = '<figure class="cl-shot"><img src="assets/images/%s.png" alt="%s"><figcaption>%s</figcaption></figure>' % (name, e(cap), e(cap)); break
                body.append("<li>%s%s</li>" % (h, shot))
            body.append("</ul>")
        intro = ('<p class="cl-intro">%s</p>' % inline(" ".join(r["intro"]))) if r["intro"] else ""
        return ('<div class="cl-release%s"><span class="cl-dot"></span><div class="cl-card"><div class="cl-head">%s%s<time>%s</time>%s</div>%s%s</div></div>'
                % (" latest" if latest_flag else "", ver, badges, e(nice_date(r["date"])), compare, intro, "".join(body)))

    porcelain = [r for r in rels if tuple(int(x) for x in r["version"].split(".")[:2]) >= (0, 7)]
    older = rels[len(porcelain):]
    out.append('<div class="cl-timeline">')
    for i, r in enumerate(porcelain):
        out.append(release_html(r, i, i == 0))
    out.append("</div>")
    out.append('<details class="cl-older"><summary>Before Porcelain: BranchShift and JetGit Plus, %s to %s (%d releases)</summary><p class="small dim">The fork\'s lineage, English halves of the bilingual entries. Kept because the code is still here.</p><div class="cl-timeline">' % (e(older[-1]["version"]), e(older[0]["version"]), len(older)))
    for j, r in enumerate(older):
        out.append(release_html(r, len(porcelain) + j, False))
    out.append("</div></details>")
    return "\n".join(out), len(rels), latest

if __name__ == "__main__":
    h, n, latest = render()
    print(n, "releases; latest", latest["version"], latest["date"]); print(len(h), "bytes")
