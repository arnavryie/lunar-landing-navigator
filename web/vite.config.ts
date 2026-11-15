import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// CesiumJS (Moon Explorer page) loads its web workers, widget CSS and star/sky assets at run time
// from <base>/cesium/, so they are copied there (served in dev, written to dist/ on build).
const cesiumBuild = 'node_modules/cesium/Build/Cesium'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  resolve: {
    alias: {
      // Upstream @cesium/engine imports this internal path removed in @zip.js/zip.js 2.25 exports map.
      '@zip.js/zip.js/lib/zip-no-worker.js': '@zip.js/zip.js',
    },
  },
  plugins: [
    react(),
    viteStaticCopy({
      targets: ['Workers', 'ThirdParty', 'Assets', 'Widgets'].map((d) => ({ src: `${cesiumBuild}/${d}`, dest: 'cesium' })),
    }),
  ],
})
