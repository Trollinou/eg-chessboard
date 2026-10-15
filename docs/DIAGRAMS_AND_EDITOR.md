# Guide de Composition de Diagrammes & Mode Éditeur (`eg-chessboard`)

Ce guide détaille l'utilisation du mode **Éditeur** (`mode="editor"`), la manipulation libre des pièces, la gestion de la structure `ChessDiagram` et l'intégration dans des blocs d'édition (tels que **WordPress Gutenberg Blocks**) à l'aide d'`eg-chessboard` (disponible pour **Vue 3** et **React**).

---

## 1. Principes Fondamentaux du Mode Éditeur (`mode="editor"`)

Le mode `editor` est spécialement conçu pour composer des positions, créer des problèmes ou éditer des diagrammes statiques :

1. **Tolérance Totale aux Règles** : Aucune contrainte d'alternance de traits ni d'interdiction de coups dits illégaux (deux rois adjacents, pions doublés sur la même colonne, rois manquants, etc.).
2. **Mode Libre Automatique** : Le mode libre (`freeMode`) est activé par défaut en mode `editor` : les pièces peuvent être glissées-déposées vers n'importe quelle case.
3. **Persistance des Formes** : Toutes les formes dessinées au clic droit sont conservées et intégrées dans la structure `ChessDiagram`.
4. **Promotion Automatique** : Lorsqu'un pion est déposé sur la 8e ou 1re rangée, `eg-chessboard` déclenche automatiquement le dialogue de sélection de pièce pour promouvoir le pion.

---

## 2. La Structure `ChessDiagram` & la Prop `diagram`

Pour encapsuler à la fois la position des pièces et les annotations visuelles (flèches, cercles), `eg-chessboard` fournit l'interface `ChessDiagram` :

```typescript
export interface ChessDiagram {
  fen: string;             // Chaîne FEN complète ou FEN de placement (ex: "8/8/4k3/8/8/4K3/8/8")
  shapes?: DrawShape[];    // Tableau des flèches et cercles annotés sur le diagramme
}
```

### 2.1 Utilisation via la prop `diagram`
Vous pouvez passer directement un objet `diagram` au composant. Toute modification de cette prop est synchronisée réactivement :

```html
<!-- Vue 3 -->
<TheChessboard
  mode="editor"
  :diagram="currentDiagram"
  @shapes-change="onShapesChange"
/>
```

```tsx
// React
<Chessboard
  mode="editor"
  diagram={currentDiagram}
  onShapesChange={onShapesChange}
/>
```

### 2.2 Lecture et écriture impératives via `BoardCore`
```typescript
// Récupérer le snapshot complet du diagramme courant :
const diagram: ChessDiagram = core.getDiagram();
console.log(diagram.fen);    // Position actuelle
console.log(diagram.shapes); // Formes graphiques

// Mettre à jour position et formes en une seule opération :
core.setDiagram({
  fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R b KQkq - 0 5',
  shapes: [
    { orig: 'c4', dest: 'f7', brush: 'red' },
    { orig: 'e1', dest: 'g1', brush: 'green' }
  ]
});
```

---

## 3. Manipulation Directe des Pièces

Pour concevoir une palette de pièces d'édition (type "pièces à glisser" ou "clic pour poser") :

### 3.1 Poser une pièce (`putPiece`)
```typescript
// Pose une Dame blanche en d5 :
core.putPiece({ type: 'queen', color: 'w' }, 'd5');

// Pose un Pion noir en e4 :
core.putPiece({ type: 'pawn', color: 'b' }, 'e4');
```

### 3.2 Supprimer une pièce (`removePiece`)
```typescript
// Supprime la pièce présente sur la case f7 :
core.removePiece('f7');
```

### 3.3 Vider ou Réinitialiser l'échiquier
```typescript
// Échiquier totalement vide :
core.setPosition('8/8/8/8/8/8/8/8 w - - 0 1');

// Position de départ standard :
core.newGame();
```

---

## 4. Extraction & Validation FEN

### 4.1 FEN de Placement (`getPlacementFen`)
Lors de la composition d'une position, les informations de roque, de prise en passant ou d'horloge ne sont souvent pas encore définies. Vous pouvez extraire directement la FEN de placement des pièces :

```typescript
const placement: string = core.getPlacementFen();
// Ex: "r1bqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR"
```

### 4.2 Validation de la FEN (`validateFen`)
Pour vérifier si la chaîne FEN saisie par l'utilisateur est valide syntaxiquement et structurellement avant de l'appliquer :

