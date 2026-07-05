<script lang="ts">
export { BoardCore, type BoardCoreState, type StockfishConfig } from '../BoardCore';
</script>

<script setup lang="ts">
import { ref, onMounted, reactive, watch } from 'vue';
import type { Config } from '@lichess-org/chessground/config';
import type { Move } from 'chess.js';
import { BoardCore, type BoardCoreState, type StockfishConfig } from '../BoardCore';
import PromotionDialog from './components/PromotionDialog.vue';

const props = withDefaults(
  defineProps<{
    boardConfig?: Config;
    playerColor?: 'white' | 'black' | 'both';
    freeMode?: boolean;
    stockfishConfig?: StockfishConfig;
  }>(),
  {
    boardConfig: () => ({}),
    freeMode: false,
    stockfishConfig: () => ({}),
  }
);

const emit = defineEmits<{
  (e: 'board-created', api: BoardCore): void;
  (e: 'move', move: Move): void;
  (e: 'check', color: string): void;
  (e: 'checkmate', color: string): void;
  (e: 'stalemate'): void;
  (e: 'draw'): void;
  (e: 'promotion', detail: { from: string; to: string; promotedTo: string }): void;
  (e: 'stockfish-hint', bestMove: string): void;
  (e: 'square-click', square: string): void;
}>();

const boardElement = ref<HTMLElement | null>(null);
let core: BoardCore | null = null;

const state = reactive<BoardCoreState>({
  showThreats: false,
  freeMode: props.freeMode,
  promotionDialogState: { isEnabled: false },
  historyViewerState: { isEnabled: false },
  currentComment: '',
});

// Watch for freeMode changes
watch(
  () => props.freeMode,
  (newVal) => {
    state.freeMode = newVal;
    if (core) {
      core.setFreeMode(newVal);
    }
  }
);

onMounted(() => {
  if (!boardElement.value) return;

  core = new BoardCore(
    boardElement.value,
    state,
    () => {
      // Triggered when reactive states like promotionDialogState change inside Core
    },
    (event, ...args) => {
      // Emit events to parent Vue component
      if (event === 'move') {
        emit('move', args[0] as Move);
      } else if (event === 'check') {
        emit('check', args[0] as string);
      } else if (event === 'checkmate') {
        emit('checkmate', args[0] as string);
      } else if (event === 'stalemate') {
        emit('stalemate');
      } else if (event === 'draw') {
        emit('draw');
      } else if (event === 'promotion') {
        emit('promotion', args[0] as { from: string; to: string; promotedTo: string });
      } else if (event === 'stockfish-hint') {
        emit('stockfish-hint', args[0] as string);
      } else if (event === 'square-click') {
        emit('square-click', args[0] as string);
      }
    },
    {
      ...props.boardConfig,
      movable: {
        ...props.boardConfig.movable,
        color: props.playerColor || props.boardConfig.movable?.color,
      },
    },
    props.stockfishConfig
  );

  emit('board-created', core);

  // Watch for configuration changes
  watch(
    () => props.boardConfig,
    (newConfig) => {
      if (newConfig && core) {
        core.setConfig(newConfig);
      }
    },
    { deep: true }
  );

  // Watch for Stockfish configuration changes
  watch(
    () => props.stockfishConfig,
    (newStockfishConfig) => {
      if (newStockfishConfig && core) {
        core.updateStockfishConfig(newStockfishConfig);
      }
    },
    { deep: true }
  );
});
</script>

<template>
  <section
    class="main-wrap"
    :class="{
      disabledBoard: state.promotionDialogState.isEnabled,
      viewingHistory: state.historyViewerState.isEnabled,
    }"
  >
    <div class="main-board">
      <PromotionDialog
        v-if="state.promotionDialogState.isEnabled"
        :state="state.promotionDialogState"
        @promotion-selected="core?.closePromotionDialog()"
      />
      <div ref="boardElement"></div>
    </div>
  </section>
</template>
