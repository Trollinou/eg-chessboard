import type { DrawShape } from '@lichess-org/chessground/draw';
import { Chess } from 'chessops';
import type { Color as ChessopsColor } from 'chessops/types';
import type { Config } from '@lichess-org/chessground/config';
import type { Key, MoveMetadata } from '@lichess-org/chessground/types';
import type { Api } from '@lichess-org/chessground/api';

import { possibleMoves } from '../BoardHelper';
import type { Move } from '../types';
import type { BoardCoreState } from '../BoardCore';
import { FenManager } from './FenManager';
import { AnnotationManager } from './AnnotationManager';
import type { ExerciseManager } from './ExerciseManager';
import type { HistoryViewerManager } from './HistoryViewerManager';
import type { PgnTreeManager } from './PgnTreeManager';

export interface BoardConfigContext {
  state: BoardCoreState;
  pos: Chess;
  board?: Api;
  exerciseManager: ExerciseManager;
  historyViewerManager: HistoryViewerManager;
  annotationManager: AnnotationManager;
  pgnTreeManager: PgnTreeManager;
  userMovableColor?: 'white' | 'black' | 'both';
  setUserMovableColor: (color?: 'white' | 'black' | 'both') => void;
  getTurnColor: () => 'white' | 'black';
  getCurrentPlyNumber: () => number;
  getFen: () => string;
  getPlacementFen: () => string;
  getMode: () => string;
  getShapes: () => DrawShape[];
  getLastMove: () => Move | null;
  changeTurn: (orig: Key, dest: Key, metadata: MoveMetadata) => Promise<void>;
  handleDrawableChange: (shapes: unknown[]) => void;
  drawThreats: () => void;
  updateCommentAndShapes: (fenStr: string) => void;
  emitEvent: (event: string, ...args: unknown[]) => void;
  checkUnpromotedPawns: () => Promise<void>;
  setPos: (pos: Chess) => void;
}

export class BoardConfigBuilder {
  private isSyncing = false;

  public buildConfig(userConfig: Config, ctx: BoardConfigContext): Config {
    const defaultEvents = {
      after: (orig: Key, dest: Key, metadata: MoveMetadata) => {
        ctx.changeTurn(orig, dest, metadata);
      },
    };

    const isFree = !!ctx.state.freeMode;

    if (userConfig.movable?.color !== undefined) {
      ctx.setUserMovableColor(userConfig.movable.color as 'white' | 'black' | 'both');
    }

    const mergedMovable = {
      free: isFree,
      color: (isFree ? 'both' : ctx.userMovableColor || ctx.getTurnColor()) as
        'white' | 'black' | 'both',
      dests: isFree ? FenManager.getPossibleMovesForBothColors(ctx.pos) : possibleMoves(ctx.pos),
      events: defaultEvents,
      ...(userConfig.movable || {}),
    };

    if (userConfig.movable?.events) {
      mergedMovable.events = {
        ...defaultEvents,
        ...userConfig.movable.events,
      };
    }

    const mergedEvents = {
      change: () => {
        if (ctx.state.freeMode) {
          this.syncGameFromBoard(ctx);
        }
      },
      select: () => {},
      ...(userConfig.events || {}),
    };

    const userSelect = userConfig.events?.select;
    if (userSelect) {
      mergedEvents.select = (key: Key) => {
        userSelect(key);
      };
    }

    const userChange = userConfig.events?.change;
    if (userChange) {
      mergedEvents.change = () => {
        if (ctx.state.freeMode) {
          this.syncGameFromBoard(ctx);
        }
        userChange();
      };
    }

    const mode = ctx.getMode();
    const isPreserve = !!ctx.state.preserveShapesOnPositionChange;
    const defaultSnap = mode === 'game';

    const mergedDrawable = {
      enabled: true,
      defaultSnapToValidMove: defaultSnap,
      eraseOnMovablePieceClick: !isPreserve,
      onChange: (shapes: unknown[]) => {
        ctx.handleDrawableChange(shapes);
      },
      ...(userConfig.drawable || {}),
    };

    const config: Config = {
      fen: ctx.getFen(),
      turnColor: ctx.getTurnColor(),
      ...userConfig,
      movable: mergedMovable,
      events: mergedEvents,
      drawable: mergedDrawable,
    };

    return config;
  }

