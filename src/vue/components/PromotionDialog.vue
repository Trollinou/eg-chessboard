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
.promotion-dialog {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 1000;
  background: white;
  border: 2px solid #333;
  border-radius: 8px;
  padding: 10px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.4);
}

.promotion-pieces {
  display: flex;
  gap: 12px;
}

.promotion-piece-btn {
  background: #f0f0f0;
  border: 1px solid #ccc;
  border-radius: 6px;
  cursor: pointer;
  width: 55px;
  height: 55px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-size: 80% 80%;
  background-position: center;
  background-repeat: no-repeat;
  transition: background-color 0.2s, transform 0.1s;
}

.promotion-piece-btn:hover {
  background-color: #e2e2e2;
  transform: scale(1.05);
}

.promotion-piece-btn:active {
  transform: scale(0.95);
}
</style>
