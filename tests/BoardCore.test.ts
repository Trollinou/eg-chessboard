// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

    it('grants immunity in coachMode when playing the 2nd or 3rd move from lastSuggestedMoves', () => {
      core.updateStockfishConfig({
        whiteMode: 'disabled',
        blackMode: 'elo',
        coachMode: true,
      });

      core.setPosition(
        'r1bqkbnr/pppp1ppp/2n5/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 2 3'
      );
      core.lastSuggestedMoves = ['f1c4', 'h5g6', 'd2d3'];
      emittedEvents = [];

      // Play the 2nd suggested move (h5g6)
      core.move('Qg6');

      expect(core.getState().isCoachPaused).toBe(false);
      expect(core.getGlyph('g6')).toBe('!');
      expect(emittedEvents.find((e) => e.event === 'coach-alert')).toBeUndefined();
      expect(core.lastSuggestedMoves).toEqual([]);
    });

    it('draws multi-color arrows while preserving existing shapes when drawArrows is true, and leaves shapes untouched when false', () => {
      // Place an existing circle on d5
      core.drawCircle('d5', 'red');
      expect(core.getShapes()).toEqual([{ orig: 'd5', brush: 'red' }]);

      // Emit stockfish-hint with drawArrows: false -> consuming app keeps control, only d5 circle remains
      (core as unknown as { eventBus: { emit: (ev: string, data: unknown) => void } }).eventBus.emit(
        'stockfish-hint',
        {
          bestMove: 'e2e4',
          drawArrows: false,
          hints: [
            { uci: 'e2e4', from: 'e2', to: 'e4', san: 'e4', rank: 1, brush: 'green', scoreType: 'cp', scoreValue: 30, whiteScoreValue: 30, winChancePercentage: 53, pv: ['e2e4'] },
            { uci: 'd2d4', from: 'd2', to: 'd4', san: 'd4', rank: 2, brush: 'blue', scoreType: 'cp', scoreValue: 25, whiteScoreValue: 25, winChancePercentage: 52, pv: ['d2d4'] },
          ],
        }
      );

      expect(core.getShapes()).toEqual([{ orig: 'd5', brush: 'red' }]);
      const hintEv = emittedEvents.find((e) => e.event === 'stockfish-hint');
      expect(hintEv?.args[0]).toBe('e2e4');
      expect((hintEv?.args[1] as unknown[]).length).toBe(2);

      // Emit stockfish-hint with drawArrows: true -> draws green, blue, yellow arrows AND preserves d5 circle
      (core as unknown as { eventBus: { emit: (ev: string, data: unknown) => void } }).eventBus.emit(
        'stockfish-hint',
        {
          bestMove: 'e2e4',
          drawArrows: true,
          hints: [
            { uci: 'e2e4', from: 'e2', to: 'e4', san: 'e4', rank: 1, brush: 'green', scoreType: 'cp', scoreValue: 30, whiteScoreValue: 30, winChancePercentage: 53, pv: ['e2e4'] },
            { uci: 'd2d4', from: 'd2', to: 'd4', san: 'd4', rank: 2, brush: 'blue', scoreType: 'cp', scoreValue: 25, whiteScoreValue: 25, winChancePercentage: 52, pv: ['d2d4'] },
            { uci: 'g1f3', from: 'g1', to: 'f3', san: 'Nf3', rank: 3, brush: 'yellow', scoreType: 'cp', scoreValue: 20, whiteScoreValue: 20, winChancePercentage: 51, pv: ['g1f3'] },
          ],
        }
      );

      expect(core.getShapes()).toEqual([
        { orig: 'd5', brush: 'red' },
        { orig: 'e2', dest: 'e4', brush: 'green' },
        { orig: 'd2', dest: 'd4', brush: 'blue' },
        { orig: 'g1', dest: 'f3', brush: 'yellow' },
      ]);
    });

    it('keeps programmatic hint arrows visible when clicking/deselecting a piece, while erasing right-click user arrows, and clears hint arrows once a move is played', () => {
      core.drawMoves([
        { from: 'e2', to: 'e4', brush: 'green' },
        { from: 'd2', to: 'd4', brush: 'blue' },
      ]);
      expect(core.getShapes()).toEqual([
        { orig: 'e2', dest: 'e4', brush: 'green' },
        { orig: 'd2', dest: 'd4', brush: 'blue' },
      ]);

      // Simulate user right-clicking to draw a temporary red arrow a2->a4
      const onChange = core.board.state.drawable.onChange;
      const withRightClickShape = [
        ...core.board.state.drawable.shapes,
        { orig: 'a2', dest: 'a4', brush: 'red' },
      ];
      core.board.state.drawable.shapes = withRightClickShape;
      onChange?.(withRightClickShape);

      expect(core.getShapes()).toEqual([
        { orig: 'e2', dest: 'e4', brush: 'green' },
        { orig: 'd2', dest: 'd4', brush: 'blue' },
        { orig: 'a2', dest: 'a4', brush: 'red' },
      ]);

      // Simulate user left-clicking a piece (Chessground drawClear empties drawable.shapes and calls onChange([]))
      core.board.state.drawable.shapes = [];
      onChange?.([]);

      // Right-click arrow is erased, but programmatic hint arrows remain visible!
      expect(core.getShapes()).toEqual([
        { orig: 'e2', dest: 'e4', brush: 'green' },
        { orig: 'd2', dest: 'd4', brush: 'blue' },
      ]);

      // Now actually play a move -> hint arrows are cleared automatically
      core.move('e4');
      expect(core.getShapes()).toEqual([]);
    });
  });

  describe('Highlight & Move Synchronization', () => {
    it('defaults highlight.lastMove and highlight.check to true in buildConfig', () => {
      const config = (core as unknown as { adapter: { buildConfig: (c: Record<string, unknown>) => { highlight?: { lastMove?: boolean; check?: boolean } } } }).adapter.buildConfig({});
      expect(config.highlight?.lastMove).toBe(true);
      expect(config.highlight?.check).toBe(true);
    });

    it('preserves partial highlight configuration overrides in buildConfig', () => {
      const config = (core as unknown as { adapter: { buildConfig: (c: Record<string, unknown>) => { highlight?: { lastMove?: boolean; check?: boolean } } } }).adapter.buildConfig({
        highlight: { lastMove: false },
      });
      expect(config.highlight?.lastMove).toBe(false);
      expect(config.highlight?.check).toBe(true);
    });

    it('sets lastMove on the board state when programmatic move is executed', () => {
      core.move({ from: 'e2', to: 'e4' });
      expect(core.getBoard().state.lastMove).toEqual(['e2', 'e4']);
    });

    it('avoids redundant board.move call in syncAfterMove when piece is already moved', () => {
      const board = core.getBoard();
      const moveSpy = vi.spyOn(board, 'move');

      // Simulate piece already moved by user drag on board
      board.state.pieces.delete('e2');
      board.state.pieces.set('e4', { role: 'pawn', color: 'white' });

      // Execute move in game session (as changeTurn does)
      const res = (core as unknown as { session: { executeMove: (m: { from: string; to: string }) => Record<string, unknown> } }).session.executeMove({
        from: 'e2',
        to: 'e4',
      });

      (core as unknown as { adapter: { syncAfterMove: (res: Record<string, unknown>) => void } }).adapter.syncAfterMove(res);

      expect(moveSpy).not.toHaveBeenCalled();
      expect(board.state.lastMove).toEqual(['e2', 'e4']);
    });
  });
});
