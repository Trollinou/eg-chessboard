<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import TheChessboard from '../src/vue/TheChessboard.vue';
import type { Key } from '@lichess-org/chessground/types';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { BoardCore, StockfishConfig } from '../src/BoardCore';
import {
  AVAILABLE_PIECE_SETS,
  AVAILABLE_BOARD_THEMES,
  type PieceSet,
  type BoardTheme,
} from '../src/types';
import PgnApp from './PgnApp.vue';

const selectedPieceSet = ref<PieceSet>('staunton');
const selectedBoardTheme = ref<BoardTheme>('brown');
const activeTab = ref<'stockfish' | 'pgn' | 'solo' | 'editor'>('stockfish');

// Editor / Diagram Test Mode State
const editorBoardCore = ref<BoardCore | null>(null);
const editorPreserveShapes = ref<boolean>(true);
const editorSelectedPiece = ref<{ type: 'p' | 'n' | 'b' | 'r' | 'q' | 'k'; color: 'w' | 'b' }>({
  type: 'q',
  color: 'w',
});
const editorMode = ref<'put' | 'remove'>('put');
const editorFen = ref<string>('');
const editorShapes = ref<DrawShape[]>([]);
const editorDiagramJson = ref<string>('');

const syncEditorOutputs = () => {
  if (editorBoardCore.value) {
    editorFen.value = editorBoardCore.value.getFen();
    editorShapes.value = editorBoardCore.value.getShapes();
    editorDiagramJson.value = JSON.stringify(editorBoardCore.value.getDiagram(), null, 2);
  }
};

const onEditorBoardCreated = (core: BoardCore) => {
  editorBoardCore.value = core;
  syncEditorOutputs();
};

const onEditorSquareClick = (square: string) => {
  if (!editorBoardCore.value) return;
  if (editorMode.value === 'put') {
    editorBoardCore.value.putPiece(
      { type: editorSelectedPiece.value.type, color: editorSelectedPiece.value.color },
      square
    );
  } else {
    editorBoardCore.value.removePiece(square);
  }
  syncEditorOutputs();
};

const onEditorShapesChange = () => {
  syncEditorOutputs();
};

const handleClearShapes = () => {
  if (editorBoardCore.value) {
    editorBoardCore.value.setShapes([]);
    syncEditorOutputs();
  }
};

const handleResetEditor = () => {
  if (editorBoardCore.value) {
    editorBoardCore.value.resetBoard();
    syncEditorOutputs();
  }
};

const boardCore = ref<BoardCore | null>(null);
const currentHint = ref<string>('');
const isThreatsEnabled = ref<boolean>(false);
const gameHistory = ref<string[]>([]);
const gameStatus = ref<string>('En attente du premier coup...');
const currentTurn = ref<'white' | 'black'>('white');
const capturedPieces = reactive<{ white: string[]; black: string[] }>({
  white: [],
  black: [],
});

// Solo Mode State
const soloBoardCore = ref<BoardCore | null>(null);
const soloHistory = ref<string[]>([]);
const soloSelectedPiece = ref<'pawn' | 'knight' | 'rook' | 'bishop' | 'queen' | 'king'>('knight');
const soloExercise = ref<'alone' | 'capture'>('alone');
const remainingTargets = ref<number>(0);

const getSoloFen = () => {
  if (soloSelectedPiece.value === 'pawn') {
    return soloExercise.value === 'alone'
      ? '8/4P3/8/8/8/8/8/8 w - - 0 1'
      : '3p1p2/4P3/8/8/8/8/8/8 w - - 0 1';
  } else if (soloSelectedPiece.value === 'knight') {
    return soloExercise.value === 'alone'
      ? '8/8/8/8/4N3/8/8/8 w - - 0 1'
      : '8/8/3p1p2/2p3p1/4N3/8/8/8 w - - 0 1';
  } else if (soloSelectedPiece.value === 'rook') {
    return soloExercise.value === 'alone'
      ? '8/8/8/8/4R3/8/8/8 w - - 0 1'
      : '8/3p4/8/2p1p3/4R3/8/3p4/8 w - - 0 1';
  } else if (soloSelectedPiece.value === 'bishop') {
    return soloExercise.value === 'alone'
      ? '8/8/8/8/4B3/8/8/8 w - - 0 1'
      : '8/1p5p/8/8/4B3/8/2p3p1/8 w - - 0 1';
  } else if (soloSelectedPiece.value === 'queen') {
    return soloExercise.value === 'alone'
      ? '8/8/8/8/4Q3/8/8/8 w - - 0 1'
      : '8/1p3p2/8/2p5/4Q3/5p2/8/8 w - - 0 1';
  } else {
    // King
    return soloExercise.value === 'alone'
      ? '8/8/8/8/4K3/8/8/8 w - - 0 1'
      : '8/8/3ppp2/3pK3/3ppp2/8/8/8 w - - 0 1';
  }
};

