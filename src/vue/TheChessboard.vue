<script lang="ts">
export {
  BoardCore,
  type BoardCoreState,
  type StockfishConfig,
  type StockfishMode,
  type ChessDiagram,
} from '../BoardCore';
export {
  AVAILABLE_PIECE_SETS,
  AVAILABLE_BOARD_THEMES,
  type Move,
  type BoardMode,
  type PieceSet,
  type BoardTheme,
  type BoardEvents,
  type PromotionDetail,
  type StockfishEvaluation,
  type EngineStatus,
  type GameReviewReport,
  type MoveAnalysisReport,
  type MoveJudgement,
} from '../types';
</script>

<script setup lang="ts">
import { ref, shallowRef, onMounted, onUnmounted, reactive, watch } from 'vue';
import type { Config } from '@lichess-org/chessground/config';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type {
  Move,
  BoardMode,
  PieceSet,
  BoardTheme,
  StockfishEvaluation,
  EngineStatus,
} from '../types';
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
    mode?: BoardMode;
    playerColor?: 'white' | 'black' | 'both';
    freeMode?: boolean;
    soloMode?: boolean;
    readOnly?: boolean;
    fitContainer?: boolean;
    preserveShapesOnPositionChange?: boolean;
    pieceSet?: PieceSet;
    boardTheme?: BoardTheme;
    stockfishConfig?: StockfishConfig;
    diagram?: ChessDiagram;
  }>(),
  {
    boardConfig: () => ({}),
    mode: 'game',
    freeMode: false,
    soloMode: false,
    readOnly: false,
    fitContainer: false,
    preserveShapesOnPositionChange: false,
    pieceSet: 'cburnett',
    boardTheme: 'brown',
    stockfishConfig: () => ({}),
  }
);

const emit = defineEmits<{
  'board-created': [api: BoardCore];
  move: [move: Move];
  'turn-change': [turnColor: 'white' | 'black', ply: number];
  check: [color: string];
  checkmate: [color: string];
  stalemate: [];
  draw: [];
  promotion: [detail: { from: string; to: string; promotedTo: string }];
  'stockfish-hint': [bestMove: string];
  evaluation: [evaluation: StockfishEvaluation];
  'engine-status': [status: EngineStatus];
  'game-review-progress': [percent: number];
  'square-click': [square: string];
  'shapes-change': [shapes: DrawShape[]];
}>();

const boardElement = ref<HTMLElement | null>(null);
const core = shallowRef<BoardCore | null>(null);

const state = reactive<BoardCoreState>({
  showThreats: false,
  mode: props.mode,
  playerColor: props.playerColor,
  freeMode: props.freeMode,
  soloMode: props.soloMode,
  readOnly: props.readOnly,
  preserveShapesOnPositionChange: props.preserveShapesOnPositionChange,
  pieceSet: props.pieceSet,
  boardTheme: props.boardTheme,
  promotionDialogState: { isEnabled: false },
  historyViewerState: { isEnabled: false },
  currentComment: '',
  turnColor: 'white',
  ply: 0,
  fen: '',
  isCheck: false,
  isGameOver: false,
});

// Watch for option & appearance changes
watch(
  [
    () => props.mode,
    () => props.readOnly,
    () => props.freeMode,
    () => props.soloMode,
    () => props.preserveShapesOnPositionChange,
    () => props.pieceSet,
    () => props.boardTheme,
    () => props.playerColor,
  ],
  ([mode, readOnly, freeMode, soloMode, preserveShapes, pieceSet, boardTheme, playerColor]) => {
    const c = core.value;
    if (!c) return;
    if (mode) c.setMode(mode);
    if (readOnly !== undefined) c.setReadOnly(readOnly);
    if (freeMode !== undefined) c.setFreeMode(freeMode);
    if (soloMode !== undefined) c.setSoloMode(soloMode);
    if (preserveShapes !== undefined) c.setPreserveShapesOnPositionChange(preserveShapes);
    if (pieceSet) c.setPieceSet(pieceSet);
    if (boardTheme) c.setBoardTheme(boardTheme);
    if (playerColor) c.setPlayerColor(playerColor);
  }
);

// Watch for configuration changes
watch(
  () => props.boardConfig,
  (newConfig) => {
    if (newConfig && core.value) {
      core.value.setConfig({
        ...newConfig,
        movable: {
          ...newConfig.movable,
          color: props.playerColor || newConfig.movable?.color,
        },
      });
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

onMounted(() => {
  if (!boardElement.value) return;

  core.value = new BoardCore(
    boardElement.value,
    state,
    () => {
      // Triggered when reactive states change inside Core
      if (core.value) {
        Object.assign(state, core.value.getState());
      }
    },
    (event, ...args) => {
      // Emit events to parent Vue component
      switch (event) {
        case 'move':
          return emit('move', args[0] as Move);
        case 'turn-change':
          return emit('turn-change', args[0] as 'white' | 'black', args[1] as number);
        case 'check':
          return emit('check', args[0] as string);
        case 'checkmate':
          return emit('checkmate', args[0] as string);
        case 'stalemate':
          return emit('stalemate');
        case 'draw':
          return emit('draw');
        case 'promotion':
          return emit('promotion', args[0] as { from: string; to: string; promotedTo: string });
        case 'stockfish-hint':
          return emit('stockfish-hint', args[0] as string);
        case 'evaluation':
          return emit('evaluation', args[0] as StockfishEvaluation);
        case 'engine-status':
          return emit('engine-status', args[0] as EngineStatus);
        case 'game-review-progress':
          return emit('game-review-progress', args[0] as number);
        case 'square-click':
          return emit('square-click', args[0] as string);
        case 'shapes-change':
          return emit('shapes-change', args[0] as DrawShape[]);
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
});

onUnmounted(() => {
  core.value?.destroy();
  core.value = null;
});

defineExpose({
  core,
  state,
  redraw: (clearBounds = true) => core.value?.redraw(clearBounds),
});
</script>

<template>
  <section
    class="main-wrap"
    :class="[
      `piece-set-${state.pieceSet || 'cburnett'}`,
      `board-theme-${state.boardTheme || 'brown'}`,
      {
        disabledBoard: state.promotionDialogState.isEnabled,
        viewingHistory: state.historyViewerState.isEnabled,
        'fit-container': props.fitContainer,
      },
    ]"
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
