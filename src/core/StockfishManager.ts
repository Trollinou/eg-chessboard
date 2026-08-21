import { makeFen } from 'chessops/fen';
import { DomainEventBus } from './DomainEventBus';
import { GameSession } from './GameSession';
import type { Move } from '../types';

export type StockfishMode = 'disabled' | 'hint' | 'elo';

export interface StockfishConfig {
  whiteMode?: StockfishMode;
  whiteElo?: number;
  blackMode?: StockfishMode;
  blackElo?: number;
  stockfishMoveTime?: number; // millisecondes
  workerUrl?: string; // URL vers stockfish.js
  wasmUrl?: string; // URL vers le binaire stockfish.wasm
}

export class StockfishManager {
  private whiteWorker: Worker | null = null;
  private blackWorker: Worker | null = null;
  private stockfishConfig: StockfishConfig = {};
  public lastSuggestedMove = '';

  constructor(
    private eventBus: DomainEventBus,
    private session: GameSession,
    stockfishConfig: StockfishConfig = {},
    private onPlayEngineMove?: (move: { from: string; to: string; promotion?: string }) => void
  ) {
    this.stockfishConfig = stockfishConfig;
  }

  public getConfig(): StockfishConfig {
    return { ...this.stockfishConfig };
  }

  public updateStockfishConfig(config: StockfishConfig, isFreeMode: boolean): void {
    this.stockfishConfig = { ...this.stockfishConfig, ...config };
    this.initStockfish(isFreeMode);
    this.triggerStockfish(isFreeMode);
  }

  public initStockfish(isFreeMode: boolean): void {
    if (isFreeMode) {
      this.terminateStockfish();
      return;
    }

    const { workerUrl, whiteMode, blackMode, whiteElo, blackElo } = this.stockfishConfig;
    if (
      !workerUrl ||
      (!whiteMode && !blackMode) ||
      (whiteMode === 'disabled' && blackMode === 'disabled')
    ) {
      this.terminateStockfish();
      return;
    }

    this.whiteWorker = this.setupWorker(this.whiteWorker, workerUrl, whiteMode, whiteElo, (line) =>
      this.handleWhiteMessage(line)
    );
    this.blackWorker = this.setupWorker(this.blackWorker, workerUrl, blackMode, blackElo, (line) =>
      this.handleBlackMessage(line)
    );
  }

  private setupWorker(
    currentWorker: Worker | null,
    workerUrl: string,
    mode: StockfishMode | undefined,
    elo: number | undefined,
    onMessage: (line: string) => void
  ): Worker | null {
    if (mode && mode !== 'disabled') {
      let worker = currentWorker;
      if (!worker) {
        worker = new Worker(workerUrl);
        worker.onmessage = (e) => onMessage(e.data);
        worker.postMessage('uci');
        worker.postMessage('ucinewgame');
        worker.postMessage('isready');
      }
      if (mode === 'elo') {
        const targetElo = elo || 1500;
        worker.postMessage('setoption name UCI_LimitStrength value true');
        worker.postMessage(`setoption name UCI_Elo value ${targetElo}`);
      } else if (mode === 'hint') {
        worker.postMessage('setoption name Hash value 256');
      }
      return worker;
    }
    if (currentWorker) {
      currentWorker.terminate();
    }
    return null;
  }

  public terminateStockfish(): void {
    if (this.whiteWorker) {
      this.whiteWorker.terminate();
      this.whiteWorker = null;
    }
    if (this.blackWorker) {
      this.blackWorker.terminate();
      this.blackWorker = null;
    }
  }

  private handleWhiteMessage(line: string): void {
    this.handleEngineOutput(line, this.stockfishConfig.whiteMode);
  }

  private handleBlackMessage(line: string): void {
    this.handleEngineOutput(line, this.stockfishConfig.blackMode);
  }

  private handleEngineOutput(line: string, mode?: StockfishMode): void {
    if (typeof line !== 'string') return;

    if (line.startsWith('bestmove')) {
      const parts = line.split(' ');
      const bestMove = parts[1];
      if (bestMove && bestMove !== '(none)') {
        this.lastSuggestedMove = bestMove;
        if (mode === 'hint') {
          this.eventBus.emit('stockfish-hint', { bestMove });
        } else if (mode === 'elo' && this.onPlayEngineMove) {
          const from = bestMove.substring(0, 2);
          const to = bestMove.substring(2, 4);
          const promotion = bestMove.length > 4 ? bestMove.substring(4, 5) : undefined;
          this.onPlayEngineMove({ from, to, promotion });
        }
      }
    }
  }

  public triggerStockfish(isFreeMode: boolean): void {
    if (isFreeMode || this.session.getIsGameOver()) {
      return;
    }

    const turn = this.session.getTurnColor();
    const mode = turn === 'white' ? this.stockfishConfig.whiteMode : this.stockfishConfig.blackMode;
    const worker = turn === 'white' ? this.whiteWorker : this.blackWorker;

    if (!worker || !mode || mode === 'disabled') {
      return;
    }

    const cmd = this.getEnginePositionCommand();
    const moveTime = this.stockfishConfig.stockfishMoveTime || 1000;

    worker.postMessage(cmd);
    worker.postMessage(`go movetime ${moveTime}`);
  }

  private getEnginePositionCommand(): string {
    const rootFen = makeFen(this.session.getRootPos().toSetup());
    const isStandardStart = rootFen === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const baseCmd = isStandardStart ? 'position startpos' : `position fen ${rootFen}`;

    const history = this.session.getHistory(true) as Move[];
    const movesStr = history
      .map((m) => m.from + m.to + (m.promotion ? m.promotion.toLowerCase() : ''))
      .join(' ');

    return movesStr ? `${baseCmd} moves ${movesStr}` : baseCmd;
  }
}
