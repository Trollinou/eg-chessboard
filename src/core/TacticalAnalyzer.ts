import { Chess, makeSquare, parseSquare } from 'chessops';
import { attacks, between, ray } from 'chessops/attacks';
import { parseFen } from 'chessops/fen';
import { SquareSet } from 'chessops/squareSet';
import type { Color, Role, Square } from 'chessops/types';
import type { Key } from '@lichess-org/chessground/types';
import type { Move, TacticalAnalysisResult } from '../types';

const PIECE_VALUES: Record<Role, number> = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
  king: 1000,
};

export function getPieceValue(roleOrSymbol: string | undefined): number {
  if (!roleOrSymbol) return 0;
  switch (roleOrSymbol.toLowerCase()) {
    case 'p':
    case 'pawn':
      return 1;
    case 'n':
    case 'knight':
    case 'b':
    case 'bishop':
      return 3;
    case 'r':
    case 'rook':
      return 5;
    case 'q':
    case 'queen':
      return 9;
    case 'k':
    case 'king':
      return 1000;
    default:
      return 0;
  }
}

function isSlidingRole(role: Role): boolean {
  return role === 'rook' || role === 'bishop' || role === 'queen';
}

interface VulnerabilityInfo {
  pieceValue: number;
  isHanging: boolean;
  isAttackedByLesser: boolean;
  isLosingExchange: boolean;
  defendersCount: number;
  enemyAttackersCount: number;
}

function cloneWithTurn(pos: Chess, turn: Color): Chess {
  if (pos.turn === turn) return pos;
  const cloned = pos.clone();
  cloned.turn = turn;
  return cloned;
}

