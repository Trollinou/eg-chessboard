import { Chess, parseUci } from 'chessops';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import { getNodesForElo } from '../BoardHelper';
import { DomainEventBus } from './DomainEventBus';
import { GameSession } from './GameSession';
import { StockfishEngine } from './StockfishEngine';
import type {
  Move,
  StockfishEvaluation,
  EngineStatus,
  GameReviewReport,
  MoveAnalysisReport,
  MoveJudgement,
} from '../types';

export type StockfishMode = 'disabled' | 'hint' | 'bot' | 'elo';

export interface StockfishConfig {
  whiteMode?: StockfishMode;
  whiteElo?: number;
  blackMode?: StockfishMode;
  blackElo?: number;
  stockfishMoveTime?: number; // millisecondes
  workerUrl?: string; // URL vers stockfish.js
  wasmUrl?: string; // URL vers stockfish.wasm
  threads?: number;
  hashSize?: number;
  showWdl?: boolean;
  multiPv?: number;
  searchLimit?: {
    movetime?: number;
    depth?: number;
    nodes?: number;
  };
}

export class StockfishManager {
  private engine: StockfishEngine | null = null;
  private stockfishConfig: StockfishConfig = {};
  public lastSuggestedMove = '';
  private isReviewRunning = false;
  private isLiveAnalysis = false;
  private isHintRequested = false;
  private reviewAbortController: AbortController | null = null;

  constructor(
    private eventBus: DomainEventBus,
    private session: GameSession,
    stockfishConfig: StockfishConfig = {},
    private onPlayEngineMove?: (move: { from: string; to: string; promotion?: string }) => void
  ) {
    this.stockfishConfig = stockfishConfig;
    this.eventBus.on('history-navigated', () => {
      if (this.isLiveAnalysis) {
        this.triggerStockfish(false);
      }
    });
  }

  public newGame(): void {
    this.isHintRequested = false;
    this.engine?.newGame();
  }

  public cancelReview(): void {
    if (this.reviewAbortController) {
      this.reviewAbortController.abort();
      this.reviewAbortController = null;
    }
    this.isReviewRunning = false;
  }

  public getConfig(): StockfishConfig {
    return { ...this.stockfishConfig };
  }

  public getEngineStatus(): EngineStatus {
    return this.engine ? this.engine.getStatus() : 'uninitialized';
  }

  public getLastEvaluation(): StockfishEvaluation | null {
    return this.engine ? this.engine.getLastEvaluation() : null;
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

    const { workerUrl, wasmUrl, whiteMode, blackMode } = this.stockfishConfig;
    const isWhiteActive = whiteMode && whiteMode !== 'disabled';
    const isBlackActive = blackMode && blackMode !== 'disabled';

    if (
      !workerUrl ||
      (!isWhiteActive &&
        !isBlackActive &&
        !this.isLiveAnalysis &&
        !this.isHintRequested &&
        !this.isReviewRunning)
    ) {
      this.terminateStockfish();
      return;
    }

    if (!this.engine) {
      this.engine = new StockfishEngine(workerUrl, wasmUrl, {
        onStatusChange: (status) => {
          this.eventBus.emit('stockfish-status', { status });
        },
        onEvaluation: (evaluation) => {
          this.eventBus.emit('stockfish-eval', { evaluation });
        },
        onBestMove: (bestMove) => {
          this.handleBestMove(bestMove);
        },
        onError: (error) => {
          this.eventBus.emit('stockfish-error', { error });
        },
      });

      this.engine
        .init()
        .then(() => {
          this.applyBaseOptions();
        })
        .catch(() => {
          // Handled via onError
        });
    } else {
      this.applyBaseOptions();
    }
  }

  private applyBaseOptions(): void {
    if (!this.engine) return;
    const { hashSize, threads, showWdl = true, multiPv = 1 } = this.stockfishConfig;
    if (hashSize) {
      this.engine.setOption('Hash', hashSize);
    }
    if (threads) {
      this.engine.setOption('Threads', threads);
    }
    this.engine.setOption('UCI_ShowWDL', showWdl);
    this.engine.setOption('MultiPV', multiPv);
  }