const getSoloShapes = (): DrawShape[] => {
  let start: Key = 'e4';
  let target: Key = 'c7';
  if (soloSelectedPiece.value === 'pawn') {
    start = 'e7';
    target = 'e8';
  } else if (soloSelectedPiece.value === 'knight') {
    start = 'e4';
    target = 'c7';
  } else if (soloSelectedPiece.value === 'rook') {
    start = 'e4';
    target = 'e8';
  } else if (soloSelectedPiece.value === 'bishop') {
    start = 'e4';
    target = 'a8';
  } else if (soloSelectedPiece.value === 'queen') {
    start = 'e4';
    target = 'h7';
  } else if (soloSelectedPiece.value === 'king') {
    start = 'e4';
    target = 'e8';
  }

  if (soloExercise.value !== 'alone') {
    return [{ orig: start, brush: 'blue' }];
  }

  return [
    { orig: start, brush: 'blue' },
    { orig: target, brush: 'green' },
  ];
};

const soloDiagram = computed(() => ({
  fen: getSoloFen(),
  shapes: getSoloShapes(),
}));

const updateTargetsCount = () => {
  if (!soloBoardCore.value) return;
  let count = 0;
  const pieces = soloBoardCore.value.getPieces();
  for (const piece of pieces.values()) {
    if (piece.color === 'b') {
      count++;
    }
  }
  remainingTargets.value = count;
};

const onSoloBoardCreated = (core: BoardCore) => {
  soloBoardCore.value = core;
  updateTargetsCount();
};

const onSoloMove = () => {
  if (soloBoardCore.value) {
    soloHistory.value = soloBoardCore.value.getHistory() as string[];
    updateTargetsCount();
  }
};

const selectPiece = (piece: 'pawn' | 'knight' | 'rook' | 'bishop' | 'queen' | 'king') => {
  soloSelectedPiece.value = piece;
  soloHistory.value = [];
  if (soloBoardCore.value) {
    soloBoardCore.value.setDiagram(soloDiagram.value);
  }
  setTimeout(updateTargetsCount, 50);
};

const selectExercise = (type: 'alone' | 'capture') => {
  soloExercise.value = type;
  soloHistory.value = [];
  if (soloBoardCore.value) {
    soloBoardCore.value.setDiagram(soloDiagram.value);
  }
  setTimeout(updateTargetsCount, 50);
};

const handleSoloReset = () => {
  if (soloBoardCore.value) {
    soloBoardCore.value.setDiagram(soloDiagram.value);
    soloHistory.value = [];
    setTimeout(updateTargetsCount, 50);
  }
};

const handleSoloUndo = () => {
  if (soloBoardCore.value) {
    soloBoardCore.value.undoLastMove();
    soloHistory.value = soloBoardCore.value.getHistory() as string[];
    updateTargetsCount();
  }
};

// User config according to request:
// - Whites assigned to user (playerColor = 'white')
// - whiteWorker in 'hint' mode
// - blackWorker in 'elo' mode with elo = 1400
// - blackWorker reflection time = 1500ms
const isStockfishDisabled = ref<boolean>(false);

const playerColor = computed<'white' | 'black' | 'both'>(() =>
  isStockfishDisabled.value ? 'both' : 'white'
);

const baseStockfishConfig = reactive<StockfishConfig>({
  workerUrl: '/stockfish.js',
  whiteMode: 'hint',
  whiteElo: 1500, // Hint mode uses full strength anyway
  blackMode: 'elo',
  blackElo: 1400,
  stockfishMoveTime: 1500,
});

const stockfishConfig = computed<StockfishConfig>(() => {
  if (isStockfishDisabled.value) {
    return {
      workerUrl: '/stockfish.js',
      whiteMode: 'disabled',
      blackMode: 'disabled',
    };
  }
  return baseStockfishConfig;
});

const onBoardCreated = (core: BoardCore) => {
  boardCore.value = core;
  syncState();
};

