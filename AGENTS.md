# Spécification d'Isopérimètre : eg-chessboard

Ce document définit le contrat d'interface, les règles de réactivité et l'architecture de communication pour assurer une portabilité et un comportement strictement identiques (1:1) entre les implémentations React (`Chessboard.tsx`) et Vue 3 (`TheChessboard.vue`), en s'appuyant sur le cœur agnostique `BoardCore.ts`.

## 1. Principes Fondamentaux d'Architecture

Pour éviter les divergences de comportement entre le modèle _pull/immutabilité_ de React et le modèle _push/Proxy_ de Vue 3 :

1. **Source de Vérité Unique** : L'état du jeu réside exclusivement dans `BoardCore`. Les frameworks ne font que refléter cet état graphiquement.
2. **Mutations Interdites depuis la Vue** : Aucun wrapper (React ou Vue) ne doit modifier directement l'objet `state` ou ses sous-propriétés (ex: `state.promotionDialogState`). Toute modification doit passer par une méthode publique de `BoardCore`.
3. **Flux Unidirectionnel avec Événements** : Le cœur notifie les wrappers de tout changement d'état interne via un mécanisme d'écoute (`onStateChange`). Le wrapper React met alors à jour son `useState`, et le wrapper Vue met à jour sa référence réactive.
4. **Pas de Fuite d'Abstraction** : L'accès aux propriétés privées par contournement de typage (ex: `coreRef.current['state']`) est strictement interdit.

---

## 2. Contrat d'Interface Public (Props & Typage)

Les types d'entrée proviennent exclusivement de `@lichess-org/chessground` (`Config`), de `chess.js` (`Move`), ou de notre structure commune (`StockfishConfig`).

### Valeurs par défaut

- **React** : Assignées via la déstructuration ES6 au niveau des arguments du composant.
- **Vue 3** : Assignées via la macro `withDefaults` en utilisant des fonctions _factory_ pour les objets afin de prévenir les mutations de références partagées.

---

## 3. Matrice d'Isopérimètre et de Correspondance

| Élément / Prop        | Type  | Nom React         | Nom / Événement Vue 3 | Stratégie d'alignement & Validation                                                                                                                                                                                                        |
| :-------------------- | :---- | :---------------- | :-------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Configuration**     | Prop  | `boardConfig`     | `boardConfig`         | Alignement strict des types via `Config`.                                                                                                                                                                                                  |
| **Couleur Joueur**    | Prop  | `playerColor`     | `playerColor`         | Types littéraux : `'white' \| 'black' \| 'both'`.                                                                                                                                                                                          |
| **Mode Libre**        | Prop  | `freeMode`        | `freeMode`            | Synchronisé dynamiquement via `useEffect` (React) et `watch` (Vue). L'écouteur `change` de Chessground (configuré dans `events.change`) synchronise automatiquement le jeu (`syncGameFromBoard`) lors de tout drag-and-drop en mode libre. |
| **Mode Solo**         | Prop  | `soloMode`        | `soloMode`            | Utilisé pour les exercices d'apprentissage (déplacements consécutifs sans alternance de tour).                                                                                                                                             |
| **Config Stockfish**  | Prop  | `stockfishConfig` | `stockfishConfig`     | Synchronisation dynamique des options du moteur. Si absente ou inactive, aucun Web Worker n'est créé.                                                                                                                                      |
| **Diagramme**         | Prop  | `diagram`         | `diagram`             | Initialisation et mise à jour dynamique de la FEN et des formes (flèches/cercles) via `setDiagram(diagram)`.                                                                                                                               |
| **Création du Board** | Event | `onBoardCreated`  | `board-created`       | Transmet l'instance de `BoardCore` dès l'initialisation.                                                                                                                                                                                   |     |
| **Mouvement**         | Event | `onMove`          | `move`                | Transmet un POJO `Move` (chess.js). Sans objet d'événement natif. Émis uniquement après la mise à jour graphique complète de l'échiquier (permettant un `undoLastMove` immédiat sans désynchronisation visuelle).                          |
| **Échec**             | Event | `onCheck`         | `check`               | Transmet la couleur en paramètre (`string`).                                                                                                                                                                                               |
| **Échec & Mat**       | Event | `onCheckmate`     | `checkmate`           | Transmet la couleur en paramètre (`string`).                                                                                                                                                                                               |
| **Pat (Stalemate)**   | Event | `onStalemate`     | `stalemate`           | Signature pure sans paramètre.                                                                                                                                                                                                             |
| **Nulle (Draw)**      | Event | `onDraw`          | `draw`                | Signature pure sans paramètre.                                                                                                                                                                                                             |
| **Promotion requis**  | Event | `onPromotion`     | `promotion`           | Transmet un POJO avec les détails requis pour la promotion.                                                                                                                                                                                |
| **Indication IA**     | Event | `onStockfishHint` | `stockfish-hint`      | Transmet le meilleur coup calculé (`string`).                                                                                                                                                                                              |
| **Clic sur case**     | Event | `onSquareClick`   | `square-click`        | Transmet la case cliquée en paramètre (`string`).                                                                                                                                                                                          |

