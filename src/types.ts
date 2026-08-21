export type BoardMode = 'editor' | 'game' | 'study';

export const AVAILABLE_PIECE_SETS = [
  'staunton',
  'merida',
  'alpha',
  'cburnett',
  'cardinal',
  'dubrovny',
  'maestro',
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
