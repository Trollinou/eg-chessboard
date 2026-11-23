<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { BoardTheme, PieceSet } from '../src';
import { mountReactSandbox } from './ReactMultiBoardApp';

const props = defineProps<{
  pieceSet: PieceSet;
  boardTheme: BoardTheme;
}>();

const containerRef = ref<HTMLElement | null>(null);
let reactMount: ReturnType<typeof mountReactSandbox> | null = null;

onMounted(() => {
  if (containerRef.value) {
    reactMount = mountReactSandbox(containerRef.value, {
      pieceSet: props.pieceSet,
      boardTheme: props.boardTheme,
    });
  }
});

watch(
  () => [props.pieceSet, props.boardTheme] as const,
  ([pieceSet, boardTheme]) => {
    reactMount?.updateProps({ pieceSet, boardTheme });
  }
);

onBeforeUnmount(() => {
  reactMount?.unmount();
  reactMount = null;
});
</script>

<template>
  <div ref="containerRef" class="react-sandbox-host"></div>
</template>
