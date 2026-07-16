import React, { useRef, useEffect, useState } from 'react';
import type { Config } from '@lichess-org/chessground/config';
import type { Move } from 'chess.js';
import {
  BoardCore,
  type BoardCoreState,
  type StockfishConfig,
  type ChessDiagram,
} from '../BoardCore';
export { BoardCore, type BoardCoreState, type StockfishConfig, type ChessDiagram };
import { PromotionDialog } from './components/PromotionDialog';

export interface ChessboardProps {
  boardConfig?: Config;
  playerColor?: 'white' | 'black' | 'both';
  freeMode?: boolean;
  soloMode?: boolean;
  stockfishConfig?: StockfishConfig;
  diagram?: ChessDiagram;
  onBoardCreated?: (api: BoardCore) => void;
  onMove?: (move: Move) => void;
  onCheck?: (color: string) => void;
  onCheckmate?: (color: string) => void;
  onStalemate?: () => void;
  onDraw?: () => void;
  onPromotion?: (detail: { from: string; to: string; promotedTo: string }) => void;
  onStockfishHint?: (bestMove: string) => void;
  onSquareClick?: (square: string) => void;
}

export const Chessboard: React.FC<ChessboardProps> = ({
  boardConfig = {},
  playerColor,
  freeMode = false,
  soloMode = false,
  stockfishConfig = {},
  diagram,
  onBoardCreated,
  onMove,
  onCheck,
  onCheckmate,
  onStalemate,
  onDraw,
  onPromotion,
  onStockfishHint,
  onSquareClick,
}) => {
  const boardRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<BoardCore | null>(null);

  const [state, setState] = useState<BoardCoreState>({
    showThreats: false,
    freeMode,
    soloMode,
    promotionDialogState: { isEnabled: false },
    historyViewerState: { isEnabled: false },
    currentComment: '',
  });

  useEffect(() => {
    if (coreRef.current) {
      coreRef.current.setFreeMode(freeMode);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((prev) => ({ ...prev, freeMode }));
  }, [freeMode]);

  useEffect(() => {
    if (coreRef.current) {
      coreRef.current.setSoloMode(soloMode);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((prev) => ({ ...prev, soloMode }));
  }, [soloMode]);

  useEffect(() => {
    if (!boardRef.current) return;

    const core = new BoardCore(
      boardRef.current,
      state,
      () => {
        // Sync React component state with BoardCore state
        setState({
          showThreats: core['state'].showThreats,
          freeMode: core['state'].freeMode,
          soloMode: core['state'].soloMode,
          promotionDialogState: { ...core['state'].promotionDialogState },
          historyViewerState: { ...core['state'].historyViewerState },
          currentComment: core['state'].currentComment,
        });
      },
      (event, ...args) => {
        if (event === 'move') onMove?.(args[0] as Move);
        else if (event === 'check') onCheck?.(args[0] as string);
        else if (event === 'checkmate') onCheckmate?.(args[0] as string);
        else if (event === 'stalemate') onStalemate?.();
        else if (event === 'draw') onDraw?.();
        else if (event === 'promotion')
          onPromotion?.(args[0] as { from: string; to: string; promotedTo: string });
        else if (event === 'stockfish-hint') onStockfishHint?.(args[0] as string);
        else if (event === 'square-click') onSquareClick?.(args[0] as string);
      },
      {
        ...boardConfig,
        movable: {
          ...boardConfig.movable,
          color: playerColor || boardConfig.movable?.color,
        },
      },
      stockfishConfig,
      diagram
    );

    coreRef.current = core;
    onBoardCreated?.(core);

    return () => {
      // Clean up logic if necessary
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (coreRef.current && boardConfig) {
      coreRef.current.setConfig(boardConfig);
    }
  }, [boardConfig]);

  useEffect(() => {
    if (coreRef.current && stockfishConfig) {
      coreRef.current.updateStockfishConfig(stockfishConfig);
    }
  }, [stockfishConfig]);

  useEffect(() => {
    if (coreRef.current && diagram) {
      coreRef.current.setDiagram(diagram);
    }
  }, [diagram]);

  return (
    <section
      className={`main-wrap ${state.promotionDialogState.isEnabled ? 'disabledBoard' : ''} ${
        state.historyViewerState.isEnabled ? 'viewingHistory' : ''
      }`}
    >
      <div className="main-board">
        {state.promotionDialogState.isEnabled && (
          <PromotionDialog
            state={state.promotionDialogState}
            onPromotionSelected={() => {
              coreRef.current?.closePromotionDialog();
            }}
          />
        )}
        <div ref={boardRef} />
      </div>
    </section>
  );
};
