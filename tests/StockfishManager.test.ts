import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StockfishManager } from '../src/core/StockfishManager';
import { DomainEventBus } from '../src/core/DomainEventBus';
import { GameSession } from '../src/core/GameSession';

let mockWorkerInstance: MockWorker | null = null;

class MockWorker {
  public onmessage: ((e: MessageEvent) => void) | null = null;
  public onerror: ((e: ErrorEvent) => void) | null = null;
  public messagesPosted: string[] = [];
  public terminated = false;

  constructor(public url: string) {
    mockWorkerInstance = this;
  }

  public postMessage(msg: string): void {
    this.messagesPosted.push(msg);

    // Auto-respond to UCI init commands
    if (msg === 'uci') {
      setTimeout(() => this.simulateMessage('uciok'), 5);
    } else if (msg === 'isready') {
      setTimeout(() => this.simulateMessage('readyok'), 5);
    }
  }

  public terminate(): void {
    this.terminated = true;
  }

  public simulateMessage(line: string): void {
    if (this.onmessage) {
      this.onmessage({ data: line } as MessageEvent);
    }
  }
}

describe('StockfishManager', () => {
  let eventBus: DomainEventBus;
  let session: GameSession;

  beforeEach(() => {
    mockWorkerInstance = null;
    vi.stubGlobal('Worker', MockWorker);
    eventBus = new DomainEventBus();
    session = new GameSession(eventBus);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockWorkerInstance = null;
  });

  it('configures bot mode with target Elo', async () => {
    const manager = new StockfishManager(eventBus, session, {
      workerUrl: '/stockfish.js',
      whiteMode: 'bot',
      whiteElo: 1800,
      stockfishMoveTime: 500,
    });

    manager.initStockfish(false);
    await new Promise((r) => setTimeout(r, 30));

    manager.triggerStockfish(false);

    expect(mockWorkerInstance?.messagesPosted).toContain(
      'setoption name UCI_LimitStrength value true'
    );
    expect(mockWorkerInstance?.messagesPosted).toContain('setoption name UCI_Elo value 1800');
    expect(mockWorkerInstance?.messagesPosted).toContain('go movetime 500');
  });

  it('configures hint mode at full strength without LimitStrength', async () => {
    const manager = new StockfishManager(eventBus, session, {
      workerUrl: '/stockfish.js',
      whiteMode: 'hint',
      multiPv: 2,
      stockfishMoveTime: 800,
    });

    manager.initStockfish(false);
    await new Promise((r) => setTimeout(r, 30));

    manager.triggerStockfish(false);

    expect(mockWorkerInstance?.messagesPosted).toContain(
      'setoption name UCI_LimitStrength value false'
    );
    expect(mockWorkerInstance?.messagesPosted).toContain('setoption name MultiPV value 2');
    expect(mockWorkerInstance?.messagesPosted).toContain('go movetime 800');
  });

  it('performs game review and calculates report with move classifications', async () => {
    // Load two moves into session: 1. e4 e5
    session.loadPgn('1. e4 e5');

    const manager = new StockfishManager(eventBus, session, {
      workerUrl: '/stockfish.js',
      whiteMode: 'hint',
    });

    manager.initStockfish(false);
    await new Promise((r) => setTimeout(r, 30));

    // Listen to worker commands to simulate evaluation responses
    if (mockWorkerInstance) {
      const origPostMessage = mockWorkerInstance.postMessage.bind(mockWorkerInstance);
      mockWorkerInstance.postMessage = (msg: string) => {
        origPostMessage(msg);
        if (msg.startsWith('go depth')) {
          setTimeout(() => {
            mockWorkerInstance?.simulateMessage('info depth 10 score cp 35 wdl 200 750 50 pv e2e4');
            mockWorkerInstance?.simulateMessage('bestmove e2e4');
          }, 0);
        }
      };
    }

    const reviewPromise = manager.reviewGame({ depth: 8 });
    const report = await reviewPromise;

    expect(report).toBeDefined();
    expect(report.moves.length).toBe(2);
    expect(report.accuracy.white).toBeGreaterThan(0);
    expect(report.accuracy.black).toBeGreaterThan(0);
    expect(report.evalGraph.length).toBe(2);
    expect(['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder']).toContain(
      report.moves[0].judgement
    );
  });

  it('completes game review up to 100% on a game ending in checkmate', async () => {
    // 4 moves ending in checkmate: Scholar's mate
    session.loadPgn('1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#');

    const manager = new StockfishManager(eventBus, session, {
      workerUrl: '/stockfish.js',
      whiteMode: 'hint',
    });

    manager.initStockfish(false);
    await new Promise((r) => setTimeout(r, 30));

    if (mockWorkerInstance) {
      const origPostMessage = mockWorkerInstance.postMessage.bind(mockWorkerInstance);
      mockWorkerInstance.postMessage = (msg: string) => {
        origPostMessage(msg);
        if (msg.startsWith('go depth')) {
          setTimeout(() => {
            mockWorkerInstance?.simulateMessage('info depth 10 score cp 40 wdl 200 750 50 pv e2e4');
            mockWorkerInstance?.simulateMessage('bestmove e2e4');
          }, 0);
        }
      };
    }

    const progressValues: number[] = [];
    const report = await manager.reviewGame({
      depth: 8,
      onProgress: (p) => progressValues.push(p),
    });

    expect(report.moves.length).toBe(7);
    expect(progressValues[progressValues.length - 1]).toBe(100);
    // Last move (Qxf7#) should have win chance 100%
    const lastMove = report.moves[report.moves.length - 1];
    expect(lastMove.san).toBe('Qxf7#');
    expect(lastMove.playedMoveScore).toBe(100);
    expect(lastMove.judgement).toBe('brilliant');
  });

  it('completes the exact 39-ply user game ending in 20. Qxa7# up to 100%', async () => {
    const userPgn = `1. e4 e6 2. d4 Nf6 3. e5 Bb4+ 4. c3 Bf8 5. exf6 Qxf6 6. Nf3 h6 7. Be3 Nc6 8. g3 b6 9. Bg2 Ba6 10. Nbd2 Qg6 11. c4 O-O-O 12. O-O d5 13. Qa4 Na5 14. b4 Qe4 15. bxa5 Qxe3 16. fxe3 c6 17. Qxc6+ Kb8 18. axb6 e5 19. Qc7+ Ka8 20. Qxa7#`;
    session.loadPgn(userPgn);

    const manager = new StockfishManager(eventBus, session, {
      workerUrl: '/stockfish.js',
      whiteMode: 'hint',
    });

    manager.initStockfish(false);
    await new Promise((r) => setTimeout(r, 30));

    if (mockWorkerInstance) {
      const origPostMessage = mockWorkerInstance.postMessage.bind(mockWorkerInstance);
      mockWorkerInstance.postMessage = (msg: string) => {
        origPostMessage(msg);
        if (msg.startsWith('go depth')) {
          setTimeout(() => {
            mockWorkerInstance?.simulateMessage('info depth 10 score cp 50 wdl 250 700 50 pv e2e4');
            mockWorkerInstance?.simulateMessage('bestmove e2e4');
          }, 0);
        }
      };
    }

    const progressValues: number[] = [];
    const report = await manager.reviewGame({
      depth: 6,
      onProgress: (p) => progressValues.push(p),
    });

    expect(report.moves.length).toBe(39);
    expect(progressValues[progressValues.length - 1]).toBe(100);
    const finalMove = report.moves[38];
    expect(finalMove.san).toBe('Qxa7#');
    expect(finalMove.playedMoveScore).toBe(100);
  });

  it('triggers requestHint even when both whiteMode and blackMode are disabled', async () => {
    const manager = new StockfishManager(eventBus, session, {
      workerUrl: '/stockfish.js',
      whiteMode: 'disabled',
      blackMode: 'disabled',
    });

    manager.requestHint({ movetime: 1200 });
    await new Promise((r) => setTimeout(r, 30));

    expect(mockWorkerInstance).not.toBeNull();
    expect(mockWorkerInstance?.messagesPosted).toContain('go movetime 1200');
  });

  it('evaluates only up to the viewed ply when navigating history', async () => {
    session.loadPgn('1. e4 e5 2. Nf3 Nc6');
    const manager = new StockfishManager(eventBus, session, {
      workerUrl: '/stockfish.js',
      whiteMode: 'hint',
      blackMode: 'hint',
    });
    manager.initStockfish(false);
    await new Promise((r) => setTimeout(r, 30));

    // View history at ply 1 (after 1. e4)
    session.viewHistory(1);
    manager.triggerStockfish(false);

    expect(mockWorkerInstance?.messagesPosted).toContain('position startpos moves e2e4');
    expect(mockWorkerInstance?.messagesPosted.some((m) => m.includes('g1f3'))).toBe(false);
  });

  it('aborts game review when cancelReview is called', async () => {
    session.loadPgn('1. e4 e5 2. Nf3 Nc6');
    const manager = new StockfishManager(eventBus, session, {
      workerUrl: '/stockfish.js',
    });
    manager.initStockfish(false);
    await new Promise((r) => setTimeout(r, 30));

    const reviewPromise = manager.reviewGame({ depth: 10 });
    manager.cancelReview();

    await expect(reviewPromise).rejects.toThrow('aborted');
  });
});
