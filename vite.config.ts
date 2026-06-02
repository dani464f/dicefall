import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Split three.js + Rapier WASM into their own chunks so the React shell
    // can paint before the (large) 3D engine resolves. DiceTray is lazy-
    // loaded (see App.tsx), so the three/rapier chunks are deferred until
    // the canvas mounts. The default 500 KB warning is silenced because
    // the rapier WASM wrapper is intrinsically large.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Function-form manualChunks. The object-map form trips the
        // current rollup type overloads (TS picks ManualChunksFunction
        // first); a function matches both and lets us be explicit.
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three'
          if (id.includes('@dimforge/rapier3d-compat')) return 'rapier'
          return undefined
        },
      },
    },
  },
})
