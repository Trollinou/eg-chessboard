import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, cpSync, existsSync, mkdirSync } from 'fs';

const copyDistAssetsPlugin = () => ({
  name: 'copy-dist-assets',
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
    const scssSrc = resolve(import.meta.dirname, 'src/styles');
    const scssDest = resolve(distDir, 'scss');
    if (existsSync(scssSrc)) {
      cpSync(scssSrc, scssDest, { recursive: true });
    }
    const assetsSrc = resolve(import.meta.dirname, 'src/assets');
    const assetsDest = resolve(distDir, 'assets');
    if (existsSync(assetsSrc)) {
      cpSync(assetsSrc, assetsDest, { recursive: true });
    }
  }
});

export default defineConfig(({ command }) => {
  return {
    root: command === 'serve' ? 'sandbox' : '.',
    publicDir: resolve(import.meta.dirname, 'public'),
    resolve: {
      alias: {
        '@': resolve(import.meta.dirname, 'src'),
      },
    },
    plugins: [vue(), react(), copyDistAssetsPlugin()],
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
    build: {
      target: 'es2021',
      cssCodeSplit: true,
      lib: {
        entry: {
          index: resolve(import.meta.dirname, 'src/index.ts'),
          vue: resolve(import.meta.dirname, 'src/vue/TheChessboard.vue'),
          react: resolve(import.meta.dirname, 'src/react/Chessboard.tsx'),
          base: resolve(import.meta.dirname, 'src/styles/base.scss'),
          'pieces/alpha': resolve(import.meta.dirname, 'src/styles/pieces/alpha.scss'),
          'pieces/cardinal': resolve(import.meta.dirname, 'src/styles/pieces/cardinal.scss'),
          'pieces/cburnett': resolve(import.meta.dirname, 'src/styles/pieces/cburnett.scss'),
          'pieces/dubrovny': resolve(import.meta.dirname, 'src/styles/pieces/dubrovny.scss'),
          'pieces/fantasy': resolve(import.meta.dirname, 'src/styles/pieces/fantasy.scss'),
          'pieces/firi': resolve(import.meta.dirname, 'src/styles/pieces/firi.scss'),
          'pieces/maestro': resolve(import.meta.dirname, 'src/styles/pieces/maestro.scss'),
          'pieces/merida': resolve(import.meta.dirname, 'src/styles/pieces/merida.scss'),
          'pieces/staunty': resolve(import.meta.dirname, 'src/styles/pieces/staunty.scss'),
          'pieces/tatiana': resolve(import.meta.dirname, 'src/styles/pieces/tatiana.scss'),
        },
        formats: ['es'],
      },
      rollupOptions: {
        external: ['vue', 'react', 'react-dom', 'react/jsx-runtime', 'chessops', '@lichess-org/chessground'],
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: (assetInfo) => {
            if (assetInfo.name === 'index.css' || assetInfo.name === 'style.css') {
              return 'eg-chessboard.css';
            }
            return '[name].[ext]';
          },
          globals: {
            vue: 'Vue',
            react: 'React',
            'react-dom': 'ReactDOM',
            chessops: 'chessops',
            '@lichess-org/chessground': 'Chessground',
          },
        },
      },
    },
  };
});
