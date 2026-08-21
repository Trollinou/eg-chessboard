# Journal des modifications (Changelog) - eg-chessboard

Toutes les modifications notables de ce projet seront documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/) et ce projet respecte le [Versionnage Sémantique](https://semver.org/lang/fr/).

## [Unreleased]

### Ajouté & Corrigé

- **Support Multi-Thèmes d'Échiquier & Coordonnées Dynamiques (8 thèmes vectoriels SVG)** :
  - Intégration de **8 thèmes d'arrière-plan vectoriels (SVG 8x8)** pour l'échiquier :
    - `brown` (Bois clair / noisette classique Lichess - style par défaut)
    - `blue` (Bleu ciel / acier moderne)
    - `green` (Vert tournoi officiel / feutre)
    - `ic` (Style Lichess IC doux et contrasté)
    - `grey` (Gris moderne / ardoise)
    - `purple` (Violet / lilas contemporain)
    - `wood` (Bois noyer chaud)
    - `maple` (Érable naturel doré)
  - **Contraste automatique des coordonnées (rangées 1-8 et colonnes a-h)** : variables CSS `--board-coord-light` et `--board-coord-dark` scopées par thème garantissant une lisibilité optimale sur les cases claires et sombres.
  - Ajout de la prop `boardTheme?: BoardTheme` sur les composants Vue 3 (`<TheChessboard board-theme="..." />`) et React (`<Chessboard boardTheme="..." />`).
  - Ajout des méthodes publiques `core.setBoardTheme(theme)` et `core.getBoardTheme()`, et intégration dans l'état réactif `state.boardTheme` (`BoardCoreState`).
  - Export des constantes `AVAILABLE_BOARD_THEMES` et du type `BoardTheme` à la racine de la bibliothèque pour les sélecteurs UI.
  - Ajout d'un sélecteur interactif de thème d'échiquier dans la sandbox.

- **Support Multi-Jeux de Pièces (8 thèmes vectoriels SVG modulaires)** :
  - Intégration de **8 styles de pièces vectoriels complets** (96 fichiers SVG au total) dans `src/assets/pieces/` :
    - `staunton` (Staunton réaliste 3D - style par défaut)
    - `merida` (Standard classique des diagrammes et manuels)
    - `alpha` (Eric Bentzen - fort contraste et contours nets)
    - `cburnett` (Colin Burnett - flat design moderne de Lichess)
    - `cardinal` (Style tournoi traditionnel élégant)
    - `dubrovny` (Inspiré des pièces des Olympiades de Dubrovnik 1950)
    - `maestro` (Style traditionnel européen robuste)
    - `staunty` (Variante Staunton contemporaine épurée)
  - Ajout de la prop `pieceSet?: PieceSet` sur les composants Vue 3 (`<TheChessboard piece-set="..." />`) et React (`<Chessboard pieceSet="..." />`).
  - Ajout des méthodes publiques `core.setPieceSet(pieceSet)` et `core.getPieceSet()`, avec intégration dans l'état réactif `state.pieceSet` (`BoardCoreState`).
  - Export des constantes `AVAILABLE_PIECE_SETS` et du type `PieceSet` à la racine de la bibliothèque pour introspection et sélecteurs d'options UI.
  - Règles CSS dynamiques `.piece-set-${pieceSet}` appliquées harmonieusement sur le plateau de jeu et dans la boîte de dialogue de promotion.
  - Ajout d'un sélecteur interactif de jeu de pièces dans la sandbox de développement.

- **Optimisation du bundle CSS autonome (`dist/eg-chessboard.css`)** :
  - Nettoyage et optimisation SVGO des 12 SVGs vectoriels originaux (suppression des métadonnées d'éditeurs Inkscape/Sodipodi, optimisation des chemins et encodage Data-URI direct).
  - Préservation intégrale et à 100% du design visuel original des pièces (dégradés, ombres portées, filtres et reflets 3D).
  - Réduction de la taille du CSS de distribution de **153 Ko** à **92 Ko** (**18.17 Ko gzip**, soit **~60% d'économie en gzip**).
  - Maintien du bundle tout-en-un autonome pour une intégration transparente et sans configuration sous React et Vue 3.
- **Centralisation de `playerColor` dans `BoardCoreState`** :
  - Ajout de `playerColor?: 'white' | 'black' | 'both'` directement dans l'interface réactive `BoardCoreState`.
  - Mise à jour réactive automatique de `state.playerColor` lors des appels à `core.setPlayerColor()`, `core.setConfig()` ou modification de prop (`playerColor` / `boardConfig.movable.color`), notifiant automatiquement `onStateChange()`.
  - Intégration de `playerColor` dans l'état réactif initial des wrappers React (`useState`) et Vue 3 (`reactive`).
- **Refactoring Architectural Majeur & Découplage par Domaines (4 modules)** :
  - Restructuration et division par 2 de la taille de `BoardCore.ts` (~490 lignes au lieu de 956), transformé en une véritable Façade mince sans logique métier résiduelle.
  - Remplacement des contextes massifs (`MoveManagerContext`, `BoardConfigContext`, `AnnotationContext`) par un **`DomainEventBus` typé** éliminant toutes les dépendances circulaires et passages de closures.
  - Consolidation des 10 sous-managers en **4 services de domaine autonomes** :
    - `GameSession` : Moteur de session et PGN pur sans dépendance DOM (fusion de `PgnTreeManager`, `HistoryViewerManager` et validation/exécution des coups de `MoveManager`).
    - `BoardAdapter` : Gestion de l'instance Chessground, des événements DOM, de la synchronisation bidirectionnelle (`syncGameFromBoard`, `updateGameState`) et des promotions (fusion de `DomHandler`, `BoardConfigBuilder`, `PromotionManager`).
    - `AnnotationService` : Centralisation du cycle de vie des formes (`DrawShape`), des menaces et des balises PGN `[%cal]`/`[%cpl]`.
    - `StockfishManager` & `ExerciseManager` : Services satellites modernisés avec injection de dépendances directe par constructeur.
  - Suppression des 7 anciens fichiers de sous-managers redondants.
  - **Immutabilité garantie** : `getState()` retourne désormais systématiquement un snapshot gelé (`Object.freeze`) avec copies profondes des sous-états (`promotionDialogState`, `historyViewerState`), garantissant une étanchéité totale face aux mutations par effet de bord depuis React et Vue 3.
  - **Fiabilisation de l'IA Stockfish** : Élimination des envois intempestifs de commandes `stop` sur worker inactif, déduplication des émissions d'événements de mouvement, et normalisation des coups UCI.
- **Détection de la Triple Répétition & Règle des 50 coups (`chessops`)** :
  - Implémentation de `PgnTreeManager.isThreefoldRepetition` exploitant `equalsIgnoreMoves` de `chessops/chess` pour comparer l'identité exacte des positions successives le long de la branche active.
  - Branchement réel de `BoardCore.getIsThreefoldRepetition()` (qui retournait précédemment `false`).
  - Prise en compte de la triple répétition et de la règle des 50 coups (`pos.halfmoves >= 100`) dans `BoardCore.getIsDraw()`, `BoardCore.getIsGameOver()` et `BoardCore.getGameOverReason()`.
  - Émission automatique de l'événement `draw` / `onDraw` dans `BoardConfigBuilder` dès qu'une triple répétition ou les 50 demi-coups sans prise/pion sont atteints.

### Refactorisation & Performance

- **Suppression des redondances `userMovableColor` et `initialConfig` dans `BoardCore`** :
  - Suppression de la variable d'instance isolée `userMovableColor` au profit de la source de vérité unique `state.playerColor`.
  - Suppression de la rétention d'instance `initialConfig` dans `BoardCore` : transmission directe de la configuration à `initBoard(initialConfig)` sans duplication mémoire.
  - Allègement de `BoardConfigContext` et `BoardConfigBuilder` par l'utilisation directe de `ctx.state.playerColor` sans callbacks verbeux (`setUserMovableColor`).
- **Simplification du calcul de FEN & suppression du cache FEN (`cachedFen` / `resetFenCache`)** :
  - Suppression de la variable d'état `cachedFen` dans `BoardCore` au profit d'un calcul direct et déterministe à la volée via `makeFen(this.pos.toSetup())`.
  - Suppression du callback `resetFenCache` dans les contextes et interfaces internes (`BoardConfigContext`, `MoveManagerContext`, `PromotionManager`).
  - Élimination des risques de désynchronisation d'état (*stale cache*) et allègement des contrats de dépendance entre `BoardCore` et ses sous-managers.

## [1.5.0] - 2026-08-18

### Ajouté & Amélioré

- **Réactivité unifiée de l'état de jeu (`BoardCoreState`)** :
  - Extension de `BoardCoreState` avec les propriétés dynamiques `turnColor` ('white' | 'black'), `ply` (number), `fen` (string), `isCheck` (boolean) et `isGameOver` (boolean).
  - Synchronisation automatique et centralisée via `onStateChange()` sur toute modification ou transition de partie (coups, annulations `undo`, réinitialisations, navigation dans l'historique).
  - Dans Vue 3 (`TheChessboard.vue`), l'état `state` est réactif et exposé directement via `defineExpose({ core, state, redraw })`.
  - Dans React (`Chessboard.tsx`), `useState<BoardCoreState>` est synchronisé avec l'état complet du core.
- **Nouvel événement de changement de trait (`turn-change` / `onTurnChange`)** :
  - Vue 3 : émission de `@turn-change="(turnColor, ply) => ..."` à chaque alternance ou transition de trait.
  - React : support de la prop `onTurnChange?: (turnColor, ply) => void`.
- **Enrichissement du type `Move` (événement `@move` / `onMove`)** :
  - Ajout des champs `turnColor`, `ply` et `isCheck` dans l'objet `Move` retourné lors de l'exécution d'un coup.
- **Mode Éditeur PGN (`readOnly: false`) & Arborescence Interactive** :
  - Support complet de l'édition PGN interactive avec création et suivi dynamique des sous-variantes.
  - Déplacement de pièces à partir de n'importe quel ply de l'historique pour insérer automatiquement une sous-variante dans l'arbre PGN.
  - Sauvegarde persistante des commentaires textuels et des annotations graphiques (`[%cal]`, `[%cpl]`) dans les nœuds du PGN (`Node<PgnNodeMeta>`).
  - Distinction stricte entre Mode Lecteur (`readOnly: true` : navigation sans altération, formes éphémères) et Mode Éditeur (`readOnly: false` : sous-variantes et persistance).
  - Nouvelles méthodes d'API publique et synchronisation réactive : `setReadOnly`, `isReadOnly`, `deleteVariation`, `promoteVariation`, `selectVariation`, `getVariationsAtPly`.
  - Intégration de `syncGamePosToPly` et liaison explicite du setter `setPos` sur `BoardCore.pos` pour garantir la synchronisation instantanée de l'échiquier lors des coups joués en historique.
- **Correction de la persistance des promotions et de l'édition libre (`PromotionManager` & `BoardConfigBuilder`)** :
  - Synchronisation explicite de la carte interne des pièces de Chessground (`board.state.pieces`) lors de la sélection d'une promotion.
  - Remplacement de `Chess.fromSetup` par `FenManager.safeLoadFen` dans `syncGameFromBoard` pour accepter toutes les positions de diagrammes personnalisées (ex: pièces hors-normes, absence de rois, échecs atypiques) sans rejet ni avertissement intempestif.
  - Ajout du bloc de fallback pour les déplacements libres normaux en mode édition (`changeTurn`), garantissant la répercussion instantanée des mouvements de pièces sur l'état logique et l'arbre PGN.
  - Suppression des avertissements informatifs `console.warn` de `safeLoadFen` pour conserver une console propre et silencieuse lors de la composition de positions.

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
