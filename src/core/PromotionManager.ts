import { parseSquare } from 'chessops';
import { makeFen } from 'chessops/fen';
import type { Chess } from 'chessops';
import type { Api } from '@lichess-org/chessground/api';
import type { Key, Role } from '@lichess-org/chessground/types';
import type { BoardCoreState } from '../BoardCore';
import { pieceSymbolToRole, FILES } from './pieceMapping';

export class PromotionManager {
  public static async checkUnpromotedPawns(
    pos: Chess,
    state: BoardCoreState,
    getMode: () => string,
    onStateChange: () => void,
    updateGameState: () => void,
    resetFenCache: () => void,
    board?: Api
  ): Promise<void> {
    if (state.promotionDialogState.isEnabled) return;
    if (!state.freeMode && getMode() !== 'editor') return;

    for (const f of FILES) {
      // Rank 8: White Pawn Promotion
      const sq8Str = `${f}8`;
      const sq8 = parseSquare(sq8Str)!;
      const piece8 = pos.board.get(sq8);
      if (piece8 && piece8.role === 'pawn' && piece8.color === 'white') {
        await PromotionManager.promptPromotionForSquare(
          sq8Str,
          'white',
          pos,
          state,
          onStateChange,
          updateGameState,
          resetFenCache,
          board
        );
        return;
      }

      // Rank 1: Black Pawn Promotion
      const sq1Str = `${f}1`;
      const sq1 = parseSquare(sq1Str)!;
      const piece1 = pos.board.get(sq1);
      if (piece1 && piece1.role === 'pawn' && piece1.color === 'black') {
        await PromotionManager.promptPromotionForSquare(
          sq1Str,
          'black',
          pos,
          state,
          onStateChange,
          updateGameState,
          resetFenCache,
          board
        );
        return;
      }
    }
  }

  public static async promptPromotionForSquare(
    sqStr: string,
    color: 'white' | 'black',
    pos: Chess,
    state: BoardCoreState,
    onStateChange: () => void,
    updateGameState: () => void,
    resetFenCache: () => void,
    board?: Api
  ): Promise<void> {
    const selectedPromotion = await new Promise<string>((resolve) => {
      state.promotionDialogState = {
        isEnabled: true,
        color,
        callback: (promoPiece) => {
          resolve(promoPiece);
        },
      };
      onStateChange();
    });

    const promotedRole = pieceSymbolToRole[selectedPromotion.toLowerCase()] || 'queen';
    const sq = parseSquare(sqStr)!;
    pos.board.set(sq, { role: promotedRole, color });
    resetFenCache();

    if (board && board.state?.pieces) {
      board.state.pieces.set(sqStr as Key, { role: promotedRole as Role, color });
      board.set({ fen: '' });
      board.set({ fen: makeFen(pos.toSetup()) });
    }

    state.promotionDialogState = { isEnabled: false };
    onStateChange();

    updateGameState();
  }
}
