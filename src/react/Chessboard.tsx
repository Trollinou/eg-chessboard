import React, { useRef, useEffect, useState } from 'react';
import type { Config } from '@lichess-org/chessground/config';
import type { DrawShape } from '@lichess-org/chessground/draw';
import {
  type Move,
  type BoardMode,
  type PieceSet,
  type BoardTheme,
  type BoardEvents,
  type PromotionDetail,
  AVAILABLE_PIECE_SETS,
  AVAILABLE_BOARD_THEMES,
} from '../types';
import {
  BoardCore,
  type BoardCoreState,
  type StockfishConfig,
  type ChessDiagram,
} from '../BoardCore';
export {
  BoardCore,
  type BoardCoreState,
  type StockfishConfig,
  type ChessDiagram,
  type Move,
  type BoardMode,
  type PieceSet,
  type BoardTheme,
  type BoardEvents,
  type PromotionDetail,
  AVAILABLE_PIECE_SETS,
  AVAILABLE_BOARD_THEMES,
};
import { PromotionDialog } from './components/PromotionDialog';

export interface ChessboardProps extends BoardEvents {
  boardConfig?: Config;
  mode?: BoardMode;
  playerColor?: 'white' | 'black' | 'both';
  freeMode?: boolean;
  soloMode?: boolean;
  readOnly?: boolean;
  fitContainer?: boolean;
  preserveShapesOnPositionChange?: boolean;
  pieceSet?: PieceSet;
  boardTheme?: BoardTheme;
  stockfishConfig?: StockfishConfig;
  diagram?: ChessDiagram;
}

export const Chessboard: React.FC<ChessboardProps> = ({
  boardConfig = {},
  mode = 'game',
  playerColor,
  freeMode = false,
  soloMode = false,
  readOnly = false,
  fitContainer = false,
  preserveShapesOnPositionChange = false,
  pieceSet = 'cburnett',
  boardTheme = 'brown',
  stockfishConfig = {},
  diagram,
  onBoardCreated,
  onMove,
  onTurnChange,
  onCheck,
  onCheckmate,
  onStalemate,
  onDraw,
  onPromotion,
  onStockfishHint,
  onSquareClick,
  onShapesChange,
}) => {
  const boardRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<BoardCore | null>(null);

  const [state, setState] = useState<BoardCoreState>({
    showThreats: false,
    mode,
    playerColor,
    freeMode,
    soloMode,
    readOnly,
    preserveShapesOnPositionChange,
    pieceSet,
    boardTheme,
    promotionDialogState: { isEnabled: false },
    historyViewerState: { isEnabled: false },
    currentComment: '',
    turnColor: 'white',
    ply: 0,
    fen: '',
    isCheck: false,
    isGameOver: false,
  });

  useEffect(() => {
    if (coreRef.current && pieceSet) {
      coreRef.current.setPieceSet(pieceSet);
    }
  }, [pieceSet]);

  useEffect(() => {
    if (coreRef.current && boardTheme) {
      coreRef.current.setBoardTheme(boardTheme);
    }
  }, [boardTheme]);

  useEffect(() => {
    if (coreRef.current && mode) {
      coreRef.current.setMode(mode);
    }
  }, [mode]);

  useEffect(() => {
    if (coreRef.current && readOnly !== undefined) {
      coreRef.current.setReadOnly(readOnly);
    }
  }, [readOnly]);

  useEffect(() => {
    if (coreRef.current && freeMode !== undefined) {
      coreRef.current.setFreeMode(freeMode);
    }
  }, [freeMode]);

  useEffect(() => {
    if (coreRef.current && soloMode !== undefined) {
      coreRef.current.setSoloMode(soloMode);
    }
  }, [soloMode]);

  useEffect(() => {
    if (coreRef.current && preserveShapesOnPositionChange !== undefined) {
      coreRef.current.setPreserveShapesOnPositionChange(preserveShapesOnPositionChange);
    }
  }, [preserveShapesOnPositionChange]);

  useEffect(() => {
    if (!boardRef.current) return;

    const core = new BoardCore(
      boardRef.current,
      state,
      () => {
        // Sync React component state with BoardCore state via public getter
        const coreState = core.getState();
        setState({
          showThreats: coreState.showThreats,
          mode: coreState.mode,
          playerColor: coreState.playerColor,
          freeMode: coreState.freeMode,
          soloMode: coreState.soloMode,
          readOnly: coreState.readOnly,
          preserveShapesOnPositionChange: coreState.preserveShapesOnPositionChange,
          pieceSet: coreState.pieceSet,
          boardTheme: coreState.boardTheme,
          promotionDialogState: { ...coreState.promotionDialogState },
          historyViewerState: { ...coreState.historyViewerState },
          currentComment: coreState.currentComment,
          turnColor: coreState.turnColor,
          ply: coreState.ply,
          fen: coreState.fen,
          isCheck: coreState.isCheck,
          isGameOver: coreState.isGameOver,
        });
      },
      (event, ...args) => {
        if (event === 'move') onMove?.(args[0] as Move);
        else if (event === 'turn-change')
          onTurnChange?.(args[0] as 'white' | 'black', args[1] as number);
        else if (event === 'check') onCheck?.(args[0] as string);
        else if (event === 'checkmate') onCheckmate?.(args[0] as string);
        else if (event === 'stalemate') onStalemate?.();
        else if (event === 'draw') onDraw?.();
        else if (event === 'promotion')
          onPromotion?.(args[0] as { from: string; to: string; promotedTo: string });
        else if (event === 'stockfish-hint') onStockfishHint?.(args[0] as string);
        else if (event === 'square-click') onSquareClick?.(args[0] as string);
        else if (event === 'shapes-change') onShapesChange?.(args[0] as DrawShape[]);
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
      core.destroy();
      coreRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (coreRef.current && playerColor) {
      coreRef.current.setPlayerColor(playerColor);
    }
  }, [playerColor]);

  useEffect(() => {
    if (coreRef.current && boardConfig) {
      coreRef.current.setConfig({
        ...boardConfig,
        movable: {
          ...boardConfig.movable,
          color: playerColor || boardConfig.movable?.color,
        },
      });
    }
  }, [boardConfig, playerColor]);

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
      className={`main-wrap piece-set-${state.pieceSet || 'cburnett'} board-theme-${state.boardTheme || 'brown'} ${
        state.promotionDialogState.isEnabled ? 'disabledBoard' : ''
      } ${state.historyViewerState.isEnabled ? 'viewingHistory' : ''} ${
        fitContainer ? 'fit-container' : ''
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
