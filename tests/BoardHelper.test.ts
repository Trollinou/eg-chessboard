import { describe, it, expect } from 'vitest';
import { Chess } from 'chessops/chess';
import {
  possibleMoves,
  isPromotion,
  shortToLongColor,
  getThreats,
  getFinalFenFromPgn,
} from '../src/BoardHelper';
import type { Move } from '../src/types';

describe('BoardHelper', () => {
  describe('shortToLongColor', () => {
    it('converts w to white and b to black', () => {
      expect(shortToLongColor('w')).toBe('white');
      expect(shortToLongColor('b')).toBe('black');
    });
  });

  describe('isPromotion', () => {
    it('detects white pawn promotion on 8th rank', () => {
      expect(isPromotion('e8', { type: 'p', color: 'w' })).toBe(true);
      expect(isPromotion('e7', { type: 'p', color: 'w' })).toBe(false);
    });

    it('detects black pawn promotion on 1st rank', () => {
      expect(isPromotion('a1', { type: 'p', color: 'b' })).toBe(true);
      expect(isPromotion('a2', { type: 'p', color: 'b' })).toBe(false);
    });

    it('returns false for non-pawn pieces or missing piece', () => {
      expect(isPromotion('e8', { type: 'q', color: 'w' })).toBe(false);
      expect(isPromotion('e8', null)).toBe(false);
      expect(isPromotion('e8', undefined)).toBe(false);
    });
  });

  describe('possibleMoves', () => {
    it('returns valid destinations for initial position', () => {
      const pos = Chess.default();
      const dests = possibleMoves(pos);
      expect(dests.has('e2')).toBe(true);
      expect(dests.get('e2')).toContain('e4');
      expect(dests.get('e2')).toContain('e3');
    });
  });

  describe('getThreats', () => {
    it('generates threats from moves list', () => {
      const moves: Move[] = [
        {
          from: 'e2',
          to: 'e4',
          piece: 'p',
          color: 'w',
          san: 'e4',
          before: 'start',
          after: 'after_e4',
        },
        {
          from: 'd7',
          to: 'd5',
          piece: 'p',
          color: 'b',
          san: 'd5',
          before: 'after_e4',
          after: 'after_d5',
        },
        {
          from: 'e4',
          to: 'd5',
          piece: 'p',
          color: 'w',
          san: 'exd5',
          captured: 'p',
          before: 'after_d5',
          after: 'after_exd5',
        },
      ];

      const threats = getThreats(moves);
      expect(threats.some((t) => t.orig === 'e4' && t.brush === 'yellow')).toBe(true);
      expect(threats.some((t) => t.orig === 'e4' && t.dest === 'd5' && t.brush === 'red')).toBe(
        true
      );
    });
  });

  describe('getFinalFenFromPgn', () => {
    it('returns final FEN for a standard game mainline', () => {
      const pgn = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6';
      const finalFen = getFinalFenFromPgn(pgn);
      expect(finalFen).toContain('r1bqkb1r/1ppp1ppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQK2R w KQkq -');
    });

    it('handles custom starting FEN via headers', () => {
      const customPgn = `[SetUp "1"]\n[FEN "8/8/8/8/8/4K3/4P3/4k3 w - - 0 1"]\n\n1. Kd3 Kd1 2. e4`;
      const finalFen = getFinalFenFromPgn(customPgn);
      expect(finalFen).toContain('8/8/8/8/4P3/3K4/8/3k4 b - -');
    });

    it('returns fallback FEN for invalid or empty PGN', () => {
      const fallback = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      expect(getFinalFenFromPgn('', fallback)).toBe(fallback);
      expect(getFinalFenFromPgn('invalid pgn string ???', fallback)).toBe(fallback);
    });
  });
});
