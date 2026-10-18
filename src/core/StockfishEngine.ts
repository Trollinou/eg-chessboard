import type { EngineStatus, StockfishEvaluation } from '../types';
import { computeEvalBarPercentage, validateFen } from '../BoardHelper';

export interface SearchOptions {
  movetime?: number;
  depth?: number;
  nodes?: number;
  infinite?: boolean;
  searchmoves?: string[];
}

export interface EngineHandlers {
  onStatusChange?: (status: EngineStatus) => void;
  onEvaluation?: (evaluation: StockfishEvaluation) => void;
  onBestMove?: (bestMove: string, ponder?: string) => void;
  onError?: (error: string) => void;
}

interface SearchContext {
  fen: string;
  turn: 'white' | 'black';
  ply: number;
}

export class StockfishEngine {
  private worker: Worker | null = null;
  private status: EngineStatus = 'uninitialized';
  private stagedContext: SearchContext = {
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    turn: 'white',
    ply: 0,
  };
  private activeContext: SearchContext | null = null;
  private lastEvaluation: StockfishEvaluation | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSearch: (() => void) | null = null;
  private pendingPosition: string | null = null;
  private initResolve: (() => void) | null = null;
  private initReject: ((err: Error) => void) | null = null;

  constructor(
    private workerUrl: string = '/stockfish.js',
    private wasmUrl?: string,
    private handlers: EngineHandlers = {}
  ) {}

  public getStatus(): EngineStatus {
    return this.status;
  }

  public getLastEvaluation(): StockfishEvaluation | null {
    return this.lastEvaluation ? { ...this.lastEvaluation } : null;
  }

