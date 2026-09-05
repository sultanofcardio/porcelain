#!/usr/bin/env python3
"""Regenerate the two generated pages: roadmap.html and changelog.html.

    python3 _tools/build.py                      # both
    CHANGELOG=/path/to/CHANGELOG.md python3 _tools/build.py changelog

The roadmap comes from features.py (the inventory), mocks.py (one mock per
unimplemented feature) and roadmap-template.html (the page around them). The
changelog comes from CHANGELOG.md on main, through changelog.py.
"""
import html
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from features import AREAS, DEMO, NEXT, load  # noqa: E402
from mocks import M  # noqa: E402
import changelog as clmod  # noqa: E402

COLS = 22
e = html.escape
STAGE_LABEL = {"done": "Supported", "v1": "Before 1.0", "after": "After 1.0", "never": "Not planned"}

CHANGELOG_INTRO = (
    "<p>Every release, newest first. Versions follow SemVer, and until 1.0 a minor version may still rename a setting or a "
    "command. The <code>.vsix</code> for each version is attached to its GitHub release. Porcelain took its identity at 0.7.0 "
    "and its name at 0.8.0; the releases before that are the fork's lineage as BranchShift and JetGit Plus, kept below the fold.</p>"
)


def front(title):
    return "---\nlayout: default\ntitle: %s\n---\n" % title


