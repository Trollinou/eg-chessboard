# eg-chessboard

`eg-chessboard` est une bibliothèque de composant d'échiquier modulaire, découplée et isopérimétrique (parité 1:1), conçue pour être utilisée de manière transparente dans des applications **Vue 3** (Vite) et **React** (WordPress Gutenberg Blocks).

Elle s'appuie sur **[@lichess-org/chessground](https://github.com/lichess-org/chessground)** (v10) pour l'interface utilisateur interactive ultra-rapide, **[chess.js](https://github.com/jhlywa/chess.js)** (v1.4.0) pour la validation des règles et la logique échiquéenne, et intègre **[Stockfish](https://github.com/official-stockfish/Stockfish)** (via Web Workers / WASM) pour les suggestions de coups et le jeu contre l'ordinateur.

---

## 🏛️ Architecture

La bibliothèque est construite selon le principe de **source de vérité unique** :

- **`BoardCore` (TS pur)** : Moteur logique agnostique gérant la partie, l'historique, le matériel, le PGN/FEN, la navigation et la synchronisation avec l'API Chessground.
- **Wrapper Vue 3 (`TheChessboard.vue`)** : Composant Vue 3 réactif prêt à l'emploi.
- **Wrapper React (`Chessboard.tsx`)** : Composant React (Gutenberg) réactif prêt à l'emploi.
- **CSS unifié** : Styles de base Chessground accompagnés des pièces au format SVG vectoriel base64.

---

## 📦 Installation

Pour ajouter la bibliothèque dans votre projet :

```bash
npm install eg-chessboard
```

Ou en dépendance locale :

```json
"dependencies": {
  "eg-chessboard": "file:../chemin/vers/eg-chessboard"
}
```

---

## 🛠️ Développement & Compilation

```bash
# Installer les dépendances
npm install

# Lancer l'application sandbox de développement
npm run dev

# Compiler la bibliothèque (génère les bundles JS/Vue/React et les types .d.ts)
npm run build

# Valider la conformité du code et du style
npm run lint
npm run format:check
```

---

## 🚀 Guide de Démarrage Rapide

### 1. Dans une application Vue 3 (Vite)

```vue
<script setup lang="ts">
import TheChessboard, { type BoardCore, type StockfishConfig } from 'eg-chessboard/vue';
import 'eg-chessboard/style.css';

const stockfishConfig: StockfishConfig = {
  workerUrl: '/stockfish.js',
  wasmUrl: '/stockfish.wasm',
  whiteMode: 'hint',
  blackMode: 'elo',
  blackElo: 1500,
  stockfishMoveTime: 1000,
};

function handleBoardCreated(boardApi: BoardCore) {
  console.log('FEN initiale :', boardApi.getFen());
}

function handleMove(move: any) {
  console.log('Coup joué :', move.san);
}

function handleStockfishHint(bestMove: string) {
  console.log('Suggestion Stockfish :', bestMove);
}
</script>

<template>
  <div style="width: 500px; height: 500px;">
    <TheChessboard
      player-color="white"
      fit-container
      :stockfish-config="stockfishConfig"
      @board-created="handleBoardCreated"
      @move="handleMove"
      @stockfish-hint="handleStockfishHint"
    />
  </div>
</template>
```

### 2. Dans une application React (Gutenberg / Next.js)

```tsx
import React from 'react';
import { Chessboard, type BoardCore, type StockfishConfig } from 'eg-chessboard/react';
import 'eg-chessboard/style.css';

export const MyChessComponent: React.FC = () => {
  const stockfishConfig: StockfishConfig = {
    workerUrl: '/stockfish.js',
    wasmUrl: '/stockfish.wasm',
    whiteMode: 'hint',
    blackMode: 'disabled',
  };

  const handleBoardCreated = (boardApi: BoardCore) => {
    console.log('FEN :', boardApi.getFen());
  };

  return (
    <div style={{ width: '500px', height: '500px' }}>
      <Chessboard
        playerColor="white"
        fitContainer
        stockfishConfig={stockfishConfig}
        onBoardCreated={handleBoardCreated}
        onMove={(move) => console.log('Coup joué :', move.san)}
        onStockfishHint={(bestMove) => console.log('Suggestion :', bestMove)}
      />
    </div>
  );
};
```

---

## 🎛️ Propriétés des Composants (Props)

Les composants `<TheChessboard>` (Vue 3) et `<Chessboard>` (React) partagent une matrice d'interfaces strictement identique :

| Prop | Type | Par défaut | Description |
| :--- | :--- | :--- | :--- |
| `boardConfig` | `Config` | `{}` | Configuration native de l'échiquier Chessground. |
| `playerColor` | `'white' \| 'black' \| 'both'` | `undefined` | Couleur(s) autorisée(s) au déplacement pour l'utilisateur. |
| `freeMode` | `boolean` | `false` | Mode libre : déplace les pièces sans validation de règles et resynchronise l'état et la FEN. |
| `soloMode` | `boolean` | `false` | Mode solo : autorise les déplacements consécutifs du même joueur sans alternance forcée. |
| `fitContainer` | `boolean` | `false` | Étend l'échiquier à 100% de la hauteur/largeur du conteneur parent (supprime les ratios fixes). |
| `preserveShapesOnPositionChange` | `boolean` | `false` | Conserve les formes/flèches dessinées lors de la pose ou suppression de pièces. |
| `stockfishConfig`| `StockfishConfig` | `{}` | Configuration du moteur de jeu et d'analyse Stockfish. |
| `diagram` | `ChessDiagram` | `undefined` | Position FEN et annotations graphiques (flèches/cercles) d'initialisation. |

---

## 📢 Événements (Events & Callbacks)

| Nom React | Nom Vue 3 | Signature | Description |
| :--- | :--- | :--- | :--- |
| `onBoardCreated` | `@board-created` | `(api: BoardCore) => void` | Émis à la création du composant avec l'instance `BoardCore`. |
| `onMove` | `@move` | `(move: Move) => void` | Émis après chaque coup valide, une fois le rendu graphique totalement achevé. |
| `onCheck` | `@check` | `(color: string) => void` | Émis lorsque le roi d'une couleur donnée est mis en échec. |
| `onCheckmate` | `@checkmate` | `(color: string) => void` | Émis lors d'un échec et mat (transmet la couleur du perdant). |
| `onStalemate` | `@stalemate` | `() => void` | Émis en cas de pat (stalemate). |
| `onDraw` | `@draw` | `() => void` | Émis en cas de partie nulle (nulle acceptée, matériel insuffisant, répétition, 50 coups). |
| `onPromotion` | `@promotion` | `(detail: { from: string, to: string, promotedTo: string }) => void` | Émis lorsqu'une promotion de pion est effectuée. |
| `onStockfishHint`| `@stockfish-hint` | `(bestMove: string) => void` | Émis lorsque le moteur Stockfish retourne une suggestion de coup (mode `hint`). |
| `onSquareClick` | `@square-click` | `(square: string) => void` | Émis lors du clic sur une case de l'échiquier. |
| `onShapesChange` | `@shapes-change` | `(shapes: DrawShape[]) => void` | Émis lorsque l'utilisateur dessine ou efface des formes interactives au clic droit. |

---

## 📚 Reference de l'API `BoardCore` (`boardApi`)

L'instance `BoardCore` (`boardApi`) est transmise via l'événement `board-created` / `onBoardCreated`. Elle constitue l'unique interface d'interaction programmatique avec l'échiquier.

### 1. Introspection & État de la Partie

| Méthode | Type de Retour | Description |
| :--- | :--- | :--- |
| `getFen()` | `string` | FEN complète validée de la position courante. |
| `getPlacementFen()` | `string` | FEN de placement uniquement (sans trait ni roque), extraite directement de Chessground (utile pour le mode libre ou FENs en cours d'édition). |
| `getPgn()` | `string` | Chaîne PGN complète de la partie avec entêtes et annotations. |
| `getTurnColor()` | `'white' \| 'black'` | Couleur du joueur dont c'est le tour. |
| `getOrientation()` | `'white' \| 'black'` | Orientation actuelle du plateau de jeu. |
| `getIsGameOver()` | `boolean` | Indique si la partie est terminée. |
| `getIsCheckmate()` | `boolean` | Indique si la position est un échec et mat. |
| `getIsCheck()` | `boolean` | Indique si le joueur actif est en échec. |
| `getInCheckColor()` | `'white' \| 'black' \| null` | Retourne la couleur du joueur actuellement en échec (ou `null`). |
| `getIsStalemate()` | `boolean` | Indique si la position est un pat. |
| `getIsDraw()` | `boolean` | Indique si la position est une nulle. |
| `getIsThreefoldRepetition()`| `boolean` | Indique si la position s'est répétée 3 fois. |
| `getIsInsufficientMaterial()`| `boolean` | Indique si le matériel est insuffisant pour mater. |
| `getGameOverReason(lang?)` | `string` | Retourne la raison formatée de fin de partie en français ou anglais (*ex: "Échec et mat ! Les Blancs ont gagné."*). |
| `getCurrentComment()` | `string` | Commentaire textuel PGN du demi-coup actuellement visualisé. |
| `getHistoryViewerState()`| `Readonly<HistoryViewerState>` | État de la navigation dans l'historique PGN. |
| `isViewingHistory()` | `boolean` | Indique si l'utilisateur consulte un coup antérieur dans l'historique. |
| `getState()` | `Readonly<BoardCoreState>` | Retourne l'état réactif global du Core. |
| `getCapturedPieces()` | `{ white: string[], black: string[] }` | Liste des pièces capturées par chaque couleur. |
| `getMaterialCount()` | `{ white: number, black: number, diff: number }` | Décompte du matériel et différentiel. |
| `getPieces()` | `Map<Key, { type: string, color: 'w' \| 'b' }>` | Liste de toutes les pièces présentes sur l'échiquier. |
| `getHistory(verbose?)` | `Move[] \| string[]` | Historique complet des coups joués. |
| `getLastMove()` | `Move \| null` | Dernier coup joué. |

### 2. Actions & Modifications de Plateau

| Méthode | Arguments | Description |
| :--- | :--- | :--- |
| `move(moveObj)` | `string \| { from: string, to: string, promotion?: string }` | Joue un coup programmatiquement (ex: `'e4'` ou `{ from: 'e2', to: 'e4' }`). |
| `setPosition(fen)` | `fen: string` | Charge une FEN. Tolère les FENs incomplètes sans crash. |
| `setDiagram(diagram)` | `diagram: ChessDiagram` | Charge une position FEN et ses formes (flèches/cercles). |
| `getDiagram()` | `none` | Retourne l'objet `{ fen, shapes }` représentant la position et les dessins actuels. |
| `loadPgn(pgn)` | `pgn: string` | Charge une partie PGN complète. |
| `resetBoard()` | `none` | Réinitialise l'échiquier à la position de départ standard. |
| `undoLastMove()` | `none` | Annule le dernier coup joué. |
| `toggleOrientation()` | `none` | Inverse l'orientation du plateau (Blancs / Noirs). |
| `putPiece(piece, square)`| `piece: Piece, square: Key \| string` | Dépose une pièce sur une case. |
| `removePiece(square)` | `square: Key \| string` | Supprime la pièce située sur la case. |
| `closePromotionDialog()`| `none` | Ferme le dialogue de sélection de promotion. |
| `setFreeMode(freeMode)` | `freeMode: boolean` | Active/désactive le mode libre. |
| `setSoloMode(soloMode)` | `soloMode: boolean` | Active/désactive le mode solo. |
| `setPreserveShapesOnPositionChange(...)` | `preserve: boolean` | Active/désactive la persistance des formes lors des changements de pièces. |
| `getFinalFenFromPgn(pgn)` | `pgn: string` | Retourne la FEN finale calculée à partir d'une chaîne PGN. |
| `redraw(clearBounds?)` | `clearBounds = true` | Invalide le cache des coordonnées DOM et ré-exécute un rendu complet. |

### 3. Navigation d'Historique PGN

| Méthode | Arguments | Description |
| :--- | :--- | :--- |
| `viewHistory(ply)` | `ply: number` | Navigue vers un demi-coup précis de l'historique PGN. |
| `stopViewingHistory()`| `none` | Revient au coup de jeu actif. |
| `viewStart()` | `none` | Navigue au tout début de la partie (ply 0). |
| `viewNext()` | `none` | Navigue au coup suivant. |
| `viewPrevious()` | `none` | Navigue au coup précédent. |

### 4. Annotations Graphiques & Commentaires PGN

| Méthode | Arguments | Description |
| :--- | :--- | :--- |
| `drawMove(from, to, brush)`| `from: string, to: string, brush: string` | Dessine une flèche (couleurs: `'green'`, `'red'`, `'blue'`, `'yellow'`). |
| `drawCircle(square, brush)`| `square: string, brush: string` | Dessine un cercle sur une case. |
| `setShapes(shapes)` | `shapes: DrawShape[] \| unknown[]` | Définit la liste complète des formes dessinées. |
| `getShapes()` / `getCurrentShapes()` | `none` | Récupère les formes actuellement tracées sur le plateau. |
| `drawThreats()` | `none` | Calcule et affiche visuellement toutes les menaces et coups légaux. |
| `hideMoves()` | `none` | Masque les flèches de menaces et efface les formes. |
| `setComment(text, shapes)`| `text: string, shapes?: DrawShape[]` | Écrit un commentaire et des formes PGN sur le coup visualisé. |
| `setCommentAtPly(...)` | `ply: number, text: string, shapes?: DrawShape[]` | Écrit un commentaire et des formes PGN sur un coup d'index spécifique. |

### 5. Restrictions d'Exercices & Pédagogie

| Méthode | Arguments | Description |
| :--- | :--- | :--- |
| `setCustomDests(dests)` | `dests: Map<Key, Key[]> \| null` | Définit explicitement les pièces et destinations autorisées. |
| `restrictMovesToPieces(...)`| `squares: Key[] \| null` | Restreint les coups légaux aux seules pièces situées sur les cases indiquées. |
| `isSquareAttacked(square, byColor)`| `square: Key, byColor: 'white' \| 'black'` | Indique si une case est attaquée par la couleur spécifiée. |
| `getSoloHistory()` | `none` | Renvoie l'historique des coups joués en mode solo. |

### 6. Nettoyage (Lifecycle) & Rendu Impératif

| Méthode | Arguments | Description |
| :--- | :--- | :--- |
| `destroy()` | `none` | Termine les Workers Stockfish et détruit l'instance DOM Chessground. |
| `redraw(clearBounds?)` | `clearBounds?: boolean` | Invalide le cache DOM des dimensions et ré-exécute un rendu complet. |

---

## ⚙️ Interfaces et Typage TypeScript

Les types suivants sont ré-exportés directement depuis le point d'entrée principal (`eg-chessboard`, `eg-chessboard/vue`, `eg-chessboard/react`) :

```typescript
import type { 
  BoardCore, 
  BoardCoreState, 
  StockfishConfig, 
  ChessDiagram, 
  Key, 
  DrawShape 
} from 'eg-chessboard';
```

### `StockfishConfig`

```typescript
export type StockfishMode = 'disabled' | 'hint' | 'elo';

export interface StockfishConfig {
  whiteMode?: StockfishMode; // Mode pour les Blancs ('disabled' | 'hint' | 'elo')
  whiteElo?: number;         // Niveau ELO (ex: 1500)
  blackMode?: StockfishMode; // Mode pour les Noirs
  blackElo?: number;         // Niveau ELO
  stockfishMoveTime?: number; // Temps de réflexion max en ms (défaut : 1000)
  workerUrl?: string;        // Chemin vers le fichier JS du worker (ex: '/stockfish.js')
  wasmUrl?: string;          // Chemin vers le binaire WASM (ex: '/stockfish.wasm')
}
```

### `ChessDiagram`

```typescript
export interface ChessDiagram {
  fen: string;           // FEN de la position
  shapes?: DrawShape[];  // Flèches et cercles associés
}
```

---

## 🎨 Styles CSS et Mode Responsive Container

Pensez à importer le fichier CSS dans votre application :

```typescript
import 'eg-chessboard/style.css';
```

### Définition des dimensions et conteneur flex (`fitContainer`)

Lorsque l'option `fitContainer` (ou `fit-container`) est activée sur le composant, celui-ci utilise les variables CSS personnalisables ci-dessous :

```css
:root {
  --eg-chessboard-width: 100%;
  --eg-chessboard-height: 100%;
  --eg-chessboard-flex: 1;
}
```

Exemple d'intégration dans une disposition Flexbox ou Grid responsive :

```vue
<div class="my-flexible-container">
  <TheChessboard fit-container :player-color="'white'" />
</div>

<style scoped>
.my-flexible-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 80vh;
}
</style>
```

---

## 📄 Licence

MIT License - Crédits à [Lichess / Chessground](https://github.com/lichess-org/chessground) et [Chess.js](https://github.com/jhlywa/chess.js).
