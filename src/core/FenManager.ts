import { Chess, parseSquare } from 'chessops';
import { parseFen } from 'chessops/fen';
import type { Color as ChessopsColor, Role } from 'chessops/types';
import type { Key, Color } from '@lichess-org/chessground/types';

import * as BoardHelper from '../BoardHelper';
import type { Move } from '../types';
import { roleToPieceSymbol, pieceSymbolToRole, FILES } from './pieceMapping';

export class FenManager {
  public static safeLoadFen(
    fenStr: string,
    onResetPgnTree?: (pos: Chess) => void
  ): { pos: Chess; isStandardOk: boolean } {
    const setupRes = parseFen(fenStr);
    if (setupRes.isOk) {
      const chessRes = Chess.fromSetup(setupRes.value);
      if (chessRes.isOk) {
        onResetPgnTree?.(chessRes.value);
        return { pos: chessRes.value, isStandardOk: true };
      }
    }

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
    onResetPgnTree?.(pos);
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

  public static validateFen(fen: string): { valid: boolean; error?: string } {
    return BoardHelper.validateFen(fen);
  }

  public static getFinalFenFromPgn(
    pgnStr: string,
    fallbackFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  ): string {
    return BoardHelper.getFinalFenFromPgn(pgnStr, fallbackFen);
  }

  // Delegations to BoardHelper for backward compatibility
  public static getPossibleMovesForBothColors(pos: Chess): Map<Key, Key[]> {
    return BoardHelper.getPossibleMovesForBothColors(pos);
  }

  public static getAllLegalMovesAsPojos(pos: Chess, fenBefore: string): Move[] {
    return BoardHelper.getAllLegalMovesAsPojos(pos, fenBefore);
  }

  public static getMaterialCount(pieces: Map<Key, { role: Role; color: Color }>) {
    return BoardHelper.getMaterialCount(pieces);
  }

  public static getCapturedPieces(history: Move[]) {
    return BoardHelper.getCapturedPieces(history);
  }

  public static getGameOverReason(
    pos: Chess,
    lang: 'fr' | 'en' = 'fr',
    isThreefold: boolean = false
  ): string {
    return BoardHelper.getGameOverReason(pos, lang, isThreefold);
  }

  public static getSquareColor(square: Key | string): 'dark' | 'light' | null {
    return BoardHelper.getSquareColor(square);
  }

  public static getSquare(pos: Chess, square: Key | string) {
    return BoardHelper.getSquare(pos, square);
  }
}
