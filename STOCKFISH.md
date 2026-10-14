# Intégration Stockfish 19 dans `eg-chessboard`

Ce guide présente l'architecture, la configuration et l'utilisation du moteur d'échecs **Stockfish 19** au sein du composant `eg-chessboard` (disponible pour **Vue 3** et **React**).

---

## 1. Nouveautés & Architecture (Stockfish 19)

- **Moteur unique unifié (Single Worker)** : Au lieu de charger deux moteurs concurrents, un seul Web Worker gère le jeu contre l'ordinateur, les suggestions tactiques et l'analyse post-mortem en basculant dynamiquement les options UCI en mémoire à la volée.
- **Binaire WebAssembly Lite-Single (1.84 Mo)** : Embarqué par défaut sans nécessiter d'en-têtes serveur COOP/COEP (`SharedArrayBuffer`), garantissant une compatibilité totale sur desktop et mobile.
- **Probabilités WDL natives** : Stockfish 19 fournit directement les probabilités de Gain/Nulle/Perte (`wdl <Win> <Draw> <Loss>` en millièmes).
- **Sécurité et résilience renforcée** :
  - Pré-validation stricte des chaînes FEN via `chessops` avant toute commande UCI afin d'éviter les arrêts brutaux de Stockfish 19 sur position illégale.
  - Surveillance active du message `info string CRITICAL ERROR` avec interception et reprise d'état.
  - Watchdog de synchronisation sur les commandes `isready` et `stop`.

---

## 2. Options de Configuration (`StockfishConfig`)

L'objet `stockfishConfig` se passe en prop au composant Vue (`:stockfish-config`) ou React (`stockfishConfig={...}`) :

```typescript
export interface StockfishConfig {
  workerUrl?: string;          // Chemin vers stockfish.js (ex: '/stockfish.js')
  wasmUrl?: string;            // Chemin vers stockfish.wasm (optionnel si dans le même dossier)
  whiteMode?: 'disabled' | 'hint' | 'bot' | 'elo';
  whiteElo?: number;           // Niveau Elo cible (1320 à 3190)
  blackMode?: 'disabled' | 'hint' | 'bot' | 'elo';
  blackElo?: number;           // Niveau Elo cible (1320 à 3190)
  stockfishMoveTime?: number;  // Temps de réflexion en millisecondes (défaut: 1000)
  threads?: number;            // Nombre de threads (défaut: 1)
  hashSize?: number;           // Taille de la mémoire de hachage en Mo (défaut: 16)
  showWdl?: boolean;           // Activation des probabilités WDL (défaut: true)
  multiPv?: number;            // Nombre de variantes principales calculées (défaut: 1)
  searchLimit?: {
    movetime?: number;         // Temps limite par coup (ms)
    depth?: number;            // Profondeur limite (plies)
    nodes?: number;            // Nœuds max calculés
  };
}
```

---

## 3. Événements Émis par l'Échiquier

| Événement Vue 3 | Événement React | Payload | Description |
| :--- | :--- | :--- | :--- |
| `@evaluation` | `onEvaluation` | `StockfishEvaluation` | Émis en continu pendant le calcul avec l'évaluation en centipions/mat, le WDL, le PV et le pourcentage d'avantage Blancs (0 à 100 %). |
| `@engine-status` | `onEngineStatus` | `EngineStatus` | Changement de statut du moteur : `'uninitialized' \| 'loading' \| 'ready' \| 'searching' \| 'stopping' \| 'error'`. |
| `@stockfish-hint` | `onStockfishHint` | `string` (UCI) | Émis lorsque le meilleur coup de conseil est calculé (ex: `"e2e4"`). |
| `@game-review-progress` | `onGameReviewProgress` | `number` (0 à 100) | Pourcentage de progression lors d'une analyse complète de partie. |

### Structure de l'évaluation (`StockfishEvaluation`)

```typescript
export interface StockfishEvaluation {
  ply: number;
  fen: string;
  depth: number;
  seldepth?: number;
  scoreType: 'cp' | 'mate';
  scoreValue: number;          // Valeur brute vue du joueur ayant le trait
  whiteScoreValue: number;     // Normalisé vue des Blancs (+ = avantage blanc)
  winChancePercentage: number; // 0% à 100% (idéal pour la barre d'évaluation)
  wdl?: [number, number, number]; // [Win, Draw, Loss] en millièmes
  bestMove?: string;           // Ex: "g1f3"
  pv: string[];                // Suite des meilleurs coups calculés
  multipvIndex: number;        // Indice de variante (1 si multiPv=1)
  nodes?: number;
  nps?: number;
  time?: number;
}
```

---

## 4. Méthodes Publiques (`BoardCore`)

Accessibles via l'instance `core` reçue sur `@board-created` (Vue) ou `onBoardCreated` (React) :

### A. Demande de conseil ponctuel (`requestHint`)
```typescript
// Calcule immédiatement à pleine force le meilleur coup (ou top 2 variantes)
core.requestHint({ multiPv: 2, movetime: 1000 });
```

