# Intégration Stockfish 19 dans `eg-chessboard`

Ce guide présente l'architecture, la configuration et l'utilisation du moteur d'échecs **Stockfish 19** au sein du composant `eg-chessboard` (disponible pour **Vue 3** et **React**).

---

## 1. Nouveautés & Architecture (Stockfish 19)

- **Moteur unique unifié (Single Worker)** : Au lieu de charger deux moteurs concurrents, un seul Web Worker gère le jeu contre l'ordinateur, les suggestions tactiques et l'analyse post-mortem en basculant dynamiquement les options UCI en mémoire à la volée.
- **Binaire WebAssembly Lite-Single (1.84 Mo)** : Embarqué par défaut sans nécessiter d'en-têtes serveur COOP/COEP (`SharedArrayBuffer`), garantissant une compatibilité totale sur desktop et mobile.
- **Probabilités WDL natives** : Stockfish 19 fournit directement les probabilités de Gain/Nulle/Perte (`wdl <Win> <Draw> <Loss>` en millièmes).
- **Sécurité et résilience renforcée** :
  - File d'attente à froid (`loading`) garantissant qu'aucune commande UCI (`position`, `go`) n'est envoyée avant la fin du handshake initial (`uciok` / `readyok`).
  - Isolation stricte des contextes de recherche (`activeContext` vs `stagedContext`) évitant toute corruption d'évaluation lors des interruptions ou préemptions asynchrones.
  - Pré-validation stricte des chaînes FEN via `chessops` avant toute commande UCI afin d'éviter les arrêts brutaux de Stockfish 19 sur position illégale.
  - Surveillance active du message `info string CRITICAL ERROR` avec interception et reprise d'état.
  - Watchdog de synchronisation tolérant (5 000 ms) sur les commandes `isready` et `stop`.
  - Compatibilité native avec la navigation historique (`core.viewHistory()`) : limitation automatique des coups analysés au ply visualisé et calcul en temps réel.

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

### A. Demande de conseil (`requestHint`)
Calcule le meilleur coup pour le camp actif à **force maximale (3500+ ELO, `UCI_LimitStrength: false`)** pour garantir une aide pédagogique optimale :
```typescript
// Par défaut : recherche pendant 1200 ms (go movetime 1200) à pleine puissance
core.requestHint();

// Avec options personnalisées (ex: 2 variantes principales, 1500 ms)
core.requestHint({ multiPv: 2, movetime: 1500 });
```
> **Note de conception** : Le calcul de conseil est totalement découplé du bridage ELO de l'adversaire et fonctionne même si aucun bot n'est configuré (`whiteMode: 'disabled'`, `blackMode: 'disabled'`). Si le moteur n'est pas encore instancié, `requestHint()` l'initialise automatiquement à la volée.

### B. Analyse en continu (`startLiveAnalysis` / `stopLiveAnalysis`)
Active l'évaluation continue en temps réel (`go infinite`) sans limite de profondeur :
```typescript
// Active l'analyse continue sur la position affichée à l'écran
core.startLiveAnalysis();

// Arrête l'analyse en continu
core.stopLiveAnalysis();
```
> **Synchronisation réactive avec l'historique** : Lors de la navigation dans les coups (`core.viewHistory(ply)`, `core.viewPrevious()`, `core.viewNext()`), l'analyse en direct s'adapte instantanément et évalue la position visualisée à l'écran.
> **Alternance transparente avec le Bot** : Si l'analyse en direct est active pendant une partie contre l'ordinateur, le moteur évalue en continu pendant que l'humain réfléchit. Dès que l'humain joue son coup, le moteur met en pause l'analyse, calcule le coup du bot adverse selon l'ELO et le temps/nœuds configurés, le joue sur l'échiquier, puis reprend instantanément l'analyse en direct pour le tour de l'humain !

### C. Revue de partie autonome (`reviewGame` / `cancelReview`)
Analyse séquentielle complète de l'ensemble des coups de la partie avec classification tactique et calcul du score d'accuracy global. Optimisée avec chaînage d'évaluations (réduction de 50 % des requêtes de calcul) et support d'annulation via `AbortSignal` :

```typescript
const controller = new AbortController();

const report = await core.reviewGame({
  depth: 12, // Profondeur par position (défaut: 12)
  signal: controller.signal, // Optionnel : signal d'annulation
  onProgress: (percent) => console.log(`Analyse : ${percent}%`)
});

// Annulation possible à tout moment :
core.cancelReview(); // ou controller.abort();

console.log('Précision Blancs :', report.accuracy.white, '%');
console.log('Précision Noirs :', report.accuracy.black, '%');
console.log('Nombre de gaffes :', report.summary.white.blunder);
```

#### Classification des coups (`MoveJudgement`)
- `'brilliant'` : Coup spectaculaire, sacrifice ou mat tactique décisif (`!!`).
- `'best'` : Meilleur coup théorique de la position (`!`).
- `'excellent'` : Coup solide quasi-optimal.
- `'good'` : Bon coup conservant la dynamique.
- `'inaccuracy'` : Imprécision tactique (`?!`).
- `'mistake'` : Erreur concédant un avantage net (`?`).
- `'blunder'` : Gaffe décisive inversant le sort de la partie (`??`).
- `'missed_win'` : Gain immédiat ou mat forcé non exploité.

### D. Réinitialisation et mémoire (`newGame`)
```typescript
// Réinitialise la partie, l'arbre PGN et transmet 'ucinewgame' à Stockfish
// pour purger les tables de transposition sans détruire le Worker.
core.newGame();
```

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

### `getNodesForElo`
Calcule une limite de recherche déterministe en nombre de nœuds selon le niveau ELO via la formule exponentielle standard (type Lichess/Maïa) : `Math.round(500 * Math.pow(10, (elo - 800) / 500))` :

```typescript
import { getNodesForElo } from 'eg-chessboard';

const nodes1400 = getNodesForElo(1400); // 7 924 nœuds (~10ms)
const nodes1800 = getNodesForElo(1800); // 50 000 nœuds (~50ms)
const nodes2500 = getNodesForElo(2500); // 1 255 943 nœuds (~1.5s)
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
