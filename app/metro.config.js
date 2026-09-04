/* ===========================================================================
   Norte — Metro
   ---------------------------------------------------------------------------
   La app vive dentro del repo, no en uno aparte, porque core/ es el motor
   compartido entre la web y el teléfono. Si viviera en dos repos habría dos
   motores separándose sin que nadie lo note.

   Metro por defecto solo mira dentro de app/, así que hay que decirle
   explícitamente que core/ y data/ también son suyos.

   Se vigilan esas dos carpetas y no la raíz entera: tools/ tiene su propio
   node_modules y no hay razón para que Metro lo rastree.
   =========================================================================== */

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [
  path.resolve(repoRoot, 'core'),
  path.resolve(repoRoot, 'data'),
];

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  '@core': path.resolve(repoRoot, 'core'),
  '@market': path.resolve(repoRoot, 'data/market'),
};

module.exports = config;
