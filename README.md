# Porcelain docs

The `gh-pages` branch. GitHub Pages builds it with Jekyll; there is no theme and nothing to install locally.

- `_layouts/default.html` is the whole frame: the sidebar and the page column, as reviewed.
- One HTML file per page, with front matter. The markup is the reviewed mock's, verbatim, so what was signed off is what renders.
- `roadmap.html` and `changelog.html` are generated (see `_tools/README.md`). `assets/css/roadmap.css` and `assets/js/site.js` carry the roadmap's styles and interactions; `assets/css/site.css` is everything else.
- Screenshots are in `assets/images/`; the README on `main` uses the same captures for the ones it shows.

To preview locally, run `python3 _tools/preview.py`, which renders every page with the layout applied into `_preview/`.
