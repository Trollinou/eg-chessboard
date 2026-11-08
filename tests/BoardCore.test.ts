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

    it('tracks soloHistory in soloMode', () => {
      core.setSoloMode(true);
      core.move({ from: 'e2', to: 'e4' });
      core.move({ from: 'd2', to: 'd4' });

      expect(core.getSoloHistory()).toHaveLength(2);
      expect(core.getSoloHistory()[0].san).toBe('e4');
      expect(core.getSoloHistory()[1].san).toBe('d4');

      core.undoLastMove();
      expect(core.getSoloHistory()).toHaveLength(1);
      expect(core.getSoloHistory()[0].san).toBe('e4');

      core.newGame();
      expect(core.getSoloHistory()).toHaveLength(0);
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

  describe('Glyph Management via Facade', () => {
    it('sets, retrieves and clears glyphs through BoardCore', () => {
      core.setGlyph('e4', 'trapped');
      expect(core.getGlyph('e4')).toBe('trapped');

      const glyphs = core.getGlyphs();
      expect(glyphs.size).toBe(1);
      expect(glyphs.get('e4')).toBe('trapped');

      core.clearGlyphs();
      expect(core.getGlyphs().size).toBe(0);
    });
  });

  describe('Resignation & Draw via Façade', () => {
    it('handles resign() and emits resign event', () => {
      const res = core.resign('white');
      expect(res).toBe(true);

      const resignEvent = emittedEvents.find((e) => e.event === 'resign');
      expect(resignEvent).toBeDefined();
      expect(resignEvent?.args[0]).toEqual({ color: 'white', winner: 'black' });

      const stateSnapshot = core.getState();
      expect(stateSnapshot.isGameOver).toBe(true);
      expect(stateSnapshot.termination?.reason).toBe('resignation');
      expect(core.getGameOverReason('fr')).toBe('Abandon des Blancs. Les Noirs ont gagné.');
    });

    it('handles agreeDraw() and emits draw event', () => {
      const res = core.agreeDraw();
      expect(res).toBe(true);

      const drawEvent = emittedEvents.find((e) => e.event === 'draw');
      expect(drawEvent).toBeDefined();

      const stateSnapshot = core.getState();
      expect(stateSnapshot.isGameOver).toBe(true);
      expect(stateSnapshot.termination?.reason).toBe('mutual_agreement');
      expect(core.getGameOverReason('fr')).toBe('Match nul par accord mutuel.');
    });

    it('handles offerDraw() in Human vs Human mode by emitting draw-offer', async () => {
      const result = await core.offerDraw('white');
      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('pending_opponent');

      const drawOfferEvent = emittedEvents.find((e) => e.event === 'draw-offer');
      expect(drawOfferEvent).toBeDefined();
      expect(drawOfferEvent?.args[0]).toBe('white');
    });

    it('handles declineDraw() by emitting draw-declined', () => {
      core.declineDraw('black', 'advantage');

      const declinedEvent = emittedEvents.find((e) => e.event === 'draw-declined');
      expect(declinedEvent).toBeDefined();
      expect(declinedEvent?.args[0]).toEqual({ byColor: 'black', reason: 'advantage' });
    });
  });

  describe('Coach Mode (coachMode, coachUndo, coachProceed, lastSuggestedMove immunity)', () => {
    it('intercepts a hanging piece move, pauses Stockfish, sets glyphs and emits coach-alert', () => {
      core.updateStockfishConfig({
        whiteMode: 'disabled',
        blackMode: 'elo',
        blackElo: 1350,
        coachMode: true,
      });

      // 1. e4 e5 2. Qh5 Nc6 3. Qg6?? (hanging Queen on g6)
      core.setPosition(
        'r1bqkbnr/pppp1ppp/2n5/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 2 3'
      );
      emittedEvents = [];

      core.move('Qg6');

      expect(core.getState().isCoachPaused).toBe(true);
      expect(core.getGlyph('g6')).toBe('??');

      const alertEvent = emittedEvents.find((e) => e.event === 'coach-alert');
      expect(alertEvent).toBeDefined();
      expect(alertEvent?.args[0]).toMatchObject({
        ply: 1,
        judgement: 'blunder',
        glyph: '??',
        reason: 'hanging_piece',
        undefendedSquares: ['g6'],
      });

      // Undo via coachUndo()
      const undone = core.coachUndo();
      expect(undone).toBe(true);
      expect(core.getState().isCoachPaused).toBe(false);
      expect(core.getGlyph('g6')).toBeNull();
      expect(core.getTurnColor()).toBe('white');
    });

    it('detects bad_trade when capturing a defended lesser piece with a higher value piece', () => {
      core.updateStockfishConfig({
        whiteMode: 'disabled',
        blackMode: 'elo',
        coachMode: true,
      });

      // White Queen on b5 captures defended Black Knight on c6
      core.setPosition(
        'r1bqkbnr/pppp1ppp/2n5/1Q2p3/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 2 3'
      );
      emittedEvents = [];

      core.move('Qxc6');

      expect(core.getState().isCoachPaused).toBe(true);
      const alertEvent = emittedEvents.find((e) => e.event === 'coach-alert');
      expect(alertEvent).toBeDefined();
      expect(alertEvent?.args[0]).toMatchObject({
        reason: 'bad_trade',
        glyph: '??',
        undefendedSquares: ['c6'],
      });

      // Confirm via coachProceed()
      core.coachProceed();
      expect(core.getState().isCoachPaused).toBe(false);
    });

    it('grants immunity to Stockfish suggested move (lastSuggestedMove) and marks it with !', () => {
      core.updateStockfishConfig({
        whiteMode: 'disabled',
        blackMode: 'elo',
        coachMode: true,
      });

      core.setPosition(
        'r1bqkbnr/pppp1ppp/2n5/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 2 3'
      );
      core.lastSuggestedMove = 'h5g6';
      emittedEvents = [];

      core.move('Qg6');

      expect(core.getState().isCoachPaused).toBe(false);
      expect(core.getGlyph('g6')).toBe('!');
      expect(emittedEvents.find((e) => e.event === 'coach-alert')).toBeUndefined();
      expect(core.lastSuggestedMove).toBe('');
    });

    it('marks checkmate move with ! and never pauses coach', () => {
      core.updateStockfishConfig({
        whiteMode: 'disabled',
        blackMode: 'elo',
        coachMode: true,
      });

      core.setPosition(
        'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4'
      );
      emittedEvents = [];

      core.move('Qxf7#');

      expect(core.getIsCheckmate()).toBe(true);
      expect(core.getState().isCoachPaused).toBe(false);
      expect(core.getGlyph('f7')).toBe('!');
      expect(emittedEvents.find((e) => e.event === 'coach-alert')).toBeUndefined();
    });
  });
});
