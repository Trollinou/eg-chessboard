import type { Api } from '@lichess-org/chessground/api';
import type { Key } from '@lichess-org/chessground/types';
import type { ChildNode } from 'chessops/pgn';
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

  public resetState(): void {
    this.state = { isEnabled: false };
  }

  public viewHistory(
    ply: number,
    path: ChildNode<PgnNodeMeta>[],
    rootFen: string,
    board: Api | null,
    onStateChange: () => void,
    updateCommentAndShapes: (fenViewing: string) => void
  ): void {
    if (ply < 0 || ply > path.length) return;

    if (ply < path.length) {
      this.state = {
        isEnabled: true,
        plyViewing: ply,
        viewOnly: board?.state?.viewOnly,
      };
      onStateChange();

      const fenViewing = ply === 0 ? rootFen : path[ply - 1].data.fen;

      if (board) {
        board.set({
          fen: fenViewing,
          viewOnly: false,
          movable: {
            color: undefined,
            dests: undefined,
            free: false,
          },
          lastMove:
            ply > 0
              ? [path[ply - 1].data.move.from as Key, path[ply - 1].data.move.to as Key]
              : undefined,
        });
      }

      updateCommentAndShapes(fenViewing);
    } else {
      this.stopViewingHistory(board, onStateChange, () => {});
    }
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
}
