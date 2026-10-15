# Guide de Conception d'Exercices & Parcours d'Apprentissage (`eg-chessboard`)

Ce guide détaille la création d'exercices tactiques, de parcours d'apprentissage pour débutants et de jeux de déplacement solo à l'aide d'`eg-chessboard` (disponible pour **Vue 3** et **React**).

---

## 1. Vue d'Ensemble & Configuration Idéale

Pour concevoir des exercices pédagogiques, la configuration recommandée repose sur :
- **`mode="game"`** : Maintient la validation des règles d'échecs (déplacements licites des pièces).
- **`soloMode={true}`** : Permet au joueur de déplacer successivement plusieurs fois ses propres pièces sans que le trait n'alterne automatiquement vers l'adversaire.
- **`playerColor="white"`** (ou `"black"`) : Empêche le joueur de saisir les pièces adverses.
- **`preserveShapesOnPositionChange={true}`** : Conserve les cercles de cases cibles et flèches indicatrices affichés même lorsque la pièce bouge.

```html
<!-- Vue 3 -->
<TheChessboard
  mode="game"
  :solo-mode="true"
  player-color="white"
  :preserve-shapes-on-position-change="true"
/>
```

```tsx
// React
<Chessboard
  mode="game"
  soloMode={true}
  playerColor="white"
  preserveShapesOnPositionChange={true}
/>
```

---

## 2. Le Mode Solo (`soloMode`) & Historique Solo

En mode standard, chaque coup inverse le trait (`turnColor`). En `soloMode` :
1. Le trait reste figé sur la couleur de la pièce qui vient d'être jouée.
2. Chaque coup est enregistré dans un historique solo distinct : `core.getSoloHistory()`.
3. L'appel à `core.undoLastMove()` annule le dernier coup de cet historique solo et repositionne la pièce sans altérer les règles du jeu.

```typescript
// Récupérer la séquence des coups joués par l'apprenant dans l'exercice :
const history: Move[] = core.getSoloHistory();
console.log(`Nombre de déplacements effectués : ${history.length}`);

// Annuler le dernier coup :
core.undoLastMove();
```

---

## 3. Restriction Dynamique des Déplacements

Pour guider l'élève ou imposer une règle spécifique (ex: "Déplace uniquement le Fou blanc", ou "Résous ce mat en 1 coup avec le Cavalier") :

### 3.1 Restreindre aux pièces situées sur certaines cases
La méthode `restrictMovesToPieces` filtre automatiquement les coups légaux de la position pour n'autoriser la manipulation que des pièces spécifiées :

```typescript
// L'apprenant ne peut attraper et déplacer que la pièce sur la case c4 :
core.restrictMovesToPieces(['c4']);

// Pour autoriser deux pièces spécifiques :
core.restrictMovesToPieces(['c4', 'f3']);

// Pour réinitialiser et autoriser toutes les pièces du joueur :
core.restrictMovesToPieces(null);
```

### 3.2 Imposer des destinations sur-mesure (`setCustomDests`)
Si vous souhaitez imposer des cases d'arrivée précises (par exemple dans un mini-jeu personnalisé) :

```typescript
const customDests = new Map<Key, Key[]>();
// La pièce en d4 ne peut aller qu'en e5 ou f6 :
customDests.set('d4', ['e5', 'f6']);

core.setCustomDests(customDests);

// Pour réinitialiser :
core.setCustomDests(null);
```

---

## 4. Détection des Menaces & Cases Attaquées (`isSquareAttacked`)

Pour vérifier si l'apprenant s'est déplacé sur une case défendue par l'adversaire (danger, case piégée) ou pour valider un exercice d'évasion :

```typescript
// Vérifie si la case 'e4' est contrôlée/attaquée par les Noirs :
const isDanger: boolean = core.isSquareAttacked('e4', 'black');

if (isDanger) {
  alert("Attention ! Cette case est attaquée par une pièce adverse.");
  core.undoLastMove(); // Annule le déplacement imprudent
}
```

> [!NOTE]
> `isSquareAttacked` s'appuie directement sur le moteur de règles `chessops` et prend en compte les clouages et trajectoires de toutes les pièces adverses.

---

## 5. Suivi des Pièces Restantes & Validation d'Objectifs

Pour les exercices de type "Capturez toutes les étoiles / pions adverses" :

```typescript
// 1. Obtenir l'inventaire actuel des pièces sur le plateau :
const pieces = core.getPieces();
// Map<Key, { type: Role, color: 'w' | 'b' }>

// Vérifier s'il reste des pièces noires :
const blackPiecesCount = Array.from(pieces.values()).filter(p => p.color === 'b').length;
if (blackPiecesCount === 0) {
  console.log("Bravo ! Toutes les pièces adverses ont été capturées !");
}

// 2. Obtenir la liste détaillée des pièces déjà capturées :
const capturedPieces = core.getCapturedPieces(); // { white: [...], black: [...] }

// 3. Calculer le total de matériel restant :
const material = core.getMaterialCount(); // { white: 39, black: 24 }
```

