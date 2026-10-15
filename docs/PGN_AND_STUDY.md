# Guide d'Intégration PGN, Études & Analyses (`eg-chessboard`)

Ce guide détaille l'utilisation du mode **Study** (`mode="study"`), la gestion de l'arbre PGN avec sous-variantes, l'encodage/décodage des annotations graphiques et la navigation dans l'historique au sein d'`eg-chessboard` (disponible pour **Vue 3** et **React**).

---

## 1. Principes Fondamentaux : Mode Lecteur vs Mode Éditeur

La prop `readOnly` détermine la manière dont `eg-chessboard` interagit avec l'arborescence PGN :

| Mode | `readOnly` | Déplacement de pièces | Clic droit (formes graphiques) | Sous-variantes PGN |
| :--- | :--- | :--- | :--- | :--- |
| **Mode Lecteur (Reader)** | `true` | Bloqué ou limité à la relecture de la variante | **Éphémères** (visuelles uniquement, non sérialisées dans le PGN) | Aucune altération de l'arbre PGN |
| **Mode Éditeur (Study Editor)** | `false` *(défaut)* | Autorisé sur n'importe quel demi-coup (ply) | **Persistantes** (encodées dans les balises `[%cal]`/`[%csl]` du coup) | **Création automatique** d'une nouvelle branche / sous-variante |

> [!TIP]
> Pour une plateforme de cours ou de puzzles où l'apprenant doit simplement consulter une partie ou résoudre un coup prédéfini, utilisez `readOnly={true}`. Pour un outil de préparation d'ouvertures ou d'annotation de parties, utilisez `readOnly={false}`.

---

## 2. Cycle de Vie & Chargement d'un PGN

### 2.1 Initialisation
L'échiquier peut être initialisé avec une position de départ ou une FEN personnalisée :

