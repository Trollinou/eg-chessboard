# Règle GitHub MCP
- Interdiction d'utiliser l'outil `get_repository_content` sur la racine du projet (cela chargerait des milliers de fichiers).
- Utilise toujours `search_code` ou `get_file_content` sur des fichiers ciblés.

--- 

# Instructions d'Optimisation de Contexte

## Règles de manipulation PHP / JS / TS / VUE / CSS / TSX / JSX / HTML
- Interdiction de lire ou charger des fichiers entiers si la tâche cible une fonction précise. Utilise des requêtes ciblées par blocs de lignes.
- Ne réécris JAMAIS un fichier complet pour une modification de logique. Produis uniquement des blocs de "diff" de code ou des fonctions isolées.
- Supprime tous les commentaires verbeux ou disclaimers lors des réponses.

---

# Spécification d'Isopérimètre : eg-chessboard

## 1. Principes Fondamentaux d'Architecture

Pour éviter les divergences de comportement entre le modèle _pull/immutabilité_ de React et le modèle _push/Proxy_ de Vue 3 :

1. **Source de Vérité Unique** : L'état du jeu réside exclusivement dans `BoardCore`. Les frameworks ne font que refléter cet état graphiquement.
2. **Mutations Interdites depuis la Vue** : Aucun wrapper (React ou Vue) ne doit modifier directement l'objet `state` ou ses sous-propriétés (ex: `state.promotionDialogState`). Toute modification doit passer par une méthode publique de `BoardCore`.
3. **Flux Unidirectionnel avec Événements** : Le cœur notifie les wrappers de tout changement d'état interne via un mécanisme d'écoute (`onStateChange`). Le wrapper React met alors à jour son `useState` (via le getter public `core.getState()`), et le wrapper Vue met à jour sa référence réactive.
4. **Pas de Fuite d'Abstraction** : L'accès aux propriétés privées par contournement de typage (ex: `coreRef.current['state']`) est strictly interdit. Toutes les lectures d'état se font via les getters publics (`getState()`, `getCurrentComment()`, `getHistoryViewerState()`, `isViewingHistory()`, etc.).
5. **Décomposition Modulaire & Façade sous `src/core/`** : `BoardCore` agit comme une **Façade fine** conservant l'API publique inchangée et orchestrant les 4 domaines spécialisés via un bus d'événements de domaine interne (`DomainEventBus`) :
   - `GameSession` : Moteur de session pur (sans dépendance DOM). Centralise l'arbre PGN (`Node<PgnNodeMeta>`), la navigation dans l'historique (`viewHistory`, `viewNext`, `viewPrevious`, `viewStart`), la validation et l'exécution des coups (Lecteur vs Éditeur avec sous-variantes), et l'arbitrage (mat, pat, nulle, 50 coups, triple répétition).
   - `BoardAdapter` : Intégration graphique Chessground (`Api`) et DOM. Gère les calculs de cases et de géométrie, les écouteurs de pointeur/redimensionnement, les dialogues de promotion, et la synchronisation bidirectionnelle (`updateGameState`, `syncGameFromBoard`).
   - `AnnotationService` : Gestion centralisée des formes graphiques (flèches `[%cal]`, cercles/cases `[%csl]`/`[%cpl]`), des menaces (`drawThreats`), et distinction entre annotations persistantes (mode `editor`) et éphémères (mode `game`/`study` en `readOnly`).
   - `StockfishManager` : Cycle de vie, gestion UCI et communication Web Workers Stockfish.
   - `ExerciseManager` : Restrictions de coups (`restrictMovesToPieces`), détection d'attaques et historique solo.
   - `DomainEventBus` : Bus d'événements de domaine typé découplant les sous-systèmes sans références circulaires.
   - `FenManager` & `pieceMapping` : Modules utilitaires purs (parsing FEN tolérant, placement, calculs de matériel/captures, construction de POJOs `Move`).
