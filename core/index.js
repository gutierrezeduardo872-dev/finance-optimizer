/* ===========================================================================
   Norte core — public surface
   ---------------------------------------------------------------------------
   Everything a host needs and nothing a host must not touch. Import from here
   rather than reaching into the files: the split between format and engine is
   an implementation detail and may move.

     web  →  tools/build-core.py flattens this into src/core.bundle.js
     RN   →  import { ccRecommend } from '../core'
     node →  import { ccRecommend } from './core/index.js'
   =========================================================================== */

export * from './format.js';
export * from './engine.js';
export * from './storage.js';
