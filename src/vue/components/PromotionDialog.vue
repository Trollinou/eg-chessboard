<script setup lang="ts">
interface PromotionPiece {
  name: string;
  data: string;
}

const props = defineProps<{
  state: {
    isEnabled: boolean;
    color?: string;
    callback?: (piece: string) => void;
  };
}>();

const emit = defineEmits<{
  (e: 'promotionSelected'): void;
}>();

const promotionPieces: PromotionPiece[] = [
  { name: 'Queen', data: 'q' },
  { name: 'Knight', data: 'n' },
  { name: 'Rook', data: 'r' },
  { name: 'Bishop', data: 'b' },
];

function promotionSelected(piece: PromotionPiece): void {
  props.state.callback?.(piece.data);
  emit('promotionSelected');
}
</script>

<template>
  <dialog class="promotion-dialog" open>
    <div class="promotion-pieces">
      <button
        v-for="piece in promotionPieces"
        :key="piece.name"
        type="button"
        class="promotion-piece-btn"
        :class="[piece.name.toLowerCase(), state.color]"
        :aria-label="piece.name"
        @click="promotionSelected(piece)"
      ></button>
    </div>
  </dialog>
</template>

<style scoped>
dialog.promotion-dialog,
.promotion-dialog {
  all: unset;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 1000;
  background: #f0d9b5;
  border: 3px solid #b58863;
  border-radius: 12px;
  padding: 10px 14px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
  box-sizing: border-box;
  margin: 0;
  width: max-content;
  max-width: 90%;
  height: auto;
  display: block;
  pointer-events: auto !important;
}

.promotion-pieces {
  display: flex;
  flex-direction: row;
  gap: 12px;
  align-items: center;
  justify-content: center;
}

.promotion-piece-btn {
  background: #ffffff;
  border: 2px solid #b58863;
  border-radius: 10px;
  cursor: pointer;
  width: 72px;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-size: 92% 92%;
  background-position: center;
  background-repeat: no-repeat;
  transition: all 0.2s ease-in-out;
  pointer-events: auto !important;
}

.promotion-piece-btn:hover {
  background-color: #e6c89c;
  border-color: #8b5a2b;
  transform: scale(1.08);
}

.promotion-piece-btn:active {
  transform: scale(0.95);
}
</style>