  public terminateStockfish(): void {
    if (this.engine) {
      this.engine.terminate();
      this.engine = null;
    }
    this.isReviewRunning = false;
    this.isLiveAnalysis = false;
  }

  public triggerStockfish(isFreeMode: boolean): void {
    if (isFreeMode || !this.engine || this.isReviewRunning) {
      return;
    }

    const { baseCmd, moves, currentFen, currentTurn, isGameOver } = this.getEnginePosition();
    if (isGameOver) {
      return;
    }

    const mode = currentTurn === 'white' ? this.stockfishConfig.whiteMode : this.stockfishConfig.blackMode;
    const elo = currentTurn === 'white' ? this.stockfishConfig.whiteElo : this.stockfishConfig.blackElo;

    // 1. If it's the bot's turn to play (only when at live position, not viewing past history)
    const isPastHistory =
      this.session.isViewingHistory() &&
      this.session.getCurrentViewingPly() < this.session.getCurrentPlyNumber();

    if (!isPastHistory && (mode === 'bot' || mode === 'elo')) {
      const targetElo = elo || 1500;
      this.engine.setOption('UCI_LimitStrength', 'true');
      this.engine.setOption('UCI_Elo', targetElo);
      this.engine.setOption('MultiPV', 1);

      const ok = this.engine.setPosition(baseCmd, moves, currentFen);
      if (!ok) return;

      const explicitMoveTime =
        this.stockfishConfig.searchLimit?.movetime ?? this.stockfishConfig.stockfishMoveTime;
      const depth = this.stockfishConfig.searchLimit?.depth;
      const nodes =
        this.stockfishConfig.searchLimit?.nodes ??
        (mode === 'elo' && !explicitMoveTime && !depth ? getNodesForElo(targetElo) : undefined);
      const moveTime = explicitMoveTime || 1000;

      this.engine.search({
        movetime: depth || nodes ? undefined : moveTime,
        depth,
        nodes,
      });
      return;
    }

    // 2. If it's the human's turn and live analysis is active, run infinite search in real-time
    if (this.isLiveAnalysis) {
      this.engine.setOption('UCI_LimitStrength', 'false');
      this.engine.setOption('MultiPV', this.stockfishConfig.multiPv || 1);

      this.engine.setPosition(baseCmd, moves, currentFen);
      this.engine.search({ infinite: true });
      return;
    }

    if (!mode || mode === 'disabled') {
      return;
    }

    // 3. Auto-hint mode
    if (mode === 'hint') {
      this.engine.setOption('UCI_LimitStrength', 'false');
      this.engine.setOption('MultiPV', this.stockfishConfig.multiPv || 1);

      const ok = this.engine.setPosition(baseCmd, moves, currentFen);
      if (!ok) return;

      const moveTime =
        this.stockfishConfig.searchLimit?.movetime || this.stockfishConfig.stockfishMoveTime || 1200;

      this.engine.search({
        movetime: moveTime,
      });
      return;
    }
  }

  public requestHint(options: { multiPv?: number; depth?: number; movetime?: number } = {}): void {
    if (this.isReviewRunning) return;
    this.isHintRequested = true;

    if (!this.engine) {
      this.initStockfish(false);
    }
    if (!this.engine) {
      this.isHintRequested = false;
      return;
    }

    const { baseCmd, moves, currentFen, isGameOver } = this.getEnginePosition();
    if (isGameOver) {
      this.isHintRequested = false;
      return;
    }

    this.engine.setOption('UCI_LimitStrength', 'false');
    this.engine.setOption('MultiPV', options.multiPv || 1);

    this.engine.setPosition(baseCmd, moves, currentFen);
    this.engine.search({
      movetime: options.depth ? undefined : options.movetime || 1200,
      depth: options.depth,
    });
  }