6. **Immutabilité de l'état exposé (`getState()`)** : `BoardCore.getState()` retourne systématiquement un snapshot gelé (`Object.freeze`) avec copies profondes des sous-états (`promotionDialogState`, `historyViewerState`) pour prévenir toute mutation par effet de bord depuis les wrappers React et Vue 3.

---

## 2. Contrat d'Interface Public (Props & Typage)

Les types d'entrée proviennent exclusivement de `@lichess-org/chessground` (`Config`), de nos types communs (`Move`, `VariationInfo`, `PgnTreeNode` de `src/types`), ou de nos structures communes (`StockfishConfig`, `ChessDiagram`).
Les types `Key`, `DrawShape` ainsi que `Move`, `VariationInfo` et `PgnTreeNode` sont ré-exportés à la racine du paquet `eg-chessboard`.

### Valeurs par défaut

- **React** : Assignées via la déstructuration ES6 au niveau des arguments du composant.
- **Vue 3** : Assignées via la macro `withDefaults` en utilisant des fonctions _factory_ pour les objets afin de prévenir les mutations de références partagées.

---

## 3. Matrice d'Isopérimètre et de Correspondance

| Élément / Prop        | Type  | Nom React         | Nom / Événement Vue 3 | Stratégie d'alignement & Validation                                                                                                                                                                                                        |
| :-------------------- | :---- | :---------------- | :-------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Configuration**     | Prop  | `boardConfig`     | `boardConfig`         | Alignement strict des types via `Config`.                                                                                                                                                                                                  |
| **Mode Métier**       | Prop  | `mode`            | `mode`                | Types littéraux : `'editor' \| 'game' \| 'study'` (par défaut `'game'`). Définit la gestion des formes (Canvas persistant en `editor`, éphémères/consignes en `game`, métadonnées PGN en `study`).                                          |
| **Couleur Joueur**    | Prop  | `playerColor`     | `playerColor`         | Types littéraux : `'white' \| 'black' \| 'both'`.                                                                                                                                                                                          |
| **Mode Libre**        | Prop  | `freeMode`        | `freeMode`            | Synchronisé dynamiquement via `useEffect` (React) et `watch` (Vue). L'écouteur `change` de Chessground (configuré dans `events.change`) synchronise automatiquement le jeu (`syncGameFromBoard`) lors de tout drag-and-drop en mode libre. En mode libre (`freeMode: true`), les coups ne sont pas soumis aux règles d'alternance stricte des traits (`move()` adapte dynamiquement le trait à la couleur de la pièce jouée), permettant les coups consécutifs sans réinitialisation de pièces. |
| **Mode Solo**         | Prop  | `soloMode`        | `soloMode`            | Utilisé pour les exercices d'apprentissage (déplacements consécutifs sans alternance de tour).                                                                                                                                             |
| **Lecture Seule**     | Prop  | `readOnly`        | `readOnly`            | Booleen (par défaut `false` en mode editor). En `readOnly: true` (Mode Lecteur), les coups ne modifient pas l'arbre PGN et les formes au clic droit sont éphémères. En `readOnly: false` (Mode Éditeur), les coups sur n'importe quel ply créent des sous-variantes et les formes/commentaires sont persistants dans le PGN. |
| **Conteneur Fit**     | Prop  | `fitContainer`    | `fitContainer`        | Applique la classe CSS `.fit-container` au conteneur principal `.main-wrap` pour étendre l'échiquier à 100% de la hauteur/largeur du conteneur parent.                                                                                    |
| **Jeu de Pièces**     | Prop  | `pieceSet`        | `pieceSet`            | Type `PieceSet` (`'maestro'`, `'merida'`, `'alpha'`, `'cburnett'`, `'cardinal'`, `'dubrovny'`, `'fantasy'`, `'firi'`, `'tatiana'`, `'staunty'`). Applique la classe `.piece-set-${pieceSet}` sur `.main-wrap` et synchronise dynamiquement avec `BoardCore.setPieceSet()`. |
| **Thème Échiquier**   | Prop  | `boardTheme`      | `boardTheme`          | Type `BoardTheme` (`'brown'`, `'blue'`, `'green'`, `'ic'`, `'grey'`, `'purple'`, `'wood'`, `'wood3'`, `'maple'`). Applique la classe `.board-theme-${boardTheme}` sur `.main-wrap` et synchronise dynamiquement avec `BoardCore.setBoardTheme()`. |
| **Config Stockfish**  | Prop  | `stockfishConfig` | `stockfishConfig`     | Synchronisation dynamique des options du moteur (incluant `workerUrl` et `wasmUrl`). Si absente ou inactive, aucun Web Worker n'est créé.                                                                                                 |
| **Diagramme**         | Prop  | `diagram`         | `diagram`             | Initialisation et mise à jour dynamique de la FEN et des formes (flèches/cercles) via `setDiagram(diagram)`.                                                                                                                               |
| **Création du Board** | Event | `onBoardCreated`  | `board-created`       | Transmet l'instance de `BoardCore` dès l'initialisation.                                                                                                                                                                                   |
| **Mouvement**         | Event | `onMove`          | `move`                | Transmet un POJO `Move` enrichi (`from`, `to`, `san`, `before`, `after`, `turnColor`, `ply`, `isCheck`). Sans objet d'événement natif. Émis uniquement après la mise à jour graphique complète de l'échiquier (permettant un `undoLastMove` immédiat sans désynchronisation visuelle). |
| **Changement de trait**| Event | `onTurnChange`   | `turn-change`         | Transmet `turnColor` (`'white' \| 'black'`) et `ply` (`number`) lors de tout changement de trait (coup joué, annulation, reset, navigation historique).                                                                                    |
| **Échec**             | Event | `onCheck`         | `check`               | Transmet la couleur en paramètre (`string`).                                                                                                                                                                                               |
| **Échec & Mat**       | Event | `onCheckmate`     | `checkmate`           | Transmet la couleur en paramètre (`string`).                                                                                                                                                                                               |
| **Pat (Stalemate)**   | Event | `onStalemate`     | `stalemate`           | Signature pure sans paramètre.                                                                                                                                                                                                             |
| **Nulle (Draw)**      | Event | `onDraw`          | `draw`                | Signature pure sans paramètre.                                                                                                                                                                                                             |
| **Promotion requis**  | Event | `onPromotion`     | `promotion`           | Transmet un POJO avec les détails requis pour la promotion.                                                                                                                                                                                |
| **Indication IA**     | Event | `onStockfishHint` | `stockfish-hint`      | Transmet le meilleur coup calculé (`string`).                                                                                                                                                                                              |
| **Clic sur case**     | Event | `onSquareClick`   | `square-click`        | Transmet la case cliquée en paramètre (`string`).                                                                                                                                                                                          |

