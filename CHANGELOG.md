# Journal des modifications (Changelog) - eg-chessboard

Toutes les modifications notables de ce projet seront documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/) et ce projet respecte le [Versionnage Sémantique](https://semver.org/lang/fr/).

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
