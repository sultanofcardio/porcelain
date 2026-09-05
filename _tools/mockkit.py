# Mock component kit: VS Code / Porcelain surfaces as HTML strings.
import html as _h

def e(s):
    return _h.escape(s, quote=True)

ICONS = [
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8l-5-5Z"/><path d="M13 3v5h5"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 4v16l4-3 4 3V4"/><path d="M15 6l4 2-4 2"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M3 12h6M15 12h6"/></svg>',
]

def vsc(title, editor, side=None, act=4, side_w=300, height=420, status=("⑂ main*+", "⑂ Porcelain", "⊗ 0 ⚠ 0"), status_right=""):
    acts = "".join('<span class="%s">%s</span>' % ("on" if i == act else "", ic) for i, ic in enumerate(ICONS))
    cols = "48px %dpx minmax(0,1fr)" % side_w if side is not None else "48px minmax(0,1fr)"
    side_html = '<div class="vsc-side">%s</div>' % side if side is not None else ""
    st = "".join("<span>%s</span>" % s for s in status)
    return ('<div class="vsc"><div class="vsc-title"><span class="tl"><i></i><i></i><i></i></span>%s</div>'
            '<div class="vsc-body" style="grid-template-columns:%s;height:%dpx"><div class="vsc-act">%s</div>%s<div class="vsc-ed">%s</div></div>'
            '<div class="vsc-status"><span class="sb-remote">&gt;&lt;</span>%s<span class="right">%s</span></div></div>'
            % (e(title), cols, height, acts, side_html, editor, st, e(status_right)))

def fw(title, body, height=None, width=None, cls=""):
    st = ""
    if height: st += "height:%dpx;" % height
    if width: st += "max-width:%dpx;" % width
    return ('<div class="fw %s" style="%s"><div class="fw-title"><span class="tl"><i></i><i></i><i></i></span><span class="fw-t">%s</span><span class="fw-signin">Sign In</span></div><div class="fw-body">%s</div></div>'
            % (cls, st, e(title), body))

# ---------- the Porcelain panel ----------
def chip(kind, text):
    # kind: head, local, tag, remote
    return '<span class="rc %s">%s</span>' % (kind, e(text))

def lograw(rows, sel=None, cols=("Author", "Message", "Date", "Hash"), extra_col=None):
    out = ['<div class="pp-cols"%s>%s</div>' % (' style="grid-template-columns:%s"' % extra_col[0] if extra_col else "", "".join("<span>%s</span>" % e(c) for c in cols))]
    for i, r in enumerate(rows):
        cls = "pp-row" + (" sel" if sel is not None and i in (sel if isinstance(sel, (list, set, tuple)) else [sel]) else "") + (" " + r.get("cls", "") if r.get("cls") else "")
        chips = "".join(chip(k, t) for k, t in r.get("chips", []))
        style = ' style="grid-template-columns:%s"' % extra_col[0] if extra_col else ""
        extra = ('<span class="pp-x">%s</span>' % r.get("x", "")) if extra_col else ""
        out.append('<div class="%s"%s><span class="pp-a">%s</span><span class="pp-g" style="--lc:%s%s"><i></i></span><span class="pp-m">%s%s</span>%s<span class="pp-d">%s</span><span class="pp-h">%s</span></div>'
                   % (cls, style, e(r.get("author", "")), r.get("lane", "#3a8ee6"), ";--lt:none" if r.get("nolane") else "", r.get("msg_html") or e(r.get("msg", "")), chips, extra, e(r.get("date", "")), e(r.get("hash", ""))))
    return "".join(out)