const syncState = () => {
  if (!boardCore.value) return;

  // Get history
  gameHistory.value = boardCore.value.getHistory() as string[];

  // Get turn
  currentTurn.value = boardCore.value.getTurnColor();

  // Get captured pieces
  const cap = boardCore.value.getCapturedPieces();
  capturedPieces.white = cap.white;
  capturedPieces.black = cap.black;

  // Set status text
  if (boardCore.value.getIsCheckmate()) {
    const winner =
      boardCore.value.getTurnColor() === 'white'
        ? 'Les Noirs gagnent par échec et mat !'
        : 'Les Blancs gagnent par échec et mat !';
    gameStatus.value = `🏆 ${winner}`;
  } else if (boardCore.value.getIsDraw()) {
    gameStatus.value = '🤝 Match nul !';
  } else if (boardCore.value.getIsStalemate()) {
    gameStatus.value = '🤝 Match nul par pat !';
  } else if (boardCore.value.getIsCheck()) {
    gameStatus.value = `⚠️ Échec au Roi (${currentTurn.value === 'white' ? 'Blancs' : 'Noirs'}) !`;
  } else {
    gameStatus.value =
      currentTurn.value === 'white'
        ? 'À vous de jouer ! (Blancs)'
        : isStockfishDisabled.value
          ? 'À vous de jouer ! (Noirs)'
          : 'Stockfish réfléchit... (Noirs)';
  }
};

const onMove = () => {
  // Clear white hint when a move is played
  currentHint.value = '';
  syncState();
};

const onStockfishHint = (bestMove: string) => {
  currentHint.value = bestMove;

  // Draw the hint arrow on the board
  if (boardCore.value && bestMove && bestMove.length >= 4) {
    const from = bestMove.slice(0, 2) as Key;
    const to = bestMove.slice(2, 4) as Key;
    // Draw arrow on board using a green brush
    boardCore.value.drawMove(from, to, 'green');
  }
};

// Controls
const handleNewGame = () => {
  if (boardCore.value) {
    boardCore.value.resetBoard();
    currentHint.value = '';
    isThreatsEnabled.value = false;
    syncState();
  }
};

const handleUndo = () => {
  if (boardCore.value) {
    boardCore.value.undoLastMove();
    // In player vs engine, undo once undoes engine move, undo twice undoes player move
    // We can do it twice to get back to player's turn if black just moved
    if (boardCore.value.getTurnColor() === 'black') {
      boardCore.value.undoLastMove();
    }
    currentHint.value = '';
    syncState();
  }
};

const toggleThreats = () => {
  if (boardCore.value) {
    if (isThreatsEnabled.value) {
      boardCore.value.hideMoves();
      isThreatsEnabled.value = false;
    } else {
      boardCore.value.drawThreats();
      isThreatsEnabled.value = true;
    }
  }
};

const toggleOrientation = () => {
  if (boardCore.value) {
    boardCore.value.toggleOrientation();
  }
};

const formatMove = (move: string, index: number) => {
  const moveNum = Math.floor(index / 2) + 1;
  return index % 2 === 0 ? `${moveNum}. ${move}` : `${move}`;
};
</script>