```typescript
import { validateFen } from 'eg-chessboard';

const result = validateFen(userInputFen);
if (result.valid) {
  core.setPosition(userInputFen);
} else {
  console.error("FEN invalide :", result.error);
}
```

---

## 5. Exemples d'Intégration Complète

### 5.1 Exemple Vue 3 : Éditeur avec Palette de Pièces

```vue
<template>
  <div class="diagram-editor">
    <div class="board-wrapper">
      <TheChessboard
        mode="editor"
        piece-set="cburnett"
        board-theme="brown"
        @board-created="onBoardCreated"
        @square-click="onSquareClick"
      />
    </div>

    <!-- Palette de pièces pour poser/retirer -->
    <div class="palette">
      <p>Sélectionnez une pièce puis cliquez sur une case :</p>
      <div class="pieces-row">
        <button
          v-for="p in palettePieces"
          :key="p.label"
          :class="{ selected: selectedPiece?.type === p.type && selectedPiece?.color === p.color }"
          @click="selectPiece(p)"
        >
          {{ p.label }}
        </button>
        <button :class="{ selected: isEraser }" @click="toggleEraser">🧹 Gomme</button>
      </div>

      <div class="actions">
        <button @click="clearBoard">Vider l'échiquier</button>
        <button @click="copyFen">Copier la FEN</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { TheChessboard, type BoardCore } from 'eg-chessboard';
import 'eg-chessboard/style.css';

const core = ref<BoardCore | null>(null);
const selectedPiece = ref<{ type: string; color: 'w' | 'b' } | null>(null);
const isEraser = ref(false);

const palettePieces = [
  { label: '♔ Roi Blanc', type: 'king', color: 'w' as const },
  { label: '♕ Dame Blanche', type: 'queen', color: 'w' as const },
  { label: '♖ Tour Blanche', type: 'rook', color: 'w' as const },
  { label: '♚ Roi Noir', type: 'king', color: 'b' as const },
  { label: '♛ Dame Noire', type: 'queen', color: 'b' as const },
  { label: '♜ Tour Noire', type: 'rook', color: 'b' as const },
];

function onBoardCreated(instance: BoardCore) {
  core.value = instance;
}

function selectPiece(p: { label: string; type: string; color: 'w' | 'b' }) {
  isEraser.value = false;
  selectedPiece.value = { type: p.type, color: p.color };
}

function toggleEraser() {
  isEraser.value = !isEraser.value;
  selectedPiece.value = null;
}

function onSquareClick(square: string) {
  if (!core.value) return;

  if (isEraser.value) {
    core.value.removePiece(square);
  } else if (selectedPiece.value) {
    core.value.putPiece(selectedPiece.value, square);
  }
}

function clearBoard() {
  core.value?.setPosition('8/8/8/8/8/8/8/8 w - - 0 1');
}

function copyFen() {
  if (!core.value) return;
  const fen = core.value.getFen();
  navigator.clipboard.writeText(fen);
  alert(`FEN copiée dans le presse-papier :\n${fen}`);
}
</script>
```

---

### 5.2 Exemple React : Bloc Gutenberg WordPress (Inspecteur & Éditeur)

```tsx
import React, { useRef, useState, useCallback } from 'react';
import { Chessboard, type BoardCore, type ChessDiagram, type DrawShape } from 'eg-chessboard';
import 'eg-chessboard/style.css';

interface GutenbergChessBlockProps {
  attributes: {
    diagram: ChessDiagram;
    theme: string;
  };
  setAttributes: (attrs: Partial<{ diagram: ChessDiagram; theme: string }>) => void;
}

export const GutenbergChessBlock: React.FC<GutenbergChessBlockProps> = ({
  attributes,
  setAttributes,
}) => {
  const coreRef = useRef<BoardCore | null>(null);

  const onBoardCreated = useCallback((core: BoardCore) => {
    coreRef.current = core;
  }, []);

  const onShapesChange = useCallback((shapes: DrawShape[]) => {
    if (!coreRef.current) return;
    setAttributes({
      diagram: {
        fen: coreRef.current.getFen(),
        shapes,
      },
    });
  }, [setAttributes]);

  const onMove = useCallback(() => {
    if (!coreRef.current) return;
    setAttributes({
      diagram: {
        fen: coreRef.current.getFen(),
        shapes: coreRef.current.getShapes(),
      },
    });
  }, [setAttributes]);

  return (
    <div className="wp-block-eg-chessboard">
      <Chessboard
        mode="editor"
        diagram={attributes.diagram}
        boardTheme={attributes.theme as any || 'brown'}
        onBoardCreated={onBoardCreated}
        onShapesChange={onShapesChange}
        onMove={onMove}
      />
    </div>
  );
};
```
