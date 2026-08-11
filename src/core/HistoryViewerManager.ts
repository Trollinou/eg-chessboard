import type { Api } from '@lichess-org/chessground/api';
import type { Key } from '@lichess-org/chessground/types';
import type { ChildNode } from 'chessops/pgn';
import { possibleMoves } from '../BoardHelper';
import { FenManager } from './FenManager';
import type { Move, PgnNodeMeta } from '../types';

export interface HistoryViewerState {
  isEnabled: boolean;
  plyViewing?: number;
  viewOnly?: boolean;
}

export class HistoryViewerManager {
  private state: HistoryViewerState = { isEnabled: false };

  public getState(): Readonly<HistoryViewerState> {
    return { ...this.state };
  }

  public isViewingHistory(): boolean {
    return this.state.isEnabled;
  }

  /**
   * Returns the ply currently being viewed, or the fallback value if not viewing history.
   * Centralizes the repeated ternary pattern for ply resolution.
   */
  public getCurrentViewingPly(fallbackPly: number): number {
    return this.state.isEnabled && this.state.plyViewing !== undefined
      ? this.state.plyViewing
      : fallbackPly;
  }

  public resetState(): void {
    this.state = { isEnabled: false };
  }

  public viewHistory(
    ply: number,
    path: ChildNode<PgnNodeMeta>[],
    rootFen: string,
    board: Api | null,
    onStateChange: () => void,
    updateCommentAndShapes: (fenViewing: string) => void,
    opts?: { isReadOnly?: boolean; freeMode?: boolean }
  ): void {
    if (ply < 0 || ply > path.length) return;

    this.state = {
      isEnabled: true,
      plyViewing: ply,
      viewOnly: board?.state?.viewOnly,
    };
    onStateChange();

    const fenViewing = ply === 0 ? rootFen : path[ply - 1].data.fen;
    const isReadOnly = opts?.isReadOnly ?? true;

    if (board) {
      let movableColor: 'white' | 'black' | 'both' | undefined = undefined;
      let movableDests: Map<Key, Key[]> | undefined = undefined;

      if (!isReadOnly) {
        const res = FenManager.safeLoadFen(fenViewing, () => {});
        const posViewing = res.pos;
        const turnColor = posViewing.turn === 'white' ? 'white' : 'black';
        movableColor = opts?.freeMode ? 'both' : turnColor;
        movableDests = opts?.freeMode
          ? FenManager.getPossibleMovesForBothColors(posViewing)
          : possibleMoves(posViewing);
      }

      board.set({ fen: '' });
      board.set({
        fen: fenViewing,
        viewOnly: false,
        movable: {
          color: movableColor,
          dests: movableDests,
          free: !!opts?.freeMode,
        },
        lastMove:
          ply > 0
            ? [path[ply - 1].data.move.from as Key, path[ply - 1].data.move.to as Key]
            : undefined,
      });
      board.redrawAll();
    }

    updateCommentAndShapes(fenViewing);
  }

  public stopViewingHistory(
    _board: Api | null,
    onStateChange: () => void,
    restoreCurrentState: () => void
  ): void {
    if (this.state.isEnabled) {
      this.state = { isEnabled: false };
      onStateChange();
      restoreCurrentState();
    }
  }

  public getLastMove(path: ChildNode<PgnNodeMeta>[]): Move | null {
    return path.length ? path[path.length - 1].data.move : null;
  }

  public getHistory(path: ChildNode<PgnNodeMeta>[], verbose = false): Move[] | string[] {
    if (verbose) {
      return path.map((n) => n.data.move);
    }
    return path.map((n) => n.data.san);
  }

  public viewStart(
    path: ChildNode<PgnNodeMeta>[],
    rootFen: string,
    board: Api | null,
    onStateChange: () => void,
    updateCommentAndShapes: (fenViewing: string) => void,
    opts?: { isReadOnly?: boolean; freeMode?: boolean }
  ): void {
    this.viewHistory(0, path, rootFen, board, onStateChange, updateCommentAndShapes, opts);
  }

  public viewNext(
    path: ChildNode<PgnNodeMeta>[],
    rootFen: string,
    board: Api | null,
    onStateChange: () => void,
    updateCommentAndShapes: (fenViewing: string) => void,
    opts?: { isReadOnly?: boolean; freeMode?: boolean }
  ): void {
    const ply = this.getCurrentViewingPly(0);
    if (ply < path.length) {
      this.viewHistory(ply + 1, path, rootFen, board, onStateChange, updateCommentAndShapes, opts);
    }
  }

  public viewPrevious(
    path: ChildNode<PgnNodeMeta>[],
    rootFen: string,
    board: Api | null,
    onStateChange: () => void,
    updateCommentAndShapes: (fenViewing: string) => void,
    opts?: { isReadOnly?: boolean; freeMode?: boolean }
  ): void {
    const ply = this.getCurrentViewingPly(path.length);
    if (ply > 0) {
      this.viewHistory(ply - 1, path, rootFen, board, onStateChange, updateCommentAndShapes, opts);
    }
  }
}