function analyzePositionVulnerability(
  pos: Chess,
  playerColor: Color
): Map<Key, VulnerabilityInfo> {
  const enemyColor: Color = playerColor === 'white' ? 'black' : 'white';
  const posForEnemy = cloneWithTurn(pos, enemyColor);
  const enemyCtx = posForEnemy.ctx();

  const posForPlayer = cloneWithTurn(pos, playerColor);
  const playerCtx = posForPlayer.ctx();
  const playerBlockers = playerCtx.blockers.intersect(pos.board[playerColor]);
  const playerKingSq = playerCtx.king;

  const enemyDestsMap = new Map<Square, SquareSet>();
  for (const enemySq of posForEnemy.board[enemyColor]) {
    enemyDestsMap.set(enemySq, posForEnemy.dests(enemySq, enemyCtx));
  }

  const vulnerable = new Map<Key, VulnerabilityInfo>();

  for (const sq of pos.board[playerColor]) {
    const piece = pos.board.get(sq);
    if (!piece || piece.role === 'king') continue;

    const pieceValue = PIECE_VALUES[piece.role];

    // 1. Direct legal enemy attackers
    const enemyAttackers: { sq: Square; role: Role; value: number }[] = [];
    const seenEnemySqs = new Set<Square>();

    for (const [enemySq, dests] of enemyDestsMap.entries()) {
      const enemyPiece = posForEnemy.board.get(enemySq);
      if (!enemyPiece) continue;

      let canCapture = dests.has(sq);
      if (
        !canCapture &&
        piece.role === 'pawn' &&
        enemyPiece.role === 'pawn' &&
        posForEnemy.epSquare !== undefined &&
        dests.has(posForEnemy.epSquare)
      ) {
        const epCapturedSq =
          posForEnemy.epSquare + (playerColor === 'white' ? 8 : -8);
        if (epCapturedSq === sq) {
          canCapture = true;
        }
      }

      if (canCapture) {
        enemyAttackers.push({
          sq: enemySq,
          role: enemyPiece.role,
          value: PIECE_VALUES[enemyPiece.role],
        });
        seenEnemySqs.add(enemySq);
      }
    }

    if (enemyAttackers.length === 0) continue;

    // 2. X-ray enemy attackers (batteries behind a legal sliding enemy attacker)
    if (enemyCtx.checkers.isEmpty()) {
      let addedEnemyXray = true;
      while (addedEnemyXray) {
        addedEnemyXray = false;
        let occ = pos.board.occupied;
        let sliderEnemySqs = SquareSet.empty();
        for (const att of enemyAttackers) {
          if (isSlidingRole(att.role)) {
            occ = occ.without(att.sq);
            sliderEnemySqs = sliderEnemySqs.with(att.sq);
          }
        }
        if (sliderEnemySqs.isEmpty()) break;

        for (const enemySq of pos.board[enemyColor]) {
          if (seenEnemySqs.has(enemySq)) continue;
          const enemyPiece = pos.board.get(enemySq);
          if (!enemyPiece || !isSlidingRole(enemyPiece.role)) continue;

          if (
            enemyCtx.blockers.has(enemySq) &&
            enemyCtx.king !== undefined &&
            !ray(enemyCtx.king, enemySq).has(sq)
          ) {
            continue;
          }

          if (
            attacks(enemyPiece, enemySq, occ).has(sq) &&
            between(enemySq, sq).intersects(sliderEnemySqs)
          ) {
            enemyAttackers.push({
              sq: enemySq,
              role: enemyPiece.role,
              value: PIECE_VALUES[enemyPiece.role],
            });
            seenEnemySqs.add(enemySq);
            addedEnemyXray = true;
          }
        }
      }
    }

    // 3. Direct friendly defenders
    const rawDefenders: { sq: Square; role: Role; value: number }[] = [];
    const seenDefSqs = new Set<Square>();

    for (const defSq of pos.board[playerColor]) {
      if (defSq === sq) continue;
      const defPiece = pos.board.get(defSq);
      if (!defPiece) continue;

      if (
        playerBlockers.has(defSq) &&
        playerKingSq !== undefined &&
        !ray(playerKingSq, defSq).has(sq)
      ) {
        continue;
      }

      if (attacks(defPiece, defSq, pos.board.occupied).has(sq)) {
        rawDefenders.push({
          sq: defSq,
          role: defPiece.role,
          value: PIECE_VALUES[defPiece.role],
        });
        seenDefSqs.add(defSq);
      }
    }

    // 4. X-ray friendly defenders (batteries: doubled rooks, queen + bishop, etc.)
    let addedDefXray = true;
    while (addedDefXray) {
      addedDefXray = false;
      let occ = pos.board.occupied;
      let sliderDefSqs = SquareSet.empty();
      for (const def of rawDefenders) {
        if (isSlidingRole(def.role)) {
          occ = occ.without(def.sq);
          sliderDefSqs = sliderDefSqs.with(def.sq);
        }
      }
      if (sliderDefSqs.isEmpty()) break;

      for (const xraySq of pos.board[playerColor]) {
        if (xraySq === sq || seenDefSqs.has(xraySq)) continue;
        const xrayPiece = pos.board.get(xraySq);
        if (!xrayPiece || !isSlidingRole(xrayPiece.role)) continue;

        if (
          playerBlockers.has(xraySq) &&
          playerKingSq !== undefined &&
          !ray(playerKingSq, xraySq).has(sq)
        ) {
          continue;
        }

        if (
          attacks(xrayPiece, xraySq, occ).has(sq) &&
          between(xraySq, sq).intersects(sliderDefSqs)
        ) {
          rawDefenders.push({
            sq: xraySq,
            role: xrayPiece.role,
            value: PIECE_VALUES[xrayPiece.role],
          });
          seenDefSqs.add(xraySq);
          addedDefXray = true;
        }
      }
    }

    const nonKingDefendersCount = rawDefenders.filter(
      (d) => d.role !== 'king'
    ).length;
    const defenders = rawDefenders.filter(
      (d) => d.role !== 'king' || nonKingDefendersCount + 1 >= enemyAttackers.length
    );

    enemyAttackers.sort((a, b) => a.value - b.value);
    defenders.sort((a, b) => a.value - b.value);

    const defendersCount = defenders.length;
    const enemyAttackersCount = enemyAttackers.length;
    const minAttackerValue = enemyAttackers[0].value;
    const secondMinAttackerValue = enemyAttackers[1]?.value ?? 1000;
    const minDefenderValue = defenders[0]?.value ?? 0;

    const isHanging = defendersCount === 0;
    const isAttackedByLesser = minAttackerValue < pieceValue;
    const isLosingExchange =
      enemyAttackersCount > defendersCount &&
      minAttackerValue + secondMinAttackerValue <= pieceValue + minDefenderValue;

    if (isHanging || isAttackedByLesser || isLosingExchange) {
      vulnerable.set(makeSquare(sq) as Key, {
        pieceValue,
        isHanging,
        isAttackedByLesser,
        isLosingExchange,
        defendersCount,
        enemyAttackersCount,
      });
    }
  }

  return vulnerable;
}

