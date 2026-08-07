<script setup lang="ts">
import { ref } from 'vue';
import TheChessboard from '../src/vue/TheChessboard.vue';
import type { BoardCore } from '../src/BoardCore';
import type { VariationInfo } from '../src/types';

const boardCore = ref<BoardCore | null>(null);
const pgnText = ref<string>(
  `[Event "Partie d'apprentissage"]\n` +
    `[Site "Antigravity"]\n` +
    `[Date "2026.07.05"]\n` +
    `[White "Professeur"]\n` +
    `[Black "Élève"]\n` +
    `[Result "*"]\n\n` +
    `1. e4 e5 { [%cal Gg1f3,Gg8c6] Commençons par l'ouverture double pion roi classique. } ` +
    `2. Nf3 Nc6 { [%cpl Gc6,Gf3] Le cavalier blanc attaque e5, le cavalier noir le défend. } ` +
    `3. Bc4 Nf6 { [%cal Gc4f7] L'attaque fritz-légère ou la défense italienne. } ` +
    `4. Ng5 d5 { [%cal Gg5f7] Menace de fourchette sur f7, paré par d5. } ` +
    `5. exd5 Na5 { [%cpl Na5] Le cavalier noir se déplace sur le côté pour attaquer le fou c4. } *`
);

const loadError = ref<string>('');
const isLoaded = ref<boolean>(false);

// Reactive state synced from BoardCore
const currentComment = ref<string>('');
const isHistoryEnabled = ref<boolean>(false);
const plyViewing = ref<number>(0);
const totalPlies = ref<number>(0);
const variations = ref<VariationInfo[]>([]);

function onBoardCreated(core: BoardCore) {
  boardCore.value = core;
  // Load default PGN
  handleLoadPgn();
}

function handleLoadPgn() {
  if (!boardCore.value) return;
  loadError.value = '';
  try {
    boardCore.value.loadPgn(pgnText.value);
    isLoaded.value = true;
    syncState();
  } catch (err: unknown) {
    const error = err as Error;
    loadError.value = error.message || 'Erreur lors du chargement du PGN. Vérifiez sa validité.';
    isLoaded.value = false;
  }
}

function loadVariantPgn() {
  pgnText.value =
    `[Event "Exemple avec Variantes PGN"]\n` +
    `[Site "Lichess"]\n` +
    `[Date "2026.07.28"]\n` +
    `[White "Joueur A"]\n` +
    `[Black "Joueur B"]\n` +
    `[Result "*"]\n\n` +
    `1. e4 e5 (1... c5 { [%cal Gc5d4] La défense sicilienne. } 2. Nf3 d6 3. d4 cxd4 4. Nxd4) ` +
    `2. Nf3 Nc6 (2... Nf6 { [%cal Gf6e4] La défense Petroff. } 3. Nxe5 d6) ` +
    `3. Bc4 Bc5 { [%cpl Bc5] L'ouverture italienne classique. } *`;
  handleLoadPgn();
}

function syncState() {
  const core = boardCore.value;
  if (!core) return;

  // Sync comment
  currentComment.value = core.getCurrentComment();

  // Sync history state
  const historyState = core.getHistoryViewerState();
  isHistoryEnabled.value = !!historyState.isEnabled;
  plyViewing.value =
    historyState.plyViewing !== undefined ? historyState.plyViewing : core.getCurrentPlyNumber();
  totalPlies.value = core.getCurrentPlyNumber();
  variations.value = core.getVariationsAtPly();
}

function selectVar(idx: number) {
  if (boardCore.value?.selectVariation(idx)) {
    syncState();
  }
}

// Navigation methods
function goStart() {
  boardCore.value?.viewStart();
  syncState();
}

function goPrevious() {
  boardCore.value?.viewPrevious();
  syncState();
}

function goNext() {
  boardCore.value?.viewNext();
  syncState();
}

function goLive() {
  boardCore.value?.stopViewingHistory();
  syncState();
}
</script>

