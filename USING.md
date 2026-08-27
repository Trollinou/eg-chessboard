# 📚 Guide d'Utilisation & Anti-Sèche : `eg-chessboard` (v1.6.1)

Ce document est votre **anti-sèche d'utilisation**. Il vous permet de retrouver instantanément les réglages et snippets de code prêts à l'emploi selon chaque cas d'usage dans vos applications **Vue 3**, **React** ou **WordPress Gutenberg**.

---

## 🏆 Les 5 Règles d'Or à Retenir

1. **Éditeur de Diagramme FEN (Gutenberg Inspector)** :
   - Passez uniquement `mode="editor"`. Nul besoin d'ajouter d'autres props (`freeMode` et `preserveShapesOnPositionChange` sont automatiques).
2. **Exercice Solo d'Apprentissage (Déplacer la même pièce plusieurs fois)** :
   - Utilisez `mode="game"` avec `soloMode={true}` et `playerColor="white"`.
3. **Exercice avec Consignes Visuelles (Cercles/Flèches qui restent en place)** :
   - Utilisez `mode="game"` avec `preserveShapesOnPositionChange={true}`.
4. **Partie contre l'Ordinateur (IA Stockfish)** :
   - Utilisez `mode="game"` + `playerColor="white"` + `stockfishConfig={{ blackMode: 'elo', blackElo: 1500 }}`.
5. **Analyseur PGN & Cours Interactifs avec Variantes** :
   - Utilisez `mode="study"`.

---

## 🧩 1. Les 3 Piliers de Configuration

### A. Le Mode Métier Principal : `mode`
C'est le paramètre fondamental qui définit la **finalité** du composant :
- **`mode="game"`** *(défaut)* : Pour **jouer** une partie (humain vs humain ou IA) ou **résoudre** un exercice. Validation stricte des règles par `chessops`.
- **`mode="editor"`** : Pour **éditer** un diagramme / poser des pièces librement / composer un problème FEN. Tolérance totale aux positions hors-règles.
- **`mode="study"`** : Pour **analyser** une partie PGN avec sous-variantes `(...)` et commentaires graphiques `[%cal]`/`[%csl]`.

---

### B. Les Modificateurs de Comportement (Flags / Drapeaux)

| Prop | Type | Par Défaut | Rôle & Usage |
| :--- | :--- | :--- | :--- |
| **`freeMode`** | `boolean` | `false` | Déplace n'importe quelle pièce sur n'importe quelle case sans valider les règles ni alterner le trait. *(Inutile si `mode="editor"` car automatique)*. |
| **`soloMode`** | `boolean` | `false` | Conserve le trait pour la couleur jouée après chaque coup. Utilisé pour les **exercices d'apprentissage solo** (ex: déplacer la même pièce 4 fois de suite). |
| **`readOnly`** | `boolean` | `false` | Mode lecture seule en mode `study`. Si `true` (Lecteur PGN), la navigation est libre mais les pièces ne modifient pas l'arbre et les formes sont éphémères. Si `false` (Éditeur PGN), les coups créent des sous-variantes et les formes/commentaires sont enregistrés dans le PGN. |
| **`preserveShapesOnPositionChange`** | `boolean` | `false` | Garde les flèches et cercles affichés même lorsque les pièces bougent. Utilisé pour **maintenir les consignes visuelles d'un exercice**. *(Inutile si `mode="editor"` car automatique)*. |
| **`pieceSet`** | `PieceSet` | `'cburnett'` | Style graphique des pièces (`'cburnett'`, `'maestro'`, `'merida'`, `'alpha'`, `'cardinal'`, `'dubrovny'`, `'fantasy'`, `'firi'`, `'tatiana'`, `'staunty'`). |
| **`boardTheme`** | `BoardTheme` | `'brown'` | Thème d'arrière-plan de l'échiquier et contraste des coordonnées (`'brown'`, `'blue'`, `'green'`, `'ic'`, `'grey'`, `'purple'`, `'wood'`, `'wood3'`, `'maple'`). |
| **`playerColor`** | `'white' \| 'black' \| 'both'` | `undefined` | Restreint les pièces déplaçables par l'utilisateur. Exemple : `'white'` empêche l'utilisateur d'attraper les pièces noires. |
| **`fitContainer`** | `boolean` | `false` | Étend l'échiquier à 100% de la hauteur/largeur de son conteneur parent (supprime les ratios fixes). |

---

