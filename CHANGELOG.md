# Journal des modifications (Changelog) - eg-chessboard

Toutes les modifications notables de ce projet seront documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/) et ce projet respecte le [Versionnage Sémantique](https://semver.org/lang/fr/).

## [Non publié / Unreleased]

### Ajouté & Amélioré

- **Mode Éditeur PGN (`readOnly: false`) & Arborescence Interactive** :
  - Support complet de l'édition PGN interactive avec création et suivi dynamique des sous-variantes.
  - Déplacement de pièces à partir de n'importe quel ply de l'historique pour insérer automatiquement une sous-variante dans l'arbre PGN.
  - Sauvegarde persistante des commentaires textuels et des annotations graphiques (`[%cal]`, `[%cpl]`) dans les nœuds du PGN (`Node<PgnNodeMeta>`).
  - Distinction stricte entre Mode Lecteur (`readOnly: true` : navigation sans altération, formes éphémères) et Mode Éditeur (`readOnly: false` : sous-variantes et persistance).
  - Nouvelles méthodes d'API publique et synchronisation réactive : `setReadOnly`, `isReadOnly`, `deleteVariation`, `promoteVariation`, `selectVariation`, `getVariationsAtPly`.
  - Intégration de `syncGamePosToPly` et liaison explicite du setter `setPos` sur `BoardCore.pos` pour garantir la synchronisation instantanée de l'échiquier lors des coups joués en historique.

---

## [1.3.5] - 2026-08-08

### Ajouté & Amélioré

- **Taille réactive et proportionnelle du panneau de promotion (`.promotion-dialog`)** :
  - Intégration des CSS Container Queries (`container-type: inline-size` sur `.main-board`).
  - Redimensionnement dynamique des pièces du panneau de promotion (`.promotion-piece-btn`) pour représenter exactement **90% de la taille d'une case de l'échiquier** (`calc(100cqw / 8 * 0.9)`).
  - Adaptation réactive du padding, de l'espacement (`gap`), de l'arrondi (`border-radius`) et des bordures du dialogue en fonction de la taille réelle de l'échiquier.
  - Synchronisation parfaite des styles réactifs entre React et Vue 3 (`PromotionDialog.vue`).

## [1.3.3] - 2026-08-07

### Corrigé & Amélioré

- **Tracé dynamique des formes et flèches (`defaultSnapToValidMove`)** :
  - Invalidation dynamique du cache des coordonnées DOM (`clearDomBounds`) lors du déclenchement du clic droit (`pointerdown` / `contextmenu`), ainsi qu'au redimensionnement (`ResizeObserver`, `resize` et `scroll`), empêchant tout décalage géométrique.
  - Alignement par mode métier : restriction de l'aimantage (`defaultSnapToValidMove: true`) au mode `'game'` (coups valides de la Dame et du Cavalier) et désactivation (`defaultSnapToValidMove: false`) en modes `'editor'` et `'study'` pour autoriser les flèches libres entre n'importe quelles cases.

### Refactorisation & Assainissement du Code (Code Health)

- **Encapsulation & Sub-managers** :
  - Suppression des accès aux membres privés par contournement de typage (`this.domHandler['boardElement']`) avec l'ajout de `domHandler.getElement()`.
  - Centralisation de la constante de coordonnées de colonnes `FILES` dans `pieceMapping.ts` et réutilisation dans `DomHandler.ts`, `FenManager.ts` et `PromotionManager.ts`.
  - Réutilisation de `roleToPieceSymbol` dans `ExerciseManager.ts` pour la résolution des pièces de l'échiquier.
  - Déduplication du cycle de vie et du traitement UCI des workers Stockfish (`setupWorker`, `handleEngineMessage`).
  - Centralisation de la résolution des plies dans `HistoryViewerManager.ts` (`getCurrentViewingPly`).

## [1.3.0] - 2026-08-01

### Ajouté

- **Migration de `chess.js` vers `chessops` & Support des sous-variantes PGN** :
  - Remplacement complet de `chess.js` par la bibliothèque hautement performante `chessops` (v0.15.1).
  - Gestion native de l'arborescence PGN (`PgnTreeNode`), des commentaires textuels et des balises graphiques `[%cal]` / `[%cpl]`.
  - Nouvelles méthodes API publiques sur `BoardCore` pour explorer et manipuler les sous-variantes PGN : `getVariationsAtPly()`, `selectVariation()`, `getPgnTree()`.
  - Fonction utilitaire exportée `getFinalFenFromPgn(pgn, fallbackFen)` pour obtenir la FEN finale d'un PGN sans manipuler l'API `chessops`.

### Refactorisation

- **Décomposition de `BoardCore` en sub-managers (`src/core/`)** :
  - Restructuration modulaire sous `src/core/` en 6 gestionnaires dédiés : `DomHandler`, `StockfishManager`, `ExerciseManager`, `AnnotationManager`, `PgnTreeManager` et `HistoryViewerManager`.
  - `BoardCore` agit comme Façade conservant l'API publique inchangée.

### Modifié & Optimisé

- **Performance & Calcul des coups** :
  - Intégration directe de `chessgroundDests` et mise en cache des calculs FEN pour accélérer les déplacements et le tracé.
  - Normalisation des cases de destination du roque pour Chessground (support des formats `e1g1` et `e1h1`).

### Corrigé

- **Mode Libre (`freeMode`)** : Correction du réalignement du trait dynamique empêchant la réinitialisation des pièces hors-tour lors de coups consécutifs de même couleur.
- **Prise en passant (`en-passant`)** : Synchronisation précise de la FEN et détection exacte des pièces capturées lors des coups en passant.

---

## [1.2.2] - 2026-07-29

### Corrigé

- **Mode Libre (`freeMode`) & Réinitialisation des pièces déplacées hors-tour** :
  - Adaptation dynamique du trait (`this.pos.turn`) à la couleur de la pièce déplacée dans `move()` lorsque `this.state.freeMode` est actif, permettant l'enchaînement de coups consécutifs de même couleur sans erreur de validation.
  - Extraction de la FEN de placement directement depuis `this.board.state.pieces` (Chessground) dans `getPlacementFen()`, empêchant la réinitialisation visuelle des pièces hors-tour lors des coups suivants.

---

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