<template>
  <div class="app-container">
    <header class="app-header">
      <div class="logo-area">
        <span class="logo-icon">♟️</span>
        <h1>
          eg-chessboard
          <span class="badge">{{
            activeTab === 'stockfish'
              ? 'Stockfish Sandbox'
              : activeTab === 'solo'
                ? 'Solo Sandbox'
                : 'Lecteur & Éditeur PGN'
          }}</span>
        </h1>
      </div>
      <div class="tab-selector">
        <button
          :class="{ active: activeTab === 'stockfish' }"
          class="tab-btn"
          @click="activeTab = 'stockfish'"
        >
          🤖 Mode Stockfish
        </button>
        <button
          :class="{ active: activeTab === 'solo' }"
          class="tab-btn"
          @click="activeTab = 'solo'"
        >
          🐴 Mode Solo (Apprentissage)
        </button>
        <button
          :class="{ active: activeTab === 'editor' }"
          class="tab-btn"
          @click="activeTab = 'editor'"
        >
          ✏️ Mode Édition & Diagramme
        </button>
        <button :class="{ active: activeTab === 'pgn' }" class="tab-btn" @click="activeTab = 'pgn'">
          📖 Lecteur & Éditeur PGN
        </button>
      </div>
      <div class="theme-selector" style="margin-left: auto; display: flex; align-items: center; gap: 16px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <label for="piece-set-select" style="font-size: 0.85rem; color: #a1a1aa;">🎨 Pièces :</label>
          <select
            id="piece-set-select"
            v-model="selectedPieceSet"
            style="background: #18181b; color: #e4e4e7; border: 1px solid #3f3f46; border-radius: 6px; padding: 4px 8px; font-size: 0.85rem; cursor: pointer;"
          >
            <option v-for="set in AVAILABLE_PIECE_SETS" :key="set" :value="set">
              {{ set.toUpperCase() }}
            </option>
          </select>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <label for="board-theme-select" style="font-size: 0.85rem; color: #a1a1aa;">🏁 Échiquier :</label>
          <select
            id="board-theme-select"
            v-model="selectedBoardTheme"
            style="background: #18181b; color: #e4e4e7; border: 1px solid #3f3f46; border-radius: 6px; padding: 4px 8px; font-size: 0.85rem; cursor: pointer;"
          >
            <option v-for="theme in AVAILABLE_BOARD_THEMES" :key="theme" :value="theme">
              {{ theme.toUpperCase() }}
            </option>
          </select>
        </div>
      </div>
    </header>

    <main v-if="activeTab === 'stockfish'" class="app-layout">
      <!-- Left column: The board -->
      <section class="board-column">
        <div class="board-wrapper">
          <TheChessboard
            :player-color="playerColor"
            :stockfish-config="stockfishConfig"
            :piece-set="selectedPieceSet"
            :board-theme="selectedBoardTheme"
            @board-created="onBoardCreated"
            @move="onMove"
            @check="syncState"
            @checkmate="syncState"
            @stalemate="syncState"
            @draw="syncState"
            @stockfish-hint="onStockfishHint"
          />
        </div>
      </section>

      <!-- Right column: Controls & Info -->
      <section class="controls-column">
        <!-- Live status card -->
        <div class="glass-card status-card" :class="{ 'warning-border': boardCore?.getIsCheck() }">
          <h2>Statut de la partie</h2>
          <div class="status-indicator">
            <span class="pulse-dot" :class="currentTurn"></span>
            <span class="status-text">{{ gameStatus }}</span>
          </div>
        </div>

        <!-- Hint Card -->
        <div v-if="!isStockfishDisabled" class="glass-card hint-card">
          <h2>Suggestion d'aide (Mode Hint)</h2>
          <p class="description">
            Le <strong>whiteWorker</strong> analyse la position et propose le meilleur coup pour
            vous (Blancs).
          </p>
          <div class="hint-display">
            <span class="hint-label">Meilleur coup :</span>
            <span v-if="currentHint" class="hint-value">{{ currentHint }}</span>
            <span v-else class="hint-placeholder">Analyse en cours... (ou jouez un coup)</span>
          </div>
          <p v-if="currentHint" class="hint-subtext">
            💡 Une flèche verte a été dessinée sur le plateau pour visualiser ce coup.
          </p>
        </div>

        <!-- Configurations -->
        <div class="glass-card config-card">
          <h2>Configuration de la partie</h2>
          <div class="config-grid">
            <div class="config-item">
              <span class="config-label">Mode :</span>
              <span class="config-value">{{
                isStockfishDisabled ? '👥 2 Joueurs (Manuel)' : '🤖 vs Stockfish IA'
              }}</span>
            </div>
            <div class="config-item">
              <span class="config-label">Joueur Blanc :</span>
              <span class="config-value white-text">{{
                isStockfishDisabled ? 'Humain' : 'Humain + Hint'
              }}</span>
            </div>
            <div class="config-item">
              <span class="config-label">Joueur Noir :</span>
              <span class="config-value black-text">{{
                isStockfishDisabled ? 'Humain' : `Stockfish (ELO ${baseStockfishConfig.blackElo})`
              }}</span>
            </div>
          </div>
        </div>

        <!-- Controls card -->
        <div class="glass-card action-card">
          <h2>Actions</h2>
          <div class="action-buttons">
            <button id="btn-new" class="btn btn-primary" @click="handleNewGame">
              🔄 Nouvelle Partie
            </button>
            <button
              id="btn-toggle-stockfish"
              :class="{ active: isStockfishDisabled }"
              class="btn btn-secondary"
              @click="isStockfishDisabled = !isStockfishDisabled"
            >
              {{
                isStockfishDisabled
                  ? '🤖 Activer Stockfish (IA)'
                  : '👥 Débrayer Stockfish (2 Joueurs)'
              }}
            </button>
            <button
              id="btn-undo"
              :disabled="gameHistory.length === 0"
              class="btn btn-secondary"
              @click="handleUndo"
            >
              ↩️ Annuler le coup
            </button>
            <button
              id="btn-threats"
              :class="{ active: isThreatsEnabled }"
              class="btn btn-secondary"
              @click="toggleThreats"
            >
              👁️ {{ isThreatsEnabled ? 'Masquer' : 'Montrer' }} les Menaces
            </button>
            <button id="btn-rotate" class="btn btn-secondary" @click="toggleOrientation">
              🔄 Tourner le plateau
            </button>
          </div>
        </div>

        <!-- Game History -->
        <div class="glass-card history-card">
          <h2>Historique des coups</h2>
          <div v-if="gameHistory.length > 0" class="history-list">
            <span v-for="(move, index) in gameHistory" :key="index" class="history-move">
              {{ formatMove(move, index) }}
            </span>
          </div>
          <span v-else class="history-empty">Aucun coup joué pour le moment.</span>
        </div>
      </section>
    </main>

    <main v-else-if="activeTab === 'solo'" class="app-layout">
      <!-- Left column: The board -->
      <section class="board-column">
        <div class="board-wrapper">
          <TheChessboard
            mode="game"
            player-color="white"
            :solo-mode="true"
            :preserve-shapes-on-position-change="true"
            :diagram="soloDiagram"
            :piece-set="selectedPieceSet"
            :board-theme="selectedBoardTheme"
            @board-created="onSoloBoardCreated"
            @move="onSoloMove"
          />
        </div>
      </section>

      <!-- Right column: Controls & Info -->
      <section class="controls-column">
        <!-- Live status card -->
        <div
          class="glass-card status-card"
          :class="{ 'success-border': remainingTargets === 0 && soloExercise === 'capture' }"
        >
          <h2>Statut de l'exercice</h2>
          <div class="status-indicator">
            <span v-if="soloExercise === 'alone'" class="status-text">
              🎯 Déplacez la pièce du cercle bleu (départ) au cercle vert (arrivée) !
            </span>
            <span v-else-if="remainingTargets > 0" class="status-text">
              🎯 Capturez tous les pions noirs ! Encore
              <strong>{{ remainingTargets }}</strong> cible{{ remainingTargets > 1 ? 's' : '' }} à
              capturer.
            </span>
            <span v-else class="status-text success-text">
              🎉 Félicitations ! Tous les pions noirs ont été capturés !
            </span>
          </div>
        </div>

        <!-- Piece Selector Card -->
        <div class="glass-card">
          <h2>Choisir la pièce à déplacer</h2>
          <div class="piece-selector-grid">
            <button
              :class="{ active: soloSelectedPiece === 'pawn' }"
              class="btn btn-secondary piece-btn"
              @click="selectPiece('pawn')"
            >
              ♙ Pion
            </button>
            <button
              :class="{ active: soloSelectedPiece === 'knight' }"
              class="btn btn-secondary piece-btn"
              @click="selectPiece('knight')"
            >
              🐴 Cavalier
            </button>
            <button
              :class="{ active: soloSelectedPiece === 'rook' }"
              class="btn btn-secondary piece-btn"
              @click="selectPiece('rook')"
            >
              🏰 Tour
            </button>
            <button
              :class="{ active: soloSelectedPiece === 'bishop' }"
              class="btn btn-secondary piece-btn"
              @click="selectPiece('bishop')"
            >
              🎯 Fou
            </button>
            <button
              :class="{ active: soloSelectedPiece === 'queen' }"
              class="btn btn-secondary piece-btn"
              @click="selectPiece('queen')"
            >
              👑 Dame
            </button>
            <button
              :class="{ active: soloSelectedPiece === 'king' }"
              class="btn btn-secondary piece-btn"
              @click="selectPiece('king')"
            >
              👑 Roi
            </button>
          </div>
        </div>

        <!-- Mode type selector -->
        <div class="glass-card">
          <h2>Type d'activité</h2>
          <div class="action-buttons">
            <button
              :class="{ active: soloExercise === 'alone' }"
              class="btn btn-secondary"
              @click="selectExercise('alone')"
            >
              🗺️ Pièce seule
            </button>
            <button
              :class="{ active: soloExercise === 'capture' }"
              class="btn btn-secondary"
              @click="selectExercise('capture')"
            >
              ⚔️ Labyrinthe de captures
            </button>
          </div>
        </div>

        <!-- Controls card -->
        <div class="glass-card action-card">
          <h2>Actions</h2>
          <div class="action-buttons">
            <button class="btn btn-primary" @click="handleSoloReset">🔄 Réinitialiser</button>
            <button
              :disabled="soloHistory.length === 0"
              class="btn btn-secondary"
              @click="handleSoloUndo"
            >
              ↩️ Annuler le coup
            </button>
          </div>
        </div>

        <!-- Game History -->
        <div class="glass-card history-card">
          <h2>Historique des coups</h2>
          <div v-if="soloHistory.length > 0" class="history-list">
            <span v-for="(move, index) in soloHistory" :key="index" class="history-move">
              {{ index + 1 }}. {{ move }}
            </span>
          </div>
          <span v-else class="history-empty">Aucun coup joué pour le moment.</span>
        </div>
      </section>
    </main>

    <main v-else-if="activeTab === 'editor'" class="app-layout">
      <!-- Left column: The board in free edit mode -->
      <section class="board-column">
        <div class="board-wrapper">
          <TheChessboard
            mode="editor"
            :free-mode="true"
            :preserve-shapes-on-position-change="editorPreserveShapes"
            :piece-set="selectedPieceSet"
            :board-theme="selectedBoardTheme"
            @board-created="onEditorBoardCreated"
            @square-click="onEditorSquareClick"
            @shapes-change="onEditorShapesChange"
          />
        </div>
      </section>

      <!-- Right column: Controls & Diagram outputs -->
      <section class="controls-column">
        <!-- Mode & Shapes preservation card -->
        <div class="glass-card">
          <h2>Options d'Édition</h2>
          <div class="config-grid">
            <div class="config-item">
              <span class="config-label">Mode d'action au clic :</span>
              <div class="action-buttons" style="grid-template-columns: 1fr 1fr; margin-top: 6px">
                <button
                  :class="{ active: editorMode === 'put' }"
                  class="btn btn-secondary"
                  @click="editorMode = 'put'"
                >
                  ➕ Poser pièce
                </button>
                <button
                  :class="{ active: editorMode === 'remove' }"
                  class="btn btn-secondary"
                  @click="editorMode = 'remove'"
                >
                  ❌ Retirer pièce
                </button>
              </div>
            </div>

            <div class="config-item" style="margin-top: 10px">
              <label
                style="
                  display: flex;
                  align-items: center;
                  gap: 8px;
                  cursor: pointer;
                  color: var(--text-primary);
                "
              >
                <input
                  v-model="editorPreserveShapes"
                  type="checkbox"
                  style="width: 18px; height: 18px; accent-color: var(--primary)"
                />
                <strong>Conservations des Formes (Flèches/Cercles)</strong>
              </label>
              <p style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 4px">
                Quand activé (<code>preserveShapesOnPositionChange = true</code>), la pose ou
                suppression de pièces ne fait pas disparaître les flèches dessinées !
              </p>
            </div>
          </div>
        </div>

        <!-- Piece Selector Card -->
        <div v-if="editorMode === 'put'" class="glass-card">
          <h2>Choisir la pièce à poser</h2>
          <div style="display: flex; gap: 8px; margin-bottom: 8px">
            <button
              :class="{ active: editorSelectedPiece.color === 'w' }"
              class="btn btn-secondary"
              @click="editorSelectedPiece.color = 'w'"
            >
              ⚪ Blancs
            </button>
            <button
              :class="{ active: editorSelectedPiece.color === 'b' }"
              class="btn btn-secondary"
              @click="editorSelectedPiece.color = 'b'"
            >
              ⚫ Noirs
            </button>
          </div>
          <div class="piece-selector-grid">
            <button
              :class="{ active: editorSelectedPiece.type === 'q' }"
              class="btn btn-secondary piece-btn"
              @click="editorSelectedPiece.type = 'q'"
            >
              👑 Dame ({{ editorSelectedPiece.color === 'w' ? '♕' : '♛' }})
            </button>
            <button
              :class="{ active: editorSelectedPiece.type === 'r' }"
              class="btn btn-secondary piece-btn"
              @click="editorSelectedPiece.type = 'r'"
            >
              🏰 Tour ({{ editorSelectedPiece.color === 'w' ? '♖' : '♜' }})
            </button>
            <button
              :class="{ active: editorSelectedPiece.type === 'b' }"
              class="btn btn-secondary piece-btn"
              @click="editorSelectedPiece.type = 'b'"
            >
              🎯 Fou ({{ editorSelectedPiece.color === 'w' ? '♗' : '♝' }})
            </button>
            <button
              :class="{ active: editorSelectedPiece.type === 'n' }"
              class="btn btn-secondary piece-btn"
              @click="editorSelectedPiece.type = 'n'"
            >
              🐴 Cavalier ({{ editorSelectedPiece.color === 'w' ? '♘' : '♞' }})
            </button>
            <button
              :class="{ active: editorSelectedPiece.type === 'p' }"
              class="btn btn-secondary piece-btn"
              @click="editorSelectedPiece.type = 'p'"
            >
              ♙ Pion ({{ editorSelectedPiece.color === 'w' ? '♙' : '♟' }})
            </button>
            <button
              :class="{ active: editorSelectedPiece.type === 'k' }"
              class="btn btn-secondary piece-btn"
              @click="editorSelectedPiece.type = 'k'"
            >
              ♔ Roi ({{ editorSelectedPiece.color === 'w' ? '♔' : '♚' }})
            </button>
          </div>
        </div>

        <!-- Controls card -->
        <div class="glass-card action-card">
          <h2>Actions sur l'échiquier</h2>
          <div class="action-buttons">
            <button class="btn btn-secondary" @click="handleClearShapes">🎨 Effacer Formes</button>
            <button class="btn btn-primary" @click="handleResetEditor">🔄 Reset Position</button>
          </div>
          <p style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 8px">
            💡 <em>Astuce :</em> Utilisez le clic droit / glisser sur l'échiquier pour dessiner des
            flèches et des cercles !
          </p>
        </div>

        <!-- Diagram Output Card -->
        <div class="glass-card history-card">
          <h2>Sorties du Diagramme (FEN & Formes)</h2>
          <div style="font-size: 0.8rem; display: flex; flex-direction: column; gap: 8px">
            <div>
              <strong>FEN :</strong>
              <code
                style="
                  display: block;
                  background: rgba(0, 0, 0, 0.3);
                  padding: 6px;
                  border-radius: 4px;
                  overflow-x: auto;
                  word-break: break-all;
                  margin-top: 4px;
                "
              >
                {{ editorFen }}
              </code>
            </div>
            <div>
              <strong>Formes ({{ editorShapes.length }}) :</strong>
              <code
                style="
                  display: block;
                  background: rgba(0, 0, 0, 0.3);
                  padding: 6px;
                  border-radius: 4px;
                  overflow-x: auto;
                  margin-top: 4px;
                "
              >
                {{ JSON.stringify(editorShapes) }}
              </code>
            </div>
            <div>
              <strong>Diagramme Exporté (`getDiagram()`) :</strong>
              <pre
                style="
                  background: rgba(0, 0, 0, 0.3);
                  padding: 6px;
                  border-radius: 4px;
                  overflow-x: auto;
                  margin-top: 4px;
                  font-size: 0.75rem;
                "
                >{{ editorDiagramJson }}</pre>
            </div>
          </div>
        </div>
      </section>
    </main>

    <PgnApp
      v-else
      :piece-set="selectedPieceSet"
      :board-theme="selectedBoardTheme"
    />
  </div>
