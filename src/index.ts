import './style.css';

export {
  BoardCore,
  type BoardCoreState,
  type StockfishConfig,
  type ChessDiagram,
} from './BoardCore';
export type { Key } from '@lichess-org/chessground/types';
export type { DrawShape } from '@lichess-org/chessground/draw';
export {
  possibleMoves,
  isPromotion,
  shortToLongColor,
  getThreats,
  type Threat,
} from './BoardHelper';
