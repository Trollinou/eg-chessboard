import type { Chess, Move, Piece, Square } from 'chess.js';
import type { Color, Key } from '@lichess-org/chessground/types';

export interface Threat {
  orig: Key;
  dest?: Key;
  brush: string;
}

export function getThreats(moves: Move[]): Threat[] {
  const threats: Threat[] = [];
  for (const move of moves) {
    threats.push({ orig: move.to as Key, brush: 'yellow' });
    if (move.captured) {
      threats.push({ orig: move.from as Key, dest: move.to as Key, brush: 'red' });
    }
    if (move.san.includes('+')) {
      threats.push({ orig: move.from as Key, dest: move.to as Key, brush: 'blue' });
    }
  }
  return threats;
}

export function shortToLongColor(color: 'w' | 'b'): Color {
  return color === 'w' ? 'white' : 'black';
}

const fileNames = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const rankNames = ['1', '2', '3', '4', '5', '6', '7', '8'];
const SQUARES: Key[] = [];
for (const rank of rankNames) {
  for (const file of fileNames) {
    SQUARES.push((file + rank) as Key);
  }
}

export function possibleMoves(game: Chess): Map<Key, Key[]> {
  const dests: Map<Key, Key[]> = new Map();
  for (const square of SQUARES) {
    const moves = game.moves({ square: square as Square, verbose: true }) as Move[];
    if (moves.length) {
      dests.set(
        moves[0].from as Key,
        moves.map((m) => m.to as Key)
      );
    }
  }
  return dests;
}

export function isPromotion(dest: Key, piece: Piece | null | undefined): boolean {
  if (!piece || piece.type !== 'p') {
    return false;
  }
  return (piece.color === 'w' && dest[1] === '8') || (piece.color === 'b' && dest[1] === '1');
}
