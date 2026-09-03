# Norte — how the app is built now

Two halves, on purpose.

```
core/     portable. ES modules. No DOM, no localStorage, no fetch.
          The scoring engine and everything it needs. This is what
          React Native will import verbatim.

src/      the web host. JSX compiled by Babel in the browser, plus the
          three things only a browser can do (the Apps Script URL, the
          localStorage wrapper, the cache keys).
```

The split happened on 2026-09-03, as step one of the move to the App Store.
Everything below the line "what runs in the browser" is unchanged from before.

## core/

| file | what |
|---|---|
| `core/format.js` | formatters, labels, date helpers, SVG icon path data |
| `core/engine.js` | card scoring, yield, boosts, picks, portfolio |
| `core/storage.js` | the storage port, and the three cache keys |
| `core/index.js` | the public surface: import from here |

`core/` has no dependencies and no build. It runs in Node today:

```bash
node --input-type=module -e "import {ccRecommend} from './core/index.js'; console.log(typeof ccRecommend)"
```

**Edit the engine here, never in `src/`.** After editing, regenerate the
browser copy:

```bash
python3 tools/build-core.py
```

That writes `src/core.bundle.js`, which is the same code flattened onto
`globalThis` under the names `src/*.jsx` already call. It is generated, it is
committed, and it can be reproduced from `core/` at any time. This is not the
old mistake of committing only the output: the source is right there.

## Proving the engine did not move

`tools/golden.mjs` runs 257 cases across every public entry point of the
engine, over the real dataset, and pins the results.

```bash
node tools/golden.mjs --check     # fails if any of the 257 changed
node tools/golden.mjs --write     # accept the new results as the baseline
```

Run `--check` before every commit that touches `core/`. Only run `--write`
when a number was *supposed* to change, and say which one in the commit
message.

This is the safety net for the React Native port: the phone must produce the
same 257 answers as the web, or the port is wrong.

## What runs in the browser

**There is no build step for the UI.** Babel compiles the JSX in the browser
when the page loads. The files in `src/` are what actually runs.

### Load order matters

`src/` files are plain scripts sharing one scope, not ES modules. Each file
may use anything defined in the files loaded above it:

```
src/core.bundle.js   generated from core/ — everything portable
src/lib.js           API url, LS, cache keys. Web-only, and small on purpose.
src/ui.jsx           primitives: Ico, Row, Sheet, BankMark, SwipeRow, ...
src/details.jsx      CardDetails, AccountDetails, ProductSheet
src/advisors.jsx     CardAdvisor, SavingsAdvisor
src/screens.jsx      Login, Home, Products, Suggestions, ...
src/admin.jsx        the admin surface
src/account.jsx      profile and settings
src/auth.jsx         login, Google sign-in, PIN
src/onboarding.jsx   first run
src/app.jsx          App shell, routing, write queue, ReactDOM.render
```

Adding a file means adding a `<script>` tag to `index.html` in the right place.

### Working locally

`file://` will not work — the browser blocks fetching `src/*` from disk. Serve
the folder:

```bash
cd ~/finance-optimizer
python3 -m http.server 8000
```

Then open http://localhost:8000. Refresh after each edit.

### Before you push

```bash
python3 tools/build-core.py --check    # bundle matches core/
node tools/golden.mjs --check          # engine unchanged
cd tools && npm install && node render-test.mjs && cd ..   # every screen renders
```

### Deploying

```bash
git add core/ src/ tools/ index.html
git commit -m "..."
git push
```

GitHub Pages serves it as static files, so it works there unchanged.

## The cost

Babel still compiles the JSX in `src/` on every page load. `core.bundle.js` is
plain JavaScript and skips Babel entirely, so the split made first paint
slightly faster rather than slower.

The unpkg dependency for Babel remains, and it does not survive the move to
the phone. That is fine: on iOS there will be a real bundler, and `core/` is
already in the shape a bundler wants.
