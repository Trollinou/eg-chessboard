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

  private onHint: (bestMove: string) => void;
  private onMove: (move: { from: string; to: string; promotion?: string }) => void;

  constructor(
    stockfishConfig: StockfishConfig = {},
    onHint: (bestMove: string) => void,
    onMove: (move: { from: string; to: string; promotion?: string }) => void
  ) {
    this.stockfishConfig = stockfishConfig;
    this.onHint = onHint;
    this.onMove = onMove;
  }

  public getConfig(): StockfishConfig {
    return { ...this.stockfishConfig };
  }

  public updateStockfishConfig(
    config: StockfishConfig,
    isFreeMode: boolean,
    isGameOver: boolean,
    turn: 'white' | 'black',
    getEnginePositionCommand: () => string
  ): void {
    this.stockfishConfig = { ...this.stockfishConfig, ...config };
    this.initStockfish(isFreeMode);
    this.triggerStockfish(isFreeMode, isGameOver, turn, getEnginePositionCommand);
  }

  public initStockfish(isFreeMode: boolean): void {
    console.log('[StockfishManager] initStockfish called. Config:', this.stockfishConfig);
    if (isFreeMode) {
      console.log('[StockfishManager] initStockfish aborted: freeMode is active');
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
    } else {
      if (currentWorker) {
        currentWorker.terminate();
      }
      return null;
    }
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

  public triggerStockfish(
    isFreeMode: boolean,
    isGameOver: boolean,
    turn: 'white' | 'black',
    getEnginePositionCommand: () => string
  ): void {
    if (isFreeMode || isGameOver) {
      console.log('[StockfishManager] triggerStockfish ignored: freeMode or game over');
      this.terminateStockfish();
      return;
    }

    const mode = turn === 'white' ? this.stockfishConfig.whiteMode : this.stockfishConfig.blackMode;

    if (!mode || mode === 'disabled') {
      return;
    }

    const movetime = this.stockfishConfig.stockfishMoveTime || 1000;
    console.log(
      '[StockfishManager] triggerStockfish. Turn:',
      turn,
      'Mode:',
      mode,
      'MoveTime:',
      movetime
    );

    const worker = turn === 'white' ? this.whiteWorker : this.blackWorker;
    if (worker) {
      const positionCmd = getEnginePositionCommand();
      console.log(
        `[StockfishManager] Sending to ${turn === 'white' ? 'White' : 'Black'} Worker:`,
        positionCmd,
        `go movetime ${movetime}`
      );
      worker.postMessage(positionCmd);
      worker.postMessage(`go movetime ${movetime}`);
    }
  }

  private handleWhiteMessage(line: string): void {
    this.handleEngineMessage(line, this.stockfishConfig.whiteMode);
  }

  private handleBlackMessage(line: string): void {
    this.handleEngineMessage(line, this.stockfishConfig.blackMode);
  }

  private handleEngineMessage(line: string, mode: StockfishMode | undefined): void {
    if (line.startsWith('bestmove')) {
      const parts = line.split(' ');
      const bestMove = parts[1];
      if (bestMove && bestMove !== '(none)') {
        if (mode === 'hint') {
          this.lastSuggestedMove = bestMove;
          this.onHint(bestMove);
        } else if (mode === 'elo') {
          const from = bestMove.slice(0, 2);
          const to = bestMove.slice(2, 4);
          const promotion = bestMove.length > 4 ? bestMove.charAt(4) : undefined;
          this.onMove({ from, to, promotion });
        }
      }
    }
  }
}
