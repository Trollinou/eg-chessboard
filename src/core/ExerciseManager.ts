import { parseSquare, Chess } from 'chessops';
import type { Color as ChessopsColor } from 'chessops/types';
import type { Key } from '@lichess-org/chessground/types';
import type { Role, Color } from '@lichess-org/chessground/types';
import { possibleMoves } from '../BoardHelper';
import type { Move } from '../types';

export class ExerciseManager {
  private customDests: Map<Key, Key[]> | null = null;
  private soloHistory: Move[] = [];

  public getCustomDests(): Map<Key, Key[]> | null {
    return this.customDests;
  }

  public setCustomDests(dests: Map<Key, Key[]> | null): void {
    this.customDests = dests;
  }

  public restrictMovesToPieces(squares: Key[] | null, pos: Chess): void {
    if (!squares) {
      this.setCustomDests(null);
      return;
    }
    const allDests = possibleMoves(pos);
    const filteredDests = new Map<Key, Key[]>();
    for (const sq of squares) {
      const destsForSq = allDests.get(sq);
      if (destsForSq) {
        filteredDests.set(sq, destsForSq);
      }
    }
    this.setCustomDests(filteredDests);
  }

  public isSquareAttacked(square: Key, byColor: 'white' | 'black', pos: Chess): boolean {
    const sq = parseSquare(square);
    if (sq === undefined) return false;
    const color: ChessopsColor = byColor === 'white' ? 'white' : 'black';
    return pos.kingAttackers(sq, color, pos.board.occupied).nonEmpty();
  }

  public getPieces(
    boardStatePieces: Map<Key, { role: Role; color: Color }>
  ): Map<Key, { type: string; color: 'w' | 'b' }> {
    const piecesMap = new Map<Key, { type: string; color: 'w' | 'b' }>();
    const roleToPieceType: Record<string, string> = {
      pawn: 'p',
      knight: 'n',
      bishop: 'b',
      rook: 'r',
      queen: 'q',
      king: 'k',
    };
    for (const [square, piece] of boardStatePieces) {
      const type = roleToPieceType[piece.role];
      if (type) {
        piecesMap.set(square, {
          type,
          color: piece.color === 'white' ? 'w' : 'b',
        });
      }
    }
    return piecesMap;
  }

  public addSoloMove(move: Move): void {
    this.soloHistory.push(move);
  }

  public getSoloHistory(): Move[] {
    return this.soloHistory;
  }

  public resetSoloHistory(): void {
    this.soloHistory = [];
  }
}