  public startLiveAnalysis(): void {
    if (this.isReviewRunning) return;
    this.isLiveAnalysis = true;
    if (!this.engine) {
      this.initStockfish(false);
    }
    if (!this.engine) return;

    this.engine.setOption('UCI_LimitStrength', 'false');
    this.engine.setOption('MultiPV', this.stockfishConfig.multiPv || 1);

    const { baseCmd, moves, currentFen } = this.getEnginePosition();
    this.engine.setPosition(baseCmd, moves, currentFen);
    this.engine.search({ infinite: true });
  }

  public stopLiveAnalysis(): void {
    if (!this.engine || !this.isLiveAnalysis) return;
    this.isLiveAnalysis = false;
    this.engine.stop();
  }

  private handleBestMove(bestMove: string): void {
    if (!bestMove || bestMove === '(none)') return;
    this.lastSuggestedMove = bestMove;
    const turn = this.session.getTurnColor();
    const mode = turn === 'white' ? this.stockfishConfig.whiteMode : this.stockfishConfig.blackMode;

    const wasHintRequested = this.isHintRequested;
    this.isHintRequested = false;

    if (wasHintRequested || mode === 'hint') {
      this.eventBus.emit('stockfish-hint', { bestMove });
    } else if ((mode === 'bot' || mode === 'elo') && this.onPlayEngineMove) {
      const from = bestMove.substring(0, 2);
      const to = bestMove.substring(2, 4);
      const promotion = bestMove.length > 4 ? bestMove.substring(4, 5) : undefined;
      this.onPlayEngineMove({ from, to, promotion });
    }
  }

