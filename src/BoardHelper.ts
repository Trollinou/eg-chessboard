import type { Chess } from 'chessops/chess';
import { castlingSide } from 'chessops/chess';
import { makeSquare } from 'chessops';
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
  const dests: Map<Key, Key[]> = new Map();
  for (let s = 0; s < 64; s++) {
    const squareDests = game.dests(s);
    if (squareDests.size() > 0) {
      const orig = makeSquare(s) as Key;
      const destList: Key[] = [];
      for (const destSq of squareDests) {
        const side = castlingSide(game, { from: s, to: destSq });
        if (side === 'h') {
          const stdSquare = (orig === 'e1' ? 'g1' : orig === 'e8' ? 'g8' : makeSquare(destSq)) as Key;
          if (!destList.includes(stdSquare)) destList.push(stdSquare);
          const rookSquare = makeSquare(destSq) as Key;
          if (!destList.includes(rookSquare)) destList.push(rookSquare);
        } else if (side === 'a') {
          const stdSquare = (orig === 'e1' ? 'c1' : orig === 'e8' ? 'c8' : makeSquare(destSq)) as Key;
          if (!destList.includes(stdSquare)) destList.push(stdSquare);
          const rookSquare = makeSquare(destSq) as Key;
          if (!destList.includes(rookSquare)) destList.push(rookSquare);
        } else {
          destList.push(makeSquare(destSq) as Key);
        }
      }
      dests.set(orig, destList);
    }
  }
  return dests;
}

export function isPromotion(dest: Key, piece: { type: string; color: string } | null | undefined): boolean {
  if (!piece || piece.type !== 'p') {
    return false;
  }
  return (piece.color === 'w' && dest[1] === '8') || (piece.color === 'b' && dest[1] === '1');
}
