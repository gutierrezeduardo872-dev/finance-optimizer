# Norte — how the app is built now

**There is no build step.** Babel compiles the JSX in the browser when the page
loads. The files in `src/` are what actually runs.

## Why

The previous setup compiled `src/*.jsx` in a sandbox and committed only the
resulting `index.html`. The source was never tracked, so when the local copy
went, it was gone — the same failure as letting the Google Sheet be the source
of truth instead of the JSON.

Removing the build removes that failure mode. Edit a file, refresh the browser.

## Load order matters

`src/` files are plain scripts sharing one scope, not ES modules — Babel in the
browser cannot resolve imports between JSX files. Each file may use anything
defined in the files loaded above it:

```
src/lib.js       constants, formatters, icons, issuer display helpers
src/engine.js    scoring: cards, yield, boosts, picks, portfolio
src/ui.jsx       primitives: Ico, Row, Sheet, BankMark, SwipeRow, ...
src/details.jsx  CardDetails, AccountDetails, ProductSheet
src/screens.jsx  Login, Home, CardAdvisor, SavingsAdvisor, Products, ...
src/app.jsx      App shell, routing, write queue, ReactDOM.render
```

Adding a file means adding a `<script>` tag to `index.html` in the right place.

## Working locally

`file://` will not work — the browser blocks fetching `src/*` from disk. Serve
the folder:

```bash
cd ~/finance-optimizer
python3 -m http.server 8000
```

Then open http://localhost:8000. Refresh after each edit; there is nothing to
rebuild.

## Deploying

```bash
git add src/ index.html
git commit -m "..."
git push
```

GitHub Pages serves `src/` as static files, so it works there unchanged.

**Commit `src/`.** That is the whole point.

## The cost

Babel compiles roughly 60 KB on every page load — about half a second on first
paint — and depends on the unpkg CDN. With a handful of testers that is a good
trade for never losing the source again.

When it stops being a good trade, install Node and esbuild, pre-bundle `src/`
into one file, and commit both. Do not go back to committing only the output.
