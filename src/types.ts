import type { BoardCore } from './BoardCore';
import type { DrawShape } from '@lichess-org/chessground/draw';

export type BoardMode = 'editor' | 'game' | 'study';

export const AVAILABLE_PIECE_SETS = [
  'maestro',
  'merida',
  'alpha',
  'cburnett',
  'cardinal',
  'dubrovny',
  'fantasy',
  'firi',
  'tatiana',
  'staunty',
] as const;
export type PieceSet = (typeof AVAILABLE_PIECE_SETS)[number] | (string & {});

export const AVAILABLE_BOARD_THEMES = [
  'brown',
  'blue',
  'green',
  'ic',
  'grey',
  'purple',
  'wood',
  'wood3',
  'maple',
] as const;
export type BoardTheme = (typeof AVAILABLE_BOARD_THEMES)[number] | (string & {});

export interface Move {
  from: string;
  to: string;
  piece: string;
  color: 'w' | 'b';
  san: string;
  lan?: string;
  captured?: string;
  promotion?: string;
  before: string;
  after: string;
  turnColor?: 'white' | 'black';
  ply?: number;
  isCheck?: boolean;
}

export interface PgnNodeMeta {
  san: string;
  fen: string;
  move: Move;
  comments?: string[];
  startingComments?: string[];
  nags?: number[];
}

export interface VariationInfo {
  index: number;
  san: string;
  fen: string;
  move: Move;
  isMainline: boolean;
  isActive?: boolean;
  comments?: string[];
}

export interface PgnTreeNode {
  san?: string;
  fen: string;
  move?: Move;
  comments?: string[];
  variations: PgnTreeNode[];
}

export interface PromotionDetail {
  from: string;
  to: string;
  promotedTo: string;
}

export interface BoardEvents {
  onBoardCreated?: (api: BoardCore) => void;
  onMove?: (move: Move) => void;
  onTurnChange?: (turnColor: 'white' | 'black', ply: number) => void;
  onCheck?: (color: string) => void;
  onCheckmate?: (color: string) => void;
  onStalemate?: () => void;
  onDraw?: () => void;
  onPromotion?: (detail: PromotionDetail) => void;
  onStockfishHint?: (bestMove: string) => void;
  onEvaluation?: (evaluation: StockfishEvaluation) => void;
  onEngineStatus?: (status: EngineStatus) => void;
  onGameReviewProgress?: (percent: number) => void;
  onSquareClick?: (square: string) => void;
  onShapesChange?: (shapes: DrawShape[]) => void;
}

export type EngineStatus =
  'uninitialized' | 'loading' | 'ready' | 'searching' | 'stopping' | 'error';

export interface StockfishEvaluation {
  ply: number;
  fen: string;
  depth: number;
  seldepth?: number;
  scoreType: 'cp' | 'mate';
  scoreValue: number;
  whiteScoreValue: number;
  winChancePercentage: number;
  wdl?: [number, number, number];
  bestMove?: string;
  pv: string[];
  multipvIndex: number;
  nodes?: number;
  nps?: number;
  time?: number;
}

export type MoveJudgement =
  'brilliant' | 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | 'missed_win';

export interface MoveAnalysisReport {
  ply: number;
  san: string;
  uci: string;
  color: 'white' | 'black';
  judgement: MoveJudgement;
  playedMoveScore: number;
  bestMoveScore: number;
  diffPercentage: number;
  bestMoveUci: string;
  bestMoveSan: string;
  comment?: string;
}

export interface GameReviewReport {
  accuracy: {
    white: number;
    black: number;
  };
  summary: {
    white: Record<MoveJudgement, number>;
    black: Record<MoveJudgement, number>;
  };
  moves: MoveAnalysisReport[];
  evalGraph: { ply: number; whiteWinChance: number }[];
}
