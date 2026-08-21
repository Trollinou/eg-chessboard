import './style.css';

export {
  BoardCore,
  type BoardCoreState,
  type StockfishConfig,
  type ChessDiagram,
} from './BoardCore';
export type { Key } from '@lichess-org/chessground/types';
export type { DrawShape } from '@lichess-org/chessground/draw';
export type { Move, VariationInfo, PgnTreeNode, BoardMode, PieceSet } from './types';
export { AVAILABLE_PIECE_SETS } from './types';
export {
  possibleMoves,
  isPromotion,
  shortToLongColor,
  getThreats,
  getFinalFenFromPgn,
  type Threat,
} from './BoardHelper';
