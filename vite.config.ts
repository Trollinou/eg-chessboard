import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, existsSync, mkdirSync } from 'fs';

const copyStockfishPlugin = () => ({
  name: 'copy-stockfish',
  closeBundle() {
    const distDir = resolve(__dirname, 'dist');
    if (!existsSync(distDir)) {
      mkdirSync(distDir, { recursive: true });
    }
    const srcJs = resolve(__dirname, 'node_modules/stockfish/bin/stockfish-18-lite-single.js');
    const srcWasm = resolve(__dirname, 'node_modules/stockfish/bin/stockfish-18-lite-single.wasm');
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
    publicDir: resolve(__dirname, 'public'),
    plugins: [vue(), react(), copyStockfishPlugin()],
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
    build: {
      lib: {
        entry: {
          index: resolve(__dirname, 'src/index.ts'),
          vue: resolve(__dirname, 'src/vue/TheChessboard.vue'),
          react: resolve(__dirname, 'src/react/Chessboard.tsx'),
        },
        formats: ['es'],
      },
      rollupOptions: {
        external: ['vue', 'react', 'react-dom', 'react/jsx-runtime', 'chess.js', '@lichess-org/chessground'],
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: '[name].[ext]',
          globals: {
            vue: 'Vue',
            react: 'React',
            'react-dom': 'ReactDOM',
            'chess.js': 'Chess',
            '@lichess-org/chessground': 'Chessground',
          },
        },
      },
    },
  };
});
