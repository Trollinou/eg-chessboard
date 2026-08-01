import type { Key } from '@lichess-org/chessground/types';
import type { Api } from '@lichess-org/chessground/api';

export class DomHandler {
  private boardElement: HTMLElement;
  private pointerDownState: { x: number; y: number; square: Key } | null = null;
  private domListeners: Array<{
    type: string;
    listener: EventListenerOrEventListenerObject;
    options?: boolean | AddEventListenerOptions;
  }> = [];

  constructor(boardElement: HTMLElement) {
    this.boardElement = boardElement;
  }

  public bindClickAndBoundsListeners(
    onSquareClick: (sq: Key) => void,
    clearDomBounds: () => void,
    getOrientation: () => 'white' | 'black'
  ): void {
    const addListener = (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions
    ) => {
      this.boardElement.addEventListener(type, listener, options);
      this.domListeners.push({ type, listener, options });
    };

    const onDown = (e: Event) => {
      const me = e as MouseEvent | TouchEvent;
      if ('button' in me && me.button !== 0) return;
      clearDomBounds();
      const sq = this.getSquareFromEvent(me, getOrientation());
      if (sq) {
        let clientX = 0;
        let clientY = 0;
        if ('touches' in me && me.touches && me.touches.length > 0) {
          clientX = me.touches[0].clientX;
          clientY = me.touches[0].clientY;
        } else if ('clientX' in me) {
          clientX = me.clientX;
          clientY = me.clientY;
        }
        this.pointerDownState = { x: clientX, y: clientY, square: sq };
      } else {
        this.pointerDownState = null;
      }
    };

    const onUp = (e: Event) => {
      const me = e as MouseEvent | TouchEvent;
      if ('button' in me && me.button !== 0) {
        this.pointerDownState = null;
        return;
      }
      if (!this.pointerDownState) return;

      let clientX = 0;
      let clientY = 0;
      if ('changedTouches' in me && me.changedTouches && me.changedTouches.length > 0) {
        clientX = me.changedTouches[0].clientX;
        clientY = me.changedTouches[0].clientY;
      } else if ('clientX' in me) {
        clientX = me.clientX;
        clientY = me.clientY;
      }

      const dx = clientX - this.pointerDownState.x;
      const dy = clientY - this.pointerDownState.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 10) {
        const sq = this.getSquareFromEvent(me, getOrientation()) || this.pointerDownState.square;
        if (sq) {
          onSquareClick(sq);
        }
      }
      this.pointerDownState = null;
    };

    if (typeof window !== 'undefined' && 'PointerEvent' in window) {
      addListener('pointerdown', onDown as EventListener, { capture: true });
      addListener('pointerup', onUp as EventListener, { capture: true });
    } else {
      addListener('mousedown', onDown as EventListener, { capture: true });
      addListener('mouseup', onUp as EventListener, { capture: true });
      addListener('touchstart', onDown as EventListener, { capture: true });
      addListener('touchend', onUp as EventListener, { capture: true });
    }
  }

  public getSquareFromEvent(
    e: MouseEvent | TouchEvent,
    orientation: 'white' | 'black'
  ): Key | null {
    if (!this.boardElement) return null;
    const rect = this.boardElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    let clientX = 0;
    let clientY = 0;
    if ('touches' in e && (e as TouchEvent).touches && (e as TouchEvent).touches.length > 0) {
      clientX = (e as TouchEvent).touches[0].clientX;
      clientY = (e as TouchEvent).touches[0].clientY;
    } else if (
      'changedTouches' in e &&
      (e as TouchEvent).changedTouches &&
      (e as TouchEvent).changedTouches.length > 0
    ) {
      clientX = (e as TouchEvent).changedTouches[0].clientX;
      clientY = (e as TouchEvent).changedTouches[0].clientY;
    } else if ('clientX' in e) {
      clientX = (e as MouseEvent).clientX;
      clientY = (e as MouseEvent).clientY;
    } else {
      return null;
    }

    const relX = (clientX - rect.left) / rect.width;
    const relY = (clientY - rect.top) / rect.height;

    if (relX < 0 || relX >= 1 || relY < 0 || relY >= 1) return null;

    const fileIdx = Math.floor(relX * 8);
    const rankIdx = Math.floor(relY * 8);

    const isWhite = orientation === 'white';
    const file = isWhite ? fileIdx : 7 - fileIdx;
    const rank = isWhite ? 7 - rankIdx : rankIdx;

    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    return `${files[file]}${rank + 1}` as Key;
  }

  public clearDomBounds(board: Api | null): void {
    const boardState = board as unknown as {
      state?: { dom?: { bounds?: { clear?: () => void } } };
    };
    if (boardState?.state?.dom?.bounds?.clear) {
      boardState.state.dom.bounds.clear();
    }
  }

  public destroy(): void {
    for (const { type, listener, options } of this.domListeners) {
      this.boardElement.removeEventListener(type, listener, options);
    }
    this.domListeners = [];
  }
}
