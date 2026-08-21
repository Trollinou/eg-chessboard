<script setup lang="ts">
import { ref } from 'vue';
import TheChessboard from '../src/vue/TheChessboard.vue';
import type { BoardCore } from '../src/BoardCore';
import type { VariationInfo } from '../src/types';

const boardCore = ref<BoardCore | null>(null);

// Mode: true = Reader (readOnly), false = Editor (interactive branching & saves)
const isReadOnly = ref<boolean>(false);

// Inputs
const pgnInput = ref<string>(
  `[Event "Partie d'apprentissage"]\n` +
    `[Site "Antigravity"]\n` +
    `[Date "2026.07.05"]\n` +
    `[White "Professeur"]\n` +
    `[Black "Élève"]\n` +
    `[Result "*"]\n\n` +
    `1. e4 e5 { [%cal Gg1f3,Gb8c6] Commençons par l'ouverture double pion roi classique. } ` +
    `2. Nf3 Nc6 { [%cpl Gc6,Gf3] Le cavalier blanc attaque e5, le cavalier noir le défend. } ` +
    `3. Bc4 Nf6 { [%cal Gc4f7] L'attaque fritz-légère ou la défense italienne. } ` +
    `4. Ng5 d5 { [%cal Gg5f7] Menace de fourchette sur f7, paré par d5. } ` +
    `5. exd5 Na5 { [%cpl Na5] Le cavalier noir se déplace sur le côté pour attaquer le fou c4. } *`
);

const customFen = ref<string>('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3');
const showFenModal = ref<boolean>(false);

const loadError = ref<string>('');
const isLoaded = ref<boolean>(false);
const copySuccessMsg = ref<string>('');

// Reactive state synced from BoardCore
const currentComment = ref<string>('');
const isHistoryEnabled = ref<boolean>(false);
const plyViewing = ref<number>(0);
const totalPlies = ref<number>(0);
const variations = ref<VariationInfo[]>([]);
const generatedPgn = ref<string>('');

function onBoardCreated(core: BoardCore) {
  boardCore.value = core;
  handleLoadPgn();
}

function syncState() {
  const core = boardCore.value;
  if (!core) return;

  currentComment.value = core.getCurrentComment();

  const historyState = core.getHistoryViewerState();
  isHistoryEnabled.value = !!historyState.isEnabled;
  plyViewing.value =
    historyState.plyViewing !== undefined ? historyState.plyViewing : core.getCurrentPlyNumber();
  totalPlies.value = core.getCurrentPlyNumber();
  variations.value = core.getVariationsAtPly();
  generatedPgn.value = core.getPgn();
}

function toggleReadOnly() {
  isReadOnly.value = !isReadOnly.value;
  if (boardCore.value) {
    boardCore.value.setReadOnly(isReadOnly.value);
    syncState();
  }
}

function handleNewGame() {
  if (!boardCore.value) return;
  boardCore.value.newGame();
  isLoaded.value = true;
  loadError.value = '';
  syncState();
}

function handleLoadFen() {
  if (!boardCore.value) return;
  loadError.value = '';
  try {
    boardCore.value.newGame(customFen.value);
    isLoaded.value = true;
    showFenModal.value = false;
    syncState();
  } catch (err: unknown) {
    const error = err as Error;
    loadError.value = error.message || 'Erreur lors du chargement de la FEN.';
  }
}

function handleLoadPgn() {
  if (!boardCore.value) return;
  loadError.value = '';
  try {
    boardCore.value.loadPgn(pgnInput.value);
    isLoaded.value = true;
    syncState();
  } catch (err: unknown) {
    const error = err as Error;
    loadError.value = error.message || 'Erreur lors du chargement du PGN. Vérifiez sa validité.';
    isLoaded.value = false;
  }
}