DEFAULT_ROWS = [
    dict(author="Ada Lovelace", msg="docs: expand the README", chips=[("head", "HEAD"), ("local", "main"), ("tag", "v0.3.0"), ("remote", "origin/main")], date="9 days ago", hash="6ab30ba"),
    dict(author="Radia Perlman", msg="chore: shut the pool down with the server", date="10 days ago", hash="04c6465"),
    dict(author="Alan Turing", msg="fix: keep pagination stable across inserts", date="11 days ago", hash="72fd1fb"),
    dict(author="Grace Hopper", msg="feat: pagination for the user list", date="13 days ago", hash="ac2edb5"),
    dict(author="Ada Lovelace", msg="refactor: split the router table", date="14 days ago", hash="7697272"),
    dict(author="Radia Perlman", msg="test: logging middleware", date="15 days ago", hash="e914342"),
    dict(author="Alan Turing", msg="chore: bump dependencies", date="16 days ago", hash="573752d"),
    dict(author="Grace Hopper", msg="feat: structured request logging", date="17 days ago", hash="e2d9496"),
]

def toolbar(chips=("Branch: main",), extra="", search="Search commits…"):
    ch = "".join('<span class="pp-chip">%s <b>×</b></span>' % e(c) for c in chips)
    return ('<div class="pp-tb"><span class="pp-search"><i>⌕</i>%s<b>Cc</b><b>.*</b></span>%s<span class="pp-dd">User ⌄</span><span class="pp-dd">Date ⌄</span><span class="pp-dd">Paths ⌄</span>%s<span class="pp-ic">⊕</span><span class="pp-ic">◉</span></div>'
            % (e(search), ch, extra))

def btree(items, sel=None):
    out = []
    for i, it in enumerate(items):
        d, icon, label = it[0], it[1], it[2]
        extra = it[3] if len(it) > 3 else ""
        cls = it[4] if len(it) > 4 else ""
        out.append('<div class="bt-row %s%s" style="--d:%d"><span class="bt-i">%s</span><span class="bt-l">%s</span>%s</div>'
                   % ("sel " if sel == i else "", cls, d, icon, e(label), extra))
    return '<div class="bt">' + "".join(out) + "</div>"

DEFAULT_TREE = [
    (0, "", "Current Branch: main", "", "bt-head"), (0, "›", "Recent"), (0, "⌄", "Local"),
    (1, "🏷", "main", '<span class="bt-cnt">↑1</span>'), (1, "⌄", "feature"), (2, "⑂", "rate-limit"), (2, "⑂", "sessions", '<span class="bt-cnt">↓2</span>'), (2, "⑂", "webhooks"),
    (1, "⌄", "fix"), (2, "⑂", "pool-leak"), (0, "⌄", "Remote"), (1, "⌄", "origin"), (2, "★", "main"), (0, "›", "Tags"),
]

def panel(tree_html=None, log_html=None, details_html=None, tb=None, tabs_active="PORCELAIN", tabs=("PROBLEMS", "OUTPUT", "TERMINAL", "PORCELAIN"), overlay="", tree_w=180, det_w=230, height=None):
    if tree_html is None: tree_html = btree(DEFAULT_TREE)
    if log_html is None: log_html = lograw(DEFAULT_ROWS, sel=0)
    if tb is None: tb = toolbar()
    t = "".join('<span class="%s">%s</span>' % ("on" if x == tabs_active else "", e(x)) for x in tabs)
    cols = "%dpx minmax(0,1fr)%s" % (tree_w, " %dpx" % det_w if details_html is not None else "")
    det = '<div class="pp-det">%s</div>' % details_html if details_html is not None else ""
    st = ' style="height:%dpx"' % height if height else ""
    return ('<div class="pp"%s><div class="pp-tabs">%s<span class="pp-tabs-r">⟳ ⤢ ✕</span></div><div class="pp-body" style="grid-template-columns:%s"><div class="pp-tree"><div class="pp-tree-tb"><span class="pp-search small"><i>⌕</i>Branch or tag</span></div>%s</div><div class="pp-log">%s%s</div>%s</div>%s</div>'
            % (st, t, cols, tree_html, tb, log_html, det, overlay))