export function analyzeMoveTactics(
  posAfter: Chess,
  playerColor: Color,
  move?: Move
): TacticalAnalysisResult {
  // 1. Short-circuit on game over (checkmate, stalemate, insufficient material)
  if (posAfter.isCheckmate() || posAfter.isEnd()) {
    return {
      undefendedSquares: [],
      pinnedSquares: [],
      isKingInCheck: false,
      hasMajorThreat: false,
    };
  }

  const enemyColor: Color = playerColor === 'white' ? 'black' : 'white';
  const kingSq = posAfter.board.kingOf(playerColor);

  // 2. Check if playerColor's own king is attacked
  const isKingInCheck =
    kingSq !== undefined &&
    posAfter.kingAttackers(kingSq, enemyColor, posAfter.board.occupied).nonEmpty();

  // Pinned friendly pieces
  const posForPlayer = cloneWithTurn(posAfter, playerColor);
  const playerBlockers = posForPlayer
    .ctx()
    .blockers.intersect(posAfter.board[playerColor]);
  const pinnedSquares: Key[] = [];
  for (const sq of playerBlockers) {
    pinnedSquares.push(makeSquare(sq) as Key);
  }

  // 3-5. Vulnerable friendly squares after move
  const vulnAfter = analyzePositionVulnerability(posAfter, playerColor);

  if (!move) {
    const undefendedSquares = Array.from(vulnAfter.keys());
    const hasMajorThreat = isKingInCheck || undefendedSquares.length > 0;
    return {
      undefendedSquares,
      pinnedSquares,
      isKingInCheck,
      hasMajorThreat,
    };
  }

  // 6. Account for captures/trades and before/after delta
  const moveToKey = move.to as Key;
  const destSq = parseSquare(move.to);
  const movedPiece = destSq !== undefined ? posAfter.board.get(destSq) : undefined;
  const movedPieceValue = movedPiece
    ? PIECE_VALUES[movedPiece.role]
    : getPieceValue(move.promotion || move.piece);
  const capturedValue = getPieceValue(move.captured);

  if (move.captured && capturedValue >= movedPieceValue) {
    vulnAfter.delete(moveToKey);
  }

  let vulnBefore = new Map<Key, VulnerabilityInfo>();
  if (move.before) {
    const setupRes = parseFen(move.before);
    if (setupRes.isOk) {
      const posBeforeRes = Chess.fromSetup(setupRes.value);
      if (posBeforeRes.isOk) {
        vulnBefore = analyzePositionVulnerability(posBeforeRes.value, playerColor);
      }
    }
  }

  const givesCheck = posAfter.isCheck();
  let hasMajorThreat = false;
  const filteredUndefended: Key[] = [];

  for (const [sqKey, info] of vulnAfter.entries()) {
    if (sqKey === moveToKey) {
      hasMajorThreat = true;
      filteredUndefended.push(sqKey);
      continue;
    }

    const beforeInfo = vulnBefore.get(sqKey);
    if (!beforeInfo) {
      // Newly exposed piece by the played move
      filteredUndefended.push(sqKey);
      if (info.pieceValue >= 3) {
        hasMajorThreat = true;
      }
    } else {
      // Already vulnerable before the move
      const ignoredExistingThreat =
        (beforeInfo.isHanging ||
          (beforeInfo.pieceValue >= 3 && beforeInfo.isAttackedByLesser)) &&
        info.pieceValue >= movedPieceValue &&
        !givesCheck &&
        capturedValue < info.pieceValue;

      if (ignoredExistingThreat) {
        hasMajorThreat = true;
        filteredUndefended.push(sqKey);
      }
    }
  }

  return {
    undefendedSquares: filteredUndefended,
    pinnedSquares,
    isKingInCheck,
    hasMajorThreat,
  };
}