---

## 4. Gestion de la Réactivité & Résolution du Risque d'État

Le risque majeur de désynchronisation de `this.state` dans `BoardCore` sous React et Vue est résolu par les implémentations suivantes :

### Cycle de vie d'une action (Exemple de la fermeture du dialogue de Promotion ou d'un coup joué) :

1. Une action ou un coup est déclenché.
2. Le wrapper de framework intercepte l'action et appelle **exclusivement** la méthode publique du cœur :
   - **React** : `coreRef.current?.closePromotionDialog();` ou `coreRef.current?.move(...)`
   - **Vue 3** : `core.closePromotionDialog();` ou `core.move(...)`
3. `BoardCore` met à jour son état interne et déclenche le callback global de changement d'état (`onStateChange`).
4. Les wrappers réagissent au changement d'état global (via `core.getState()`) pour mettre à jour l'UI de manière réactive.

#### Implémentation attendue dans le composant React (`Chessboard.tsx`) :

```typescript
// Interdit : Modifier l'état localement ou accéder aux membres privés via des casts
// setState(prev => ({ ...prev, promotionDialogState: { isEnabled: false } }))
// const s = core['state'];

// Recommandé : Passer par l'API publique et les getters du Core
const coreState = core.getState();
setState({
  showThreats: coreState.showThreats,
  mode: coreState.mode,
  freeMode: coreState.freeMode,
  soloMode: coreState.soloMode,
  readOnly: coreState.readOnly,
  preserveShapesOnPositionChange: coreState.preserveShapesOnPositionChange,
  promotionDialogState: { ...coreState.promotionDialogState },
  historyViewerState: { ...coreState.historyViewerState },
  currentComment: coreState.currentComment,
  turnColor: coreState.turnColor,
  ply: coreState.ply,
  fen: coreState.fen,
  isCheck: coreState.isCheck,
  isGameOver: coreState.isGameOver,
});
```

