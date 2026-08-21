import type { Move } from '../types';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';

export interface DomainEvents {
  'move-executed': {
    move: Move;
    turnColor: 'white' | 'black';
    ply: number;
    isCheck: boolean;
    isGameOver: boolean;
    isCheckmate: boolean;
    isStalemate: boolean;
    isDraw: boolean;
  };
  'turn-changed': {
    turnColor: 'white' | 'black';
    ply: number;
  };
  'position-changed': {
    fen: string;
    posUpdated: boolean;
  };
  'history-navigated': {
    ply: number;
    fen: string;
    isViewingHistory: boolean;
    lastMove?: [Key, Key];
  };
  'shapes-changed': {
    shapes: DrawShape[];
  };
  'comment-changed': {
    comment: string;
    ply: number;
  };
  'stockfish-hint': {
    bestMove: string;
  };
  'square-clicked': {
    square: Key;
  };
  'promotion-required': {
    from: string;
    to: string;
    promotedTo: string;
  };
  'state-changed': void;
}

export type DomainEventCallback<T> = (data: T) => void;

type UntypedCallback = (data: unknown) => void;

export class DomainEventBus {
  private listeners = new Map<keyof DomainEvents, Set<UntypedCallback>>();

  public on<K extends keyof DomainEvents>(
    event: K,
    callback: DomainEventCallback<DomainEvents[K]>
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback as UntypedCallback);

    return () => {
      this.off(event, callback);
    };
  }

  public off<K extends keyof DomainEvents>(
    event: K,
    callback: DomainEventCallback<DomainEvents[K]>
  ): void {
    this.listeners.get(event)?.delete(callback as UntypedCallback);
  }

  public emit<K extends keyof DomainEvents>(event: K, data?: DomainEvents[K]): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const cb of Array.from(callbacks)) {
        cb(data);
      }
    }
  }

  public clear(): void {
    this.listeners.clear();
  }
}
