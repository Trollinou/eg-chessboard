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

export class StockfishEngine {
  private worker: Worker | null = null;
  private status: EngineStatus = 'uninitialized';
  private currentTurn: 'white' | 'black' = 'white';
  private currentPly = 0;
  private currentFen = '';
  private lastEvaluation: StockfishEvaluation | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSearch: (() => void) | null = null;
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

  public setPosition(fenOrStartpos: string, moves: string[] = []): boolean {
    if (!this.worker) return false;

    const trimmed = fenOrStartpos.trim();
    const isStartpos =
      trimmed === 'startpos' || trimmed.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');

    if (!isStartpos) {
      const validation = validateFen(trimmed);
      if (!validation.valid) {
        this.handlers.onError?.(`FEN rejected before sending to Stockfish: ${validation.error}`);
        return false;
      }
      this.currentFen = trimmed;
      const parts = trimmed.split(' ');
      this.currentTurn = parts[1] === 'b' ? 'black' : 'white';
    } else {
      this.currentFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      this.currentTurn = 'white';
    }

    const movesStr = moves.length > 0 ? ` moves ${moves.join(' ')}` : '';
    const baseCmd = isStartpos ? 'position startpos' : `position fen ${trimmed}`;
    this.worker.postMessage(`${baseCmd}${movesStr}`);

    if (moves.length > 0) {
      // Determine turn from move count if startpos
      if (isStartpos) {
        this.currentTurn = moves.length % 2 === 0 ? 'white' : 'black';
      }
      this.currentPly = moves.length;
    }
    return true;
  }

  public search(options: SearchOptions = {}): void {
    if (!this.worker) return;

    if (this.status === 'searching' || this.status === 'stopping') {
      this.pendingSearch = () => this.search(options);
      this.stop();
      return;
    }

    let cmd = 'go';
    if (options.infinite) {
      cmd += ' infinite';
    } else if (options.movetime !== undefined) {
      cmd += ` movetime ${options.movetime}`;
    } else if (options.depth !== undefined) {
      cmd += ` depth ${options.depth}`;
    } else if (options.nodes !== undefined) {
      cmd += ` nodes ${options.nodes}`;
    } else {
      cmd += ' movetime 1000';
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
      this.armWatchdog(3000, 'Stop command timeout waiting for bestmove');
    }
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

      if (bestMove) {
        this.handlers.onBestMove?.(bestMove, ponder);
      }

      if (this.pendingSearch) {
        const next = this.pendingSearch;
        this.pendingSearch = null;
        next();
      }
    }
  }

  private parseInfoLine(line: string): void {
    const depthMatch = line.match(/\bdepth\s+(\d+)/);
    const seldepthMatch = line.match(/\bseldepth\s+(\d+)/);
    const multipvMatch = line.match(/\bmultipv\s+(\d+)/);
    const nodesMatch = line.match(/\bnodes\s+(\d+)/);
    const npsMatch = line.match(/\bnps\s+(\d+)/);
    const timeMatch = line.match(/\btime\s+(\d+)/);
    const wdlMatch = line.match(/\bwdl\s+(\d+)\s+(\d+)\s+(\d+)/);
    const scoreCpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
    const scoreMateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);

    let scoreType: 'cp' | 'mate' = 'cp';
    let scoreValue = 0;

    if (scoreMateMatch) {
      scoreType = 'mate';
      scoreValue = parseInt(scoreMateMatch[1], 10);
    } else if (scoreCpMatch) {
      scoreType = 'cp';
      scoreValue = parseInt(scoreCpMatch[1], 10);
    } else {
      return;
    }

    const wdl: [number, number, number] | undefined = wdlMatch
      ? [parseInt(wdlMatch[1], 10), parseInt(wdlMatch[2], 10), parseInt(wdlMatch[3], 10)]
      : undefined;

    const pvMatch = line.match(/\bpv\s+(.+)$/);
    const pvMoves = pvMatch ? pvMatch[1].trim().split(/\s+/) : [];

    const isWhite = this.currentTurn === 'white';
    const sign = isWhite ? 1 : -1;
    const whiteScoreValue = scoreValue * sign;
    const winChancePercentage = computeEvalBarPercentage(
      this.currentTurn,
      scoreType,
      scoreValue,
      wdl
    );

    const evaluation: StockfishEvaluation = {
      ply: this.currentPly,
      fen: this.currentFen,
      depth: depthMatch ? parseInt(depthMatch[1], 10) : 0,
      seldepth: seldepthMatch ? parseInt(seldepthMatch[1], 10) : undefined,
      scoreType,
      scoreValue,
      whiteScoreValue,
      winChancePercentage,
      wdl,
      bestMove: pvMoves[0],
      pv: pvMoves,
      multipvIndex: multipvMatch ? parseInt(multipvMatch[1], 10) : 1,
      nodes: nodesMatch ? parseInt(nodesMatch[1], 10) : undefined,
      nps: npsMatch ? parseInt(npsMatch[1], 10) : undefined,
      time: timeMatch ? parseInt(timeMatch[1], 10) : undefined,
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
