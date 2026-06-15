# Instructions et Règles pour les Agents d'IA (AGENTS.md)

Ce document définit les règles strictes que doit suivre tout agent de codage (IA ou humain) contribuant au projet `eg-chessboard`.

---

## 1. Principe d'Isopérimètre Obligatoire (Vue / React)

Le cœur de la bibliothèque est agnostique (`src/BoardCore.ts`). Les composants Vue 3 (`src/vue/TheChessboard.vue`) et React (`src/react/Chessboard.tsx`) ne sont que des wrappers d'interface utilisateur autour de ce cœur.

* **Parité des fonctionnalités** : Toute fonctionnalité, propriété (`prop`), événement (`emit` ou `callback`), configuration ou option ajoutée ou modifiée dans la version **Vue** doit être implémentée de manière strictement identique dans la version **React**, et inversement.
* **Typage homogène** : Les interfaces de propriétés (`ChessboardProps` sous React et `defineProps` sous Vue) et de retour d'événements doivent utiliser des types partagés ou stricts issus de `chess.js` ou `@lichess-org/chessground`.

---

## 2. Processus de Qualité Obligatoire

Avant de finaliser une tâche, d'exécuter un build de production, ou de réaliser un commit, **vous devez obligatoirement** exécuter et valider les étapes suivantes :

### Étape A : Formatage du code
Toutes les modifications de code doivent respecter les standards définis dans `.prettierrc`.
```bash
npm run format
```

### Étape B : Analyse statique (Linter)
Aucune erreur ou avertissement linter ne doit subsister.
```bash
npm run lint
```

### Étape C : Compilation & Typage
S'assurer que le compilateur TypeScript et le compilateur de composants Vue (`vue-tsc`) n'émettent aucune erreur de type lors du build.
```bash
npm run build
```

---

## 3. Gestion de l'état et du cycle de vie

* **Agnosticisme du cœur (`BoardCore`)** : Ne jamais insérer de logique spécifique à un framework (comme des hooks React ou des `ref` Vue) dans `BoardCore.ts`. Le cœur doit uniquement manipuler le DOM natif et l'état vanilla.
* **Synchronisation des états** : 
  * Sous Vue : Utiliser `watch` pour synchroniser les changements de props réactives avec le cœur.
  * Sous React : Utiliser des hooks `useEffect` appropriés pour synchroniser les props avec le cœur (en faisant attention de ne pas provoquer de rendus en cascade ou des appels redondants de `setState`).