```typescript
// Réinitialisation standard (position de départ classique)
core.newGame();

// Réinitialisation sur une FEN personnalisée (injecte [SetUp "1"] et [FEN "..."] dans le PGN)
core.newGame('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3');

// Chargement complet d'une partie avec métadonnées et variantes
core.loadPgn(`[Event "Partie Exemple"]
[Site "Paris"]
[Date "2026.10.15"]
[White "Joueur A"]
[Black "Joueur B"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 (2... d6 3. d4) 3. Bc4 Bc5 { Position d'attaque [%cal Ge2e4,Gf3e5] } 4. c3 1-0`);
```

> [!NOTE]
> `loadPgn()` positionne automatiquement l'échiquier sur la position initiale (`viewStart()` / ply 0) afin d'afficher d'emblée la FEN de départ et les éventuels commentaires d'introduction (`startingComments`).

### 2.2 Récupération du PGN résultant
À tout moment, vous pouvez exporter le PGN complet incluant l'intégralité des sous-variantes entre parenthèses, les commentaires textuels et les balises graphiques :

```typescript
const pgnString: string = core.getPgn();
const pgnHeaders: Record<string, string> = core.getPgnInfo();
```

---

## 3. Navigation dans l'Historique

Le composant fournit une API impérative complète pour piloter la barre de navigation :

```typescript
// Début de partie (ply 0)
core.viewStart();

// Coup précédent
core.viewPrevious();

// Coup suivant
core.viewNext();

// Dernier coup de la branche active
core.viewEnd();

// Aller directement à un demi-coup précis (ex: après 1. e4 -> ply 1)
core.viewHistory(plyNumber);

// Vérifier si l'utilisateur navigue dans le passé
const isViewingHistory: boolean = core.isViewingHistory();
const historyState = core.getHistoryViewerState(); // { isEnabled, currentPly, maxPly }
```

Lors de la navigation, `eg-chessboard` émet l'événement `turn-change` (`onTurnChange` en React) avec la couleur au trait et le numéro de ply correspondant.

---

## 4. Gestion des Variantes & Arbre PGN

`eg-chessboard` modélise l'arborescence complète via la structure `PgnTreeNode` :

### 4.1 Consulter les sous-variantes à une position
À tout moment (ou à un ply spécifique), vous pouvez interroger les variantes alternatives disponibles :

```typescript
const variations: VariationInfo[] = core.getVariationsAtPly();
// variations = [
//   { index: 0, san: "Nf3", isCurrent: true },
//   { index: 1, san: "Bc4", isCurrent: false }
// ]
```

### 4.2 Naviguer et réorganiser les variantes
```typescript
// Basculer sur une sous-variante alternative
core.selectVariation(variationIndex);

// Promouvoir une variante secondaire en ligne principale (mainline)
core.promoteVariation(variationIndex);

// Supprimer une sous-variante superflue
core.deleteVariation(variationIndex);

// Obtenir l'arbre complet sous forme d'objet JSON exploitable
const tree: PgnTreeNode = core.getPgnTree();
```

---

## 5. Commentaires Textuels & Annotations Graphiques (`[%cal]`, `[%csl]`)

Les annotations graphiques (flèches et cercles de couleur) sont synchronisées de manière transparente avec la syntaxe standard PGN :
- `[%cal <couleur><caseDépart><caseArrivée>]` (ex: `[%cal Ge2e4,Rc1g5]`)
- `[%csl <couleur><case>]` (ex: `[%csl Ge4,Ye5,Rd4]`)

Les couleurs supportées sont :
- `G` : Vert (Green - par défaut)
- `R` : Rouge (Red)
- `B` : Bleu (Blue)
- `Y` : Jaune (Yellow)

### 5.1 Écriture de commentaires et de formes
```typescript
// Ajouter un commentaire textuel et des formes sur le coup visualisé à l'écran :
core.setComment(
  "Attaque double sur la case f7 !",
  [
    { orig: 'c4', dest: 'f7', brush: 'red' },
    { orig: 'f7', brush: 'yellow' }
  ]
);

// Ou cibler un demi-coup précis dans l'arborescence :
core.setCommentAtPly(ply, "Coup douteux", shapes);
```

### 5.2 Lecture
```typescript
// Commentaire textuel nettoyé (dépouillé des balises [%cal]/[%csl])
const comment: string = core.getCurrentComment();

// Formes actuellement dessinées sur l'échiquier
const shapes: DrawShape[] = core.getShapes();
```

---

## 6. Exemples d'Intégration Complète

### 6.1 Exemple Vue 3 (`StudyPlayer.vue`)

```vue
<template>
  <div class="study-player">
    <TheChessboard
      mode="study"
      :read-only="false"
      piece-set="merida"
      board-theme="blue"
      @board-created="onBoardCreated"
      @turn-change="onTurnChange"
    />

    <!-- Panneau de navigation et commentaires -->
    <div class="controls">
      <div class="nav-buttons">
        <button @click="core?.viewStart()">|&lt;</button>
        <button @click="core?.viewPrevious()">&lt;</button>
        <button @click="core?.viewNext()">&gt;</button>
        <button @click="core?.viewEnd()">&gt;|</button>
      </div>

      <div class="comment-box">
        <h4>Commentaire (Ply {{ currentPly }})</h4>
        <p>{{ currentComment || 'Aucun commentaire sur ce coup.' }}</p>
      </div>

      <!-- Liste des variantes disponibles -->
      <div v-if="variations.length > 1" class="variations-list">
        <h4>Variantes alternatives :</h4>
        <button
          v-for="v in variations"
          :key="v.index"
          :class="{ active: v.isCurrent }"
          @click="selectVariation(v.index)"
        >
          {{ v.san }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { TheChessboard, type BoardCore, type VariationInfo } from 'eg-chessboard';
import 'eg-chessboard/style.css';

const core = ref<BoardCore | null>(null);
const currentPly = ref(0);
const currentComment = ref('');
const variations = ref<VariationInfo[]>([]);

function onBoardCreated(instance: BoardCore) {
  core.value = instance;
  // Chargement d'une étude
  core.value.loadPgn('1. e4 e5 2. Nf3 (2. f4 exf4) 2... Nc6 { Position ouverte }');
  refreshUi();
}

function onTurnChange(_color: 'white' | 'black', ply: number) {
  currentPly.value = ply;
  refreshUi();
}

function selectVariation(index: number) {
  core.value?.selectVariation(index);
  refreshUi();
}

function refreshUi() {
  if (!core.value) return;
  currentComment.value = core.value.getCurrentComment();
  variations.value = core.value.getVariationsAtPly();
}
</script>
```

---

### 6.2 Exemple React (`StudyPlayer.tsx`)

```tsx
import React, { useRef, useState, useCallback } from 'react';
import { Chessboard, type BoardCore, type VariationInfo } from 'eg-chessboard';
import 'eg-chessboard/style.css';

export const StudyPlayer: React.FC = () => {
  const coreRef = useRef<BoardCore | null>(null);
  const [currentComment, setCurrentComment] = useState('');
  const [variations, setVariations] = useState<VariationInfo[]>([]);

  const refreshUi = useCallback((core: BoardCore) => {
    setCurrentComment(core.getCurrentComment());
    setVariations(core.getVariationsAtPly());
  }, []);

  const handleBoardCreated = useCallback((core: BoardCore) => {
    coreRef.current = core;
    core.loadPgn('1. d4 d5 2. c4 c6 (2... e6 3. Nc3) 3. Nf3 { Défense Slave }');
    refreshUi(core);
  }, [refreshUi]);

  const handleTurnChange = useCallback(() => {
    if (coreRef.current) {
      refreshUi(coreRef.current);
    }
  }, [refreshUi]);

  return (
    <div className="study-player">
      <Chessboard
        mode="study"
        readOnly={false}
        pieceSet="cburnett"
        boardTheme="wood"
        onBoardCreated={handleBoardCreated}
        onTurnChange={handleTurnChange}
      />

      <div className="nav-controls">
        <button onClick={() => coreRef.current?.viewStart()}>|&lt;</button>
        <button onClick={() => coreRef.current?.viewPrevious()}>&lt;</button>
        <button onClick={() => coreRef.current?.viewNext()}>&gt;</button>
        <button onClick={() => coreRef.current?.viewEnd()}>&gt;|</button>
      </div>

      <div className="comments">
        <p>{currentComment || 'Pas de commentaire.'}</p>
      </div>

      {variations.length > 1 && (
        <div className="variations">
          {variations.map((v) => (
            <button
              key={v.index}
              style={{ fontWeight: v.isCurrent ? 'bold' : 'normal' }}
              onClick={() => {
                coreRef.current?.selectVariation(v.index);
                if (coreRef.current) refreshUi(coreRef.current);
              }}
            >
              {v.san}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
```
