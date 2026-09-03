/* ===========================================================================
   Norte — web host bindings
   ---------------------------------------------------------------------------
   What is left of the old src/lib.js after the portable half moved to
   core/format.js: the three things that are true of a browser and of nothing
   else. Everything else (formatters, labels, date helpers, icon paths, and the
   whole scoring engine) now lives in core/ and arrives here through
   src/core.bundle.js, which index.html loads before this file.

   If you are looking for mxn(), catIcon(), scoreCard() or ccRecommend(), they
   are in core/. Edit them there and run:

       python3 tools/build-core.py

   Adding anything to THIS file is a claim that it cannot work on a phone.
   That claim is usually wrong. Check core/ first.
   =========================================================================== */

/* ------------------------------- backend -------------------------------- */

const API =
  "https://script.google.com/macros/s/AKfycbz0ti8iYODBR60V-AqD-YlTDK4-w7RekiMDrFsz6dJqLeJ9oqRZCyQxuEpFvpAk8ZeP/exec";

/* ------------------------------- storage -------------------------------- */

// webStorage() and KEYS come from core/storage.js via the bundle. The old
// names are kept so that no call site in src/*.jsx had to change in the split.
const LS = webStorage();

const K_SESSION = KEYS.session;
const K_MARKET = KEYS.market;
const K_USER = KEYS.user;
