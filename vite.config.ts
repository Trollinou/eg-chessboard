import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [vue(), react()],
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
      external: ['vue', 'react', 'react-dom', 'chess.js', '@lichess-org/chessground'],
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
});
