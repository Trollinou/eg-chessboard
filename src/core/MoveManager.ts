import { parseSquare, type Chess } from 'chessops';
import { makeFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import { isNormal } from 'chessops/types';
import type { Role, Move as ChessopsMove } from 'chessops/types';
import type { Api } from '@lichess-org/chessground/api';
import type { Key, MoveMetadata } from '@lichess-org/chessground/types';

import { isPromotion, shortToLongColor } from '../BoardHelper';
import type { PgnNodeMeta } from '../types';
import type { BoardCoreState } from '../BoardCore';
import type { PgnTreeManager } from './PgnTreeManager';
import type { ExerciseManager } from './ExerciseManager';
import type { HistoryViewerManager } from './HistoryViewerManager';
import { roleToPieceSymbol, pieceSymbolToRole, buildMovePojo } from './pieceMapping';
import { ChildNode } from 'chessops/pgn';

export interface MoveManagerContext {
  state: BoardCoreState;
  pos: Chess;
  board: Api;
  pgnTreeManager: PgnTreeManager;
  exerciseManager: ExerciseManager;
  historyViewerManager: HistoryViewerManager;
  onStateChange: () => void;
  emitEvent: (event: string, ...args: unknown[]) => void;
  getFen: () => string;
  getMode: () => string;
  resetFenCache: () => void;
  updateGameState: (opts?: { updateFen?: boolean; animate?: boolean }) => void;
  triggerStockfish: () => void;
  syncGameFromBoard: () => void;
  setPos: (pos: Chess) => void;
}

export class MoveManager {
  public static executeMove(
    moveObj: string | { from: string; to: string; promotion?: string },
    ctx: MoveManagerContext
  ): boolean {
    const wasViewingHistory = ctx.historyViewerManager.isViewingHistory();

    if (wasViewingHistory) {
      const ply = ctx.historyViewerManager.getCurrentViewingPly(ctx.pgnTreeManager.getActivePath().length);
      const path = ctx.pgnTreeManager.getActivePath();
      const targetNode = ply === 0 ? ctx.pgnTreeManager.getRootNode() : path[ply - 1];

      if (ctx.state.readOnly) {
        const tempPos = ctx.pgnTreeManager.syncGamePosToPly(ply);
        let tempParsed: ChessopsMove | undefined;
        if (typeof moveObj === 'string') {
          tempParsed = parseSan(tempPos, moveObj);
        } else {
          const fromSq = parseSquare(moveObj.from);
          const toSq = parseSquare(moveObj.to);
          if (fromSq !== undefined && toSq !== undefined) {
            tempParsed = { from: fromSq, to: toSq };
          }
        }
        if (tempParsed) {
          const fenBefore = makeFen(tempPos.toSetup());
          const movePojo = buildMovePojo(tempPos, tempParsed, fenBefore);
          const existingChild = targetNode.children.find(
            (child) =>
              child.data.san === movePojo.san ||
              (child.data.move.from === movePojo.from && child.data.move.to === movePojo.to)
          );
          if (!existingChild) {
            return false;
          }
        }
      }

      ctx.pgnTreeManager.setCurrentNode(targetNode);
      const syncedPos = ctx.pgnTreeManager.syncGamePosToPly(ply);
      ctx.setPos(syncedPos);
      ctx.pos = syncedPos;
      ctx.resetFenCache();
      ctx.historyViewerManager.stopViewingHistory(ctx.board, ctx.onStateChange, () => {
        ctx.board.set({ fen: '' });
        ctx.board.set({ fen: ctx.getFen() });
        ctx.updateGameState({ updateFen: true, animate: false });
      });
    }

    let parsedMove: ChessopsMove | undefined;

    if (ctx.state.freeMode) {
      if (typeof moveObj === 'string') {
        const posWhite = ctx.pos.clone();
        posWhite.turn = 'white';
        const moveWhite = parseSan(posWhite, moveObj);
        if (moveWhite && posWhite.isLegal(moveWhite)) {
          ctx.pos.turn = 'white';
          parsedMove = moveWhite;
        } else {
          const posBlack = ctx.pos.clone();
          posBlack.turn = 'black';
          const moveBlack = parseSan(posBlack, moveObj);
          if (moveBlack && posBlack.isLegal(moveBlack)) {
            ctx.pos.turn = 'black';
            parsedMove = moveBlack;
          }
        }
      } else {
        const fromSq = parseSquare(moveObj.from);
        const toSq = parseSquare(moveObj.to);
        if (fromSq !== undefined && toSq !== undefined) {
          const promoRole = moveObj.promotion
            ? pieceSymbolToRole[moveObj.promotion.toLowerCase()]
            : undefined;
          parsedMove = { from: fromSq, to: toSq, promotion: promoRole };
          const piece = ctx.pos.board.get(fromSq);
          if (piece) {
            ctx.pos.turn = piece.color;
          }
        }
      }
    } else {
      if (typeof moveObj === 'string') {
        parsedMove = parseSan(ctx.pos, moveObj);
      } else {
        const fromSq = parseSquare(moveObj.from);
        const toSq = parseSquare(moveObj.to);
        if (fromSq !== undefined && toSq !== undefined) {
          const promoRole = moveObj.promotion
            ? pieceSymbolToRole[moveObj.promotion.toLowerCase()]
            : undefined;
          parsedMove = { from: fromSq, to: toSq, promotion: promoRole };
        }
      }
    }

    if (!parsedMove || !ctx.pos.isLegal(parsedMove)) {
      return false;
    }

    const colorBefore: 'w' | 'b' = ctx.pos.turn === 'white' ? 'w' : 'b';
    const fenBefore = ctx.getFen();

    const movePojo = buildMovePojo(ctx.pos, parsedMove, fenBefore);
    ctx.resetFenCache();

    if (ctx.state.soloMode) {
      ctx.exerciseManager.addSoloMove(movePojo);
      ctx.pos.turn = colorBefore === 'w' ? 'white' : 'black';
      ctx.resetFenCache();
    }

    const currentNode = ctx.pgnTreeManager.getCurrentNode();
    let childNode = currentNode.children.find(
      (child) =>
        child.data.san === movePojo.san ||
        (child.data.move.from === movePojo.from && child.data.move.to === movePojo.to)
    );

    if (!childNode) {
      childNode = new ChildNode<PgnNodeMeta>({
        san: movePojo.san,
        fen: movePojo.after,
        move: movePojo,
      });
      currentNode.children.push(childNode!);
    }
    ctx.pgnTreeManager.setCurrentNode(childNode!);

    if (!wasViewingHistory) {
      ctx.board.move(movePojo.from as Key, movePojo.to as Key);
      if (isNormal(parsedMove) && parsedMove.promotion) {
        setTimeout(() => {
          ctx.board.set({ fen: ctx.getFen() });
        }, 50);
      }
      ctx.updateGameState({ updateFen: true, animate: true });
    } else {
      ctx.board.set({ fen: '' });
      ctx.board.set({ fen: ctx.getFen() });
      ctx.updateGameState({ updateFen: true, animate: false });
      ctx.board.redrawAll();
    }

    ctx.emitEvent('move', movePojo);

    if (isNormal(parsedMove) && parsedMove.promotion) {
      ctx.emitEvent('promotion', {
        color: shortToLongColor(colorBefore),
        promotedTo: roleToPieceSymbol[parsedMove.promotion].toUpperCase(),
        sanMove: movePojo.san,
      });
    }

    ctx.triggerStockfish();
    return true;
  }

  public static async changeTurn(
    orig: Key,
    dest: Key,
    _metadata: MoveMetadata,
    ctx: MoveManagerContext
  ): Promise<void> {
    let targetPos = ctx.pos;
    if (ctx.historyViewerManager.isViewingHistory()) {
      const ply = ctx.historyViewerManager.getCurrentViewingPly(ctx.pgnTreeManager.getActivePath().length);
      targetPos = ctx.pgnTreeManager.syncGamePosToPly(ply);
    }

    const sq = parseSquare(orig)!;
    const piece = targetPos.board.get(sq);
    const destSq = parseSquare(dest);
    const destPiece = destSq ? targetPos.board.get(destSq) : undefined;
    const activePiece = piece || destPiece;

    const pieceType = activePiece ? roleToPieceSymbol[activePiece.role] : undefined;
    const pieceColor = activePiece
      ? activePiece.color === 'white'
        ? 'w'
        : 'b'
      : targetPos.turn === 'white'
        ? 'w'
        : 'b';

    if (pieceType === 'p' && isPromotion(dest, { type: pieceType, color: pieceColor })) {
      const selectedPromotion = await new Promise<string>((resolve) => {
        ctx.state.promotionDialogState = {
          isEnabled: true,
          color: shortToLongColor(pieceColor),
          callback: (promoPiece) => {
            resolve(promoPiece);
          },
        };
        ctx.onStateChange();
      });

      const moved = MoveManager.executeMove(
        {
          from: orig,
          to: dest,
          promotion: selectedPromotion.toLowerCase(),
        },
        ctx
      );

      if (!moved && (ctx.state.freeMode || ctx.getMode() === 'editor')) {
        const promotedRole = pieceSymbolToRole[selectedPromotion.toLowerCase()] || 'queen';
        const color = pieceColor === 'w' ? 'white' : 'black';

        const pieces = new Map(ctx.board.state.pieces);
        pieces.set(dest, { role: promotedRole as Role, color });
        if (orig !== dest) {
          pieces.delete(orig);
        }
        ctx.board.setPieces(pieces);
        ctx.syncGameFromBoard();
      }
    } else {
      const moved = MoveManager.executeMove(
        {
          from: orig,
          to: dest,
        },
        ctx
      );

      if (!moved && (ctx.state.freeMode || ctx.getMode() === 'editor')) {
        const color = pieceColor === 'w' ? 'white' : 'black';
        const role = activePiece ? activePiece.role : 'pawn';
        const pieces = new Map(ctx.board.state.pieces);
        pieces.set(dest, { role, color });
        if (orig !== dest) {
          pieces.delete(orig);
        }
        ctx.board.setPieces(pieces);
        ctx.syncGameFromBoard();
      }
    }
  }
}