  public setHandlers(handlers: EngineHandlers): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  private setStatus(newStatus: EngineStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.handlers.onStatusChange?.(newStatus);
    }
  }

  public init(): Promise<void> {
    if (this.worker && (this.status === 'ready' || this.status === 'searching')) {
      return Promise.resolve();
    }

    this.terminate();
    this.setStatus('loading');

    return new Promise<void>((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;
      try {
        const fullWorkerUrl = this.wasmUrl
          ? `${this.workerUrl}#${encodeURIComponent(this.wasmUrl)}`
          : this.workerUrl;

        this.worker = new Worker(fullWorkerUrl);

        this.worker.onerror = (e) => {
          const errMsg = `Stockfish Worker error: ${e.message || 'Unknown Worker Error'}`;
          this.handleCriticalFailure(errMsg);
          reject(new Error(errMsg));
        };

        this.worker.onmessage = (e: MessageEvent) => {
          this.handleEngineLine(e.data);
        };

        this.armWatchdog(8000, 'Engine init timeout (uci/isready)');

        // Initialize UCI sequence
        this.worker.postMessage('uci');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.handleCriticalFailure(`Worker instantiation failed: ${msg}`);
        reject(err);
      }
    });
  }

  public setOption(name: string, value: string | number | boolean): void {
    if (!this.worker) return;
    this.worker.postMessage(`setoption name ${name} value ${value}`);
  }

  public setPosition(fenOrStartpos: string, moves: string[] = [], currentFen?: string): boolean {
    if (!this.worker) return false;

    const trimmed = fenOrStartpos.trim();
    const isStartpos =
      trimmed === 'startpos' || trimmed.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');

    let rootTurn: 'white' | 'black' = 'white';
    let baseFen = trimmed;

    if (!isStartpos) {
      const validation = validateFen(trimmed);
      if (!validation.valid) {
        this.handlers.onError?.(`FEN rejected before sending to Stockfish: ${validation.error}`);
        return false;
      }
      baseFen = trimmed;
      const parts = trimmed.split(' ');
      rootTurn = parts[1] === 'b' ? 'black' : 'white';
    } else {
      baseFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      rootTurn = 'white';
    }

    const calculatedTurn: 'white' | 'black' =
      moves.length % 2 === 0
        ? rootTurn
        : rootTurn === 'white'
          ? 'black'
          : 'white';

    this.stagedContext = {
      fen: currentFen || baseFen,
      turn: calculatedTurn,
      ply: moves.length,
    };

    const movesStr = moves.length > 0 ? ` moves ${moves.join(' ')}` : '';
    const baseCmd = isStartpos ? 'position startpos' : `position fen ${trimmed}`;
    const fullCmd = `${baseCmd}${movesStr}`;

    if (this.status === 'searching' || this.status === 'stopping') {
      this.pendingPosition = fullCmd;
    } else if (this.status === 'loading') {
      this.worker.postMessage(fullCmd);
      this.pendingPosition = fullCmd;
    } else {
      this.worker.postMessage(fullCmd);
      this.pendingPosition = null;
    }

    return true;
  }

  public search(options: SearchOptions = {}): void {
    if (this.status === 'error' || !this.worker) {
      this.pendingSearch = () => this.search(options);
      this.init().catch(() => {});
      return;
    }

    if (this.status === 'loading') {
      this.pendingSearch = () => this.search(options);
      return;
    }

    if (this.status === 'searching' || this.status === 'stopping') {
      this.pendingSearch = () => this.search(options);
      this.stop();
      return;
    }

    if (this.pendingPosition) {
      this.worker.postMessage(this.pendingPosition);
      this.pendingPosition = null;
    }

    this.activeContext = { ...this.stagedContext };

    let cmd = 'go';
    if (options.infinite) {
      cmd += ' infinite';
    } else {
      let hasParam = false;
      if (options.nodes !== undefined) {
        cmd += ` nodes ${options.nodes}`;
        hasParam = true;
      }
      if (options.movetime !== undefined) {
        cmd += ` movetime ${options.movetime}`;
        hasParam = true;
      }
      if (options.depth !== undefined) {
        cmd += ` depth ${options.depth}`;
        hasParam = true;
      }
      if (!hasParam) {
        cmd += ' movetime 1000';
      }
    }

    if (options.searchmoves && options.searchmoves.length > 0) {
      cmd += ` searchmoves ${options.searchmoves.join(' ')}`;
    }

    this.setStatus('searching');
    this.worker.postMessage(cmd);
  }

  public stop(): void {
    if (!this.worker) return;
    if (this.status === 'searching') {
      this.setStatus('stopping');
      this.worker.postMessage('stop');
      this.armWatchdog(5000, 'Stop command timeout waiting for bestmove');
    }
  }

  public newGame(): void {
    if (this.status === 'error' || !this.worker) {
      this.init().catch(() => {});
      return;
    }
    if (this.status === 'uninitialized') return;
    this.pendingSearch = null;
    this.pendingPosition = null;
    if (this.status === 'searching' || this.status === 'stopping') {
      this.stop();
    }
    this.worker.postMessage('ucinewgame');
    this.worker.postMessage('isready');
  }

  public terminate(): void {
    this.clearWatchdog();
    if (this.worker) {
      try {
        this.worker.postMessage('quit');
        this.worker.terminate();
      } catch {
        // ignore on cleanup
      }
      this.worker = null;
    }
    if (this.initReject) {
      this.initReject(new Error('Engine terminated'));
      this.initReject = null;
      this.initResolve = null;
    }
    this.pendingSearch = null;
    this.pendingPosition = null;
    this.activeContext = null;
    this.setStatus('uninitialized');
  }

  private handleEngineLine(line: unknown): void {
    if (typeof line !== 'string') return;
    const text = line.trim();

    // 1. Intercept CRITICAL ERROR (Stockfish 19)
    if (text.includes('info string CRITICAL ERROR')) {
      this.handleCriticalFailure(text);
      return;
    }

    // 2. UCI handshake transitions
    if (text === 'uciok') {
      this.worker?.postMessage('setoption name UCI_ShowWDL value true');
      this.worker?.postMessage('ucinewgame');
      this.worker?.postMessage('isready');
      return;
    }

    if (text === 'readyok') {
      this.clearWatchdog();
      if (this.status === 'loading') {
        this.setStatus('ready');
      }
      if (this.initResolve) {
        this.initResolve();
        this.initResolve = null;
        this.initReject = null;
      }
      if (this.pendingSearch) {
        const next = this.pendingSearch;
        this.pendingSearch = null;
        next();
      } else if (this.pendingPosition) {
        this.worker?.postMessage(this.pendingPosition);
        this.pendingPosition = null;
      }
      return;
    }

    // 3. Info line parsing (evaluations, WDL, PV)
    if (text.startsWith('info ') && text.includes('score ')) {
      this.parseInfoLine(text);
      return;
    }

    // 4. Bestmove conclusion
    if (text.startsWith('bestmove')) {
      this.clearWatchdog();
      const parts = text.split(/\s+/);
      const bestMove = parts[1] || '';
      const ponderIndex = parts.indexOf('ponder');
      const ponder = ponderIndex !== -1 ? parts[ponderIndex + 1] : undefined;

      this.setStatus('ready');

      const next = this.pendingSearch;
      this.pendingSearch = null;

      if (bestMove) {
        this.handlers.onBestMove?.(bestMove, ponder);
      }
      if (next) {
        next();
      }
    }
  }

  private parseInfoLine(line: string): void {
    if (this.status === 'stopping') return;
    const ctx = this.activeContext || this.stagedContext;

    const tokens = line.split(/\s+/);
    let depth = 0;
    let seldepth: number | undefined;
    let multipvIndex = 1;
    let nodes: number | undefined;
    let nps: number | undefined;
    let time: number | undefined;
    let wdl: [number, number, number] | undefined;
    let scoreType: 'cp' | 'mate' | null = null;
    let scoreValue = 0;
    let pvMoves: string[] = [];

    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === 'depth' && i + 1 < tokens.length) {
        depth = parseInt(tokens[++i], 10);
      } else if (token === 'seldepth' && i + 1 < tokens.length) {
        seldepth = parseInt(tokens[++i], 10);
      } else if (token === 'multipv' && i + 1 < tokens.length) {
        multipvIndex = parseInt(tokens[++i], 10);
      } else if (token === 'nodes' && i + 1 < tokens.length) {
        nodes = parseInt(tokens[++i], 10);
      } else if (token === 'nps' && i + 1 < tokens.length) {
        nps = parseInt(tokens[++i], 10);
      } else if (token === 'time' && i + 1 < tokens.length) {
        time = parseInt(tokens[++i], 10);
      } else if (token === 'wdl' && i + 3 < tokens.length) {
        wdl = [
          parseInt(tokens[++i], 10),
          parseInt(tokens[++i], 10),
          parseInt(tokens[++i], 10),
        ];
      } else if (token === 'score' && i + 2 < tokens.length) {
        const type = tokens[++i];
        if (type === 'cp' || type === 'mate') {
          scoreType = type;
          scoreValue = parseInt(tokens[++i], 10);
        }
      } else if (token === 'pv') {
        pvMoves = tokens.slice(i + 1);
        break;
      }
    }

    if (!scoreType) {
      return;
    }

    const isWhite = ctx.turn === 'white';
    const sign = isWhite ? 1 : -1;
    const whiteScoreValue = scoreValue * sign;
    const winChancePercentage = computeEvalBarPercentage(
      ctx.turn,
      scoreType,
      scoreValue,
      wdl
    );

    const evaluation: StockfishEvaluation = {
      ply: ctx.ply,
      fen: ctx.fen,
      depth,
      seldepth,
      scoreType,
      scoreValue,
      whiteScoreValue,
      winChancePercentage,
      wdl,
      bestMove: pvMoves[0],
      pv: pvMoves,
      multipvIndex,
      nodes,
      nps,
      time,
    };

    this.lastEvaluation = evaluation;
    this.handlers.onEvaluation?.(evaluation);
  }

  private handleCriticalFailure(errorMsg: string): void {
    this.clearWatchdog();
    this.setStatus('error');
    this.handlers.onError?.(errorMsg);
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        // ignore
      }
      this.worker = null;
    }
    if (this.initReject) {
      this.initReject(new Error(errorMsg));
      this.initReject = null;
      this.initResolve = null;
    }
  }

  private armWatchdog(timeoutMs: number, reason: string): void {
    this.clearWatchdog();
    this.watchdogTimer = setTimeout(() => {
      this.handleCriticalFailure(`Watchdog timeout: ${reason}`);
    }, timeoutMs);
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }
}