### C. Le Moteur d'IA : `stockfishConfig`
Contrôle le Web Worker Stockfish (WASM) :
- **Si omis ou `{}`** : Aucun Worker créé (performance optimale).
- **Partie contre l'IA** : `blackMode: 'elo', blackElo: 1500` (l'ordinateur joue les Noirs à 1500 ELO).
- **Conseil / Suggestion (Hint)** : `whiteMode: 'hint'` (émets l'événement `@stockfish-hint` sans jouer le coup automatiquement).

---

### D. Le Style Graphique des Pièces : `pieceSet` & `AVAILABLE_PIECE_SETS`
Permet de changer l'apparence des pièces à chaud :
- **10 styles vectoriels inclus** : `'cburnett'` *(défaut)*, `'maestro'`, `'merida'`, `'alpha'`, `'cardinal'`, `'dubrovny'`, `'fantasy'`, `'firi'`, `'tatiana'`, `'staunty'`.
- La liste complète est exportée sous `AVAILABLE_PIECE_SETS` pour alimenter directement vos sélecteurs d'options UI.

---

### E. Le Thème de l'Échiquier : `boardTheme` & `AVAILABLE_BOARD_THEMES`
Permet de personnaliser le fond du plateau et les couleurs des coordonnées :
- **9 thèmes inclus** : `'brown'` *(défaut)*, `'blue'`, `'green'`, `'ic'`, `'grey'`, `'purple'`, `'wood'`, `'wood3'` *(texture HD photoréaliste)*, `'maple'`.
- La liste complète est exportée sous `AVAILABLE_BOARD_THEMES`.
- Les coordonnées (1-8, a-h) adaptent automatiquement leurs contrastes clairs/sombres en fonction du thème choisi.

---

## 📊 2. Matrice de Configuration Rapide (Quel scénario utiliser ?)

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    MATRICE DE CONFIGURATION                                                 │
├──────────────────────────────────────┬──────────┬──────────┬──────────┬──────────┬──────────────┬───────────┤
│ Scénario d'Usage                      │ mode     │ readOnly │ freeMode │ soloMode │ preserve...  │ player... │
├──────────────────────────────────────┼──────────┼──────────┼──────────┼──────────┼──────────────┼───────────┤
│ 1. Éditeur de Diagramme (Gutenberg)  │ 'editor' │ false    │ (Auto)   │ false    │ (Auto)       │ Omis      │
│ 2. Partie 2 Joueurs en Local (2P)    │ 'game'   │ false    │ false    │ false    │ false        │ Omis      │
│ 3. Joueur Blanc vs Ordinateur (IA)   │ 'game'   │ false    │ false    │ false    │ false        │ 'white'   │
│ 4. Joueur Noir vs Ordinateur (IA)    │ 'game'   │ false    │ false    │ false    │ false        │ 'black'   │
│ 5. Exercice Solo d'Apprentissage     │ 'game'   │ false    │ false    │ true     │ true (si req)│ 'white'   │
│ 6. Lecteur PGN (Lecture Seule)       │ 'study'  │ true     │ false    │ false    │ false        │ Omis      │
│ 7. Éditeur PGN (Interactif & Variantes)│ 'study'│ false    │ false    │ false    │ false        │ Omis      │
│ 8. Bac à Sable / Réflexion Libre     │ 'game'   │ false    │ true     │ false    │ false        │ Omis      │
└──────────────────────────────────────┴──────────┴──────────┴──────────┴──────────┴──────────────┴───────────┘
```

---

## 🛠️ 3. Fiches Recettes Prêtes à Copier-Coller

### Recette 1 : Bloc Éditeur de Diagramme (Gutenberg Inspector)
*Besoin : Poser des pièces librement par clic ou drag, dessiner des flèches au clic droit, aucun contrôle de règles.*

```tsx
<Chessboard
  mode="editor"
  diagram={{ fen: attributes.fen, shapes: attributes.shapes }}
  onBoardCreated={(core) => (coreRef.current = core)}
/>
```

---

### Recette 2 : Partie Joueur vs IA (L'ordinateur joue les Noirs à 1500 ELO)
*Besoin : Le joueur a les Blancs, l'IA répond automatiquement.*

```tsx
const stockfishConfig: StockfishConfig = {
  workerUrl: '/stockfish.js',
  wasmUrl: '/stockfish.wasm',
  blackMode: 'elo',
  blackElo: 1500,
  stockfishMoveTime: 1000,
};

<Chessboard
  mode="game"
  playerColor="white"
  stockfishConfig={stockfishConfig}
  onMove={(move) => console.log('Coup joué :', move.san)}
/>
```

---

### Recette 3 : Exercice Solo d'Apprentissage avec Consignes Visuelles
*Besoin : Déplacer un Cavalier blanc plusieurs fois jusqu'à une cible (cercle vert) sans que les pièces ne réinitialisent les formes.*

```tsx
<Chessboard
  mode="game"
  soloMode={true}
  preserveShapesOnPositionChange={true}
  playerColor="white"
  diagram={{
    fen: '8/8/8/8/4N3/8/8/8 w - - 0 1',
    shapes: [
      { orig: 'e4', brush: 'blue' },
      { orig: 'c7', brush: 'green' }
    ]
  }}
/>
```

---

### Recette 4 : Lecteur PGN en Lecture Seule (`readOnly={true}`)
*Besoin : Consulter une partie PGN et ses variantes sans altérer le document. Formes éphémères au clic droit.*

```tsx
<Chessboard
  mode="study"
  readOnly={true}
  onBoardCreated={(core) => {
    core.loadPgn('1. e4 e5 (1... c5 { [%cal Gc5d4] } 2. Nf3) 2. Nf3 Nc6');
  }}
/>
```

---

### Recette 5 : Éditeur PGN Interactif avec Création de Variantes (`readOnly={false}`)
*Besoin : Saisir de nouveaux coups sur n'importe quel demi-coup pour générer des sous-variantes, ajouter des explications textuelles et dessiner des flèches persistantes.*

```tsx
<Chessboard
  mode="study"
  readOnly={false}
  onBoardCreated={(core) => {
    // Nouvelle partie ou FEN personnalisée avec en-têtes Setup automatiques
    core.newGame('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3');
    // Récupérer le PGN généré à tout moment :
    console.log(core.getPgn());
  }}
/>
```

---

### Recette 6 : Partie 2 Joueurs en Local (Même Écran)
*Besoin : Deux joueurs s'affrontent sur le même écran avec alternance stricte des traits et vérification des règles.*

```tsx
<Chessboard
  mode="game"
  playerColor="both"
  onCheck={(color) => alert(`Échec au roi ${color} !`)}
  onCheckmate={(color) => alert(`Échec et mat ! Les ${color === 'white' ? 'Noirs' : 'Blancs'} ont gagné.`)}
/>
```

---

### Recette 7 : Sélecteur de Jeu de Pièces & Changement Dynamique
*Besoin : Permettre à l'utilisateur de choisir le thème de pièces parmi les 8 modèles disponibles.*

```vue
<!-- Vue 3 -->
<script setup lang="ts">
import { ref } from 'vue';
import TheChessboard, { AVAILABLE_PIECE_SETS, type PieceSet } from 'eg-chessboard/vue';

const selectedPieceSet = ref<PieceSet>('cburnett');
</script>

<template>
  <div>
    <select v-model="selectedPieceSet">
      <option v-for="set in AVAILABLE_PIECE_SETS" :key="set" :value="set">
        {{ set }}
      </option>
    </select>

    <TheChessboard :piece-set="selectedPieceSet" />
  </div>
</template>
```

```tsx
// React
import React, { useState } from 'react';
import { Chessboard, AVAILABLE_PIECE_SETS, type PieceSet } from 'eg-chessboard/react';

export const CustomPieceSetBoard: React.FC = () => {
  const [pieceSet, setPieceSet] = useState<PieceSet>('cburnett');

  return (
    <div>
      <select value={pieceSet} onChange={(e) => setPieceSet(e.target.value as PieceSet)}>
        {AVAILABLE_PIECE_SETS.map((set) => (
          <option key={set} value={set}>
            {set}
          </option>
        ))}
      </select>

      <Chessboard pieceSet={pieceSet} />
    </div>
  );
};
```

---

### Recette 8 : Sélecteur de Thème d'Échiquier & Ambiance
*Besoin : Personnaliser le visuel de l'échiquier et les couleurs des coordonnées.*

```vue
<!-- Vue 3 -->
<script setup lang="ts">
import { ref } from 'vue';
import TheChessboard, { AVAILABLE_BOARD_THEMES, type BoardTheme } from 'eg-chessboard/vue';

const selectedTheme = ref<BoardTheme>('green');
</script>

<template>
  <div>
    <select v-model="selectedTheme">
      <option v-for="theme in AVAILABLE_BOARD_THEMES" :key="theme" :value="theme">
        {{ theme }}
      </option>
    </select>

    <TheChessboard :board-theme="selectedTheme" />
  </div>
</template>
```

```tsx
// React
import React, { useState } from 'react';
import { Chessboard, AVAILABLE_BOARD_THEMES, type BoardTheme } from 'eg-chessboard/react';

export const ThemedBoard: React.FC = () => {
  const [boardTheme, setBoardTheme] = useState<BoardTheme>('green');

  return (
    <div>
      <select value={boardTheme} onChange={(e) => setBoardTheme(e.target.value as BoardTheme)}>
        {AVAILABLE_BOARD_THEMES.map((theme) => (
          <option key={theme} value={theme}>
            {{ theme }}
          </option>
        ))}
      </select>

      <Chessboard boardTheme={boardTheme} />
    </div>
  );
};
```


