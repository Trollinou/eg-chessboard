import { describe, it, expect } from 'vitest';
import { Chess } from 'chessops';
import { FenManager } from '../src/core/FenManager';
import type { Key, Color } from '@lichess-org/chessground/types';
import type { Role } from 'chessops/types';

describe('FenManager', () => {
  describe('safeLoadFen', () => {
    it('loads standard full FEN correctly', () => {
      let resetCalled = false;
      const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
      const result = FenManager.safeLoadFen(fen, (pos) => {
        resetCalled = true;
        expect(pos.turn).toBe('black');
      });

      expect(result.isStandardOk).toBe(true);
      expect(resetCalled).toBe(true);
    });

    it('tolerantly parses non-standard or partial FEN placements without king/full castling', () => {
      let resetCalled = false;
      // Partial FEN with only a few pieces and no kings
      const partialFen = '8/8/8/4P3/8/8/8/8 w - - 0 1';
      const result = FenManager.safeLoadFen(partialFen, () => {
        resetCalled = true;
      });

      expect(resetCalled).toBe(true);
      expect(result.pos).toBeDefined();
    });
  });

  describe('boardPiecesToPlacementFen', () => {
    it('converts map of pieces to placement FEN string', () => {
      const pieces = new Map<Key, { role: Role; color: Color }>();
      pieces.set('e1', { role: 'king', color: 'white' });
      pieces.set('e8', { role: 'king', color: 'black' });
      pieces.set('e4', { role: 'pawn', color: 'white' });

      const fen = FenManager.boardPiecesToPlacementFen(pieces);
      expect(fen).toBe('4k3/8/8/8/4P3/8/8/4K3');
    });
  });

  describe('getMaterialCount', () => {
    it('calculates white, black, and material difference', () => {
      const pieces = new Map<Key, { role: Role; color: Color }>();
      pieces.set('e1', { role: 'king', color: 'white' });
      pieces.set('e8', { role: 'king', color: 'black' });
      pieces.set('d1', { role: 'queen', color: 'white' }); // 9
      pieces.set('a1', { role: 'rook', color: 'white' }); // 5
      pieces.set('c8', { role: 'bishop', color: 'black' }); // 3

      const material = FenManager.getMaterialCount(pieces);
      expect(material.materialWhite).toBe(14);
      expect(material.materialBlack).toBe(3);
      expect(material.materialDiff).toBe(11);
    });
  });
});
