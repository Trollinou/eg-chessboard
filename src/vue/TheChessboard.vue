<script setup lang="ts">
import { ref, onMounted, reactive, watch } from 'vue';
import type { Config } from '@lichess-org/chessground/config';
import { BoardCore, type BoardCoreState } from '../BoardCore';
import PromotionDialog from './components/PromotionDialog.vue';

const props = withDefaults(defineProps<{
  boardConfig?: Config;
  playerColor?: 'white' | 'black' | 'both';
}>(), {
  boardConfig: () => ({}),
});

const emit = defineEmits<{
  (e: 'board-created', api: BoardCore): void;
  (e: 'move', move: any): void;
  (e: 'check', color: string): void;
  (e: 'checkmate', color: string): void;
  (e: 'stalemate'): void;
  (e: 'draw'): void;
  (e: 'promotion', detail: any): void;
}>();

const boardElement = ref<HTMLElement | null>(null);
const state = reactive<BoardCoreState>({
  showThreats: false,
  promotionDialogState: { isEnabled: false },
  historyViewerState: { isEnabled: false },
});

onMounted(() => {
  if (!boardElement.value) return;

  const core = new BoardCore(
    boardElement.value,
    state,
    () => {
      // Triggered when reactive states like promotionDialogState change inside Core
    },
    (event, ...args) => {
      // Emit events to parent Vue component
      if (event === 'move') {
        emit('move', args[0]);
      } else if (event === 'check') {
        emit('check', args[0]);
      } else if (event === 'checkmate') {
        emit('checkmate', args[0]);
      } else if (event === 'stalemate') {
        emit('stalemate');
      } else if (event === 'draw') {
        emit('draw');
      } else if (event === 'promotion') {
        emit('promotion', args[0]);
      }
    },
    {
      ...props.boardConfig,
      movable: {
        ...props.boardConfig.movable,
        color: props.playerColor || props.boardConfig.movable?.color,
      }
    }
  );

  emit('board-created', core);

  // Watch for configuration changes
  watch(() => props.boardConfig, (newConfig) => {
    if (newConfig) {
      core.setConfig(newConfig);
    }
  }, { deep: true });
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
        @promotion-selected="state.promotionDialogState = { isEnabled: false }"
      />
      <div ref="boardElement"></div>
    </div>
  </section>
</template>