---

## 6. Consignes Graphiques Persistantes

Dans les exercices, il est fréquent d'afficher une case cible (cercle vert) ou une consigne de trajectoire (flèche jaune). Grâce à `preserveShapesOnPositionChange={true}`, ces annotations ne disparaissent pas au premier coup joué :

```typescript
core.setShapes([
  // Flèche verte indiquant une suggestion de trajet
  { orig: 'b1', dest: 'c3', brush: 'green' },
  // Cercle jaune marquant la case cible finale de l'exercice
  { orig: 'd5', brush: 'yellow' }
]);
```

---

## 7. Exemples d'Intégration Complète

### 7.1 Exemple Vue 3 : Exercice "Le Parcours du Cavalier"

```vue
<template>
  <div class="exercise-container">
    <h3>Exercice : Amenez le Cavalier sur la case cible en évitant les cases attaquées !</h3>
    
    <TheChessboard
      mode="game"
      :solo-mode="true"
      player-color="white"
      :preserve-shapes-on-position-change="true"
      piece-set="cburnett"
      board-theme="green"
      @board-created="onBoardCreated"
      @move="onMove"
    />

    <div class="status-panel">
      <p>Coups joués : {{ moveCount }}</p>
      <p v-if="feedback" class="feedback">{{ feedback }}</p>
      <button @click="resetExercise">Recommencer</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { TheChessboard, type BoardCore, type Move, type Key } from 'eg-chessboard';
import 'eg-chessboard/style.css';

const core = ref<BoardCore | null>(null);
const moveCount = ref(0);
const feedback = ref('');
const TARGET_SQUARE: Key = 'g6';

function onBoardCreated(instance: BoardCore) {
  core.value = instance;
  setupExercise();
}

function setupExercise() {
  if (!core.value) return;
  
  // FEN avec un Cavalier blanc en b1 et une Tour noire en e8
  core.value.setPosition('4r3/8/8/8/8/8/8/1N6 w - - 0 1');
  
  // On restreint les déplacements au seul Cavalier en b1
  core.value.restrictMovesToPieces(['b1']);
  
  // On trace la case cible
  core.value.setShapes([{ orig: TARGET_SQUARE, brush: 'yellow' }]);
  
  moveCount.value = 0;
  feedback.value = '';
}

function onMove(move: Move) {
  if (!core.value) return;
  moveCount.value++;

  // Vérifier si la case d'arrivée est sous le feu de la Tour noire :
  if (core.value.isSquareAttacked(move.to as Key, 'black')) {
    feedback.value = '❌ Case attaquée par la Tour adverse ! Coup annulé.';
    core.value.undoLastMove();
    moveCount.value--;
    return;
  }

  // Vérifier si l'objectif est atteint :
  if (move.to === TARGET_SQUARE) {
    feedback.value = `🎉 Bravo ! Objectif atteint en ${moveCount.value} coups !`;
    core.value.restrictMovesToPieces([]); // Bloque les coups
  } else {
    feedback.value = 'Bien joué, continuez !';
  }
}

function resetExercise() {
  setupExercise();
}
</script>
```

---

### 7.2 Exemple React : Exercice d'Attaque Directe

```tsx
import React, { useRef, useState, useCallback } from 'react';
import { Chessboard, type BoardCore, type Move, type Key } from 'eg-chessboard';
import 'eg-chessboard/style.css';

export const TacticalPuzzle: React.FC = () => {
  const coreRef = useRef<BoardCore | null>(null);
  const [status, setStatus] = useState<string>('Trouvez le coup gagnant !');

  const onBoardCreated = useCallback((core: BoardCore) => {
    coreRef.current = core;
    // Position de puzzle tactique (Mat en 1)
    core.setPosition('r1bqkb1r/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 1');
    core.restrictMovesToPieces(['h5']); // Seule la Dame est autorisée
    core.setShapes([{ orig: 'f7', brush: 'red' }]);
  }, []);

  const onMove = useCallback((move: Move) => {
    if (move.from === 'h5' && move.to === 'f7') {
      setStatus('🏆 Échec et mat ! Exercice réussi.');
    } else {
      setStatus('❌ Mauvais coup. Réessayez !');
      coreRef.current?.undoLastMove();
    }
  }, []);

  return (
    <div className="puzzle-container">
      <h3>{status}</h3>
      <Chessboard
        mode="game"
        soloMode={true}
        playerColor="white"
        pieceSet="staunty"
        boardTheme="brown"
        onBoardCreated={onBoardCreated}
        onMove={onMove}
      />
    </div>
  );
};
```