### B. Analyse en continu (`startLiveAnalysis` / `stopLiveAnalysis`)
```typescript
// Active l'analyse continue (infinite search) sur la position affichée à l'écran
core.startLiveAnalysis();

// Arrête l'analyse en continu
core.stopLiveAnalysis();
```

### C. Revue de partie autonome (`reviewGame`)
Analyse séquentielle complète de l'ensemble des coups de la partie avec classification tactique et calcul du score d'accuracy global :

```typescript
const report = await core.reviewGame({
  depth: 12, // Profondeur par position (défaut: 12)
  onProgress: (percent) => console.log(`Analyse : ${percent}%`)
});

console.log('Précision Blancs :', report.accuracy.white, '%');
console.log('Précision Noirs :', report.accuracy.black, '%');
console.log('Nombre de gaffes :', report.summary.white.blunder);
```

#### Classification des coups (`MoveJudgement`)
- `'brilliant'` : Coup spectaculaire ou sacrifice gagnant (`!!`).
- `'best'` : Meilleur coup théorique de la position (`!`).
- `'excellent'` : Coup solide quasi-optimal.
- `'good'` : Bon coup conservant la dynamique.
- `'inaccuracy'` : Imprécision tactique (`?!`).
- `'mistake'` : Erreur concédant un avantage net (`?`).
- `'blunder'` : Gaffe décisive inversant le sort de la partie (`??`).
- `'missed_win'` : Gain immédiat ou mat forcé non exploité.

---

## 5. Fonctions Utilitaires Exportées

### `computeEvalBarPercentage`
Calcule le pourcentage de remplissage d'une jauge d'avantage (de 0 % pour les Noirs à 100 % pour les Blancs, avec 50 % pour l'équilibre parfait) :

```typescript
import { computeEvalBarPercentage } from 'eg-chessboard';

// Exemple centipions (+1.50 pour les Blancs au trait blanc)
const pct = computeEvalBarPercentage('w', 'cp', 150); // ~63.7%

// Exemple WDL direct Stockfish 19 [Win, Draw, Loss]
const pctWdl = computeEvalBarPercentage('w', 'cp', 200, [600, 300, 100]); // 75.0%

// Exemple Mat en 3 pour les Blancs
const pctMate = computeEvalBarPercentage('w', 'mate', 3); // 100%
```

### `validateFen`
Valide la syntaxe et la légalité échiquéenne d'une chaîne FEN avant toute manipulation :

```typescript
import { validateFen } from 'eg-chessboard';

const result = validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
if (!result.valid) {
  console.error('FEN illégale :', result.error);
}
```

---

## 6. Exemple d'Intégration Vue 3 avec Barre d'Évaluation

```vue
<template>
  <div class="chess-container">
    <!-- Barre d'évaluation visuelle -->
    <div class="eval-bar-wrapper">
      <div class="eval-bar-fill" :style="{ height: `${evalPercentage}%` }"></div>
      <span class="eval-text">{{ evalLabel }}</span>
    </div>

    <!-- Échiquier -->
    <TheChessboard
      :stockfish-config="config"
      @board-created="onBoardCreated"
      @evaluation="onEvaluation"
      @stockfish-hint="onHint"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import TheChessboard, {
  type BoardCore,
  type StockfishConfig,
  type StockfishEvaluation,
} from 'eg-chessboard/vue';

const evalPercentage = ref(50);
const evalLabel = ref('0.0');
let core: BoardCore | null = null;

const config: StockfishConfig = {
  workerUrl: '/stockfish.js',
  whiteMode: 'hint',
  blackMode: 'bot',
  blackElo: 1600,
  stockfishMoveTime: 1200,
  showWdl: true
};

const onBoardCreated = (api: BoardCore) => {
  core = api;
};

const onEvaluation = (ev: StockfishEvaluation) => {
  evalPercentage.value = ev.winChancePercentage;
  if (ev.scoreType === 'mate') {
    evalLabel.value = `#${ev.whiteScoreValue}`;
  } else {
    const cp = (ev.whiteScoreValue / 100).toFixed(1);
    evalLabel.value = ev.whiteScoreValue > 0 ? `+${cp}` : cp;
  }
};

const onHint = (bestMove: string) => {
  if (core && bestMove.length >= 4) {
    core.drawMove(bestMove.slice(0, 2), bestMove.slice(2, 4), 'green');
  }
};
</script>

<style scoped>
.chess-container {
  display: flex;
  align-items: center;
  gap: 16px;
}
.eval-bar-wrapper {
  width: 24px;
  height: 480px;
  background-color: #312e2b;
  border-radius: 4px;
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column-reverse;
}
.eval-bar-fill {
  background-color: #ffffff;
  transition: height 0.3s ease;
  width: 100%;
}
.eval-text {
  position: absolute;
  bottom: 8px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 11px;
  font-weight: bold;
  color: #000;
}
</style>
```
