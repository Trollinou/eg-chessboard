# Journal des modifications (Changelog) - eg-chessboard

Toutes les modifications notables de ce projet seront documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/) et ce projet respecte le [Versionnage Sémantique](https://semver.org/lang/fr/).

## [1.2.1] - 2026-07-27

### Ajouté

- **Méthode `setPlayerColor` & Réactivité `playerColor`** : Ajout de la méthode publique `core.setPlayerColor(color)` sur `BoardCore` et synchronisation réactive dans les wrappers Vue 3 (`TheChessboard.vue`) et React (`Chessboard.tsx`).

### Modifié

- **Optimisation de `setConfig()`** : Comparaison intelligente de FEN via la méthode interne `isSameFen(fen)`. `setConfig()` n'exécute plus `setPosition()` si la FEN fournie est identique à la position actuelle, ce qui empêche la réinitialisation du plateau et préserve la sélection de case lors d'un déplacement en 2 clics.

### Corrigé

- **Dysfonctionnement du mode Solo (`soloMode` + `playerColor`)** : Réalignement automatique du trait interne dans `updateGameState()` si `playerColor` est spécifié, et génération élargie de `dests` pour permettre les mouvements de pièces sans conflit de tour.
- **Effacement intempestif des formes graphiques (`updateCommentAndShapes`)** : Correction de l'effacement automatique des formes personnalisées lorsque la position FEN n'a aucun commentaire PGN (`!rawComment`). Les formes graphiques (flèches et cercles) posées au 1er clic ou transmises via `boardConfig.drawable.shapes` sont désormais préservées.
- **Écrasement de la couleur du joueur (`userMovableColor`) dans `updateGameState`** : Mémorisation de la couleur configurée dans `this.userMovableColor` pour éviter que `updateGameState()` n'écrase la couleur autorisée au joueur par le trait courant de `chess.js`.

---

## [1.2.0] - 2026-07-27

### Ajouté

- **Prop & Option `preserveShapesOnPositionChange`** : Conserve les formes (flèches et cercles) dessinées lors de la modification des pièces (pose, suppression) en mode éditeur/diagramme.
- **Rendu Atomique et Invalidation Cache Bounds (`redraw`)** : Ajout de la méthode publique `redraw(clearBounds)` sur `BoardCore`, `TheChessboard.vue` et `Chessboard.tsx` pour réinitialiser le cache DOM de Chessground et relancer un rendu complet.
- **Calcul de FEN finale PGN (`getFinalFenFromPgn`)** : Méthode utilitaire `getFinalFenFromPgn(pgn: string)` pour obtenir la FEN résultante d'un PGN sans manipuler directement le constructeur interne.
- **Événement `shapes-change` / `onShapesChange`** : Émis nativement lors des annotations graphiques interactives au clic droit par l'utilisateur.
- **Mode d'Édition & Diagramme dans la Sandbox** : Onglet dédié dans `sandbox/DevApp.vue` pour tester la création de positions, la pose/suppression de pièces, le traçage de formes et l'export JSON en temps réel.

### Modifié

- **Optimisation et Rendu GPU (`updateGameState`)** : Regroupement atomique des modifications Chessground dans un seul appel `board.set(...)` avec `animation: { enabled: false }` en mode éditeur et promotion de la couche SVG `.cg-shapes` sur un calque GPU dédié (`z-index: 3`, `transform: translateZ(0)`).

### Corrigé

- **Affichage Échiquier en Mode Paysage** : Suppression de la media query `@media (orientation: landscape)` dans `src/style.css` qui imposait à `.main-wrap` une largeur fixe (`90vh` / max `700px`), empêchant l'échiquier de s'adapter à 100% de la largeur du conteneur parent et provoquant un tronquage vertical sur ordinateur et tablette.
- **Clignotement et Effacement des Formes au Clic** :
  - Protection des formes via le tampon `autoShapes` de Chessground contre les effacements automatiques au clic gauche sur cases vides.
  - Détection matérielle du bouton de souris (`lastMouseButton`) pour filtrer les auto-clears du clic gauche tout en permettant l'effacement immédiat des formes au clic droit.
  - Correction de `putPiece()` en vidant préventivement la case (`remove`) avant l'insertion dans `chess.js` afin d'éviter les rejets sur cases occupées.

---

## [1.1.4] - 2026-07-17

### Modifié

- **Optimisation de la synchronisation en mode libre** : Remplacement de l'instanciation coûteuse de l'objet `Chess` temporaire dans `syncGameFromBoard()` par l'utilisation directe de `getPlacementFen()`.

### Corrigé

- **Crash lors de la restauration de FEN invalides** : Correction d'une exception non interceptée dans le bloc `finally` de `getPossibleMovesForBothColors()`. Les appels à `this.game.load()` y ont été remplacés par `this.safeLoadFen()` afin de tolérer la restauration de FEN incomplètes sans faire planter l'application.

---

## [1.1.3] - 2026-07-12

### Modifié

- **Compatibilité React 17 & 18** :
  - Rétrogradation des `peerDependencies` et `devDependencies` de React vers la version `^18.2.0` (types inclus) pour assurer la compatibilité et éviter les conflits lors de builds avec React 19.
- **Externalisation de `react/jsx-runtime`** :
  - Configuration de Vite (`vite.config.ts`) pour marquer `'react/jsx-runtime'` comme dépendance externe dans `rollupOptions.external` afin d'éviter d'embarquer (inliner) le runtime JSX dans le bundle compilé de React.

---

## [1.1.2] - 2026-07-10

### Modifié

- **Compatibilité TypeScript 6.0.3 et `vue-tsc`** :
  - Configuration de `"rootDir": "src"` dans `tsconfig.json` pour la génération des fichiers de déclaration.
  - Déclaration globale de module pour les fichiers `.css` dans `src/env.d.ts`.
  - Passage de l'instance `core` en `shallowRef` dans `TheChessboard.vue` pour conserver l'exactitude du type original de `BoardCore` sans enveloppement Proxy de Vue.
  - Migration de `defineEmits` vers le format objet de tuples pour se conformer au typage strict de TS 6.

### Corrigé

- **Conflits de Dépendances ESLint** : Rétrogradation d'ESLint de `^10.6.0` (encore instable/incompatible) vers la version stable `^9.21.0` afin de résoudre les conflits d'installation `EROSOLVE` avec les plugins React/Vue.

---

## [1.1.1] - 2026-07-05

### Ajouté

- **Mode Solo (`soloMode`)** : Prise en charge des déplacements consécutifs sans alternance forcée de tour pour les exercices d'apprentissage (disponible dans les composants Vue, React et dans `BoardCore`).
- **APIs d'exercices** : Ajout de `isSquareAttacked`, `getPieces`, et `getSoloHistory` dans `BoardCore` pour valider les actions de l'utilisateur dans les exercices.

### Corrigé

- **Réinitialisation de Stockfish** : Correction d'un bug où le moteur Stockfish n'était plus réinitialisé après une partie terminée en cliquant sur "Nouvelle partie" ou en chargeant un nouveau FEN / PGN. Les workers sont désormais ré-instanciés correctement si nécessaire.

---

## [1.1.0] - 2026-06-15

### Ajouté

- **Intégration de Stockfish** : Prise en charge du moteur Stockfish via Web Workers pour suggérer le meilleur coup (`hint`) ou pour jouer contre l'ordinateur à un ELO configurable (`elo`).
- **Mode Libre (`freeMode`)** : Possibilité de déplacer librement toutes les pièces sur le plateau, synchronisant dynamiquement l'état FEN interne du jeu.
- **Navigation Historique** : Ajout de fonctionnalités permettant d'explorer programmatiquement les coups précédents dans la partie (`viewHistory`, `viewStart`, `viewNext`, `viewPrevious`, `stopViewingHistory`).
- Dépendance npm ajoutée pour `stockfish` (v18.0.7).
- **Exportation de types** : Exportation de `StockfishConfig` et `BoardCore` depuis la racine et les modules spécifiques (Vue et React) pour faciliter l'intégration et le typage TypeScript dans les applications clientes.

---

## [1.0.0] - 2026-06-15

### Ajouté

- Initialisation de la bibliothèque découplée `eg-chessboard`.
- **`BoardCore.ts`** : Coeur logique agnostique encapsulant `chess.js` et Chessground.
- **`BoardHelper.ts`** : Outils partagés de validation de coups, détection d'échecs, de promotions et de menaces.
- **Composant Vue 3** (`src/vue/TheChessboard.vue`) : Wrapper réactif et boîte de dialogue de promotion pour Vue 3/Vite.
- **Composant React** (`src/react/Chessboard.tsx`) : Wrapper réactif prêt pour intégration dans WordPress (Gutenberg).
- **CSS unifié** : Styles Chessground v10 et SVG base64 intégrés pour le thème des pièces.
- **Build multi-entrées** (Vite) : Sorties configurées séparément pour Vue, React, le Core et le CSS avec génération des déclarations de types TypeScript (`.d.ts`).
- Dépendances configurées avec `@lichess-org/chessground` (v10.1.1) et `chess.js` (v1.4.0).
- Configuration de la qualité du code avec **ESLint (v9 Flat Config)** et **Prettier**.
- Scripts npm dédiés : `lint`, `lint:fix`, `format`, et `format:check`.

### Corrigé

- Nettoyage des avertissements d'analyse statique (typage strict avec `chess.js` à la place de `any` et résolution des dépendances de hooks React).