</template>

<style>
/* Page styling using curated aesthetics */
:root {
  --bg-color: #0b0f19;
  --card-bg: rgba(17, 24, 39, 0.7);
  --card-border: rgba(255, 255, 255, 0.08);
  --text-primary: #f3f4f6;
  --text-secondary: #9ca3af;
  --primary: #6366f1;
  --primary-hover: #4f46e5;
  --success: #10b981;
  --warning: #f59e0b;
  --danger: #ef4444;
  --white-color: #f3f4f6;
  --black-color: #111827;
}

.tab-selector {
  display: flex;
  gap: 12px;
}

.tab-btn {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.2s;
}

.tab-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.tab-btn.active {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
  box-shadow: 0 0 12px rgba(99, 102, 241, 0.4);
}

body {
  margin: 0;
  font-family: 'Plus Jakarta Sans', sans-serif;
  background-color: var(--bg-color);
  background-image:
    radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.15) 0px, transparent 50%),
    radial-gradient(at 100% 0%, rgba(16, 185, 129, 0.1) 0px, transparent 50%);
  background-attachment: fixed;
  color: var(--text-primary);
  min-height: 100vh;
}

.app-container {
  max-width: 1280px;
  margin: 0 auto;
  padding: 2rem;
}

.app-header {
  margin-bottom: 2rem;
  text-align: center;
}

