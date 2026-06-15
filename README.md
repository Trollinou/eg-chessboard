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
import TheChessboard from 'eg-chessboard/vue';
import 'eg-chessboard/style.css';

function handleBoardCreated(boardApi: any) {
  console.log('FÉNICIA :', boardApi.getFen());
}

function handleMove(move: any) {
  console.log('Coup joué :', move.san);
}
</script>

<template>
  <TheChessboard
    :player-color="'white'"
    @board-created="handleBoardCreated"
    @move="handleMove"
  />
</template>
```

### 2. Dans un projet React (Gutenberg / WordPress)

```tsx
import React from 'react';
import { Chessboard } from 'eg-chessboard/react';
import 'eg-chessboard/style.css';

export const MyChessBlock = () => {
  const handleBoardCreated = (boardApi: any) => {
    console.log('FÉNICIA :', boardApi.getFen());
  };

  return (
    <Chessboard
      playerColor="white"
      onBoardCreated={handleBoardCreated}
      onMove={(move) => console.log('Coup joué :', move.san)}
    />
  );
};
```

---

## API de `BoardCore`

L'instance d'API (`boardApi` ou `BoardCore`) renvoyée lors de la création de l'échiquier expose de nombreuses méthodes :

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
