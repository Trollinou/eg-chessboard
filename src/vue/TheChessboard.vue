<script lang="ts">
export {
  BoardCore,
  type BoardCoreState,
  type StockfishConfig,
  type ChessDiagram,
} from '../BoardCore';
</script>

<script setup lang="ts">
import { ref, shallowRef, onMounted, onUnmounted, reactive, watch } from 'vue';
import type { Config } from '@lichess-org/chessground/config';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Move } from 'chess.js';
import {
  BoardCore,
  type BoardCoreState,
  type StockfishConfig,
  type ChessDiagram,
} from '../BoardCore';
import PromotionDialog from './components/PromotionDialog.vue';

const props = withDefaults(
  defineProps<{
    boardConfig?: Config;
    playerColor?: 'white' | 'black' | 'both';
    freeMode?: boolean;
    soloMode?: boolean;
    fitContainer?: boolean;
    preserveShapesOnPositionChange?: boolean;
    stockfishConfig?: StockfishConfig;
    diagram?: ChessDiagram;
  }>(),
  {
    boardConfig: () => ({}),
    freeMode: false,
    soloMode: false,
    fitContainer: false,
    preserveShapesOnPositionChange: false,
    stockfishConfig: () => ({}),
  }
);

const emit = defineEmits<{
  'board-created': [api: BoardCore];
  move: [move: Move];
  check: [color: string];
  checkmate: [color: string];
  stalemate: [];
  draw: [];
  promotion: [detail: { from: string; to: string; promotedTo: string }];
  'stockfish-hint': [bestMove: string];
  'square-click': [square: string];
  'shapes-change': [shapes: DrawShape[]];
}>();

const boardElement = ref<HTMLElement | null>(null);
const core = shallowRef<BoardCore | null>(null);

const state = reactive<BoardCoreState>({
  showThreats: false,
  freeMode: props.freeMode,
  soloMode: props.soloMode,
  preserveShapesOnPositionChange: props.preserveShapesOnPositionChange,
  promotionDialogState: { isEnabled: false },
  historyViewerState: { isEnabled: false },
  currentComment: '',
});

// Watch for freeMode changes
watch(
  () => props.freeMode,
  (newVal) => {
    state.freeMode = newVal;
    if (core.value) {
      core.value.setFreeMode(newVal);
    }
  }
);

// Watch for soloMode changes
watch(
  () => props.soloMode,
  (newVal) => {
    state.soloMode = newVal;
    if (core.value) {
      core.value.setSoloMode(newVal);
    }
  }
);

// Watch for preserveShapesOnPositionChange changes
watch(
  () => props.preserveShapesOnPositionChange,
  (newVal) => {
    state.preserveShapesOnPositionChange = newVal;
    if (core.value) {
      core.value.setPreserveShapesOnPositionChange(newVal);
    }
  }
);

onMounted(() => {
  if (!boardElement.value) return;

  core.value = new BoardCore(
    boardElement.value,
    state,
    () => {
      // Triggered when reactive states change inside Core
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
      } else if (event === 'shapes-change') {
        emit('shapes-change', args[0] as DrawShape[]);
      }
    },
    {
      ...props.boardConfig,
      movable: {
        ...props.boardConfig.movable,
        color: props.playerColor || props.boardConfig.movable?.color,
      },
    },
    props.stockfishConfig,
    props.diagram
  );

  emit('board-created', core.value!);

  // Watch for configuration changes
  watch(
    () => props.boardConfig,
    (newConfig) => {
      if (newConfig && core.value) {
        core.value.setConfig(newConfig);
      }
    },
    { deep: true }
  );

  // Watch for Stockfish configuration changes
  watch(
    () => props.stockfishConfig,
    (newStockfishConfig) => {
      if (newStockfishConfig && core.value) {
        core.value.updateStockfishConfig(newStockfishConfig);
      }
    },
    { deep: true }
  );

  // Watch for diagram changes
  watch(
    () => props.diagram,
    (newDiagram) => {
      if (newDiagram && core.value) {
        core.value.setDiagram(newDiagram);
      }
    },
    { deep: true }
  );
});

onUnmounted(() => {
  core.value?.destroy();
  core.value = null;
});

defineExpose({
  core,
  redraw: (clearBounds = true) => core.value?.redraw(clearBounds),
});
</script>

<template>
  <section
    class="main-wrap"
    :class="{
      disabledBoard: state.promotionDialogState.isEnabled,
      viewingHistory: state.historyViewerState.isEnabled,
      'fit-container': props.fitContainer,
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
