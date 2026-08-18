export type BoardMode = 'editor' | 'game' | 'study';

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
  comments?: string[];
}

export interface PgnTreeNode {
  san?: string;
  fen: string;
  move?: Move;
  comments?: string[];
  variations: PgnTreeNode[];
}