.logo-area {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
}

.logo-icon {
  font-size: 2.5rem;
}

.app-header h1 {
  font-family: 'Outfit', sans-serif;
  font-size: 2.2rem;
  font-weight: 700;
  margin: 0;
  background: linear-gradient(135deg, #fff 0%, #a5b4fc 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.badge {
  font-size: 0.8rem;
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  background: rgba(99, 102, 241, 0.2);
  border: 1px solid rgba(99, 102, 241, 0.3);
  color: #a5b4fc;
  font-weight: 500;
}

.subtitle {
  color: var(--text-secondary);
  font-size: 1rem;
  margin-top: 0.5rem;
}

/* Layout Grid */
.app-layout {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 2.5rem;
  align-items: start;
}

@media (max-width: 968px) {
  .app-layout {
    grid-template-columns: 1fr;
  }
}

/* Chessboard Column */
.board-column {
  display: flex;
  justify-content: center;
  align-items: center;
}

.board-wrapper {
  width: 100%;
  max-width: 600px;
  aspect-ratio: 1;
  background: rgba(17, 24, 39, 0.4);
  border: 1px solid var(--card-border);
  border-radius: 16px;
  padding: 1rem;
  box-shadow:
    0 20px 25px -5px rgba(0, 0, 0, 0.5),
    0 10px 10px -5px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(12px);
}

/* Glassmorphism Cards */
.glass-card {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 16px;
  padding: 1.5rem;
  margin-bottom: 1.25rem;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(8px);
  transition:
    transform 0.2s ease,
    border-color 0.2s ease;
}

.glass-card h2 {
  font-family: 'Outfit', sans-serif;
  font-size: 1.1rem;
  font-weight: 600;
  margin-top: 0;
  margin-bottom: 0.75rem;
  color: #a5b4fc;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  padding-bottom: 0.5rem;
}

/* Warning Border for Check */
.warning-border {
  border-color: rgba(239, 68, 68, 0.4);
  box-shadow: 0 0 15px rgba(239, 68, 68, 0.15);
}

/* Pulse dot for turn indicator */
.status-indicator {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 1.1rem;
  font-weight: 500;
}

.pulse-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
  box-shadow: 0 0 8px currentColor;
}