def build_roadmap():
    rows = load()
    total = len(rows)
    counts = {s: sum(1 for r in rows if r["stage"] == s) for s in STAGE_LABEL}
    above = sum(1 for r in rows if r["tier"] <= 2)
    for r in rows:  # rank is importance: before-1.0 above the seam, the rest below it
        if r["tier"] <= 2:
            assert r["stage"] in ("done", "v1"), "above the seam but not done/v1: %s" % r["feat"]
        else:
            assert r["stage"] in ("after", "never"), "below the seam but %s: %s" % (r["stage"], r["feat"])
    missing = [r["feat"] for r in rows if r["stage"] in ("v1", "after") and r["feat"] not in M]
    unused = [k for k in M if k not in {r["feat"] for r in rows}]
    if missing or unused:
        raise SystemExit("mocks out of step: missing %r, unused %r" % (missing, unused))

    tier_counts = {}
    for r in rows:
        t = tier_counts.setdefault(r["tier"], {"name": r["tier_name"], "sub": r["tier_sub"], "done": 0, "v1": 0, "after": 0, "never": 0, "n": 0})
        t[r["stage"]] += 1
        t["n"] += 1

    tiles = "".join(
        '<button type="button" class="sq" style="--i:%d" data-n="%d" data-stage="%s" data-area="%s" data-feat="%s" aria-label="%s"></button>'
        % (i, r["n"], r["stage"], r["area"], e(r["feat"], quote=True), e("#%d %s" % (r["n"], r["feat"]), quote=True))
        for i, r in enumerate(rows))

    def stage_chip(r):
        if r["stage"] == "done":
            return ""
        if r["feat"] in NEXT:
            return '<span class="stage next">Next up</span>'
        return '<span class="stage %s">%s</span>' % (r["stage"], STAGE_LABEL[r["stage"]])

    def sw(r):
        if r["stage"] == "done":
            return '<span class="sw done" aria-label="Supported"></span>'
        if r["stage"] == "never":
            return '<span class="sw no" aria-label="Not planned"></span>'
        return '<span class="sw %s" aria-label="%s"></span>' % (r["stage"], STAGE_LABEL[r["stage"]])

    def pdetail(r):
        para, mock = M[r["feat"]]
        return ('<div class="pdetail" data-for="prow-%d" hidden><div class="pd-inner"><div class="pd-text"><h4>What it would look like</h4><p>%s</p>'
                '<p class="small dim">Mock, drawn on the real surfaces. Nothing here is built.</p></div><div class="pd-mock">%s</div></div></div>'
                % (r["n"], para, mock))

    parts = []
    cur_tier = 0
    for r in rows:
        if r["tier"] != cur_tier:
            if cur_tier == 2:
                parts.append('<div class="seamrow" id="seamrow"><span class="rank"></span><span class="lanes"></span><span class="seam-content"><span class="stitch"></span><span class="seam-badge">1.0</span><span class="stitch"></span></span></div>')
            cur_tier = r["tier"]
            t = tier_counts[cur_tier]
            pct = lambda k: "%.2f%%" % (100.0 * t[k] / t["n"])  # noqa: E731
            parts.append(
                '<div class="tierhead" data-tier="%d"><div><span class="tier-name">%s</span><span class="tier-sub">%s</span></div>'
                '<div class="tier-prog"><span>%d of %d supported</span><div class="segbar" style="height:5px">'
                '<span class="s-done" style="width:%s"></span><span class="s-v1" style="width:%s"></span>'
                '<span class="s-after" style="width:%s"></span><span class="s-never" style="width:%s"></span></div></div></div>'
                % (cur_tier, e(t["name"]), e(t["sub"]), t["done"], t["n"], pct("done"), pct("v1"), pct("after"), pct("never")))
        demo = r["feat"] in M
        cls = "prow %s%s" % (r["stage"], " expandable" if demo else "")
        tags = stage_chip(r) + ('<span class="stage demo">Mock</span>' if demo else "") + '<span class="atag">%s</span>' % e(AREAS[r["area"]][0])
        feat = e(r["feat"]) + ('<span class="chev"></span>' if demo else "")
        parts.append(
            '<div class="%s" id="prow-%d" data-area="%s" data-stage="%s"%s><span class="rank">%d</span><span class="lanes"></span>%s<span class="feat">%s</span><span class="tags">%s</span></div>'
            % (cls, r["n"], r["area"], r["stage"], ' role="button" tabindex="0" aria-expanded="false"' if demo else "", r["n"], sw(r), feat, tags))
        if demo:
            parts.append(pdetail(r))

    area_js = "{" + ",".join('%s:{name:%s,color:"%s"}' % (k, repr(v[0]).replace("'", '"'), v[1]) for k, v in AREAS.items()) + "}"
    next_js = "[" + ",".join(str(r["n"]) for r in rows if r["feat"] in NEXT) + "]"
    data = "<script>window.ROADMAP={AREAS:%s,NEXT:%s,COLS:%d,ABOVE:%d,TOTAL:%d};</script>" % (area_js, next_js, COLS, above, total)
    next_names = " · ".join(r["feat"].split(":")[0].split(" (")[0] for r in rows if r["feat"] in NEXT)

    page = open(os.path.join(HERE, "roadmap-template.html"), encoding="utf-8").read()
    for k, v in {
        "{{DATA}}": data, "{{TILES}}": tiles, "{{LIST}}": "\n".join(parts),
        "{{TOTAL}}": str(total), "{{DONE}}": str(counts["done"]), "{{V1}}": str(counts["v1"]),
        "{{AFTER}}": str(counts["after"]), "{{NEVER}}": str(counts["never"]), "{{ABOVE}}": str(above),
        "{{TOGO}}": str(counts["v1"]), "{{NEXT_NAMES}}": e(next_names),
    }.items():
        page = page.replace(k, v)
    left = sorted(set(re.findall(r"\{\{[A-Z_]+\}\}", page)))
    if left:
        raise SystemExit("unfilled placeholders: %r" % left)
    open(os.path.join(ROOT, "roadmap.html"), "w", encoding="utf-8").write(front("Roadmap") + page)
    print("roadmap.html: %d features, %d supported, seam after %d, %d mocks" % (total, counts["done"], above, len(M)))


def build_changelog():
    body, n, latest = clmod.render()
    open(os.path.join(ROOT, "changelog.html"), "w", encoding="utf-8").write(
        front("Changelog") + '<div class="kicker">Releases</div>\n<h1>Changelog</h1>\n' + CHANGELOG_INTRO + "\n" + body + "\n")
    print("changelog.html: %d releases, latest %s (%s)" % (n, latest["version"], latest["date"]))


if __name__ == "__main__":
    what = sys.argv[1:] or ["roadmap", "changelog"]
    if "roadmap" in what:
        build_roadmap()
    if "changelog" in what:
        build_changelog()
