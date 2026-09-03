/* ===========================================================================
   Norte core — storage port
   ---------------------------------------------------------------------------
   The old src/lib.js talked to localStorage directly. A phone has no
   localStorage, so the core cannot own that decision any more: it declares
   the shape it needs and the host supplies an implementation.

     web          → webStorage() over window.localStorage
     React Native → an adapter over AsyncStorage or MMKV (async; see below)
     tests        → memoryStorage(), so a test run leaves nothing behind

   Deliberately synchronous, because that is what the current call sites
   assume. AsyncStorage is not synchronous, so on the phone the app hydrates
   once at boot into a memoryStorage and writes through to AsyncStorage in the
   background. hydrate() exists for exactly that.
   =========================================================================== */

/**
 * @typedef {Object} Storage
 * @property {(key: string) => any}            get  parsed value, or null
 * @property {(key: string, value: any) => boolean} set  false if it did not persist
 * @property {(key: string) => void}           del
 */

/** In-memory. Used by tests, and as the phone's synchronous front layer. */
export function memoryStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    get(k) { return m.has(k) ? m.get(k) : null; },
    set(k, v) { m.set(k, v); return true; },
    del(k) { m.delete(k); },
    /** Snapshot, for a write-through layer to flush. */
    entries() { return Object.fromEntries(m); },
  };
}

/** Browser localStorage. Same swallow-everything behaviour as the old LS. */
export function webStorage() {
  return {
    get(k) {
      try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }
      catch { return null; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); return true; }
      catch { return false; }
    },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
}

/**
 * Synchronous front, asynchronous back. Reads never hit the slow store; every
 * write is mirrored to it and the failures are reported rather than swallowed,
 * because on a phone a lost write is a lost movement.
 *
 * @param {Storage} front  memoryStorage(), pre-filled by hydrate()
 * @param {{setItem:(k:string,v:string)=>Promise<any>, removeItem:(k:string)=>Promise<any>}} back
 * @param {(err: Error, key: string) => void} [onError]
 */
export function writeThrough(front, back, onError) {
  const fail = (k) => (e) => { if (onError) onError(e, k); };
  return {
    get: front.get,
    set(k, v) {
      front.set(k, v);
      Promise.resolve(back.setItem(k, JSON.stringify(v))).catch(fail(k));
      return true;
    },
    del(k) {
      front.del(k);
      Promise.resolve(back.removeItem(k)).catch(fail(k));
    },
  };
}

/**
 * Read a set of keys out of an async store into a memoryStorage, once, at
 * boot. Keys that are missing or corrupt are skipped rather than thrown on:
 * a bad cache entry must never be the reason the app will not open.
 *
 * @param {{getItem:(k:string)=>Promise<string|null>}} back
 * @param {string[]} keys
 */
export async function hydrate(back, keys) {
  const seed = {};
  for (const k of keys) {
    try {
      const raw = await back.getItem(k);
      if (raw != null) seed[k] = JSON.parse(raw);
    } catch { /* skip */ }
  }
  return memoryStorage(seed);
}

/** Cache keys, shared by every host so they cannot drift apart. */
export const KEYS = {
  session: 'norte.session.v1',
  market: 'norte.market.v2',
  user: 'norte.user.v2',
};
