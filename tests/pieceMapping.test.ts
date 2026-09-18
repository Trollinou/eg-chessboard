import { describe, it, expect } from 'vitest';
import { Chess, parseSquare } from 'chessops';
import { parseFen } from 'chessops/fen';
import { roleToPieceSymbol, pieceSymbolToRole, buildMovePojo } from '../src/core/pieceMapping';

describe('pieceMapping', () => {
  describe('role mappings', () => {
    it('correctly maps roles to symbols and back', () => {
      expect(roleToPieceSymbol.pawn).toBe('p');
      expect(roleToPieceSymbol.knight).toBe('n');
      expect(roleToPieceSymbol.bishop).toBe('b');
      expect(roleToPieceSymbol.rook).toBe('r');
      expect(roleToPieceSymbol.queen).toBe('q');
      expect(roleToPieceSymbol.king).toBe('k');

      expect(pieceSymbolToRole.p).toBe('pawn');
      expect(pieceSymbolToRole.n).toBe('knight');
      expect(pieceSymbolToRole.b).toBe('bishop');
      expect(pieceSymbolToRole.r).toBe('rook');
      expect(pieceSymbolToRole.q).toBe('queen');
      expect(pieceSymbolToRole.k).toBe('king');
    });
  });

  describe('buildMovePojo', () => {
    it('builds a complete POJO for standard pawn push', () => {
      const pos = Chess.default();
      const fenBefore = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      const move = {
        from: parseSquare('e2')!,
        to: parseSquare('e4')!,
      };

      const movePojo = buildMovePojo(pos, move, fenBefore);
      expect(movePojo.from).toBe('e2');
      expect(movePojo.to).toBe('e4');
      expect(movePojo.piece).toBe('p');
      expect(movePojo.color).toBe('w');
      expect(movePojo.san).toBe('e4');
      expect(movePojo.before).toBe(fenBefore);
      expect(movePojo.after).toContain('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq');
      expect(movePojo.turnColor).toBe('black');
      expect(movePojo.ply).toBe(1);
    });

    it('handles capture and piece metadata detection', () => {
      const fenBefore = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2';
      const setup = parseFen(fenBefore);
      expect(setup.isOk).toBe(true);
      const posRes = Chess.fromSetup(setup.value);
      expect(posRes.isOk).toBe(true);
      const pos = posRes.value;

      const move = {
        from: parseSquare('e4')!,
        to: parseSquare('d5')!,
      };

      const movePojo = buildMovePojo(pos, move, fenBefore);
      expect(movePojo.from).toBe('e4');
      expect(movePojo.to).toBe('d5');
      expect(movePojo.san).toBe('exd5');
      expect(movePojo.captured).toBe('p');
    });
  });
});
