import { Chess, parseSquare } from 'chessops';
import { parseFen } from 'chessops/fen';
import type { Color as ChessopsColor, Role } from 'chessops/types';
import type { Key, Color } from '@lichess-org/chessground/types';

import { possibleMoves } from '../BoardHelper';
import type { Move } from '../types';
import { roleToPieceSymbol, pieceSymbolToRole, buildMovePojo, FILES } from './pieceMapping';

export class FenManager {
  public static safeLoadFen(
    fenStr: string,
    onResetPgnTree: (pos: Chess) => void
  ): { pos: Chess; isStandardOk: boolean } {
    const setupRes = parseFen(fenStr);
    if (setupRes.isOk) {
      const chessRes = Chess.fromSetup(setupRes.value);
      if (chessRes.isOk) {
        onResetPgnTree(chessRes.value);
        return { pos: chessRes.value, isStandardOk: true };
      }
    }

    console.warn('Invalid FEN loaded, fallback to manual piece placing:', fenStr);

    const parts = fenStr.split(' ');
    const placement = parts[0];

    let pos = Chess.default();
    const minSetupRes = parseFen(`4k3/8/8/8/8/8/8/4K3 ${parts[1] === 'b' ? 'b' : 'w'} - - 0 1`);
    if (minSetupRes.isOk) {
      const minChess = Chess.fromSetup(minSetupRes.value);
      if (minChess.isOk) {
        pos = minChess.value;
      }
    }
    pos.board.take(parseSquare('e1')!);
    pos.board.take(parseSquare('e8')!);
    pos.turn = parts[1] === 'b' ? 'black' : 'white';

    const ranks = placement.split('/');

    for (let r = 0; r < 8; r++) {
      const rankStr = ranks[r];
      if (!rankStr) continue;
      let fileIdx = 0;
      for (let i = 0; i < rankStr.length; i++) {
        const char = rankStr[i];
        if (/[1-8]/.test(char)) {
          fileIdx += parseInt(char, 10);
        } else {
          const color: ChessopsColor = char === char.toUpperCase() ? 'white' : 'black';
          const role = pieceSymbolToRole[char.toLowerCase()];
          const square = parseSquare(`${FILES[fileIdx]}${8 - r}`)!;
          if (fileIdx < 8 && role) {
            pos.board.set(square, { role, color });
          }
          fileIdx++;
        }
      }
    }
    onResetPgnTree(pos);
    return { pos, isStandardOk: false };
  }

  public static boardPiecesToPlacementFen(pieces: Map<Key, { role: Role; color: Color }>): string {
    const ranks: string[] = [];
    for (let rank = 8; rank >= 1; rank--) {
      let rankStr = '';
      let emptyCount = 0;
      for (let fileIdx = 0; fileIdx < 8; fileIdx++) {
        const file = String.fromCharCode(97 + fileIdx);
        const square = `${file}${rank}` as Key;
        const piece = pieces.get(square);
        if (piece) {
          if (emptyCount > 0) {
            rankStr += emptyCount.toString();
            emptyCount = 0;
          }
          const char = roleToPieceSymbol[piece.role] || 'p';
          rankStr += piece.color === 'white' ? char.toUpperCase() : char;
        } else {
          emptyCount++;
        }
      }
      if (emptyCount > 0) {
        rankStr += emptyCount.toString();
      }
      ranks.push(rankStr);
    }
    return ranks.join('/');
  }

  public static getPossibleMovesForBothColors(pos: Chess): Map<Key, Key[]> {
    const dests = possibleMoves(pos);
    const swapped = pos.clone();
    swapped.turn = swapped.turn === 'white' ? 'black' : 'white';
    const otherDests = possibleMoves(swapped);
    for (const [key, value] of otherDests.entries()) {
      dests.set(key, value);
    }
    return dests;
  }

  public static getAllLegalMovesAsPojos(pos: Chess, fenBefore: string): Move[] {
    const moves: Move[] = [];
    const ctx = pos.ctx();
    for (const [from, dests] of pos.allDests(ctx)) {
      for (const destSq of dests) {
        const temp = pos.clone();
        const movePojo = buildMovePojo(temp, { from, to: destSq }, fenBefore);
        moves.push(movePojo);
      }
    }
    return moves;
  }

  public static getMaterialCount(pieces: Map<Key, { role: Role; color: Color }>) {
    const piecesValues: Record<string, number> = {
      pawn: 1,
      knight: 3,
      bishop: 3,
      rook: 5,
      queen: 9,
      king: 0,
    };

    const materialCount = {
      materialWhite: 0,
      materialBlack: 0,
      materialDiff: 0,
    };

    for (const piece of pieces.values()) {
      if (piece.color === 'white') {
        materialCount.materialWhite += piecesValues[piece.role];
      } else {
        materialCount.materialBlack += piecesValues[piece.role];
      }
    }
    materialCount.materialDiff = materialCount.materialWhite - materialCount.materialBlack;
    return materialCount;
  }

  public static getCapturedPieces(history: Move[]) {
    const captured = {
      white: [] as string[],
      black: [] as string[],
    };
    for (const move of history) {
      if (move.captured) {
        const capturingColor = move.color === 'w' ? 'white' : 'black';
        captured[capturingColor].push(move.captured);
      }
    }
    return captured;
  }

  public static getGameOverReason(pos: Chess, lang: 'fr' | 'en' = 'fr'): string {
    if (!pos.isEnd()) return '';
    if (pos.isCheckmate()) {
      const turnColor = pos.turn === 'white' ? 'white' : 'black';
      const winner =
        turnColor === 'white'
          ? lang === 'fr'
            ? 'Noirs'
            : 'Black'
          : lang === 'fr'
            ? 'Blancs'
            : 'White';
      return lang === 'fr'
        ? `Échec et mat ! Les ${winner} ont gagné.`
        : `Checkmate! ${winner} won.`;
    }
    if (pos.isStalemate()) return lang === 'fr' ? 'Match nul par Pat.' : 'Draw by stalemate.';
    if (pos.isInsufficientMaterial())
      return lang === 'fr'
        ? 'Match nul par matériel insuffisant.'
        : 'Draw by insufficient material.';
    return lang === 'fr' ? 'Match nul.' : 'Draw.';
  }

  public static getSquareColor(square: Key | string): 'dark' | 'light' | null {
    const sq = parseSquare(square);
    if (sq === undefined) return null;
    const rank = Math.floor(sq / 8);
    const file = sq % 8;
    return (rank + file) % 2 === 0 ? 'dark' : 'light';
  }

  public static getSquare(pos: Chess, square: Key | string) {
    const sq = parseSquare(square);
    if (sq === undefined) return undefined;
    const piece = pos.board.get(sq);
    if (!piece) return null;
    return {
      type: roleToPieceSymbol[piece.role],
      color: piece.color === 'white' ? ('w' as const) : ('b' as const),
    };
  }
}
