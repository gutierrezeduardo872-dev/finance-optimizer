# render-test.mjs

Renders the real screens against the real dataset, headlessly.

## Why it exists

`esbuild` validates syntax, not that every identifier resolves. On 2026-08-17 a
find-and-replace removed the line declaring `fee` in `screens.jsx` while leaving
a reference to it thirty lines below. That is valid JavaScript, so the syntax
check passed, and the Suggestions screen threw a ReferenceError on every render
— which React surfaces as a blank screen rather than an error. It shipped, and
the user found it.

This catches that class of bug. It also caught the second one the same day: the
portfolio reallocation pick has `acct: null`, and the render dereferenced it.

## Running it

```bash
cd tools && npm install          # react, react-dom, esbuild
node render-test.mjs
```

Expected:

```
  fixture: 4 card picks, 6 account picks
  OK    Home
  OK    Suggestions
  OK    Products
```

Non-zero exit means a screen crashed. Run it before pushing anything under
`src/`.

## The fixture matters

The first version of this harness passed against the very bug it was written to
catch, because the test user had no movements — so `newCardPicks` returned
nothing and the branch containing the bug never rendered. The fixture now
asserts it produces both card and account picks and exits 2 if it does not.

A harness that cannot fail is worse than no harness: it converts "untested" into
"passing".
