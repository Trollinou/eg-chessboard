import { describe, it, expect, beforeEach } from 'vitest';
import { Chess } from 'chessops';
import { ExerciseManager } from '../src/core/ExerciseManager';
import type { Key, Role, Color } from '@lichess-org/chessground/types';
import type { Move } from '../src/types';

describe('ExerciseManager', () => {
  let exerciseManager: ExerciseManager;
  let pos: Chess;

  beforeEach(() => {
    exerciseManager = new ExerciseManager();
    pos = Chess.default();
  });

  describe('Move Restrictions (restrictMovesToPieces)', () => {
    it('restricts allowed destinations only to specified squares', () => {
      // In default starting position, white has pawns on a2-h2 and knights on b1, g1
      exerciseManager.restrictMovesToPieces(['e2', 'g1'], pos);

      const dests = exerciseManager.getCustomDests();
      expect(dests).not.toBeNull();
      expect(dests?.has('e2')).toBe(true);
      expect(dests?.get('e2')).toEqual(expect.arrayContaining(['e3', 'e4']));
      expect(dests?.has('g1')).toBe(true);
      expect(dests?.get('g1')).toEqual(expect.arrayContaining(['f3', 'h3']));

      // Other pieces should not be allowed
      expect(dests?.has('d2')).toBe(false);
      expect(dests?.has('b1')).toBe(false);
    });

    it('clears restrictions when passing null', () => {
      exerciseManager.restrictMovesToPieces(['e2'], pos);
      expect(exerciseManager.getCustomDests()).not.toBeNull();

      exerciseManager.restrictMovesToPieces(null, pos);
      expect(exerciseManager.getCustomDests()).toBeNull();
    });
  });

  describe('Threat Detection (isSquareAttacked)', () => {
    it('detects squares attacked by White', () => {
      // In default starting position, e3 and d3 are controlled by pawns on d2/f2 and e2/c2
      expect(exerciseManager.isSquareAttacked('d3', 'white', pos)).toBe(true);
      expect(exerciseManager.isSquareAttacked('e3', 'white', pos)).toBe(true);

      // e5 is not attacked by White at move 0
      expect(exerciseManager.isSquareAttacked('e5', 'white', pos)).toBe(false);
    });

    it('detects squares attacked by Black', () => {
      // In default starting position, e6 and d6 are attacked by Black pawns
      expect(exerciseManager.isSquareAttacked('e6', 'black', pos)).toBe(true);
      expect(exerciseManager.isSquareAttacked('d6', 'black', pos)).toBe(true);

      // e4 is not attacked by Black at move 0
      expect(exerciseManager.isSquareAttacked('e4', 'black', pos)).toBe(false);
    });

    it('returns false for invalid square', () => {
      expect(exerciseManager.isSquareAttacked('invalid' as Key, 'white', pos)).toBe(false);
    });
  });

  describe('Board Pieces Conversion', () => {
    it('converts Chessground board pieces map to simple POJO format', () => {
      const boardPieces = new Map<Key, { role: Role; color: Color }>();
      boardPieces.set('e1', { role: 'king', color: 'white' });
      boardPieces.set('e8', { role: 'king', color: 'black' });
      boardPieces.set('e4', { role: 'pawn', color: 'white' });

      const pieces = exerciseManager.getPieces(boardPieces);
      expect(pieces.get('e1')).toEqual({ type: 'k', color: 'w' });
      expect(pieces.get('e8')).toEqual({ type: 'k', color: 'b' });
      expect(pieces.get('e4')).toEqual({ type: 'p', color: 'w' });
    });
  });

  describe('Solo History Tracking', () => {
    it('records and resets solo moves', () => {
      const move1: Move = {
        from: 'e2',
        to: 'e4',
        piece: 'p',
        color: 'w',
        san: 'e4',
        before: 'start',
        after: 'after_e4',
      };
      const move2: Move = {
        from: 'e4',
        to: 'e5',
        piece: 'p',
        color: 'w',
        san: 'e5',
        before: 'after_e4',
        after: 'after_e5',
      };

      exerciseManager.addSoloMove(move1);
      exerciseManager.addSoloMove(move2);

      expect(exerciseManager.getSoloHistory()).toHaveLength(2);
      expect(exerciseManager.getSoloHistory()[0].san).toBe('e4');
      expect(exerciseManager.getSoloHistory()[1].san).toBe('e5');

      exerciseManager.resetSoloHistory();
      expect(exerciseManager.getSoloHistory()).toHaveLength(0);
    });
  });
});
