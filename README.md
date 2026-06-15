# eg-chessboard

`eg-chessboard` est une bibliothèque de composant d'échiquier modulaire et découplée, conçue pour être utilisée de manière transparente dans des applications **Vue 3** (Vite) et **React** (WordPress Gutenberg Blocks).

Elle utilise **[@lichess-org/chessground](https://github.com/lichess-org/chessground)** (v10) pour l'interface utilisateur interactive et ultra-rapide et **[chess.js](https://github.com/jhlywa/chess.js)** (v1.4.0) pour la validation des règles et la logique du jeu d'échecs.

---

## Architecture

La bibliothèque est découpée de manière à isoler la logique métier du framework de rendu :
- **`BoardCore` (TS pur)** : Moteur logique agnostique gérant la partie, l'historique, le matériel, le PGN/FEN et la synchronisation avec l'API Chessground.
- **Wrapper Vue 3 (`TheChessboard.vue`)** : Composant Vue 3 prêt à l'emploi.
- **Wrapper React (`Chessboard.tsx`)** : Composant React (Gutenberg) prêt à l'emploi.
- **CSS unifié** : Styles de base Chessground accompagnés des pièces au format SVG base64 (thème standard).

---

## Installation

Pour l'ajouter dans vos projets locaux en tant que dépendance :

```json
"dependencies": {
  "eg-chessboard": "file:../chemin/vers/eg-chessboard"
}
```

Puis lancez l'installation :
```bash
npm install
```

---

## Développement & Build

Pour compiler la bibliothèque (générer les modules JS pour Vue, React, Core et exporter le CSS et les types TypeScript) :

```bash
# Installer les dépendances de développement
npm install

# Compiler la bibliothèque
npm run build
```

Les fichiers de sortie seront générés dans le dossier `/dist`.

---

## Utilisation

### 1. Dans un projet Vue 3 (Vite)

```vue
<script setup lang="ts">
import TheChessboard, { type BoardCore, type StockfishConfig } from 'eg-chessboard/vue';
import 'eg-chessboard/style.css';

const stockfishConfig: StockfishConfig = {
  workerUrl: '/stockfish.js', // Chemin vers le worker Stockfish
  whiteMode: 'hint',          // 'disabled' | 'hint' | 'elo'
  blackMode: 'elo',
  blackElo: 1500,
  stockfishMoveTime: 1000
};

function handleBoardCreated(boardApi: BoardCore) {
  console.log('FEN :', boardApi.getFen());
}

function handleMove(move: any) {
  console.log('Coup joué :', move.san);
}

function handleStockfishHint(bestMove: string) {
  console.log('Suggestion de Stockfish :', bestMove);
}
</script>

<template>
  <TheChessboard
    :player-color="'white'"
    :free-mode="false"
    :stockfish-config="stockfishConfig"
    @board-created="handleBoardCreated"
    @move="handleMove"
    @stockfish-hint="handleStockfishHint"
  />
</template>
```

### 2. Dans un projet React (Gutenberg / WordPress)

```tsx
import React from 'react';
import { Chessboard, type BoardCore, type StockfishConfig } from 'eg-chessboard/react';
import 'eg-chessboard/style.css';

export const MyChessBlock = () => {
  const stockfishConfig: StockfishConfig = {
    workerUrl: '/stockfish.js',
    whiteMode: 'hint',
    blackMode: 'disabled'
  };

  const handleBoardCreated = (boardApi: BoardCore) => {
    console.log('FEN :', boardApi.getFen());
  };

  return (
    <Chessboard
      playerColor="white"
      freeMode={false}
      stockfishConfig={stockfishConfig}
      onBoardCreated={handleBoardCreated}
      onMove={(move) => console.log('Coup joué :', move.san)}
      onStockfishHint={(bestMove) => console.log('Suggestion Stockfish :', bestMove)}
    />
  );
};
```

---

## Propriétés des Composants (Props)

Les composants `<TheChessboard>` (Vue) et `<Chessboard>` (React) acceptent les propriétés suivantes :

| Prop | Type | Par défaut | Description |
| --- | --- | --- | --- |
| `boardConfig` | `Config` | `{}` | Configuration directe de Chessground. |
| `playerColor` | `'white' \| 'black' \| 'both'` | `undefined` | Couleur jouable par l'utilisateur. |
| `freeMode` | `boolean` | `false` | Active le mode libre (permet de déplacer les pièces sans contrainte de règles et synchronise la logique de jeu). |
| `stockfishConfig` | `StockfishConfig` | `{}` | Configuration du moteur de jeu Stockfish. |

---

## Structures de Configuration

### 1. Configuration de Stockfish (`StockfishConfig`)

L'interface `StockfishConfig` vous permet de paramétrer les moteurs d'analyse ou de jeu :

```typescript
export type StockfishMode = 'disabled' | 'hint' | 'elo';

export interface StockfishConfig {
  whiteMode?: StockfishMode;      // Mode pour les Blancs ('disabled' | 'hint' | 'elo')
  whiteElo?: number;              // Niveau ELO de Stockfish pour les Blancs (ex: 1500)
  blackMode?: StockfishMode;      // Mode pour les Noirs
  blackElo?: number;              // Niveau ELO de Stockfish pour les Noirs
  stockfishMoveTime?: number;     // Temps de réflexion max de Stockfish en millisecondes (défaut : 1000)
  workerUrl?: string;             // URL/Chemin relatif vers le script du Web Worker Stockfish (ex: '/stockfish.js')
}
```

- **`disabled`** : Stockfish est inactif.
- **`hint`** : Stockfish suggère le meilleur coup via l'événement `stockfish-hint` / `onStockfishHint`.
- **`elo`** : Stockfish joue automatiquement contre le joueur lors de son tour, selon le niveau d'ELO paramétré.

### 2. Configuration Chessground (`Config`)

L'objet `boardConfig` accepte toutes les options natives de Chessground. Voici les principales clés utiles :

```typescript
interface Config {
  fen?: string;                   // Position de départ au format FEN
  orientation?: 'white' | 'black'; // Orientation de l'échiquier
  turnColor?: 'white' | 'black';  // Joueur dont c'est le tour
  coordinates?: boolean;          // Afficher ou non les coordonnées sur les bords (défaut : true)
  autoCastle?: boolean;           // Roquer automatiquement lorsque le roi se déplace sur la tour (défaut : true)
  movable?: {
    free?: boolean;               // Permettre tous les déplacements (sans règles)
    color?: 'white' | 'black' | 'both'; // Couleurs autorisées à jouer
    showDests?: boolean;          // Mettre en surbrillance les cases de destination possibles (défaut : true)
  };
  draggable?: {
    enabled?: boolean;            // Activer le glisser-déposer des pièces (défaut : true)
  };
  selectable?: {
    enabled?: boolean;            // Permettre la sélection de pièces par simple clic (défaut : true)
  };
  highlight?: {
    lastMove?: boolean;           // Mettre en surbrillance le dernier coup joué (défaut : true)
    check?: boolean;              // Mettre en surbrillance le roi en échec (défaut : true)
  };
}
```

*Pour voir la liste exhaustive des configurations de l'échiquier, consultez la [documentation de Chessground](https://github.com/lichess-org/chessground).*

---

## API de `BoardCore`

L'instance d'API (`boardApi` ou `BoardCore`) renvoyée lors de la création de l'échiquier expose de nombreuses méthodes :

### Méthodes Générales
- `getFen()` : Renvoie la chaîne FEN de la position actuelle.
- `getPgn()` : Renvoie le PGN de la partie.
- `move(coup)` : Joue un coup programmatiquement (ex: `e4` ou `{ from: 'e2', to: 'e4' }`).
- `undoLastMove()` : Annule le dernier coup joué.
- `resetBoard()` : Réinitialise l'échiquier à la position de départ.
- `toggleOrientation()` : Alterne l'orientation de l'échiquier (Blancs/Noirs).
- `getTurnColor()` : Renvoie `'white'` ou `'black'`.
- `getCapturedPieces()` : Renvoie un objet contenant les pièces capturées par chaque joueur.
- `getMaterialCount()` : Renvoie le décompte du matériel et le différentiel.
- `drawMove(from, to, color)` : Dessine une flèche sur l'échiquier.
- `hideMoves()` : Efface les flèches et marques temporaires.

### Moteur Stockfish
- `updateStockfishConfig(config)` : Met à jour dynamiquement la configuration de Stockfish.

### Navigation dans l'Historique
- `viewHistory(ply)` : Navigue vers le demi-coup spécifié dans l'historique de la partie (active le mode lecture seule).
- `stopViewingHistory()` : Revient à la position de jeu active actuelle.
- `viewStart()` : Revient au tout début de la partie.
- `viewNext()` : Avance au coup suivant dans l'historique.
- `viewPrevious()` : Recule au coup précédent.