function loadVariantPgnPreset() {
  pgnInput.value =
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

function loadStandardPgnPreset() {
  pgnInput.value =
    `[Event "Partie Immortelle"]\n` +
    `[Site "Londres"]\n` +
    `[Date "1851.06.21"]\n` +
    `[White "Adolf Anderssen"]\n` +
    `[Black "Lionel Kieseritzky"]\n` +
    `[Result "1-0"]\n\n` +
    `1. e4 e5 2. f4 exf4 3. Bc4 Qh4+ 4. Kf1 b5 5. Bxb5 Nf6 6. Nf3 Qh6 7. d3 Nh5 8. Nh4 Qg5 9. Nf5 c6 10. g4 Nf6 11. Rg1 cxb5 12. h4 Qg6 13. h5 Qg5 14. Qf3 Ng8 15. Bxf4 Qf6 16. Nc3 Bc5 17. Nd5 Qxb2 18. Bd6 Bxg1 19. e5 Qxa1+ 20. Ke2 Na6 21. Nxg7+ Kd8 22. Qf6+ Nxf6 23. Be7# 1-0`;
  handleLoadPgn();
}

function onCommentInput() {
  if (boardCore.value && !isReadOnly.value) {
    const currentShapes = boardCore.value.getShapes();
    boardCore.value.setComment(currentComment.value, currentShapes);
    syncState();
  }
}

function drawPresetShape(type: 'arrow-green' | 'arrow-red' | 'circle-blue' | 'clear') {
  if (!boardCore.value) return;
  if (type === 'clear') {
    boardCore.value.setShapes([]);
    if (!isReadOnly.value) {
      boardCore.value.setComment(currentComment.value, []);
    }
  } else if (type === 'arrow-green') {
    boardCore.value.drawMove('g1', 'f3', 'green');
    if (!isReadOnly.value) {
      boardCore.value.setComment(currentComment.value, boardCore.value.getShapes());
    }
  } else if (type === 'arrow-red') {
    boardCore.value.drawMove('c4', 'f7', 'red');
    if (!isReadOnly.value) {
      boardCore.value.setComment(currentComment.value, boardCore.value.getShapes());
    }
  } else if (type === 'circle-blue') {
    boardCore.value.drawCircle('c6', 'blue');
    if (!isReadOnly.value) {
      boardCore.value.setComment(currentComment.value, boardCore.value.getShapes());
    }
  }
  syncState();
}

function selectVar(idx: number) {
  if (boardCore.value?.selectVariation(idx)) {
    syncState();
  }
}

function promoteVar(idx: number) {
  if (boardCore.value?.promoteVariation(idx)) {
    syncState();
  }
}

function deleteVar(idx: number) {
  if (boardCore.value?.deleteVariation(idx)) {
    syncState();
  }
}

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

async function copyPgnToClipboard() {
  if (!generatedPgn.value) return;
  try {
    await navigator.clipboard.writeText(generatedPgn.value);
    copySuccessMsg.value = '✓ PGN copié dans le presse-papier !';
    setTimeout(() => {
      copySuccessMsg.value = '';
    }, 3000);
  } catch (_err) {
    copySuccessMsg.value = 'Erreur lors de la copie.';
  }
}
</script>

<template>
  <div class="pgn-tester-container">
    <!-- Barre de Commutation du Mode & Actions Globales -->
    <div class="mode-header-card glass-card">
      <div class="mode-info">
        <div class="mode-badge" :class="isReadOnly ? 'reader' : 'editor'">
          {{ isReadOnly ? '📖 Mode Lecteur PGN' : '✏️ Mode Éditeur PGN' }}
        </div>
        <p class="mode-desc">
          <template v-if="isReadOnly">
            <strong>Lecture seule :</strong> Parcourez l'arbre PGN sans risque d'altération. Les
            flèches/cercles ajoutés au clic droit sont <em>éphémères</em> et les pièces ne créent
            pas de variantes.
          </template>
          <template v-else>
            <strong>Édition interactive :</strong> Jouez des coups depuis n'importe quel point du
            PGN pour <em>générer des sous-variantes</em>. Les commentaires et les annotations
            visuelles sont enregistrés dans le PGN.
          </template>
        </p>
      </div>

      <div class="mode-controls">
        <button
          class="btn toggle-mode-btn"
          :class="isReadOnly ? 'btn-editor' : 'btn-reader'"
          @click="toggleReadOnly"
        >
          {{ isReadOnly ? '✏️ Passer en Mode Éditeur' : '📖 Passer en Mode Lecteur' }}
        </button>
      </div>
    </div>

    <!-- Toolbar de Création / Chargement -->
    <div class="toolbar-card glass-card">
      <div class="toolbar-buttons">
        <button class="btn btn-action" @click="handleNewGame">✨ Nouvelle Partie</button>
        <button class="btn btn-action" @click="showFenModal = !showFenModal">
          🧩 Démarrer depuis une FEN
        </button>
        <button class="btn btn-preset" @click="loadVariantPgnPreset">🌿 PGN avec Variantes</button>
        <button class="btn btn-preset" @click="loadStandardPgnPreset">♟️ Partie Immortelle</button>
      </div>

      <!-- Option FEN dépliable -->
      <div v-if="showFenModal" class="fen-input-box">
        <label>Saisir la FEN personnalisée (En-têtes SetUp & FEN générés automatiquement) :</label>
        <div class="fen-input-row">
          <input
            v-model="customFen"
            type="text"
            class="fen-input"
            placeholder="r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"
          />
          <button class="btn btn-primary" @click="handleLoadFen">Appliquer FEN</button>
        </div>
      </div>
    </div>

    <!-- Layout Principal -->
    <div class="pgn-layout">
      <!-- Section Gauche: Échiquier & Contrôles -->
      <div class="board-panel">
        <div class="board-wrapper">
          <TheChessboard
            mode="study"
            :read-only="isReadOnly"
            :free-mode="false"
            @board-created="onBoardCreated"
            @move="syncState"
          />
        </div>

        <!-- Contrôles de navigation pas-à-pas -->
        <div v-if="isLoaded" class="navigation-controls glass-card">
          <button class="nav-btn" title="Début (Coup 0)" @click="goStart">⏮️</button>
          <button class="nav-btn" title="Coup précédent" @click="goPrevious">◀️</button>
          <span class="ply-indicator"> Coup : {{ plyViewing }} / {{ totalPlies }} </span>
          <button class="nav-btn" title="Coup suivant" @click="goNext">▶️</button>
          <button class="nav-btn" title="Dernier coup / En direct" @click="goLive">⏭️</button>
        </div>

        <!-- Outils d'Annotations Visuelles Rapides (Boutons Raccourcis de Test) -->
        <div class="shapes-toolbar glass-card">
          <h3>🎨 Outils d'annotation rapide (Raccourcis de test)</h3>
          <div class="shapes-buttons">
            <button class="btn shape-btn" @click="drawPresetShape('arrow-green')">
              🟢 Flèche g1-f3
            </button>
            <button class="btn shape-btn" @click="drawPresetShape('arrow-red')">
              🔴 Flèche c4-f7
            </button>
            <button class="btn shape-btn" @click="drawPresetShape('circle-blue')">
              🔵 Rond c6
            </button>
            <button class="btn shape-btn danger" @click="drawPresetShape('clear')">
              🎨 Effacer Formes
            </button>
          </div>
          <p class="shape-tip">
            💡 <em>Note :</em> Dans un PGN, les formes appartiennent
            <strong>exclusivement au coup courant</strong>. Utilisez le clic droit / glisser sur le
            plateau pour dessiner vos propres formes sur la position affichée !
          </p>
        </div>
      </div>

      <!-- Section Droite: Import, Commentaires, Variantes & Export -->
      <div class="info-panel">
        <!-- Zone de saisie / Import PGN -->
        <div class="glass-card pgn-input-card">
          <h2>Importer un PGN</h2>
          <textarea
            v-model="pgnInput"
            placeholder="Collez votre code PGN complet ici..."
            rows="5"
            class="pgn-textarea"
          ></textarea>
          <div class="button-row">
            <button class="primary-btn" @click="handleLoadPgn">📥 Charger ce PGN</button>
          </div>
          <p v-if="loadError" class="error-msg">{{ loadError }}</p>
        </div>

        <!-- Éditeur de Commentaires pour la position courante -->
        <div class="glass-card comment-card">
          <h2>💬 Commentaire / Explications au coup {{ plyViewing }}</h2>
          <template v-if="!isReadOnly">
            <textarea
              v-model="currentComment"
              placeholder="Rédigez ici vos explications stratégiques pour cette position..."
              rows="3"
              class="comment-textarea"
              @input="onCommentInput"
            ></textarea>
            <span class="editor-note">
              ✏️ Les modifications textuelles et les formes sont enregistrées directement dans le
              PGN.
            </span>
          </template>
          <template v-else>
            <div class="comment-content">
              <p v-if="currentComment" class="comment-text">💬 {{ currentComment }}</p>
              <p v-else class="no-comment">
                Aucune explication ou commentaire rédigé pour cette position.
              </p>
            </div>
            <span class="reader-note">
              🔒 Mode Lecteur actif : passez en mode éditeur pour modifier les commentaires.
            </span>
          </template>
        </div>

        <!-- Section Gestion des Variantes Alternatives -->
        <div v-if="variations.length > 0" class="glass-card variations-card">
          <h2>🌿 Variantes alternatives à ce coup ({{ variations.length }})</h2>
          <div class="variations-list">
            <div v-for="v in variations" :key="`${v.index}-${v.san}`" class="variation-item-row">
              <button :class="['var-btn', { active: v.isActive }]" @click="selectVar(v.index)">
                {{ v.san }} <span v-if="v.isMainline" class="mainline-tag">(Ligne Principale)</span>
              </button>

              <div v-if="!isReadOnly" class="var-actions">
                <button
                  v-if="!v.isMainline"
                  class="btn btn-tiny promote"
                  title="Promouvoir en ligne principale"
                  @click="promoteVar(v.index)"
                >
                  ⬆️ Promouvoir
                </button>
                <button
                  class="btn btn-tiny delete"
                  title="Supprimer cette variante"
                  @click="deleteVar(v.index)"
                >
                  🗑️ Supprimer
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Exportation du PGN en Temps Réel -->
        <div class="glass-card export-card">
          <div class="export-header">
            <h2>📄 PGN Généré en temps réel</h2>
            <button class="btn btn-secondary copy-btn" @click="copyPgnToClipboard">
              📋 Copier le PGN
            </button>
          </div>
          <p v-if="copySuccessMsg" class="success-msg">{{ copySuccessMsg }}</p>
          <pre class="pgn-code-output">{{ generatedPgn }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pgn-tester-container {
  color: #fff;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.mode-header-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  gap: 16px;
  flex-wrap: wrap;
}

.mode-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 20px;
  font-weight: bold;
  font-size: 0.9rem;
  margin-bottom: 6px;
}

.mode-badge.reader {
  background: rgba(59, 130, 246, 0.2);
  color: #60a5fa;
  border: 1px solid rgba(96, 165, 250, 0.4);
}

.mode-badge.editor {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
  border: 1px solid rgba(52, 211, 153, 0.4);
}

.mode-desc {
  font-size: 0.9rem;
  color: #d1d5db;
  margin: 0;
  line-height: 1.4;
}

.toggle-mode-btn {
  padding: 10px 18px;
  font-weight: bold;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
}

.btn-editor {
  background: #10b981;
  color: #fff;
}

.btn-editor:hover {
  background: #059669;
}

.btn-reader {
  background: #3b82f6;
  color: #fff;
}

.btn-reader:hover {
  background: #2563eb;
}

.toolbar-card {
  padding: 14px 20px;
}

.toolbar-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.btn-action {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #fff;
  padding: 8px 14px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-action:hover {
  background: rgba(255, 255, 255, 0.2);
}

.btn-preset {
  background: rgba(99, 102, 241, 0.2);
  border: 1px solid rgba(99, 102, 241, 0.4);
  color: #a5b4fc;
  padding: 8px 14px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-preset:hover {
  background: rgba(99, 102, 241, 0.3);
}

.fen-input-box {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.fen-input-box label {
  font-size: 0.85rem;
  color: #9ca3af;
}

.fen-input-row {
  display: flex;
  gap: 10px;
}

.fen-input {
  flex: 1;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  color: #fff;
  padding: 8px 12px;
  font-family: monospace;
  font-size: 0.9rem;
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

.shapes-toolbar {
  width: 100%;
  max-width: 480px;
  padding: 14px;
}

.shapes-toolbar h3 {
  font-size: 0.95rem;
  margin: 0 0 10px 0;
  color: #e5e7eb;
}

.shapes-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.shape-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #fff;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
  transition: background 0.2s;
}

.shape-btn:hover {
  background: rgba(255, 255, 255, 0.18);
}

.shape-btn.danger {
  color: #f87171;
  border-color: rgba(248, 113, 113, 0.3);
}

.shape-tip {
  font-size: 0.78rem;
  color: #9ca3af;
  margin: 8px 0 0 0;
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
  font-size: 0.85rem;
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
  padding: 8px 16px;
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

.comment-textarea {
  width: 100%;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  color: #fff;
  padding: 10px;
  font-family: inherit;
  font-size: 0.95rem;
  resize: vertical;
  margin-top: 8px;
}

.editor-note,
.reader-note {
  display: block;
  font-size: 0.78rem;
  color: #9ca3af;
  margin-top: 6px;
}

.comment-text {
  font-size: 1.05rem;
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

.variations-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.variation-item-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: rgba(255, 255, 255, 0.04);
  padding: 6px 10px;
  border-radius: 6px;
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

.mainline-tag {
  font-size: 0.75rem;
  color: #93c5fd;
  margin-left: 4px;
}

.var-actions {
  display: flex;
  gap: 6px;
}

.btn-tiny {
  padding: 4px 8px;
  font-size: 0.75rem;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn-tiny.promote {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
  border: 1px solid rgba(52, 211, 153, 0.3);
}

.btn-tiny.delete {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
  border: 1px solid rgba(248, 113, 113, 0.3);
}

.export-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.export-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.export-header h2 {
  font-size: 1rem;
  margin: 0;
}

.copy-btn {
  padding: 6px 12px;
  font-size: 0.85rem;
}

.success-msg {
  color: #34d399;
  font-size: 0.85rem;
  margin: 0;
}

.pgn-code-output {
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 12px;
  font-family: monospace;
  font-size: 0.85rem;
  color: #a7f3d0;
  max-height: 180px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