def details(title, hash_, author, email, date, chips=(), extra=""):
    return ('<div class="pp-det-h">Changed files</div><div class="pp-file"><i>TS</i> src/db/pool.ts</div><div class="pp-file"><i class="md">M↓</i> README.md</div>'
            '<div class="pp-det-c"><b>%s</b><div class="pp-det-meta">%s %s <a>&lt;%s&gt;</a> on %s</div><div class="pp-det-chips">%s</div>%s</div>'
            % (e(title), e(hash_), e(author), e(email), e(date), "".join(chip(k, t) for k, t in chips), extra))

# ---------- commit view ----------
def cb(state=""):
    return '<span class="cb %s"></span>' % state

def crow(d, parts, cls=""):
    return '<div class="crow %s" style="--d:%d">%s</div>' % (cls, d, parts)

def ctree_default():
    return "".join([
        crow(0, cb("mixed") + '<span class="cchev">⌄</span><b>CHANGES</b><span class="cn">4 FILES</span>'),
        crow(1, cb("mixed") + '<span class="cchev">⌄</span><span class="fold"></span>src<span class="cn">3 files</span>'),
        crow(2, cb("on") + '<span class="ts">TS</span><span class="fn add">webhooks.ts</span><span class="st add">A</span>'),
        crow(2, cb() + '<span class="ts">TS</span><span class="fn">config.ts</span><span class="st">M</span>'),
        crow(2, cb("on") + '<span class="ts">TS</span><span class="fn">router.ts</span><span class="st">M</span>', "sel"),
        crow(1, cb() + '<span class="ts md">M↓</span><span class="fn">README.md</span><span class="st">M</span>'),
        crow(0, cb() + '<span class="cchev">⌄</span><b>UNVERSIONED FILES</b><span class="cn">1 FILE</span>'),
        crow(1, cb() + '<span class="ts md">M↓</span><span class="fn unv">NOTES.md</span><span class="st unv">U</span>'),
    ])

def commitside(tree=None, msg='feat: return JSON on unmatched routes', tab="Commit", banner="", below_msg="", extra_opts="", msg_extra="", buttons=True, tabs_html=None):
    tree = ctree_default() if tree is None else tree
    tabs_html = tabs_html or "".join('<span class="%s">%s</span>' % ("on" if t == tab else "", t) for t in ("Commit", "Shelf", "Stash"))
    msgbox = '<div class="cmsg"><div class="cmsg-box">%s</div>%s<div class="copts">%s Amend %s Sign-off<span class="ico">⚙</span><span class="ico">🕓</span>%s</div>%s</div>' % (
        msg, msg_extra, cb(), cb(), extra_opts,
        '<div class="cbtns"><span class="primary">Commit</span><span>Commit and Push…</span><span class="dd">⌄</span></div>' if buttons else "")
    return ('<div class="side-head">Commit</div><div class="ctabs">%s</div><div class="ctool"><i></i><i></i><i></i><i></i><i class="b"></i><i class="g"></i><b></b><i></i><i></i><i></i></div>%s<div class="ctree">%s</div>%s%s'
            % (tabs_html, banner, tree, below_msg, msgbox))

def banner(text, buttons):
    return '<div class="cbanner"><span>%s</span>%s</div>' % (text, "".join('<b class="%s">%s</b>' % ("p" if i == 0 else "", e(b)) for i, b in enumerate(buttons)))

# ---------- code + diff ----------
def code(lines, start=1, gutter=True):
    out = []
    for i, (cls, h) in enumerate(lines):
        n = "" if cls == "fill" else str(start + i)
        out.append('<div class="cl %s">%s<span class="ct">%s</span></div>' % (cls, '<span class="cn2">%s</span>' % n if gutter else "", h))
    return '<div class="codeblk">%s</div>' % "".join(out)

