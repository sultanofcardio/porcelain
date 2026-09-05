#!/usr/bin/env python3
"""Render the site without Jekyll: the layout applied to each page, into _preview/."""
import os
import re
import shutil

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(root, "_preview")
shutil.rmtree(out, ignore_errors=True)
shutil.copytree(os.path.join(root, "assets"), os.path.join(out, "assets"))
layout = open(os.path.join(root, "_layouts/default.html"), encoding="utf-8").read()
for name in sorted(os.listdir(root)):
    if not name.endswith(".html") or name.startswith("_"):
        continue
    src = open(os.path.join(root, name), encoding="utf-8").read()
    _, fm, body = src.split("---\n", 2)
    title = re.search(r"^title: (.*)$", fm, re.M).group(1)
    url = "/" if name == "index.html" else "/" + name
    page = layout.replace("{{ content }}", body).replace("{{ page.title }}", title).replace("{{ site.baseurl }}", ".")
    page = re.sub(r'\{% if page\.url == "([^"]+)" %\}(.*?)\{% else %\}(.*?)\{% endif %\}', lambda m: m.group(2) if m.group(1) == url else m.group(3), page, flags=re.S)
    page = re.sub(r'\{% if page\.url == "([^"]+)" %\}(.*?)\{% endif %\}', lambda m: m.group(2) if m.group(1) == url else "", page, flags=re.S)
    open(os.path.join(out, name), "w", encoding="utf-8").write(page)
print("rendered to", out)