#### Implémentation attendue dans le composant Vue 3 (`TheChessboard.vue`) :

```typescript
// Synchronisation réactive dans onStateChange :
() => {
  if (core.value) {
    Object.assign(state, core.value.getState());
  }
}
// Exposition de l'état réactif et du core :
defineExpose({
  core,
  state,
  redraw: (clearBounds = true) => core.value?.redraw(clearBounds),
});
```

---

## 5. Gestion des annotations graphiques, commentaires, Mode Lecteur / Éditeur et Variantes PGN

Pour assurer l'uniformité du traitement des exercices et des PGN (incluant la gestion des arbres de variantes) :

1. **Extraction automatique** : Le traitement des commentaires textuels, des balises propriétaires (`[%cal]` pour les flèches, `[%csl]`/`[%cpl]` pour les ronds et cases) et de la structure en arbre (`Node<PgnNodeMeta>`) est opéré exclusivement par `BoardCore` via `chessops/pgn`. Les wrappers ne doivent pas faire de parsing PGN de leur côté.
2. **Champ d'état commun** : Le texte de commentaire nettoyé est exposé dans l'état commun sous la clé `currentComment`, accessible via le getter public `core.getCurrentComment()`.
3. **Méthodes de dessin et d'extraction publiques** : Toute opération de dessin dynamique (ex: `drawMove`, `drawCircle`, `setShapes`) ou d'extraction des formes posées sur l'échiquier (`getShapes(): DrawShape[]`) doit être invoquée via les méthodes publiques de `BoardCore`. Les paramètres de cases (`from`, `to`, `square`) acceptent de manière permissive le type `Key | string`.
4. **Distinction Stricte Mode Lecteur (`readOnly: true`) vs Mode Éditeur (`readOnly: false`)** :
   - **Mode Lecteur (`readOnly: true`)** : Permet de consulter un PGN et de suivre ses variantes sans modifier la structure. Les formes dessinées au clic droit sont **éphémères** (affichées visuellement sans être écrites dans les balises PGN) et les pièces ne peuvent pas être déplacées pour altérer l'arbre PGN.
   - **Mode Éditeur (`readOnly: false`)** : Déplacer une pièce sur n'importe quel coup visualisé crée automatiquement une **sous-variante** dans le PGN (ou suit la branche si le coup existe déjà). Les commentaires textuels et les formes (`[%cal]`, `[%csl]`) sont **persistants** et enregistrés directement dans l'arbre PGN.
