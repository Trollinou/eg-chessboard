import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StockfishEngine } from '../src/core/StockfishEngine';
import type { StockfishEvaluation, EngineStatus } from '../src/types';

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
  }

  public terminate(): void {
    this.terminated = true;
  }

  // Helper to simulate engine responses
  public simulateMessage(line: string): void {
    if (this.onmessage) {
      this.onmessage({ data: line } as MessageEvent);
    }
  }
}

describe('StockfishEngine', () => {
  beforeEach(() => {
    mockWorkerInstance = null;
    vi.stubGlobal('Worker', MockWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockWorkerInstance = null;
  });

  it('initializes worker and follows UCI handshake', async () => {
    const statuses: EngineStatus[] = [];
    const engine = new StockfishEngine('/stockfish.js', undefined, {
      onStatusChange: (status) => statuses.push(status),
    });

    const initPromise = engine.init();
    expect(engine.getStatus()).toBe('loading');
    expect(mockWorkerInstance?.messagesPosted).toContain('uci');

    // Simulate engine uciok
    mockWorkerInstance?.simulateMessage('uciok');
    expect(mockWorkerInstance?.messagesPosted).toContain('setoption name UCI_ShowWDL value true');
    expect(mockWorkerInstance?.messagesPosted).toContain('ucinewgame');
    expect(mockWorkerInstance?.messagesPosted).toContain('isready');

    // Simulate engine readyok
    mockWorkerInstance?.simulateMessage('readyok');
    await initPromise;

    expect(engine.getStatus()).toBe('ready');
    expect(statuses).toContain('loading');
    expect(statuses).toContain('ready');
  });

  it('rejects invalid FEN before sending to worker', () => {
    const errors: string[] = [];
    const engine = new StockfishEngine('/stockfish.js', undefined, {
      onError: (err) => errors.push(err),
    });
    engine.init();

    // Invalid FEN (no kings)
    const success = engine.setPosition('8/8/8/8/8/8/8/8 w - - 0 1');
    expect(success).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('FEN rejected');
    // Ensure position command was NOT posted
    expect(mockWorkerInstance?.messagesPosted.some((m) => m.startsWith('position'))).toBe(false);
  });

  it('accepts valid FEN and sends position command', () => {
    const engine = new StockfishEngine('/stockfish.js');
    engine.init();

    const success = engine.setPosition(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
    );
    expect(success).toBe(true);
    expect(mockWorkerInstance?.messagesPosted).toContain(
      'position fen rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
    );
  });

  it('parses info lines with centipions, wdl, and pv correctly', async () => {
    let capturedEval: StockfishEvaluation | null = null;
    const engine = new StockfishEngine('/stockfish.js', undefined, {
      onEvaluation: (ev) => {
        capturedEval = ev;
      },
    });

    const initPromise = engine.init();
    mockWorkerInstance?.simulateMessage('uciok');
    mockWorkerInstance?.simulateMessage('readyok');
    await initPromise;

    engine.setPosition('startpos');

    // Simulate Stockfish 19 info line
    const infoLine =
      'info depth 20 seldepth 31 multipv 1 score cp 48 wdl 165 820 15 nodes 1452034 nps 1210028 hashfull 412 tbhits 0 time 1200 pv e2e4 e7e5 g1f3 b8c6';
    mockWorkerInstance?.simulateMessage(infoLine);

    expect(capturedEval).not.toBeNull();
    expect(capturedEval!.depth).toBe(20);
    expect(capturedEval!.seldepth).toBe(31);
    expect(capturedEval!.scoreType).toBe('cp');
    expect(capturedEval!.scoreValue).toBe(48);
    expect(capturedEval!.whiteScoreValue).toBe(48);
    expect(capturedEval!.wdl).toEqual([165, 820, 15]);
    expect(capturedEval!.bestMove).toBe('e2e4');
    expect(capturedEval!.pv[0]).toBe('e2e4');
    expect(capturedEval!.pv[1]).toBe('e7e5');
    expect(capturedEval!.nodes).toBe(1452034);
    expect(capturedEval!.nps).toBe(1210028);
    expect(capturedEval!.time).toBe(1200);
    expect(capturedEval!.winChancePercentage).toBeGreaterThan(50);
  });

  it('parses mate score correctly', async () => {
    let capturedEval: StockfishEvaluation | null = null;
    const engine = new StockfishEngine('/stockfish.js', undefined, {
      onEvaluation: (ev) => {
        capturedEval = ev;
      },
    });

    const initPromise = engine.init();
    mockWorkerInstance?.simulateMessage('uciok');
    mockWorkerInstance?.simulateMessage('readyok');
    await initPromise;

    engine.setPosition('startpos');
    mockWorkerInstance?.simulateMessage('info depth 10 multipv 1 score mate 3 pv f7f8');

    expect(capturedEval).not.toBeNull();
    expect(capturedEval!.scoreType).toBe('mate');
    expect(capturedEval!.scoreValue).toBe(3);
    expect(capturedEval!.winChancePercentage).toBe(100);
  });

  it('handles bestmove and triggers onBestMove callback', async () => {
    let capturedBestMove = '';
    let capturedPonder: string | undefined = '';
    const engine = new StockfishEngine('/stockfish.js', undefined, {
      onBestMove: (bm, ponder) => {
        capturedBestMove = bm;
        capturedPonder = ponder;
      },
    });

    const initPromise = engine.init();
    mockWorkerInstance?.simulateMessage('uciok');
    mockWorkerInstance?.simulateMessage('readyok');
    await initPromise;

    engine.search({ movetime: 500 });
    expect(engine.getStatus()).toBe('searching');

    mockWorkerInstance?.simulateMessage('bestmove e2e4 ponder e7e5');
    expect(capturedBestMove).toBe('e2e4');
    expect(capturedPonder).toBe('e7e5');
    expect(engine.getStatus()).toBe('ready');
  });

  it('intercepts CRITICAL ERROR from Stockfish 19 and transitions to error', async () => {
    const errors: string[] = [];
    const statuses: EngineStatus[] = [];
    const engine = new StockfishEngine('/stockfish.js', undefined, {
      onError: (err) => errors.push(err),
      onStatusChange: (st) => statuses.push(st),
    });

    const initPromise = engine.init();
    mockWorkerInstance?.simulateMessage('uciok');
    mockWorkerInstance?.simulateMessage('readyok');
    await initPromise;

    mockWorkerInstance?.simulateMessage('info string CRITICAL ERROR: Invalid FEN: corrupt data');

    expect(engine.getStatus()).toBe('error');
    expect(statuses).toContain('error');
    expect(errors.some((e) => e.includes('CRITICAL ERROR'))).toBe(true);
    expect(mockWorkerInstance?.terminated).toBe(true);
  });

  it('queues search when already searching and stops previous search', async () => {
    const engine = new StockfishEngine('/stockfish.js');
    const initPromise = engine.init();
    mockWorkerInstance?.simulateMessage('uciok');
    mockWorkerInstance?.simulateMessage('readyok');
    await initPromise;

    engine.search({ movetime: 1000 });
    expect(engine.getStatus()).toBe('searching');

    // Trigger second search while first is running
    engine.search({ depth: 15 });
    expect(engine.getStatus()).toBe('stopping');
    expect(mockWorkerInstance?.messagesPosted).toContain('stop');

    // When first search finishes with bestmove, second search should be launched
    mockWorkerInstance?.simulateMessage('bestmove e2e4');
    expect(mockWorkerInstance?.messagesPosted).toContain('go depth 15');
    expect(engine.getStatus()).toBe('searching');
  });
});