KW = lambda s: '<span class="kw">%s</span>' % s
ST = lambda s: '<span class="str">%s</span>' % s
FN = lambda s: '<span class="fn2">%s</span>' % s
TY = lambda s: '<span class="ty">%s</span>' % s
CM = lambda s: '<span class="cm2">%s</span>' % s

POOL_L = [
    ("", KW("export") + " " + KW("class") + " " + TY("Pool") + " {"),
    ("", "  " + KW("private") + " " + KW("readonly") + " free: " + TY("Client") + "[] = [];"),
    ("", ""),
    ("del", "  " + FN("close") + "(): " + TY("void") + " {"),
    ("del", "    " + FN("clearInterval") + "(" + KW("this") + ".sweeper);"),
    ("del", "  }"),
    ("", ""),
    ("", "  " + KW("private") + " " + FN("sweep") + "(): " + TY("void") + " {"),
    ("", "    " + KW("const") + " cutoff = Date." + FN("now") + "() - " + KW("this") + ".options.idleMillis;"),
]
POOL_R = [
    ("", KW("export") + " " + KW("class") + " " + TY("Pool") + " {"),
    ("", "  " + KW("private") + " " + KW("readonly") + " free: " + TY("Client") + "[] = [];"),
    ("", ""),
    ("add", "  " + KW("async") + " " + FN("drain") + "(): " + TY("Promise") + "&lt;" + TY("void") + "&gt; {"),
    ("add", "    " + FN("clearInterval") + "(" + KW("this") + ".sweeper);"),
    ("add", "    " + KW("await") + " Promise." + FN("all") + "(" + KW("this") + ".free." + FN("map") + "((c) =&gt; c." + FN("close") + "()));"),
    ("add", "  }"),
    ("", ""),
    ("", "  " + KW("private") + " " + FN("sweep") + "(): " + TY("void") + " {"),
]

def diffwin(title, lrev, rrev, path, left=POOL_L, right=POOL_R, count="1 difference", toolbar_extra="", overlay="", height=330, floating=True, heads=True):
    body = ('<div class="dw"><div class="dw-tb"><span>↑</span><span>↓</span><span>✎</span><span>‹</span><span>›</span><span class="on">⇅</span><span>⌕</span>%s<span class="dw-cnt">%s</span><span>⚙</span></div>'
            '%s<div class="dw-panes"><div class="dw-pane">%s</div><div class="dw-pane">%s</div></div>%s</div>'
            % (toolbar_extra, e(count),
               ('<div class="dw-heads"><span>🔒 <b>%s</b> %s</span><span>🔒 <b>%s</b> %s</span></div>' % (e(lrev), e(path), e(rrev), e(path))) if heads else "",
               code(left), code(right), overlay))
    return fw(title, body, height=height) if floating else body