  public syncGameFromBoard(ctx: BoardConfigContext): void {
    if (this.isSyncing) return;
    this.isSyncing = true;
    try {
      const placement = ctx.getPlacementFen();
      const currentFenParts = ctx.getFen().split(' ');
      const turn = currentFenParts[1] || 'w';
      const castling = currentFenParts[2] || '-';
      const ep = currentFenParts[3] || '-';
      const halfmove = currentFenParts[4] || '0';
      const fullmove = currentFenParts[5] || '1';

      const newFen = `${placement} ${turn} ${castling} ${ep} ${halfmove} ${fullmove}`;

      FenManager.safeLoadFen(newFen, (pos) => {
        ctx.setPos(pos);
        ctx.pgnTreeManager.resetTree(pos);
      });

      const isPreserve = !!ctx.state.preserveShapesOnPositionChange || ctx.getMode() === 'editor';
      if (isPreserve && ctx.board) {
        ctx.annotationManager.applyBoardShapes(
          ctx.annotationManager.getPreservedShapes(),
          ctx.board,
          true
        );
      }

      ctx.emitEvent('move', {
        after: newFen,
      });

      ctx.checkUnpromotedPawns();
    } finally {
      this.isSyncing = false;
    }
  }

  public updateGameState(ctx: BoardConfigContext, { updateFen = true, animate = true } = {}): void {
    if (!ctx.historyViewerManager.isViewingHistory()) {
      const isPreserve = !!ctx.state.preserveShapesOnPositionChange || ctx.getMode() === 'editor';
      const currentShapes = ctx.getShapes();
      const savedShapes = isPreserve ? [...currentShapes] : null;

      const isFree = !!ctx.state.freeMode;
      const isSolo = !!ctx.state.soloMode;

      if (
        isSolo &&
        ctx.userMovableColor &&
        (ctx.userMovableColor === 'white' || ctx.userMovableColor === 'black')
      ) {
        const requiredTurn: ChessopsColor = ctx.userMovableColor === 'white' ? 'white' : 'black';
        if (ctx.pos.turn !== requiredTurn) {
          ctx.pos.turn = requiredTurn;
        }
      }

      const lastMove = ctx.getLastMove();

      if (ctx.board) {
        ctx.board.set({
          ...(updateFen ? { fen: ctx.getFen() } : {}),
          turnColor: ctx.getTurnColor(),
          check: ctx.pos.isCheck() ? ctx.getTurnColor() : undefined,
          animation: { enabled: animate && !isPreserve && !isFree },
          lastMove: lastMove ? [lastMove.from as Key, lastMove.to as Key] : undefined,
          movable: {
            free: isFree,
            color: isFree ? 'both' : ctx.userMovableColor || ctx.getTurnColor(),
            dests:
              ctx.exerciseManager.getCustomDests() ||
              (isFree || (isSolo && (!ctx.userMovableColor || ctx.userMovableColor === 'both'))
                ? FenManager.getPossibleMovesForBothColors(ctx.pos)
                : possibleMoves(ctx.pos)),
          },
          drawable: {
            eraseOnMovablePieceClick: !isPreserve,
            defaultSnapToValidMove: ctx.getMode() === 'game',
            ...(savedShapes
              ? {
                  autoShapes: [],
                  shapes: savedShapes,
                }
              : {}),
          },
        });

        if (savedShapes) {
          ctx.annotationManager.applyBoardShapes(savedShapes, ctx.board, true);
        }
      }

      if (ctx.state.showThreats) {
        ctx.drawThreats();
      } else if (!savedShapes) {
        ctx.updateCommentAndShapes(ctx.getFen());
      }
      ctx.checkUnpromotedPawns();
    }

    this.emitEvents(ctx);
  }

  public emitEvents(ctx: BoardConfigContext): void {
    ctx.emitEvent('turn-change', ctx.getTurnColor(), ctx.getCurrentPlyNumber());
    if (ctx.pos.isCheck()) {
      ctx.emitEvent(ctx.pos.isCheckmate() ? 'checkmate' : 'check', ctx.getTurnColor());
    }
    if (ctx.pos.isStalemate()) {
      ctx.emitEvent('stalemate');
    } else if (ctx.pos.isEnd()) {
      ctx.emitEvent('draw');
    }
  }
}
