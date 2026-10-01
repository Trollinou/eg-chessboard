// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BoardCore, type BoardCoreState } from '../src/BoardCore';

describe('BoardCore (Façade & Lifecycle)', () => {
  let container: HTMLElement;
  let core: BoardCore;
  let state: BoardCoreState;
  let stateChanges: number;
  let emittedEvents: Array<{ event: string; args: unknown[] }>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    stateChanges = 0;
    emittedEvents = [];

    state = {
      showThreats: false,
      mode: 'game',
      playerColor: 'white',
      freeMode: false,
      soloMode: false,
      readOnly: false,
      preserveShapesOnPositionChange: false,
      pieceSet: 'cburnett',
      boardTheme: 'brown',
      promotionDialogState: { isEnabled: false },
      historyViewerState: { isEnabled: false },
      currentComment: '',
      turnColor: 'white',
      ply: 0,
      fen: '',
      isCheck: false,
      isGameOver: false,
    };

    core = new BoardCore(
      container,
      state,
      () => {
        stateChanges++;
      },
      (event, ...args) => {
        emittedEvents.push({ event, args });
      }
    );
  });

  afterEach(() => {
    core?.destroy();
    container?.remove();
  });

  describe('State Immutability & Façade Contract', () => {
    it('returns frozen state snapshot via getState()', () => {
      const coreState = core.getState();
      expect(coreState).toBeDefined();
      expect(Object.isFrozen(coreState)).toBe(true);
      expect(coreState.turnColor).toBe('white');
      expect(coreState.ply).toBe(0);
    });

    it('updates piece set and board theme dynamically', () => {
      expect(core.getPieceSet()).toBe('cburnett');
      core.setPieceSet('merida');
      expect(core.getPieceSet()).toBe('merida');

      expect(core.getBoardTheme()).toBe('brown');
      core.setBoardTheme('blue');
      expect(core.getBoardTheme()).toBe('blue');
    });

    it('toggles readOnly mode', () => {
      expect(core.isReadOnly()).toBe(false);
      core.setReadOnly(true);
      expect(core.isReadOnly()).toBe(true);
      expect(core.getState().readOnly).toBe(true);
    });
  });

  describe('Move Execution & Game Control', () => {
    it('executes valid moves and emits move events', () => {
      const moved = core.move({ from: 'e2', to: 'e4' });
      expect(moved).toBe(true);
      expect(core.getTurnColor()).toBe('black');
      expect(core.getCurrentPlyNumber()).toBe(1);

      const moveEvent = emittedEvents.find((e) => e.event === 'move');
      expect(moveEvent).toBeDefined();
      expect((moveEvent?.args[0] as { san: string }).san).toBe('e4');
    });

    it('rejects invalid moves', () => {
      const moved = core.move({ from: 'e2', to: 'e5' });
      expect(moved).toBe(false);
      expect(core.getCurrentPlyNumber()).toBe(0);
    });

    it('resets board and tree with newGame()', () => {
      core.move({ from: 'e2', to: 'e4' });
      expect(core.getCurrentPlyNumber()).toBe(1);

      core.newGame();
      expect(core.getCurrentPlyNumber()).toBe(0);
      expect(core.getTurnColor()).toBe('white');
    });
  });

  describe('Diagram Management (FEN + Shapes)', () => {
    it('sets and retrieves diagram position and shapes', () => {
      const diagram = {
        fen: '8/8/8/4k3/8/4K3/8/8 w - - 0 1',
        shapes: [{ orig: 'e3' as const, dest: 'e5' as const, brush: 'green' }],
      };

      core.setDiagram(diagram);
      expect(core.getPlacementFen()).toBe('8/8/8/4k3/8/4K3/8/8');
    });
  });

  describe('Lifecycle Cleanup (destroy)', () => {
    it('cleans up resources and is safe against multiple destroy calls', () => {
      expect(() => {
        core.destroy();
        core.destroy();
      }).not.toThrow();
    });
  });
});
