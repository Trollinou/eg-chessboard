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
});