.pulse-dot.white {
  background-color: var(--white-color);
  color: var(--white-color);
  animation: pulse 1.5s infinite alternate;
}

.pulse-dot.black {
  background-color: #4f46e5;
  color: #4f46e5;
  animation: pulse 1.5s infinite alternate;
}

@keyframes pulse {
  0% {
    transform: scale(0.9);
    opacity: 0.6;
  }
  100% {
    transform: scale(1.2);
    opacity: 1;
  }
}

/* Hint Card styling */
.hint-card {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(16, 185, 129, 0.05) 100%);
  border: 1px solid rgba(99, 102, 241, 0.25);
}

.description {
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-bottom: 1rem;
}

.hint-display {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: rgba(0, 0, 0, 0.3);
  padding: 0.75rem 1rem;
  border-radius: 8px;
  font-family: monospace;
}

.hint-label {
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.hint-value {
  color: var(--success);
  font-size: 1.2rem;
  font-weight: 700;
  letter-spacing: 1px;
}

.hint-placeholder {
  color: var(--text-secondary);
  font-style: italic;
  font-size: 0.9rem;
}

.hint-subtext {
  font-size: 0.8rem;
  color: var(--success);
  margin-top: 0.5rem;
  margin-bottom: 0;
}

/* Config Grid */
.config-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.config-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.config-label {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.config-value {
  font-size: 0.95rem;
  font-weight: 600;
}

.white-text {
  color: #fff;
}

.black-text {
  color: #a5b4fc;
}

/* Buttons */
.action-buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.btn {
  padding: 0.75rem 1rem;
  border-radius: 8px;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.2s ease;
}

.btn-primary {
  background: var(--primary);
  color: white;
}

.btn-primary:hover {
  background: var(--primary-hover);
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--card-border);
  color: var(--text-primary);
}

.btn-secondary:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}

.btn-secondary.active {
  background: rgba(99, 102, 241, 0.2);
  border-color: var(--primary);
  color: #a5b4fc;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* History List */
.history-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  max-height: 120px;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.2);
  padding: 0.75rem;
  border-radius: 8px;
}

.history-move {
  font-family: monospace;
  font-size: 0.9rem;
  padding: 0.2rem 0.5rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
}

.history-empty {
  font-size: 0.85rem;
  color: var(--text-secondary);
  font-style: italic;
}

/* Force chessground to remain inside its responsive wrapper */
.board-wrapper .main-wrap {
  width: 100% !important;
  max-width: 100% !important;
}
.board-wrapper .cg-wrap {
  width: 100% !important;
  height: 100% !important;
}

/* Solo Mode Specific Styles */
.piece-selector-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 8px;
}

.success-border {
  border-color: rgba(16, 185, 129, 0.4) !important;
  box-shadow: 0 0 15px rgba(16, 185, 129, 0.2) !important;
}

.success-text {
  color: var(--success) !important;
  font-weight: bold;
}
</style>