  public async reviewGame(
    options: {
      depth?: number;
      onProgress?: (percent: number) => void;
      signal?: AbortSignal;
    } = {}
  ): Promise<GameReviewReport> {
    this.isReviewRunning = true;
    if (!this.engine) {
      this.initStockfish(false);
    }
    if (!this.engine) {
      this.isReviewRunning = false;
      throw new Error('Stockfish engine is not initialized');
    }

    this.reviewAbortController = new AbortController();
    const effectiveSignal = options.signal || this.reviewAbortController.signal;

    this.eventBus.emit('stockfish-game-review', { progress: 0, isComplete: false });

    const depth = options.depth || 12;
    const history = this.session.getHistory(true) as Move[];
    const rootFen = makeFen(this.session.getRootPos().toSetup());

    const movesReport: MoveAnalysisReport[] = [];
    const evalGraph: { ply: number; whiteWinChance: number }[] = [];
    const whiteSummary: Record<MoveJudgement, number> = {
      brilliant: 0,
      best: 0,
      excellent: 0,
      good: 0,
      inaccuracy: 0,
      mistake: 0,
      blunder: 0,
      missed_win: 0,
    };
    const blackSummary: Record<MoveJudgement, number> = {
      brilliant: 0,
      best: 0,
      excellent: 0,
      good: 0,
      inaccuracy: 0,
      mistake: 0,
      blunder: 0,
      missed_win: 0,
    };

    const playedMovesUci: string[] = [];

    this.engine.setOption('UCI_LimitStrength', 'false');
    this.engine.setOption('MultiPV', 1);

    try {
      let currentEval = await this.evaluatePosition(rootFen, [], depth, effectiveSignal);

      for (let i = 0; i < history.length; i++) {
        if (effectiveSignal.aborted) {
          throw new Error('Game review was aborted');
        }

        const move = history[i];
        const moveColor = move.color === 'w' ? 'white' : 'black';

        // 1. Position before move is currentEval (50% reduction in Stockfish evaluations)
        const evalBefore = currentEval;

        // 2. Play the move and evaluate position after move
        const moveUci = move.from + move.to + (move.promotion ? move.promotion.toLowerCase() : '');
        playedMovesUci.push(moveUci);

        let evalAfter: StockfishEvaluation;
        if (move.san.includes('#')) {
          evalAfter = {
            ply: i + 1,
            fen: rootFen,
            depth,
            scoreType: 'mate',
            scoreValue: 0,
            whiteScoreValue: moveColor === 'white' ? 10000 : -10000,
            winChancePercentage: moveColor === 'white' ? 100 : 0,
            pv: [],
            multipvIndex: 1,
          };
        } else {
          evalAfter = await this.evaluatePosition(rootFen, [...playedMovesUci], depth, effectiveSignal);
        }
        currentEval = evalAfter;

        // Calculate win chance before and after from the player's perspective
        const bestWinChance =
          moveColor === 'white'
            ? evalBefore.winChancePercentage
            : 100 - evalBefore.winChancePercentage;

        const playedWinChance =
          moveColor === 'white'
            ? evalAfter.winChancePercentage
            : 100 - evalAfter.winChancePercentage;

        const diff = Math.max(0, bestWinChance - playedWinChance);

        // Determine if a mate was missed
        const isMissedWin =
          evalBefore.scoreType === 'mate' &&
          ((moveColor === 'white' && evalBefore.whiteScoreValue > 0) ||
            (moveColor === 'black' && evalBefore.whiteScoreValue < 0)) &&
          evalAfter.scoreType !== 'mate';

        const judgement = this.classifyMove(diff, isMissedWin, move.san);

        if (moveColor === 'white') {
          whiteSummary[judgement]++;
        } else {
          blackSummary[judgement]++;
        }

        const bestMoveUci = evalBefore.bestMove || moveUci;
        const bestMoveSan =
          bestMoveUci === moveUci
            ? move.san
            : this.uciToSan(move.before, bestMoveUci);

        movesReport.push({
          ply: i + 1,
          san: move.san,
          uci: moveUci,
          color: moveColor,
          judgement,
          playedMoveScore: playedWinChance,
          bestMoveScore: bestWinChance,
          diffPercentage: Number(diff.toFixed(1)),
          bestMoveUci,
          bestMoveSan,
        });

        evalGraph.push({
          ply: i + 1,
          whiteWinChance: evalAfter.winChancePercentage,
        });

        const percent = Math.round(((i + 1) / history.length) * 100);
        options.onProgress?.(percent);
        this.eventBus.emit('stockfish-game-review', { progress: percent, isComplete: false });
      }

      // Calculate accuracy using exponential loss formula
      const whiteAccuracy = this.calculateAccuracy(
        movesReport.filter((m) => m.color === 'white').map((m) => m.diffPercentage)
      );
      const blackAccuracy = this.calculateAccuracy(
        movesReport.filter((m) => m.color === 'black').map((m) => m.diffPercentage)
      );

      const report: GameReviewReport = {
        accuracy: {
          white: whiteAccuracy,
          black: blackAccuracy,
        },
        summary: {
          white: whiteSummary,
          black: blackSummary,
        },
        moves: movesReport,
        evalGraph,
      };

      this.eventBus.emit('stockfish-game-review', { report, isComplete: true, progress: 100 });
      return report;
    } finally {
      this.isReviewRunning = false;
      this.reviewAbortController = null;
      this.restoreDefaultHandlers();
      this.triggerStockfish(false);
    }
  }

  private restoreDefaultHandlers(): void {
    if (!this.engine) return;
    this.engine.setHandlers({
      onStatusChange: (status) => {
        this.eventBus.emit('stockfish-status', { status });
      },
      onEvaluation: (evaluation) => {
        this.eventBus.emit('stockfish-eval', { evaluation });
      },
      onBestMove: (bestMove) => {
        this.handleBestMove(bestMove);
      },
      onError: (error) => {
        this.eventBus.emit('stockfish-error', { error });
      },
    });
  }

