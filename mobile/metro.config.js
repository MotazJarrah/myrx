const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname)

// ── rive-react-native resolver shim (June 1 2026) ────────────────────────────
// rive-react-native@9.8.3 sets its package.json `react-native` + `source` fields
// to `src/index.tsx`. Expo SDK 54's Metro resolver fails on that — it appends
// source extensions to the already-`.tsx` path and reports "none of these files
// exist", 500-ing the whole bundle. The package also ships a clean compiled
// CommonJS build at lib/commonjs/index.js (the `main` field). Redirect the bare
// `rive-react-native` specifier to that compiled entry so it resolves cleanly,
// without globally changing resolverMainFields (which would risk other deps).
const riveEntry = path.resolve(__dirname, 'node_modules/rive-react-native/lib/commonjs/index.js')
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'rive-react-native') {
    return { type: 'sourceFile', filePath: riveEntry }
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
