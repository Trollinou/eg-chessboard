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

    if (whiteMode && whiteMode !== 'disabled') {
      if (!this.whiteWorker) {
        this.whiteWorker = new Worker(workerUrl);
        this.whiteWorker.onmessage = (e) => this.handleWhiteMessage(e.data);
        this.whiteWorker.postMessage('uci');
        this.whiteWorker.postMessage('ucinewgame');
        this.whiteWorker.postMessage('isready');
      }
      if (whiteMode === 'elo') {
        const elo = whiteElo || 1500;
        this.whiteWorker.postMessage('setoption name UCI_LimitStrength value true');
        this.whiteWorker.postMessage(`setoption name UCI_Elo value ${elo}`);
      } else if (whiteMode === 'hint') {
        this.whiteWorker.postMessage('setoption name Hash value 256');
      }
    } else {
      if (this.whiteWorker) {
        this.whiteWorker.terminate();
        this.whiteWorker = null;
      }
    }

    if (blackMode && blackMode !== 'disabled') {
      if (!this.blackWorker) {
        this.blackWorker = new Worker(workerUrl);
        this.blackWorker.onmessage = (e) => this.handleBlackMessage(e.data);
        this.blackWorker.postMessage('uci');
        this.blackWorker.postMessage('ucinewgame');
        this.blackWorker.postMessage('isready');
      }
      if (blackMode === 'elo') {
        const elo = blackElo || 1500;
        this.blackWorker.postMessage('setoption name UCI_LimitStrength value true');
        this.blackWorker.postMessage(`setoption name UCI_Elo value ${elo}`);
      } else if (blackMode === 'hint') {
        this.blackWorker.postMessage('setoption name Hash value 256');
      }
    } else {
      if (this.blackWorker) {
        this.blackWorker.terminate();
        this.blackWorker = null;
      }
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

    if (turn === 'white' && this.whiteWorker) {
      const positionCmd = getEnginePositionCommand();
      console.log(
        '[StockfishManager] Sending to White Worker:',
        positionCmd,
        `go movetime ${movetime}`
      );
      this.whiteWorker.postMessage(positionCmd);
      this.whiteWorker.postMessage(`go movetime ${movetime}`);
    } else if (turn === 'black' && this.blackWorker) {
      const positionCmd = getEnginePositionCommand();
      console.log(
        '[StockfishManager] Sending to Black Worker:',
        positionCmd,
        `go movetime ${movetime}`
      );
      this.blackWorker.postMessage(positionCmd);
      this.blackWorker.postMessage(`go movetime ${movetime}`);
    }
  }

  private handleWhiteMessage(line: string): void {
    if (line.startsWith('bestmove')) {
      const parts = line.split(' ');
      const bestMove = parts[1];
      if (bestMove && bestMove !== '(none)') {
        const mode = this.stockfishConfig.whiteMode;
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

  private handleBlackMessage(line: string): void {
    if (line.startsWith('bestmove')) {
      const parts = line.split(' ');
      const bestMove = parts[1];
      if (bestMove && bestMove !== '(none)') {
        const mode = this.stockfishConfig.blackMode;
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