5. **Initialisation, Chargement PGN & FEN Setup** : Démarrer une nouvelle partie ou charger une FEN personnalisée s'effectue via `core.newGame(fen?)`. Si la FEN n'est pas la position de départ standard, `BoardCore` injecte automatiquement les en-têtes `[SetUp "1"]` et `[FEN "..."]` dans la sortie PGN (`core.getPgn()`). Le chargement d'un PGN complet s'effectue via `core.loadPgn(pgn)` qui initialise l'arbre PGN et positionne automatiquement l'échiquier sur la position initiale (`viewStart()` / ply 0) afin d'afficher d'emblée la FEN de départ et les formes/commentaires initiaux (`startingComments`).
6. **Enrichissement / Saisie de commentaires** : L'écriture de commentaires et d'annotations graphiques dans le PGN s'effectue uniquement via `core.setComment(text, shapes)` (cible le coup visualisé à l'écran) ou `core.setCommentAtPly(ply, text, shapes)`. Le PGN résultant est récupéré via `core.getPgn()` et inclut l'intégralité des sous-variantes entre parenthèses `(...)`.
7. **Navigation et sous-variantes** :
   - `core.getVariationsAtPly(ply?)` : retourne la liste des variantes alternatives (`VariationInfo[]`) disponibles au coup demandé (y compris au coup 1 avec `ply=0`).
   - `core.selectVariation(index)` : bascule le coup et la branche active vers la sous-variante choisie.
   - `core.promoteVariation(index?)` : promeut la variante sélectionnée en ligne principale (*mainline*).
   - `core.deleteVariation(index?)` : supprime la variante sélectionnée.
   - `core.getPgnTree()` : expose l'arborescence complète sous forme d'un arbre `PgnTreeNode`.

---

## 6. Gestion des restrictions de déplacements et aides pour les exercices

Pour restreindre dynamiquement les mouvements de l'utilisateur ou valider ses actions dans le cadre d'exercices d'apprentissage :

1. **Méthodes publiques exclusives** : Toute restriction ou vérification de coups doit s'appuyer sur les méthodes publiques de `BoardCore` :
   - `core.setCustomDests(dests: Map<Key, Key[]> | null)` : Définit explicitement les pièces et leurs cases de destinations autorisées.
   - `core.restrictMovesToPieces(squares: Key[] | null)` : Filtre automatiquement les coups légaux de la position pour n'autoriser le déplacement que des pièces situées sur les cases spécifiées.
   - `core.isSquareAttacked(square: Key, byColor: 'white' | 'black'): boolean` : Permet à l'application hôte de détecter si le joueur s'est déplacé sur une case menacée afin de déclencher un avertissement ou une réinitialisation de l'exercice.
   - `core.getPieces(): Map<Key, { type: string; color: 'w' | 'b' }>` : Retourne la liste des pièces restantes sur l'échiquier pour valider la capture complète des pièces adverses.
   - `core.getSoloHistory(): Move[]` : Retourne l'historique des coups joués en mode solo.
2. **Cycle de vie** : Les restrictions modifient le comportement interne de Chessground de manière persistante jusqu'à ce qu'elles soient réinitialisées en passant `null`. En `soloMode`, après chaque coup, le trait est automatiquement conservé sur la couleur de la pièce jouée pour autoriser les déplacements consécutifs.

---

## 7. Méthodes Utilitaires d'État & Lifecycle

Pour interroger l'état interne de l'échiquier et gérer le nettoyage de manière uniforme :