def mergewin(title, yours="main", theirs="fix/pool-leak", path="src/db/pool.ts", counter="1 conflict · 0 resolved", overlay="", toolbar_extra="", height=340):
    l = [("", "  " + FN("release") + "(client: " + TY("Client") + "): " + TY("void") + " {"), ("", "    " + KW("this") + ".free." + FN("push") + "(client);"), ("", "  }"),
         ("conf", "  " + FN("close") + "(): " + TY("void") + " {"), ("conf", "    " + FN("clearInterval") + "(" + KW("this") + ".sweeper);"), ("conf", "  }"), ("", ""), ("", "  " + KW("private") + " " + FN("sweep") + "() {")]
    m = [("", "  " + FN("release") + "(client: " + TY("Client") + "): " + TY("void") + " {"), ("", "    " + KW("this") + ".free." + FN("push") + "(client);"), ("", "  }"),
         ("", ""), ("", "  " + KW("private") + " " + FN("sweep") + "() {"), ("", "    " + KW("const") + " cutoff = Date." + FN("now") + "();")]
    r = [("", "  " + FN("release") + "(client: " + TY("Client") + "): " + TY("void") + " {"), ("", "    " + KW("this") + ".free." + FN("push") + "(client);"), ("", "  }"),
         ("conf", "  " + KW("async") + " " + FN("drain") + "(): " + TY("Promise") + "&lt;" + TY("void") + "&gt; {"), ("conf", "    " + FN("clearInterval") + "(" + KW("this") + ".sweeper);"), ("conf", "    " + KW("await") + " Promise." + FN("all") + "(…);"), ("conf", "  }"), ("", "")]
    body = ('<div class="dw mw"><div class="dw-tb"><span>↑</span><span>↓</span><span>⇉</span><span>✨</span>%s<span>↶</span><span>↷</span><span>✕</span><span>⌕</span><span class="dw-cnt">%s</span><span class="dw-btn">Cancel</span><span class="dw-btn p">Apply</span></div>'
            '<div class="dw-heads three"><span>🔒 <b>%s</b> %s <i class="tagp">YOURS</i></span><span>✎ <b>Result</b> %s</span><span>🔒 <b>%s</b> %s <i class="tagp">THEIRS</i></span></div>'
            '<div class="dw-panes three"><div class="dw-pane">%s</div><div class="dw-gut"><span>≫</span><span>✕</span></div><div class="dw-pane">%s</div><div class="dw-gut"><span>≪</span><span>✕</span></div><div class="dw-pane">%s</div></div>%s</div>'
            % (toolbar_extra, e(counter), e(yours), e(path), e(path), e(theirs), e(path), code(l), code(m), code(r), overlay))
    return fw(title, body, height=height)

# ---------- menus, pickers, toasts, dialogs ----------
def ctxmenu(items, pos="", width=250):
    out = []
    for it in items:
        if it == "-":
            out.append('<div class="cm-sep"></div>'); continue
        label = it[0]; o = it[1] if len(it) > 1 else {}
        cls = " ".join(k for k in ("sel", "dis", "chk", "unchk") if o.get(k))
        sc = '<span class="cm-sc">%s</span>' % e(o["sc"]) if o.get("sc") else ""
        ic = '<span class="cm-ic">%s</span>' % o["icon"] if o.get("icon") else '<span class="cm-ic"></span>'
        sub = '<span class="cm-sub">›</span>' if o.get("sub") else ""
        out.append('<div class="cm-item %s">%s<span>%s</span>%s%s</div>' % (cls, ic, e(label), sc, sub))
    return '<div class="cm" style="width:%dpx;%s">%s</div>' % (width, pos, "".join(out))

def quickpick(placeholder, items, value="", pos="", width=440, title=None):
    out = []
    for it in items:
        label = it[0]; o = it[1] if len(it) > 1 else {}
        cls = ("sel" if o.get("sel") else "")
        chk = ""
        if "chk" in o: chk = '<span class="qp-chk %s"></span>' % ("on" if o["chk"] else "")
        det = '<span class="qp-det">%s</span>' % e(o["det"]) if o.get("det") else ""
        desc = '<span class="qp-desc">%s</span>' % e(o["desc"]) if o.get("desc") else ""
        out.append('<div class="qp-item %s">%s<span class="qp-l">%s</span>%s%s</div>' % (cls, chk, label, desc, det))
    t = '<div class="qp-title">%s</div>' % e(title) if title else ""
    inbox = "" if (not value and not placeholder) else '<div class="qp-in">%s<span class="qp-ph">%s</span></div>' % (e(value) + '<span class="caret"></span>' if value else "", "" if value else e(placeholder))
    w = "width:%dpx;" % width if width else ""
    return '<div class="qp" style="%s%s">%s%s%s</div>' % (w, pos, t, inbox, "".join(out))

def toast(kind, text, buttons=(), pos="right:16px;bottom:34px", source="Porcelain", width=380):
    ic = {"info": "ⓘ", "warn": "⚠", "err": "⊗", "ok": "✓"}[kind]
    b = ('<div class="toast-b">%s</div>' % "".join('<span class="%s">%s</span>' % ("p" if i == 0 else "", e(x)) for i, x in enumerate(buttons))) if buttons else ""
    return '<div class="toast" style="width:%dpx;%s"><div class="toast-h"><i class="%s">%s</i><span>%s</span><b>×</b></div><div class="toast-src">Source: %s</div>%s</div>' % (width, pos, kind, ic, text, e(source), b)

