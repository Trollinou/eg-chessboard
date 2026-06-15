# Journal des modifications (Changelog) - eg-chessboard

Toutes les modifications notables de ce projet seront documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/) et ce projet respecte le [Versionnage Sémantique](https://semver.org/lang/fr/).

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
