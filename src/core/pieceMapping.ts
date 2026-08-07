import { makeSquare } from 'chessops';
import { makeFen } from 'chessops/fen';
import { makeSanAndPlay } from 'chessops/san';
import { isNormal } from 'chessops/types';
import type { Chess } from 'chessops';
import type { Role, Move as ChessopsMove } from 'chessops/types';

import type { Move } from '../types';

/** Mapping from chessops Role to single-char piece symbol (e.g. 'pawn' → 'p'). */
export const roleToPieceSymbol: Record<Role, string> = {
  pawn: 'p',
  knight: 'n',
  bishop: 'b',
  rook: 'r',
  queen: 'q',
  king: 'k',
};

/** Mapping from single-char piece symbol to chessops Role (e.g. 'p' → 'pawn'). */
export const pieceSymbolToRole: Record<string, Role> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

/**
 * Builds a Move POJO from a chessops parsed move on a given position.
 * The move is played on the position (mutating `pos`) and the resulting SAN and FEN are computed.
 *
 * @param pos - The current chess position (will be mutated via `makeSanAndPlay`).
 * @param parsedMove - The parsed chessops move to play.
 * @param fenBefore - The FEN string representing the position before the move.
 * @returns The constructed Move POJO.
 */
export function buildMovePojo(pos: Chess, parsedMove: ChessopsMove, fenBefore: string): Move {
  const fromStr = isNormal(parsedMove) ? makeSquare(parsedMove.from) : '';
  const toStr = makeSquare(parsedMove.to);
  const pieceBefore = isNormal(parsedMove) ? pos.board.get(parsedMove.from) : undefined;
  const colorBefore: 'w' | 'b' = pos.turn === 'white' ? 'w' : 'b';

  let capturedPiece = pos.board.get(parsedMove.to);
  const isEnPassant =
    isNormal(parsedMove) &&
    pieceBefore?.role === 'pawn' &&
    fromStr[0] !== toStr[0] &&
    !capturedPiece;

  if (isEnPassant) {
    capturedPiece = { role: 'pawn', color: colorBefore === 'w' ? 'black' : 'white' };
  }

  const promoChar =
    isNormal(parsedMove) && parsedMove.promotion
      ? roleToPieceSymbol[parsedMove.promotion]
      : undefined;

  const sanStr = makeSanAndPlay(pos, parsedMove);
  const fenAfter = makeFen(pos.toSetup());

  return {
    from: fromStr,
    to: toStr,
    piece: pieceBefore ? roleToPieceSymbol[pieceBefore.role] : 'p',
    color: colorBefore,
    san: sanStr,
    captured: capturedPiece ? roleToPieceSymbol[capturedPiece.role] : undefined,
    promotion: promoChar,
    before: fenBefore,
    after: fenAfter,
  };
}
