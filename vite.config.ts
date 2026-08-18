import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, existsSync, mkdirSync } from 'fs';

const copyStockfishPlugin = () => ({
  name: 'copy-stockfish',
  closeBundle() {
    const distDir = resolve(import.meta.dirname, 'dist');
    if (!existsSync(distDir)) {
      mkdirSync(distDir, { recursive: true });
    }
    const srcJs = resolve(import.meta.dirname, 'node_modules/stockfish/bin/stockfish-18-lite-single.js');
    const srcWasm = resolve(import.meta.dirname, 'node_modules/stockfish/bin/stockfish-18-lite-single.wasm');
    if (existsSync(srcJs)) {
      copyFileSync(srcJs, resolve(distDir, 'stockfish.js'));
    }
    if (existsSync(srcWasm)) {
      copyFileSync(srcWasm, resolve(distDir, 'stockfish.wasm'));
    }
  }
});

export default defineConfig(({ command }) => {
  return {
    root: command === 'serve' ? 'sandbox' : '.',
    publicDir: resolve(import.meta.dirname, 'public'),
    plugins: [vue(), react(), copyStockfishPlugin()],
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
    build: {
      target: 'es2021',
      minify: 'esbuild',
      sourcemap: false,
      lib: {
        entry: {
          index: resolve(import.meta.dirname, 'src/index.ts'),
          vue: resolve(import.meta.dirname, 'src/vue/TheChessboard.vue'),
          react: resolve(import.meta.dirname, 'src/react/Chessboard.tsx'),
        },
        formats: ['es'],
      },
      rollupOptions: {
        // Externaliser UNIQUEMENT les dépendances framework (React/Vue)
        // chessops et chessground sont BUNDLÉS avec la bibliothèque pour simplifier l'intégration
        external: ['vue', 'react', 'react-dom', 'react/jsx-runtime'],
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: '[name].[ext]',
          globals: {
            vue: 'Vue',
            react: 'React',
            'react-dom': 'ReactDOM',
          },
          // Code splitting : séparer les dépendances lourdes dans des chunks distincts
          manualChunks: (id) => {
            // Regrouper chessops + chessground dans un chunk "vendor"
            if (id.includes('@lichess-org/chessground') || id.includes('chessops')) {
              return 'vendor';
            }
            // Stockfish JS est déjà géré par copyStockfishPlugin
            return null;
          },
        },
        // Optimisation du tree-shaking
        treeshake: {
          moduleSideEffects: false,
          propertyReadSideEffects: false,
        },
      },
      // Désactiver le sourcemap en production pour réduire la taille
      cssMinify: true,
    },
    // Cache optimisé pour le développement
    cacheDir: 'node_modules/.vite-cache',
  };
});