<template>
  <div class="pgn-tester-container">
    <div class="pgn-layout">
      <!-- Section Gauche: L'échiquier -->
      <div class="board-panel">
        <div class="board-wrapper">
          <TheChessboard mode="study" :free-mode="false" @board-created="onBoardCreated" @move="syncState" />
        </div>

        <!-- Contrôles de navigation -->
        <div v-if="isLoaded" class="navigation-controls glass-card">
          <button class="nav-btn" title="Début" @click="goStart">⏮️</button>
          <button class="nav-btn" title="Coup précédent" @click="goPrevious">◀️</button>
          <span class="ply-indicator"> Coup : {{ plyViewing }} / {{ totalPlies }} </span>
          <button class="nav-btn" title="Coup suivant" @click="goNext">▶️</button>
          <button class="nav-btn" title="Position finale" @click="goLive">⏭️</button>
        </div>
      </div>

      <!-- Section Droite: Éditeur PGN & Commentaires -->
      <div class="info-panel">
        <!-- Zone de saisie PGN -->
        <div class="glass-card pgn-input-card">
          <h2>Importer du PGN</h2>
          <textarea
            v-model="pgnText"
            placeholder="Collez votre PGN ici (contenant éventuellement des explications et des flèches/ronds)..."
            rows="6"
            class="pgn-textarea"
          ></textarea>
          <div class="button-row">
            <button class="primary-btn" @click="handleLoadPgn">Charger le PGN</button>
            <button class="secondary-btn" @click="loadVariantPgn">Exemple avec Variantes</button>
          </div>
          <p v-if="loadError" class="error-msg">{{ loadError }}</p>
        </div>

        <!-- Affichage des explications -->
        <div class="glass-card comment-card">
          <h2>Explications / Commentaires</h2>
          <div class="comment-content">
            <p v-if="currentComment" class="comment-text">💬 {{ currentComment }}</p>
            <p v-else class="no-comment">
              Aucune explication ou commentaire disponible pour cette position.
            </p>
          </div>
        </div>

        <!-- Section Variantes (si plusieurs sous-lignes existent) -->
        <div v-if="variations.length > 1" class="glass-card variations-card">
          <h2>🌿 Variantes alternatives à ce coup</h2>
          <div class="variations-buttons">
            <button
              v-for="v in variations"
              :key="v.index"
              :class="['var-btn', { active: v.isMainline }]"
              @click="selectVar(v.index)"
            >
              {{ v.san }} <span v-if="v.isMainline">(Active)</span>
            </button>
          </div>
        </div>

        <!-- Astuce -->
        <div class="glass-card help-card">
          <h3>Guide des annotations graphiques</h3>
          <p>Vous pouvez tester le tracé en ajoutant ces balises dans vos commentaires PGN :</p>
          <ul>
            <li><code>[%cal Gf3h4]</code> : Flèche verte (<strong>G</strong>reen) de f3 à h4</li>
            <li><code>[%cal Rf3h4]</code> : Flèche rouge (<strong>R</strong>ed)</li>
            <li><code>[%cpl Gc6]</code> : Rond vert sur c6</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pgn-tester-container {
  color: #fff;
}

.pgn-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  align-items: start;
}

@media (max-width: 900px) {
  .pgn-layout {
    grid-template-columns: 1fr;
  }
}

.board-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.board-wrapper {
  width: 100%;
  max-width: 480px;
  aspect-ratio: 1;
}

.navigation-controls {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 480px;
  padding: 12px;
}

.nav-btn {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #fff;
  border-radius: 6px;
  padding: 8px 16px;
  cursor: pointer;
  font-size: 1.1rem;
  transition: background 0.2s;
}

.nav-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.ply-indicator {
  font-family: monospace;
  font-size: 1rem;
}

.info-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.pgn-textarea {
  width: 100%;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #fff;
  padding: 10px;
  font-family: monospace;
  font-size: 0.9rem;
  resize: vertical;
}

.button-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}

.primary-btn {
  background: #3b82f6;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 10px 20px;
  font-weight: bold;
  cursor: pointer;
  transition: background 0.2s;
}

.primary-btn:hover {
  background: #2563eb;
}

.error-msg {
  color: #ef4444;
  margin-top: 10px;
  font-size: 0.9rem;
}

.comment-card {
  min-height: 120px;
}

.comment-text {
  font-size: 1.1rem;
  line-height: 1.5;
  background: rgba(255, 255, 255, 0.05);
  padding: 12px;
  border-radius: 6px;
  border-left: 4px solid #3b82f6;
}

.no-comment {
  color: #9ca3af;
  font-style: italic;
}

.help-card code {
  background: rgba(0, 0, 0, 0.3);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: monospace;
  color: #60a5fa;
}

.help-card ul {
  padding-left: 20px;
  margin-top: 8px;
}

.help-card li {
  margin-bottom: 6px;
  font-size: 0.9rem;
}

.variations-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.var-btn {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #fff;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.2s;
}

.var-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.var-btn.active {
  background: #3b82f6;
  border-color: #60a5fa;
  font-weight: bold;
}
</style>
