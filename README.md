# eg-chessboard

`eg-chessboard` est une bibliothèque de composant d'échiquier modulaire, découplée et isopérimétrique (parité 1:1), conçue pour être utilisée de manière transparente dans des applications **Vue 3** (Vite) et **React** (WordPress Gutenberg Blocks).

Elle s'appuie sur **[@lichess-org/chessground](https://github.com/lichess-org/chessground)** (v10) pour l'interface utilisateur interactive ultra-rapide, **[chessops](https://github.com/niklasf/chessops)** (v0.15+) pour la validation des règles, la gestion des positions et l'analyse d'arbres PGN avec sous-variantes, et intègre **[Stockfish](https://github.com/official-stockfish/Stockfish)** (via Web Workers / WASM) pour les suggestions de coups et le jeu contre l'ordinateur.

---

## 🏛️ Architecture

La bibliothèque est construite selon le principe de **source de vérité unique** :

- **`BoardCore` (TS pur - Façade d'Orchestration)** : Moteur logique agnostique qui orchestre l'état et offre l'interface unifiée avec les wrappers. Il s'appuie sur des sous-modules spécialisés sous `src/core/` :
  - **`DomHandler`** : Événements pointer/mouse/touch et calcul dynamique de la géométrie de la grille et des cases.
  - **`StockfishManager`** : Gestion du cycle de vie, protocole UCI et communications avec les Web Workers Stockfish.
  - **`ExerciseManager`** : Restrictions de mouvements (`restrictMovesToPieces`), détection d'attaques et historique solo.
  - **`AnnotationManager`** : Parsing des annotations PGN (`[%cal]`, `[%cpl]`), formes graphiques (flèches/cercles) et synchronisation des événements de tracé (`handleDrawableChange`, `updateCommentAndShapes`).
  - **`PgnTreeManager`** : Arbre PGN (`Node<PgnNodeMeta>`), gestion des sous-variantes, parsing SAN et sérialisation.
  - **`HistoryViewerManager`** : Navigation pas-à-pas dans l'historique (`viewHistory`, `viewNext`, `viewPrevious`, `viewStart`) et états d'affichage.
  - **`FenManager`** : Parsing FEN tolérant, repli manuel et utilitaires d'évaluation de position/matériel (`getMaterialCount`, `getCapturedPieces`, `getGameOverReason`).
  - **`PromotionManager`** : Détection des pions non promus (rangées 1 & 8) et gestion des promesses de dialogues de promotion.
  - **`MoveManager`** : Exécution des coups (SAN/POJO), synchronisation avec l'arbre PGN et émission d'événements de mouvement.
  - **`BoardConfigBuilder`** : Construction de la configuration Chessground et synchronisation réactive de l'état graphique/logique (`updateGameState`, `syncGameFromBoard`).
  - **`pieceMapping`** : Module de constantes partagées (`roleToPieceSymbol`, `pieceSymbolToRole`) et utilitaire centralisé `buildMovePojo` pour la construction des objets `Move`.
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

## 🚀 Optimisations de Bundle

La bibliothèque utilise **lazy loading** et **code splitting** pour optimiser les performances :

| Fichier | Taille (gzip) | Chargé | Description |
|--------|---------------|--------|-------------|
| `index.js` / `react.js` / `vue.js` | **~0.2-5KB** | ✅ Toujours | Points d'entrée framework |
| `chunks/BoardCore-*.js` | **~13KB** | ✅ Toujours | Code principal de la bibliothèque |
| `chunks/vendor-*.js` | **~28KB** | ✅ Toujours | chessops + chessground |
| `stockfish.js` | **~21KB** | ⚠️ Sur demande | Worker Stockfish (JS) |
| `stockfish.wasm` | **~7.3MB** | ⚠️ Sur demande | Binaire Stockfish (WASM) |

**Taille totale initiale :** ~**46KB** (gzip) sans Stockfish
**Avec Stockfish activé :** ~**67KB** + 7.3MB (WASM lazy-loaded)

> ✅ **Aucune dépendance supplémentaire requise** - Tout est bundlé et optimisé.
> ✅ **Stockfish est lazy-loaded** - Le WASM (7.3MB) n'est chargé que si vous activez le mode Stockfish.
> ✅ **Code splitting** - Les dépendances lourdes sont séparées pour un cache optimal.

### 📥 Configuration requise pour Stockfish (WASM)

Pour que Stockfish fonctionne (en mode `hint` ou `elo`), votre application doit :

1. **Servir les fichiers `stockfish.js` et `stockfish.wasm`** depuis votre serveur
2. **Configurer les headers COOP/COEP** pour le lazy loading du WASM

#### Configuration serveur (exemples)

**Nginx :**
```nginx
location / {
  header Cross-Origin-Opener-Policy "same-origin";
  header Cross-Origin-Embedder-Policy "require-corp";
}
```

**Apache :**
```apache
Header set Cross-Origin-Opener-Policy "same-origin"
Header set Cross-Origin-Embedder-Policy "require-corp"
```

**Express.js :**
```javascript
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});
```

**Vite (développement) :**
Déjà configuré dans `vite.config.ts` via les headers du serveur.

#### Configuration du client

Dans votre application, spécifiez les chemins vers les fichiers Stockfish :

```typescript
const stockfishConfig: StockfishConfig = {
  workerUrl: '/stockfish.js',      // Chemin vers le worker JS
  wasmUrl: '/stockfish.wasm',      // Chemin vers le binaire WASM
  whiteMode: 'hint',                // Mode pour les Blancs
  blackMode: 'elo',                // Mode pour les Noirs
  blackElo: 1500,                  // Niveau ELO
  stockfishMoveTime: 1000,         // Temps de réflexion (ms)
};
```

> ⚠️ **Important** : Les chemins doivent être **absolus** (`/stockfish.js`) ou **URL complètes** (`https://cdn.mondomaine.com/stockfish.js`).

---

## 💡 Bonnes pratiques d'intégration

### Optimisation du chargement

1. **Préchargez les chunks critiques** :
   ```html
   <link rel="modulepreload" href="https://cdn.jsdelivr.net/npm/eg-chessboard@1.4.0/chunks/vendor-[hash].js" as="script" crossorigin>
   <link rel="modulepreload" href="https://cdn.jsdelivr.net/npm/eg-chessboard@1.4.0/chunks/BoardCore-[hash].js" as="script" crossorigin>
   ```

2. **Lazy load le composant échiquier** (si l'échiquier n'est pas toujours visible) :
   ```vue
   <!-- Vue 3 avec lazy loading -->
   <template>
     <Suspense>
       <TheChessboard v-if="showChessboard" v-bind="chessboardProps" />
     </Suspense>
   </template>
   ```

3. **Cache longue durée** : Configurez votre serveur pour cache les chunks avec `immutable` :
   ```nginx
   location ~* \.(js|css)$ {
     expires 1y;
     add_header Cache-Control "public, immutable";
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

> 💡 **Structure du build** :
> - Les fichiers principaux (`index.js`, `react.js`, `vue.js`) sont générés dans `/dist`
> - Les dépendances lourdes sont dans `/dist/chunks/vendor-[hash].js`
> - Stockfish est copié dans `/dist/stockfish.js` et `/dist/stockfish.wasm`
> - Les types TypeScript sont générés dans `/dist/*.d.ts`

---

## 🚀 Guide de Démarrage Rapide

### 1. Dans une application Vue 3 (Vite)

```vue
<script setup lang="ts">
import TheChessboard, { type BoardCore, type StockfishConfig, type Move } from 'eg-chessboard/vue';
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

function handleMove(move: Move) {
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
import { Chessboard, type BoardCore, type StockfishConfig, type Move } from 'eg-chessboard/react';
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
        onMove={(move: Move) => console.log('Coup joué :', move.san)}
        onStockfishHint={(bestMove) => console.log('Suggestion :', bestMove)}
      />
    </div>
  );
};
```

---

## 🎛️ Propriétés des Composants (Props)

Les composants `<TheChessboard>` (Vue 3) et `<Chessboard>` (React) partagent une matrice d'interfaces strictly identique :

| Prop | Type | Par défaut | Description |
| :--- | :--- | :--- | :--- |
| `boardConfig` | `Config` | `{}` | Configuration native de l'échiquier Chessground. |
| `mode` | `'editor' \| 'game' \| 'study'` | `'game'` | Mode métier : `'editor'` (diagrammes, formes sur canvas persistant), `'game'` (partie/exercice, formes éphémères ou de consigne), `'study'` (annotations PGN rattachées aux demi-coups `[%cal]`/`[%cpl]`). |
| `playerColor` | `'white' \| 'black' \| 'both'` | `undefined` | Couleur(s) autorisée(s) au déplacement pour l'utilisateur. |
| `freeMode` | `boolean` | `false` | Mode libre : déplace les pièces librement sans validation stricte des règles ni contrainte d'alternance de tour, et resynchronise l'état et la FEN. |
| `soloMode` | `boolean` | `false` | Mode solo : autorise les déplacements consécutifs du même joueur sans alternance forcée. |
| `readOnly` | `boolean` | `false` | Mode lecture seule (Lecteur vs Éditeur PGN). En `readOnly: true`, les coups ne modifient pas le PGN et les formes dessinées sont éphémères. En `readOnly: false`, les coups créent des variantes et les formes/commentaires sont enregistrés dans le PGN. |
| `fitContainer` | `boolean` | `false` | Étend l'échiquier à 100% de la hauteur/largeur du conteneur parent (supprime les ratios fixes). |
| `preserveShapesOnPositionChange` | `boolean` | `false` | Conserve les formes/flèches dessinées lors de la pose ou suppression de pièces (implicite si `mode='editor'`). |
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

## 📚 Référence de l'API `BoardCore` (`boardApi`)

L'instance `BoardCore` (`boardApi`) est transmise via l'événement `board-created` / `onBoardCreated`. Elle constitue l'unique interface d'interaction programmatique avec l'échiquier.

### 1. Introspection & État de la Partie

| Méthode | Type de Retour | Description |
| :--- | :--- | :--- |
| `getFen()` | `string` | FEN complète validée de la position courante. |
| `getPlacementFen()` | `string` | FEN de placement uniquement (sans trait ni roque), extraite directement de Chessground (utile pour le mode libre ou FENs en cours d'édition). |
| `getPgn()` | `string` | Chaîne PGN complète de la partie avec entêtes, annotations et toutes les sous-variantes entre parenthèses `(...)`. |
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
| `isReadOnly()` | `boolean` | Indique si le mode lecture seule est actuellement actif. |
| `getState()` | `Readonly<BoardCoreState>` | Retourne l'état réactif global du Core. |
| `getCapturedPieces()` | `{ white: string[], black: string[] }` | Liste des pièces capturées par chaque couleur. |
| `getMaterialCount()` | `{ white: number, black: number, diff: number }` | Décompte du matériel et différentiel. |
| `getPieces()` | `Map<Key, { type: string, color: 'w' \| 'b' }>` | Liste de toutes les pièces présentes sur l'échiquier. |
| `getHistory(verbose?)` | `Move[] \| string[]` | Historique des coups joués le long de la ligne active. |
| `getLastMove()` | `Move \| null` | Dernier coup joué sur la ligne active. |

### 2. Actions & Modifications de Plateau

| Méthode | Arguments | Description |
| :--- | :--- | :--- |
| `move(moveObj)` | `string \| { from: string, to: string, promotion?: string }` | Joue un coup programmatiquement (ex: `'e4'` ou `{ from: 'e2', to: 'e4' }`). Crée une nouvelle variante si le coup diffère de la ligne existante. |
| `newGame(fen?)` | `fen?: string` | Démarre une nouvelle partie (position initiale par défaut ou FEN personnalisée avec en-têtes SetUp & FEN automatiques). |
| `setPosition(fen)` | `fen: string` | Charge une FEN. Tolère les FENs incomplètes sans crash. |
| `setDiagram(diagram)` | `diagram: ChessDiagram` | Charge une position FEN et ses formes (flèches/cercles). |
| `getDiagram()` | `none` | Retourne l'objet `{ fen, shapes }` représentant la position et les dessins actuels. |
| `loadPgn(pgn)` | `pgn: string` | Charge une partie PGN complète avec toutes ses sous-variantes. |
| `resetBoard()` | `none` | Réinitialise l'échiquier à la position de départ standard. |
| `undoLastMove()` | `none` | Annule le dernier coup joué et remonte au nœud parent dans l'arbre PGN. |
| `toggleOrientation()` | `none` | Inverse l'orientation du plateau (Blancs / Noirs). |
| `putPiece(piece, square)`| `piece: Piece, square: Key \| string` | Dépose une pièce sur une case. |
| `removePiece(square)` | `square: Key \| string` | Supprime la pièce située sur la case. |
| `closePromotionDialog()`| `none` | Ferme le dialogue de sélection de promotion. |
| `setPlayerColor(color)` | `color: 'white' \| 'black' \| 'both'` | Modifie dynamiquement la couleur du joueur autorisée aux déplacements. |
| `setFreeMode(freeMode)` | `freeMode: boolean` | Active/désactive le mode libre. |
| `setSoloMode(soloMode)` | `soloMode: boolean` | Active/désactive le mode solo. |
| `setReadOnly(readOnly)` | `readOnly: boolean` | Active/désactive le mode lecture seule (Lecteur vs Éditeur PGN). |
| `setPreserveShapesOnPositionChange(...)` | `preserve: boolean` | Active/désactive la persistance des formes lors des changements de pièces. |
| `setConfig(config)` | `config: Config` | Applique une nouvelle configuration. Conserve la sélection et les formes si la FEN est inchangée. |
| `getFinalFenFromPgn(pgn)` | `pgn: string` | Retourne la FEN finale calculée à partir d'une chaîne PGN. |
| `redraw(clearBounds?)` | `clearBounds = true` | Invalide le cache des coordonnées DOM et ré-exécute un rendu complet. |

### 3. Navigation dans l'Historique & Gestion des Variantes PGN

| Méthode | Arguments | Description |
| :--- | :--- | :--- |
| `viewHistory(ply)` | `ply: number` | Navigue vers un demi-coup précis le long de la branche active. |
| `stopViewingHistory()`| `none` | Revient au coup de jeu actif. |
| `viewStart()` | `none` | Navigue au tout début de la partie (ply 0). |
| `viewNext()` | `none` | Navigue au coup suivant. |
| `viewPrevious()` | `none` | Navigue au coup précédent. |
| `getVariationsAtPly(ply?)` | `ply?: number` | Retourne la liste des sous-variantes alternatives (`VariationInfo[]`) disponibles à ce demi-coup (supporte ply 0). |
| `selectVariation(index)`| `variationIndex: number` | Bascule le plateau et la ligne active vers la sous-variante indiquée par son index. |
| `promoteVariation(index?)`| `variationIndex?: number` | Promeut la sous-variante indiquée au rang de ligne principale (*mainline*). |
| `deleteVariation(index?)` | `variationIndex?: number` | Supprime la sous-variante indiquée de l'arbre PGN. |
| `getPgnTree()` | `none` | Retourne l'arborescence PGN complète sous forme d'un arbre `PgnTreeNode`. |

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

### 7. Fonctions Utilitaires Autonomes (Helper Functions)

Ces fonctions d'aide sont directement exportées à la racine de la bibliothèque (`eg-chessboard`, `eg-chessboard/vue`, `eg-chessboard/react`) et n'exigent pas d'instancier un échiquier :

| Fonction | Arguments | Type de retour | Description |
| :--- | :--- | :--- | :--- |
| `getFinalFenFromPgn(pgn, fallbackFen?)` | `pgn: string, fallbackFen?: string` | `string` | Déroule la variante principale d'une chaîne PGN via `chessops` et retourne la FEN finale calculée. Renvoie `fallbackFen` (position initiale par défaut) si le PGN est invalide ou vide. |
| `possibleMoves(game)` | `game: Chess` | `Map<Key, Key[]>` | Calcule la carte des coups légaux pour Chessground. |
| `getThreats(moves)` | `moves: Move[]` | `Threat[]` | Génère la liste des attaques et menaces visuelles. |
| `isPromotion(dest, piece)` | `dest: Key, piece: Piece` | `boolean` | Indique si le déplacement spécifié correspond à une promotion de pion. |
| `shortToLongColor(color)` | `color: 'w' \| 'b'` | `'white' \| 'black'` | Convertit la notation courte de couleur vers la notation longue. |


---

## ⚙️ Interfaces et Typage TypeScript

Les types suivants sont ré-exportés directement depuis le point d'entrée principal (`eg-chessboard`, `eg-chessboard/vue`, `eg-chessboard/react`) :

```typescript
import type { 
  BoardCore, 
  BoardCoreState, 
  StockfishConfig, 
  ChessDiagram, 
  Move,
  VariationInfo,
  PgnTreeNode,
  Key, 
  DrawShape 
} from 'eg-chessboard';
import { getFinalFenFromPgn } from 'eg-chessboard';
```

### `Move`

```typescript
export interface Move {
  from: string;        // Case de départ (ex: 'e2')
  to: string;          // Case d'arrivée (ex: 'e4')
  piece: string;       // Symbole de la pièce ('p', 'n', 'b', 'r', 'q', 'k')
  color: 'w' | 'b';    // Couleur du joueur
  san: string;         // Notation SAN (ex: 'Nf3', 'O-O', 'exd5')
  captured?: string;   // Pièce capturée si applicable
  promotion?: string;  // Pièce de promotion si applicable
  before: string;      // FEN avant le coup
  after: string;       // FEN après le coup
}
```

### `VariationInfo`

```typescript
export interface VariationInfo {
  index: number;       // Index de la variante
  san: string;         // Coup SAN de début de variante
  fen: string;         // FEN résultante
  move: Move;          // Objet Mouvement associé
  isMainline: boolean; // Indique si cette variante est la ligne actuellement suivie
  comments?: string[]; // Commentaires associés
}
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

---

## 📜 Changelog

### v1.4.0+ - Optimisations de Bundle (Option C implémentée)

✅ **Code Splitting** : Séparation des dépendances (`chessops` + `chessground`) dans un chunk `vendor-*.js` distinct
✅ **Lazy Loading Stockfish** : Le WASM (7.3MB) est chargé uniquement si Stockfish est activé
✅ **Optimisation Vite** : Configuration améliorée avec esbuild, treeshaking, et cache optimisé
✅ **Documentation mise à jour** : Ajout des sections sur le code splitting et les bonnes pratiques d'intégration

**Impact :**
- Taille initiale réduite à **~46KB** (gzip) sans Stockfish
- Meilleure mise en cache des chunks séparés
- Expérience utilisateur simplifiée (aucune dépendance supplémentaire requise)

---

## 📄 Licence

MIT License - Crédits à [Lichess / Chessground](https://github.com/lichess-org/chessground) et [Lichess / Chessops](https://github.com/niklasf/chessops).
