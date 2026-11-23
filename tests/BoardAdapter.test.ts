// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BoardAdapter } from '../src/core/BoardAdapter';
import { DomainEventBus } from '../src/core/DomainEventBus';
import { GameSession } from '../src/core/GameSession';
import { AnnotationService } from '../src/core/AnnotationService';

function createTestAdapter(element: HTMLElement, initialConfig = {}) {
  const eventBus = new DomainEventBus();
  const session = new GameSession(eventBus);
  const annotationService = new AnnotationService(eventBus, session);
  return new BoardAdapter(
    element,
    eventBus,
    session,
    annotationService,
    () => ({ mode: 'game', playerColor: 'white' }),
    async () => 'q',
    undefined,
    initialConfig
  );
}

describe('BoardAdapter Cross-Document / Iframe (Gutenberg apiVersion 3)', () => {
  let iframeDoc: Document;
  let adapters: BoardAdapter[];

  beforeEach(() => {
    iframeDoc = document.implementation.createHTMLDocument('gutenberg-canvas');
    adapters = [];
  });

  afterEach(() => {
    for (const adapter of adapters) {
      adapter.destroy();
    }
    adapters = [];
    vi.restoreAllMocks();
  });

  it('sets trustAllEvents automatically when mounted in a separate ownerDocument unless overridden', () => {
    const el1 = iframeDoc.createElement('div');
    iframeDoc.body.appendChild(el1);
    const adapter1 = createTestAdapter(el1);
    adapters.push(adapter1);

    expect(adapter1.board.state.trustAllEvents).toBe(true);

    const el2 = iframeDoc.createElement('div');
    iframeDoc.body.appendChild(el2);
    const adapter2 = createTestAdapter(el2, { trustAllEvents: false });
    adapters.push(adapter2);

    expect(adapter2.board.state.trustAllEvents).toBe(false);
  });

  it('relays mousemove and mouseup from ownerDocument to parent document only while interacting', () => {
    const el = iframeDoc.createElement('div');
    iframeDoc.body.appendChild(el);
    const adapter = createTestAdapter(el);
    adapters.push(adapter);

    const parentMoves: MouseEvent[] = [];
    const parentUps: MouseEvent[] = [];
    const onParentMove = (e: Event) => parentMoves.push(e as MouseEvent);
    const onParentUp = (e: Event) => parentUps.push(e as MouseEvent);
    document.addEventListener('mousemove', onParentMove);
    document.addEventListener('mouseup', onParentUp);

    try {
      // Idle: must not relay
      iframeDoc.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 20 }));
      iframeDoc.dispatchEvent(new MouseEvent('mouseup', { clientX: 10, clientY: 20 }));
      expect(parentMoves).toHaveLength(0);
      expect(parentUps).toHaveLength(0);

      // Active drag on this instance: must relay
      (adapter.board.state.draggable as { current?: unknown }).current = { orig: 'e2' };
      iframeDoc.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 120, clientY: 240, buttons: 1 })
      );
      iframeDoc.dispatchEvent(new MouseEvent('mouseup', { clientX: 125, clientY: 245, button: 0 }));

      expect(parentMoves).toHaveLength(1);
      expect(parentMoves[0].clientX).toBe(120);
      expect(parentMoves[0].clientY).toBe(240);
      expect(parentUps).toHaveLength(1);
      expect(parentUps[0].clientX).toBe(125);
      expect(parentUps[0].clientY).toBe(245);

      // Active draw on this instance: must also relay
      (adapter.board.state.draggable as { current?: unknown }).current = undefined;
      (adapter.board.state.drawable as { current?: unknown }).current = { orig: 'e2' };
      iframeDoc.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 60 }));
      expect(parentMoves).toHaveLength(2);
    } finally {
      document.removeEventListener('mousemove', onParentMove);
      document.removeEventListener('mouseup', onParentUp);
    }
  });

  it('relays touchmove and touchend with touch coordinates while interacting', () => {
    const el = iframeDoc.createElement('div');
    iframeDoc.body.appendChild(el);
    const adapter = createTestAdapter(el);
    adapters.push(adapter);

    const parentTouchMoves: Array<Event & { clientX?: number; clientY?: number }> = [];
    const parentTouchEnds: Array<Event & { clientX?: number; clientY?: number }> = [];
    const onMove = (e: Event) =>
      parentTouchMoves.push(e as Event & { clientX?: number; clientY?: number });
    const onEnd = (e: Event) =>
      parentTouchEnds.push(e as Event & { clientX?: number; clientY?: number });
    document.addEventListener('touchmove', onMove);
    document.addEventListener('touchend', onEnd);

    try {
      (adapter.board.state.draggable as { current?: unknown }).current = { orig: 'e2' };

      const touchMove = new Event('touchmove', { bubbles: true, cancelable: true });
      Object.defineProperty(touchMove, 'targetTouches', {
        value: [{ clientX: 88, clientY: 99 }],
      });
      iframeDoc.dispatchEvent(touchMove);

      const touchEnd = new Event('touchend', { bubbles: true, cancelable: true });
      Object.defineProperty(touchEnd, 'changedTouches', {
        value: [{ clientX: 90, clientY: 100 }],
      });
      iframeDoc.dispatchEvent(touchEnd);

      expect(parentTouchMoves).toHaveLength(1);
      expect(parentTouchMoves[0].clientX).toBe(88);
      expect(parentTouchMoves[0].clientY).toBe(99);
      expect(parentTouchEnds).toHaveLength(1);
      expect(parentTouchEnds[0].clientX).toBe(90);
      expect(parentTouchEnds[0].clientY).toBe(100);
    } finally {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    }
  });

  it('isolates multiple board instances in the same ownerDocument (only active instance relays)', () => {
    const el1 = iframeDoc.createElement('div');
    const el2 = iframeDoc.createElement('div');
    iframeDoc.body.appendChild(el1);
    iframeDoc.body.appendChild(el2);

    const adapter1 = createTestAdapter(el1);
    const adapter2 = createTestAdapter(el2);
    adapters.push(adapter1, adapter2);

    const relayedMoves: Event[] = [];
    const relayedUps: Event[] = [];
    const onMove = (e: Event) => relayedMoves.push(e);
    const onUp = (e: Event) => relayedUps.push(e);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);

    try {
      // Neither interacting -> 0 relayed events
      iframeDoc.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
      expect(relayedMoves).toHaveLength(0);

      // Only adapter1 interacting -> relayed exactly once
      (adapter1.board.state.draggable as { current?: unknown }).current = { orig: 'd2' };
      (adapter2.board.state.draggable as { current?: unknown }).current = undefined;

      iframeDoc.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 300 }));
      iframeDoc.dispatchEvent(new MouseEvent('mouseup', { clientX: 200, clientY: 300 }));

      expect(relayedMoves).toHaveLength(1);
      expect(relayedUps).toHaveLength(1);
    } finally {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
  });

  it('clears DOM bounds on scroll in ownerDocument and removes all listeners on destroy()', () => {
    const el = iframeDoc.createElement('div');
    iframeDoc.body.appendChild(el);
    const adapter = createTestAdapter(el);
    adapters.push(adapter);

    const clearSpy = vi.spyOn(adapter, 'clearDomBounds');
    iframeDoc.dispatchEvent(new Event('scroll'));
    expect(clearSpy).toHaveBeenCalledTimes(1);

    const relayedMoves: Event[] = [];
    const onMove = (e: Event) => relayedMoves.push(e);
    document.addEventListener('mousemove', onMove);

    try {
      (adapter.board.state.draggable as { current?: unknown }).current = { orig: 'e2' };
      adapter.destroy();
      clearSpy.mockClear();

      iframeDoc.dispatchEvent(new Event('scroll'));
      iframeDoc.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 40 }));

      expect(clearSpy).not.toHaveBeenCalled();
      expect(relayedMoves).toHaveLength(0);
    } finally {
      document.removeEventListener('mousemove', onMove);
    }
  });
});
