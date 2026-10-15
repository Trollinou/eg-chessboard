import { Chess, parseSquare } from 'chessops';
import { chessgroundDests } from 'chessops/compat';
import { parsePgn, startingPosition } from 'chessops/pgn';
import { parseSan } from 'chessops/san';
import { makeFen, parseFen } from 'chessops/fen';
import type { Role } from 'chessops/types';
import type { Color, Key } from '@lichess-org/chessground/types';
import type { Move } from './types';
import { roleToPieceSymbol, buildMovePojo } from './core/pieceMapping';

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

export function getSquareColor(square: Key | string): 'dark' | 'light' | null {
  const sq = parseSquare(square);
  if (sq === undefined) return null;
  const rank = Math.floor(sq / 8);
  const file = sq % 8;
  return (rank + file) % 2 === 0 ? 'dark' : 'light';
}

export function getSquare(pos: Chess, square: Key | string) {
  const sq = parseSquare(square);
  if (sq === undefined) return undefined;
  const piece = pos.board.get(sq);
  if (!piece) return null;
  return {
    type: roleToPieceSymbol[piece.role],
    color: piece.color === 'white' ? ('w' as const) : ('b' as const),
  };
}

export function getPossibleMovesForBothColors(pos: Chess): Map<Key, Key[]> {
  const dests = possibleMoves(pos);
  const swapped = pos.clone();
  swapped.turn = swapped.turn === 'white' ? 'black' : 'white';
  const otherDests = possibleMoves(swapped);
  for (const [key, value] of otherDests.entries()) {
    dests.set(key, value);
  }
  return dests;
}

export function getAllLegalMovesAsPojos(pos: Chess, fenBefore: string): Move[] {
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

export function getMaterialCount(pieces: Map<Key, { role: Role; color: Color }>) {
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
      materialCount.materialWhite += piecesValues[piece.role] || 0;
    } else {
      materialCount.materialBlack += piecesValues[piece.role] || 0;
    }
  }
  materialCount.materialDiff = materialCount.materialWhite - materialCount.materialBlack;
  return materialCount;
}

export function getCapturedPieces(history: Move[]) {
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

export function getGameOverReason(
  pos: Chess,
  lang: 'fr' | 'en' = 'fr',
  isThreefold: boolean = false
): string {
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
  if (isThreefold)
    return lang === 'fr' ? 'Match nul par triple répétition.' : 'Draw by threefold repetition.';
  if (pos.halfmoves >= 100)
    return lang === 'fr' ? 'Match nul par la règle des 50 coups.' : 'Draw by fifty-move rule.';
  if (pos.isEnd()) return lang === 'fr' ? 'Match nul.' : 'Draw.';
  return '';
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

export function validateFen(fen: string): { valid: boolean; error?: string } {
  if (!fen || typeof fen !== 'string') {
    return { valid: false, error: 'Empty FEN string' };
  }
  const setupRes = parseFen(fen.trim());
  if (setupRes.isErr) {
    return { valid: false, error: `Invalid FEN syntax: ${setupRes.error}` };
  }
  const chessRes = Chess.fromSetup(setupRes.value);
  if (chessRes.isErr) {
    return { valid: false, error: `Illegal chess position: ${chessRes.error}` };
  }
  return { valid: true };
}

export function computeEvalBarPercentage(
  turn: 'w' | 'b' | 'white' | 'black',
  scoreType: 'cp' | 'mate',
  scoreValue: number,
  wdl?: [number, number, number]
): number {
  const isWhite = turn === 'w' || turn === 'white';
  const sign = isWhite ? 1 : -1;

  if (scoreType === 'mate') {
    const whiteMate = scoreValue * sign;
    return whiteMate > 0 ? 100 : 0;
  }

  let whitePercentage: number;
  if (wdl) {
    const [w, d, l] = wdl;
    const whiteWin = isWhite ? w : l;
    whitePercentage = (whiteWin + 0.5 * d) / 10;
  } else {
    const whiteCp = scoreValue * sign;
    const K = 0.00368208;
    whitePercentage = 100 / (1 + Math.exp(-K * whiteCp));
  }

  return Math.max(5, Math.min(95, Number(whitePercentage.toFixed(1))));
}

/**
 * Calcule une limite de recherche en nombre de nœuds selon le niveau ELO.
 * Formule exponentielle standard : 500 * 10^((elo - 800) / 500)
 */
export function getNodesForElo(elo: number): number {
  return Math.round(500 * Math.pow(10, (elo - 800) / 500));
}