- `core.setReadOnly(readOnly: boolean): void` : Active/désactive le mode lecture seule (Lecteur vs Éditeur PGN).
- `core.isReadOnly(): boolean` : Indique si le mode lecture seule est actuellement actif.
- `core.setPieceSet(pieceSet: PieceSet): void` : Définit dynamiquement le style de pièces utilisé (`'maestro'`, `'merida'`, `'alpha'`, `'cburnett'`, `'cardinal'`, `'dubrovny'`, `'fantasy'`, `'firi'`, `'tatiana'`, `'staunty'`).
- `core.getPieceSet(): PieceSet` : Retourne le style de pièces actuellement actif.
- `core.setBoardTheme(theme: BoardTheme): void` : Définit dynamiquement le thème visuel d'arrière-plan de l'échiquier (`'brown'`, `'blue'`, `'green'`, `'ic'`, `'grey'`, `'purple'`, `'wood'`, `'wood3'`, `'maple'`).
- `core.getBoardTheme(): BoardTheme` : Retourne le thème d'échiquier actuellement actif.
- `core.newGame(fen?: string): void` : Réinitialise l'échiquier et l'arbre PGN à partir de la position initiale ou d'une FEN personnalisée (avec en-têtes Setup PGN).
- `core.setPlayerColor(color: 'white' | 'black' | 'both'): void` : Définit dynamiquement la couleur du joueur autorisée aux déplacements sans qu'elle ne soit écrasée par le trait courant.
- `core.setConfig(config: Config, fillDefaults?: boolean): void` : Applique les modifications de configuration sur Chessground sans réinitialiser la FEN ni effacer la sélection si la FEN reste inchangée.
- `core.getOrientation(): 'white' | 'black'` : Retourne l'orientation actuelle du plateau de jeu.
- `core.getPlacementFen(): string` : Retourne la FEN de placement actuelle des pièces (sans les autres métadonnées de FEN) extraite directement de Chessground (utile en mode libre ou pour les FENs en cours d'édition).
- `core.getCurrentComment(): string` : Retourne le commentaire textuel du coup courant.
- `core.lastSuggestedMove: string` : Getter/setter stockant le dernier coup suggéré (*hint*) par Stockfish en notation UCI (ex: `"e2e4"`).
- `core.getHistoryViewerState(): Readonly<HistoryViewerState>` : Retourne l'état de visualisation de l'historique.
- `core.isViewingHistory(): boolean` : Indique si la vue navigue actuellement dans l'historique.
- `core.getInCheckColor(): 'white' | 'black' | null` : Retourne la couleur du joueur en échec (ou `null`).
- `core.getIsThreefoldRepetition(): boolean` : Indique si la position actuelle s'est répétée au moins 3 fois dans la variante active.
- `core.getIsDraw(): boolean` : Indique si la position est nulle (pat, manque de matériel, 50 coups ou triple répétition).
- `core.getIsGameOver(): boolean` : Indique si la partie est terminée (échec et mat ou nulle).
- `core.getGameOverReason(lang?: 'fr' | 'en'): string` : Retourne la raison formatée de fin de partie (*ex: "Échec et mat ! Les Blancs ont gagné."*, *"Match nul par triple répétition."*, *"Match nul par la règle des 50 coups."*).
- `getFinalFenFromPgn(pgnStr: string, fallbackFen?: string): string` : Fonction utilitaire autonome (exportée depuis `BoardHelper` et à la racine d'`eg-chessboard`) qui calcule la FEN finale en rejouant la variante principale du PGN via `chessops`. Permet aux applications hôtes (ex: plugin ROI) de déterminer la position finale d'un PGN sans manipuler directement l'API de `chessops`.
- `core.destroy(): void` : Libère proprement toutes les sous-ressources (Workers Stockfish, instance DOM Chessground). Appelé automatiquement au démontage des wrappers React (`useEffect` cleanup) et Vue 3 (`onUnmounted`).

---

## 8. Gestion des Diagrammes (FEN + Formes) et tolérance aux FENs invalides/incomplètes

Pour instancier et lire des diagrammes combinant une position FEN et des formes dessinées (flèches et cercles) :

1. **Méthode publique exclusive** : L'écriture et le chargement d'un diagramme s'effectuent via `core.setDiagram(diagram: ChessDiagram)`.
2. **Récupération de l'état** : L'état actuel est obtenu via `core.getDiagram()`, retournant un objet `{ fen: string, shapes: DrawShape[] }` où les formes proviennent directement du plateau de jeu (`this.board.state.drawable.shapes`).
3. **Synchronisation réactive** :
   - **React** : Le composant surveille la prop `diagram` via `useEffect` et appelle `coreRef.current?.setDiagram(diagram)`.
   - **Vue 3** : Le composant surveille la prop `diagram` via un `watch` avec `deep: true` et appelle `core.value?.setDiagram(diagram)`.
4. **Tolérance aux positions incomplètes/invalides** : Si la FEN chargée via `setPosition` ou `setDiagram` ne respecte pas les contraintes de parsing strictes, `BoardCore` charge une position minimale contenant le trait (turn) approprié, retire les rois factices, puis injecte manuellement chaque pièce sur le plateau. Ceci prévient tout crash ou désynchronisation de l'état logique par rapport à l'affichage visuel de Chessground.
