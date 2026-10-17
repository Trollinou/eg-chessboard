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
  type StockfishEvaluation,
  type EngineStatus,
  type GameReviewReport,
  type MoveAnalysisReport,
  type MoveJudgement,
  AVAILABLE_PIECE_SETS,
  AVAILABLE_BOARD_THEMES,
} from '../types';
import {
  BoardCore,
  type BoardCoreState,
  type StockfishConfig,
  type StockfishMode,
  type ChessDiagram,
} from '../BoardCore';
export {
  BoardCore,
  type BoardCoreState,
  type StockfishConfig,
  type StockfishMode,
  type ChessDiagram,
  type Move,
  type BoardMode,
  type PieceSet,
  type BoardTheme,
  type BoardEvents,
  type PromotionDetail,
  type StockfishEvaluation,
  type EngineStatus,
  type GameReviewReport,
  type MoveAnalysisReport,
  type MoveJudgement,
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

const DEFAULT_BOARD_CONFIG: Config = {};
const DEFAULT_STOCKFISH_CONFIG: StockfishConfig = {};

export const Chessboard: React.FC<ChessboardProps> = ({
  boardConfig = DEFAULT_BOARD_CONFIG,
  mode = 'game',
  playerColor,
  freeMode = false,
  soloMode = false,
  readOnly = false,
  fitContainer = false,
  preserveShapesOnPositionChange = false,
  pieceSet = 'cburnett',
  boardTheme = 'brown',
  stockfishConfig = DEFAULT_STOCKFISH_CONFIG,
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
  onEvaluation,
  onEngineStatus,
  onGameReviewProgress,
  onSquareClick,
  onShapesChange,
}) => {
  const boardRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<BoardCore | null>(null);

  const callbacksRef = useRef<BoardEvents>({
    onBoardCreated,
    onMove,
    onTurnChange,
    onCheck,
    onCheckmate,
    onStalemate,
    onDraw,
    onPromotion,
    onStockfishHint,
    onEvaluation,
    onEngineStatus,
    onGameReviewProgress,
    onSquareClick,
    onShapesChange,
  });

  useEffect(() => {
    callbacksRef.current = {
      onBoardCreated,
      onMove,
      onTurnChange,
      onCheck,
      onCheckmate,
      onStalemate,
      onDraw,
      onPromotion,
      onStockfishHint,
      onEvaluation,
      onEngineStatus,
      onGameReviewProgress,
      onSquareClick,
      onShapesChange,
    };
  });

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
    const core = coreRef.current;
    if (!core) return;
    if (pieceSet) core.setPieceSet(pieceSet);
    if (boardTheme) core.setBoardTheme(boardTheme);
    if (mode) core.setMode(mode);
    if (readOnly !== undefined) core.setReadOnly(readOnly);
    if (freeMode !== undefined) core.setFreeMode(freeMode);
    if (soloMode !== undefined) core.setSoloMode(soloMode);
    if (playerColor) core.setPlayerColor(playerColor);
    if (preserveShapesOnPositionChange !== undefined) {
      core.setPreserveShapesOnPositionChange(preserveShapesOnPositionChange);
    }
  }, [
    pieceSet,
    boardTheme,
    mode,
    readOnly,
    freeMode,
    soloMode,
    playerColor,
    preserveShapesOnPositionChange,
  ]);

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
        const cb = callbacksRef.current;
        switch (event) {
          case 'move':
            return cb.onMove?.(args[0] as Move);
          case 'turn-change':
            return cb.onTurnChange?.(args[0] as 'white' | 'black', args[1] as number);
          case 'check':
            return cb.onCheck?.(args[0] as string);
          case 'checkmate':
            return cb.onCheckmate?.(args[0] as string);
          case 'stalemate':
            return cb.onStalemate?.();
          case 'draw':
            return cb.onDraw?.();
          case 'promotion':
            return cb.onPromotion?.(args[0] as { from: string; to: string; promotedTo: string });
          case 'stockfish-hint':
            return cb.onStockfishHint?.(args[0] as string);
          case 'evaluation':
            return cb.onEvaluation?.(args[0] as StockfishEvaluation);
          case 'engine-status':
            return cb.onEngineStatus?.(args[0] as EngineStatus);
          case 'game-review-progress':
            return cb.onGameReviewProgress?.(args[0] as number);
          case 'square-click':
            return cb.onSquareClick?.(args[0] as string);
          case 'shapes-change':
            return cb.onShapesChange?.(args[0] as DrawShape[]);
        }
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
    callbacksRef.current.onBoardCreated?.(core);

    return () => {
      core.destroy();
      coreRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
