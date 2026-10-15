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