def dialog(title, body, buttons=(("Cancel", False), ("OK", True)), sub="", pos="", width=440, floating=False):
    bt = "".join('<span class="dbtn %s">%s</span>' % ("primary" if p else "", e(l)) for l, p in buttons)
    inner = '<div class="dlg2" style="width:%dpx;%s"><div class="dlg-title">%s</div>%s<div class="dlg-body">%s</div><div class="dlg-foot">%s</div></div>' % (
        width, pos, e(title), ('<div class="dlg-sub">%s</div>' % sub) if sub else "", body, bt)
    return fw(title, inner, width=width + 2, cls="fw-dlg") if floating else inner

def field(label, control, note=""):
    return '<div class="fld"><label>%s</label><div>%s%s</div></div>' % (e(label), control, ('<div class="fld-note">%s</div>' % note) if note else "")

def inp(value="", ph="", w="100%", caret=False):
    return '<span class="in" style="width:%s">%s%s</span>' % (w, e(value) if value else '<i>%s</i>' % e(ph), '<span class="caret"></span>' if caret else "")

def select(value, w="100%"):
    return '<span class="in sel" style="width:%s">%s<b>⌄</b></span>' % (w, e(value))

def chk(label, on=False, note=""):
    return '<label class="chkl">%s%s%s</label>' % (cb("on" if on else ""), e(label), (' <span class="chk-note">%s</span>' % e(note)) if note else "")

def settings(rows, pos=""):
    out = []
    for title, desc, control in rows:
        parts = title.split(": ")
        t = '<b>%s:</b> %s' % (e(parts[0]), e(parts[1])) if len(parts) == 2 else e(title)
        out.append('<div class="set-row"><div class="set-t">%s</div><div class="set-d">%s</div><div class="set-c">%s</div></div>' % (t, desc, control))
    return '<div class="setp" style="%s"><div class="setp-h"><span class="pp-search"><i>⌕</i>porcelain</span></div>%s</div>' % (pos, "".join(out))

def tw(headers, rows, sel=None, widths=None):
    st = ' style="grid-template-columns:%s"' % widths if widths else ""
    out = ['<div class="tw-h"%s>%s</div>' % (st, "".join("<span>%s</span>" % h for h in headers))]
    for i, r in enumerate(rows):
        out.append('<div class="tw-r %s"%s>%s</div>' % ("sel" if sel == i else "", st, "".join("<span>%s</span>" % c for c in r)))
    return '<div class="tw">%s</div>' % "".join(out)

def blame(lines, header=""):
    out = []
    for who, when, age, h in lines:
        out.append('<div class="bl-row"><span class="bl-g age%d">%s <i>%s</i></span><span class="ct">%s</span></div>' % (age, e(who), e(when), h))
    return '<div class="bl">%s%s</div>' % (('<div class="bl-h">%s</div>' % header) if header else "", "".join(out))

def editor_tabs(tabs, active=0):
    return '<div class="ed-tabs">%s</div>' % "".join('<span class="etab %s">%s</span>' % ("on" if i == active else "", e(t)) for i, t in enumerate(tabs))

def terminal(lines):
    return '<div class="term">%s</div>' % "".join('<div>%s</div>' % l for l in lines)

def shelf_side(items, menu="", tab="Shelf"):
    rows = "".join(items)
    return commitside(tree=rows, tab=tab, buttons=False, msg="", msg_extra="") .replace('<div class="cmsg">', '<div class="cmsg" hidden>') + menu

def note(text):
    return '<p class="small dim" style="margin:0 0 10px">%s</p>' % text