  private evaluatePosition(
    rootFen: string,
    moves: string[],
    depth: number,
    signal?: AbortSignal
  ): Promise<StockfishEvaluation> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Game review was aborted'));
        return;
      }

      if (!this.engine) {
        resolve({
          ply: moves.length,
          fen: rootFen,
          depth,
          scoreType: 'cp',
          scoreValue: 0,
          whiteScoreValue: 0,
          winChancePercentage: 50,
          pv: [],
          multipvIndex: 1,
        });
        return;
      }

      let lastEval: StockfishEvaluation | null = null;
      let isDone = false;

      const finish = () => {
        if (isDone) return;
        isDone = true;
        clearTimeout(safetyTimer);
        signal?.removeEventListener('abort', onAbort);
        if (lastEval) {
          resolve(lastEval);
        } else {
          resolve(
            this.engine?.getLastEvaluation() || {
              ply: moves.length,
              fen: rootFen,
              depth,
              scoreType: 'cp',
              scoreValue: 0,
              whiteScoreValue: 0,
              winChancePercentage: 50,
              pv: [],
              multipvIndex: 1,
            }
          );
        }
      };

      const onAbort = () => {
        if (isDone) return;
        isDone = true;
        clearTimeout(safetyTimer);
        signal?.removeEventListener('abort', onAbort);
        this.engine?.stop();
        reject(new Error('Game review was aborted'));
      };

      signal?.addEventListener('abort', onAbort);

      const safetyTimer = setTimeout(() => {
        this.engine?.stop();
        finish();
      }, 5000);

      const originalHandlers = {
        onEvaluation: (ev: StockfishEvaluation) => {
          lastEval = ev;
        },
        onBestMove: () => {
          finish();
        },
      };

      this.engine.setHandlers(originalHandlers);
      const baseCmd =
        rootFen === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
          ? 'startpos'
          : rootFen;

      this.engine.setPosition(baseCmd, moves);
      this.engine.search({ depth });
    });
  }

  private classifyMove(diff: number, isMissedWin: boolean, san: string): MoveJudgement {
    if (isMissedWin) return 'missed_win';
    if (diff <= 1.5) {
      if (san.includes('!!') || (san.includes('#') && san.includes('x') && diff < 0.5)) return 'brilliant';
      return 'best';
    }
    if (diff <= 5.0) return 'excellent';
    if (diff <= 10.0) return 'good';
    if (diff <= 20.0) return 'inaccuracy';
    if (diff <= 35.0) return 'mistake';
    return 'blunder';
  }

  private uciToSan(fen: string, uci: string): string {
    const parsedMove = parseUci(uci);
    if (!parsedMove) return uci;
    const setupRes = parseFen(fen);
    if (setupRes.isErr) return uci;
    const posRes = Chess.fromSetup(setupRes.value);
    if (posRes.isErr) return uci;
    return makeSan(posRes.value, parsedMove) || uci;
  }

  private calculateAccuracy(losses: number[]): number {
    if (!losses.length) return 100;
    const sum = losses.reduce((acc, loss) => acc + Math.exp(-0.06 * loss), 0);
    return Number(((sum / losses.length) * 100).toFixed(1));
  }

  private getEnginePosition(): {
    baseCmd: string;
    moves: string[];
    currentFen?: string;
    currentTurn: 'white' | 'black';
    isGameOver: boolean;
  } {
    const rootFen = makeFen(this.session.getRootPos().toSetup());
    const isStandardStart = rootFen === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const baseCmd = isStandardStart ? 'startpos' : rootFen;

    let history = this.session.getHistory(true) as Move[];
    let currentFen: string | undefined;
    let currentTurn: 'white' | 'black' = this.session.getTurnColor();
    let isGameOver = this.session.getIsGameOver();

    if (this.session.isViewingHistory()) {
      const viewingPly = this.session.getCurrentViewingPly();
      history = history.slice(0, viewingPly);
      const rootPos = this.session.getRootPos();
      const path = this.session.getActivePath();
      if (viewingPly === 0) {
        currentFen = rootFen;
        currentTurn = rootPos.turn === 'white' ? 'white' : 'black';
        isGameOver = false;
      } else if (path[viewingPly - 1]?.data?.fen) {
        currentFen = path[viewingPly - 1].data.fen;
        const parts = currentFen.split(' ');
        currentTurn = parts[1] === 'b' ? 'black' : 'white';
        isGameOver = viewingPly === path.length && this.session.getIsGameOver();
      }
    } else {
      currentFen = this.session.getFen();
    }

    const moves = history.map(
      (m) => m.from + m.to + (m.promotion ? m.promotion.toLowerCase() : '')
    );

    return { baseCmd, moves, currentFen, currentTurn, isGameOver };
  }
}
