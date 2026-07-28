import { Chess } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { parsePgn, startingPosition } from 'chessops/pgn';
import { parseSan } from 'chessops/san';
import { makeFen } from 'chessops/fen';
import type { Color, Key } from '@lichess-org/chessground/types';
import type { Move } from './types';

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

export function possibleMoves(game: Chess): Map<Key, Key[]> {
  return chessgroundDests(game) as Map<Key, Key[]>;
}

export function isPromotion(
  dest: Key,
  piece: { type: string; color: string } | null | undefined
): boolean {
  if (!piece || piece.type !== 'p') {
    return false;
  }
  return (piece.color === 'w' && dest[1] === '8') || (piece.color === 'b' && dest[1] === '1');
}

export function getFinalFenFromPgn(
  pgnStr: string,
  fallbackFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
): string {
  if (!pgnStr || !pgnStr.trim()) return fallbackFen;
  try {
    const games = parsePgn(pgnStr);
    if (!games.length) return fallbackFen;
    const g = games[0];
    const startRes = startingPosition(g.headers);
    const temp = startRes.isOk ? startRes.value : Chess.default();
    for (const child of g.moves.mainlineNodes()) {
      const m = parseSan(temp, child.data.san);
      if (!m) break;
      temp.play(m);
    }
    return makeFen(temp.toSetup());
  } catch {
    return fallbackFen;
  }
}