---

## 4. Gestion de la Réactivité & Résolution du Risque d'État

Le risque majeur de désynchronisation de `this.state` dans `BoardCore` sous React est résolu par les implémentations suivantes :

### Cycle de vie d'une action (Exemple de la fermeture du dialogue de Promotion) :

1. L'utilisateur sélectionne une pièce dans le composant `PromotionDialog`.
2. Le wrapper de framework intercepte l'action et appelle **exclusivement** la méthode publique du cœur :
   - **React** : `coreRef.current?.closePromotionDialog();`
   - **Vue 3** : `core.closePromotionDialog();`
3. `BoardCore` met à jour son état interne et déclenche le callback global de changement d'état.
4. Les wrappers réagissent au changement d'état global pour mettre à jour l'UI.

#### Implémentation attendue dans le composant React (`Chessboard.tsx`) :

```typescript
// Interdit : Modifier l'état localement sans avertir le Core
// onPromotionSelected={() => { setState(prev => ({ ...prev, promotionDialogState: { isEnabled: false } })) }}

// Recommandé : Passer par l'API publique du Core
onPromotionSelected={(pendingMove) => {
  coreRef.current?.confirmPromotion(pendingMove);
  // closePromotionDialog() est géré à l'intérieur de confirmPromotion()
}}
```

---

## 5. Gestion des annotations graphiques et commentaires PGN

Pour assurer l'uniformité du traitement des exercices et des PGN :

1. **Extraction automatique** : Le traitement des commentaires textuels et des balises propriétaires (`[%cal]` pour les flèches, `[%cpl]` pour les ronds) est opéré exclusivement par `BoardCore` dans `updateCommentAndShapes()`. Les wrappers ne doivent pas faire de parsing de commentaires PGN de leur côté.
2. **Champ d'état commun** : Le texte de commentaire nettoyé est exposé dans l'état commun sous la clé `currentComment`.
3. **Méthodes de dessin publiques** : Toute opération de dessin dynamique (ex: `drawMove`, `drawCircle`, `setShapes`) doit être invoquée via les méthodes publiques de `BoardCore`.
4. **Enrichissement / Saisie de commentaires** : L'écriture de commentaires et d'annotations graphiques dans le PGN s'effectue uniquement via `core.setComment(text, shapes)` (cible le coup visualisé à l'écran) ou `core.setCommentAtPly(ply, text, shapes)`. Le PGN résultant est récupéré via `core.getPgn()`.

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

## 7. Méthodes Utilitaires d'État

Pour interroger l'état interne de l'échiquier de manière uniforme :

- `core.getOrientation(): 'white' | 'black'` : Retourne l'orientation actuelle du plateau de jeu.
- `core.getPlacementFen(): string` : Retourne la FEN de placement actuelle des pièces (sans les autres métadonnées de FEN) extraite directement de Chessground, sans dépendre de la validation de `chess.js` (utile en mode libre ou pour les FENs en cours d'édition).

---

## 8. Gestion des Diagrammes (FEN + Formes)

Pour instancier et lire des diagrammes combinant une position FEN et des formes dessinées (flèches et cercles) :

1. **Méthode publique exclusive** : L'écriture et le chargement d'un diagramme s'effectuent via `core.setDiagram(diagram: ChessDiagram)`.
2. **Récupération de l'état** : L'état actuel est obtenu via `core.getDiagram()`, retournant un objet `{ fen: string, shapes: DrawShape[] }` où les formes proviennent directement du plateau de jeu (`this.board.state.drawable.shapes`).
3. **Synchronisation réactive** :
   - **React** : Le composant surveille la prop `diagram` via `useEffect` et appelle `coreRef.current?.setDiagram(diagram)`.
   - **Vue 3** : Le composant surveille la prop `diagram` via un `watch` avec `deep: true` et appelle `core.value?.setDiagram(diagram)`.
