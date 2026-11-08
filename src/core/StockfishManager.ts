import { Chess, parseUci } from 'chessops';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import type { Key } from '@lichess-org/chessground/types';
import { getNodesForElo } from '../BoardHelper';
import { DomainEventBus } from './DomainEventBus';
import { GameSession } from './GameSession';
import { StockfishEngine } from './StockfishEngine';
import type {
  Move,
  StockfishEvaluation,
  StockfishHint,
  HintBrush,
  HintRequestOptions,
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
  /** Écart maximal en centipions avec le meilleur coup pour retenir les coups secondaires (MultiPV). Défaut: 50 en coachMode. */
  hintMaxScoreDiffCp?: number;
  /** Trace automatiquement les flèches de suggestion sur l'échiquier en conservant les formes existantes. Défaut: false. */
  drawHintArrows?: boolean;
  searchLimit?: {
    movetime?: number;
    depth?: number;
    nodes?: number;
  };
  drawAcceptanceThresholdPawns?: number; // Défaut: 0.30 pion
  minDrawMoves?: number; // Défaut: 20 coups (40 plies)
  /** Active l'analyse pédagogique des coups humains, les glyphes automatiques et la suspension sur gaffe. */
  coachMode?: boolean;
}

export class StockfishManager {
  private engine: StockfishEngine | null = null;
  private stockfishConfig: StockfishConfig = {};
  private _lastSuggestedMoves: string[] = [];
  private lastHints: StockfishHint[] = [];
  private isReviewRunning = false;
  private isLiveAnalysis = false;
  private isHintRequested = false;
  private pendingHintOptions: HintRequestOptions | null = null;
  private pendingHintResolvers: Array<(hints: StockfishHint[]) => void> = [];
  private reviewAbortController: AbortController | null = null;

  public get lastSuggestedMove(): string {
    return this._lastSuggestedMoves[0] ?? '';
  }

  public set lastSuggestedMove(move: string) {
    this._lastSuggestedMoves = move ? [move] : [];
  }

  public get lastSuggestedMoves(): string[] {
    return [...this._lastSuggestedMoves];
  }

  public set lastSuggestedMoves(moves: string[]) {
    this._lastSuggestedMoves = moves.filter(Boolean);
  }

  constructor(
    private eventBus: DomainEventBus,
    private session: GameSession,
    stockfishConfig: StockfishConfig = {},
    private onPlayEngineMove?: (move: { from: string; to: string; promotion?: string }) => void
  ) {
    this.stockfishConfig = stockfishConfig;
    this.eventBus.on('history-navigated', () => {
      if (this.isLiveAnalysis) {
        const { isGameOver } = this.getEnginePosition();
        if (isGameOver) {
          this.engine?.stop();
          const isCheckmate = this.session.getIsCheckmate();
          const turnColor = this.session.getTurnColor();
          const winChance = isCheckmate ? (turnColor === 'white' ? 0 : 100) : 50;
          this.eventBus.emit('stockfish-eval', {
            evaluation: {
              ply: this.session.getCurrentViewingPly(),
              fen: this.session.getFen(),
              scoreType: isCheckmate ? 'mate' : 'cp',
              scoreValue: 0,
              whiteScoreValue: isCheckmate ? (turnColor === 'white' ? -10000 : 10000) : 0,
              winChancePercentage: winChance,
              depth: 0,
              pv: [],
              multipvIndex: 1,
            },
          });
          return;
        }
        this.triggerStockfish(false);
      }
    });
  }

  public newGame(): void {
    this.isHintRequested = false;
    this.pendingHintOptions = null;
    this.resolvePendingHints([]);
    this._lastSuggestedMoves = [];
    this.lastHints = [];
    if (!this.engine || this.engine.getStatus() === 'error') {
      this.initStockfish(false);
      return;
    }
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

  public getLastEvaluations(): StockfishEvaluation[] {
    return this.engine ? this.engine.getLastEvaluations() : [];
  }

  public getLastHints(): StockfishHint[] {
    return this.lastHints.map((h) => ({ ...h, pv: [...h.pv] }));
  }

  public updateStockfishConfig(
    config: StockfishConfig,
    isFreeMode: boolean,
    skipTrigger = false
  ): void {
    this.stockfishConfig = { ...this.stockfishConfig, ...config };
    this.initStockfish(isFreeMode);
    if (!skipTrigger) {
      this.triggerStockfish(isFreeMode);
    }
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

    if (!this.engine || this.engine.getStatus() === 'error') {
      if (this.engine) {
        this.engine.terminate();
        this.engine = null;
      }
      this.engine = new StockfishEngine(workerUrl, wasmUrl, {
        onStatusChange: (status) => {
          this.eventBus.emit('stockfish-status', { status });
        },
        onEvaluation: (evaluation) => {
          this.eventBus.emit('stockfish-eval', { evaluation });
        },
        onBestMove: (bestMove, _ponder, evaluations) => {
          this.handleBestMove(bestMove, evaluations);
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

  public requestHint(options: HintRequestOptions = {}): Promise<StockfishHint[]> {
    if (this.isReviewRunning) return Promise.resolve([]);
    this.isHintRequested = true;
    this.pendingHintOptions = options;

    if (!this.engine || this.engine.getStatus() === 'error') {
      this.initStockfish(false);
    }
    if (!this.engine) {
      this.isHintRequested = false;
      this.pendingHintOptions = null;
      return Promise.resolve([]);
    }

    const { baseCmd, moves, currentFen, isGameOver } = this.getEnginePosition();
    if (isGameOver) {
      this.isHintRequested = false;
      this.pendingHintOptions = null;
      return Promise.resolve([]);
    }

    const multiPv = Math.max(1, options.multiPv ?? this.stockfishConfig.multiPv ?? 1);
    this.engine.setOption('UCI_LimitStrength', 'false');
    this.engine.setOption('MultiPV', multiPv);

    this.engine.setPosition(baseCmd, moves, currentFen);
    this.engine.search({
      movetime: options.depth ? undefined : options.movetime || 1200,
      depth: options.depth,
    });

    return new Promise<StockfishHint[]>((resolve) => {
      this.pendingHintResolvers.push(resolve);
    });
  }

  public startLiveAnalysis(): void {
    if (this.isReviewRunning) return;
    this.isLiveAnalysis = true;
    if (!this.engine || this.engine.getStatus() === 'error') {
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

  public isStockfishActiveForColor(color: 'white' | 'black'): boolean {
    const mode = color === 'white' ? this.stockfishConfig.whiteMode : this.stockfishConfig.blackMode;
    return !!mode && mode !== 'disabled';
  }

  public async evaluateDrawOffer(
    offeringColor: 'white' | 'black'
  ): Promise<{
    accepted: boolean;
    reason: 'too_early' | 'advantage' | 'equal_or_worse';
    score?: number;
  }> {
    const currentMoves = Math.floor(this.session.getCurrentPlyNumber() / 2);
    const minMoves = this.stockfishConfig.minDrawMoves ?? 20;

    if (currentMoves < minMoves) {
      return {
        accepted: false,
        reason: 'too_early',
      };
    }

    const opponentColor: 'white' | 'black' = offeringColor === 'white' ? 'black' : 'white';
    let evaluation = this.getLastEvaluation();

    if (!evaluation && this.engine && this.engine.getStatus() !== 'error') {
      try {
        const { baseCmd, moves } = this.getEnginePosition();
        evaluation = await this.evaluatePosition(baseCmd, moves, 10);
        this.restoreDefaultHandlers();
      } catch {
        // Fallback to null
      }
    }

    let stockfishScorePawns = 0;
    if (evaluation) {
      if (evaluation.scoreType === 'mate') {
        const mateForWhite = evaluation.whiteScoreValue > 0;
        const mateForStockfish = opponentColor === 'white' ? mateForWhite : !mateForWhite;
        stockfishScorePawns = mateForStockfish ? 999 : -999;
      } else {
        const whiteScorePawns = evaluation.whiteScoreValue / 100;
        stockfishScorePawns = opponentColor === 'white' ? whiteScorePawns : -whiteScorePawns;
      }
    }

    const threshold = this.stockfishConfig.drawAcceptanceThresholdPawns ?? 0.3;
    const accepted = stockfishScorePawns <= threshold;

    return {
      accepted,
      reason: accepted ? 'equal_or_worse' : 'advantage',
      score: stockfishScorePawns,
    };
  }

  private resolvePendingHints(hints: StockfishHint[]): void {
    if (this.pendingHintResolvers.length === 0) return;
    const resolvers = [...this.pendingHintResolvers];
    this.pendingHintResolvers = [];
    for (const resolve of resolvers) {
      resolve(hints);
    }
  }

  private getHintBrush(rank: number): HintBrush {
    if (rank === 1) return 'green';
    if (rank === 2) return 'blue';
    if (rank === 3) return 'yellow';
    return 'red';
  }

  private buildHints(
    bestMove: string,
    evaluations: StockfishEvaluation[],
    maxScoreDiffCp?: number
  ): StockfishHint[] {
    const currentFen = this.session.getFen();
    const validEvals: StockfishEvaluation[] = [];
    const seenMoves = new Set<string>();

    for (const ev of evaluations) {
      const moveUci = ev.bestMove || ev.pv[0];
      if (!moveUci || moveUci === '(none)' || seenMoves.has(moveUci)) continue;
      seenMoves.add(moveUci);
      validEvals.push({ ...ev, bestMove: moveUci });
    }

    if (validEvals.length === 0) {
      const from = bestMove.substring(0, 2) as Key;
      const to = bestMove.substring(2, 4) as Key;
      const promotion = bestMove.length > 4 ? bestMove.substring(4, 5) : undefined;
      return [
        {
          uci: bestMove,
          from,
          to,
          promotion,
          san: this.uciToSan(currentFen, bestMove),
          rank: 1,
          scoreType: 'cp',
          scoreValue: 0,
          whiteScoreValue: 0,
          winChancePercentage: 50,
          pv: [bestMove],
          brush: 'green',
        },
      ];
    }

    const topEval = validEvals[0];
    const filteredEvals = validEvals.filter((ev, idx) => {
      if (idx === 0) return true;
      if (maxScoreDiffCp === undefined || !Number.isFinite(maxScoreDiffCp)) return true;

      if (topEval.scoreType === 'mate' && topEval.scoreValue > 0) {
        return ev.scoreType === 'mate' && ev.scoreValue > 0;
      }
      if (ev.scoreType === 'mate' && ev.scoreValue < 0) {
        return topEval.scoreType === 'mate' && topEval.scoreValue < 0;
      }
      if (topEval.scoreType === 'cp' && ev.scoreType === 'cp') {
        const diffCp = topEval.scoreValue - ev.scoreValue;
        return diffCp <= maxScoreDiffCp;
      }
      return false;
    });

    return filteredEvals.map((ev, idx) => {
      const uci = ev.bestMove!;
      const rank = idx + 1;
      const from = uci.substring(0, 2) as Key;
      const to = uci.substring(2, 4) as Key;
      const promotion = uci.length > 4 ? uci.substring(4, 5) : undefined;
      return {
        uci,
        from,
        to,
        promotion,
        san: this.uciToSan(ev.fen || currentFen, uci),
        rank,
        scoreType: ev.scoreType,
        scoreValue: ev.scoreValue,
        whiteScoreValue: ev.whiteScoreValue,
        winChancePercentage: ev.winChancePercentage,
        pv: [...ev.pv],
        brush: this.getHintBrush(rank),
      };
    });
  }

  private handleBestMove(bestMove: string, evaluations?: StockfishEvaluation[]): void {
    if (!bestMove || bestMove === '(none)') {
      this.resolvePendingHints([]);
      return;
    }
    const turn = this.session.getTurnColor();
    const mode = turn === 'white' ? this.stockfishConfig.whiteMode : this.stockfishConfig.blackMode;

    const wasHintRequested = this.isHintRequested;
    const hintOpts = this.pendingHintOptions;
    this.isHintRequested = false;
    this.pendingHintOptions = null;

    if (wasHintRequested || mode === 'hint') {
      const maxScoreDiffCp =
        hintOpts?.maxScoreDiffCp ??
        this.stockfishConfig.hintMaxScoreDiffCp ??
        (this.stockfishConfig.coachMode ? 50 : undefined);
      const drawArrows =
        hintOpts?.drawArrows ?? this.stockfishConfig.drawHintArrows ?? false;

      const evals = evaluations && evaluations.length > 0 ? evaluations : this.getLastEvaluations();
      const hints = this.buildHints(bestMove, evals, maxScoreDiffCp);
      this.lastHints = hints;
      this._lastSuggestedMoves = hints.map((h) => h.uci);
      if (this._lastSuggestedMoves.length === 0) {
        this._lastSuggestedMoves = [bestMove];
      }

      this.eventBus.emit('stockfish-hint', { bestMove, hints, drawArrows });
      this.resolvePendingHints(hints);
    } else if ((mode === 'bot' || mode === 'elo') && this.onPlayEngineMove) {
      this._lastSuggestedMoves = [bestMove];
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
    if (!this.engine || this.engine.getStatus() === 'error') {
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
        let moveUci = move.from + move.to;
        const san = move.san ? move.san.trim() : '';
        if (san.startsWith('O-O-O') || san.startsWith('0-0-0') || moveUci === 'e1a1' || moveUci === 'e8a8') {
          moveUci = moveColor === 'white' ? 'e1c1' : 'e8c8';
        } else if (san.startsWith('O-O') || san.startsWith('0-0') || moveUci === 'e1h1' || moveUci === 'e8h8') {
          moveUci = moveColor === 'white' ? 'e1g1' : 'e8g8';
        }
        moveUci += move.promotion ? move.promotion.toLowerCase() : '';
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
      onBestMove: (bestMove, _ponder, evaluations) => {
        this.handleBestMove(bestMove, evaluations);
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

      if (!this.engine || this.engine.getStatus() === 'error') {
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
        onError: () => {
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

    const moves = history.map((m) => {
      let uci = m.from + m.to;
      const san = m.san ? m.san.trim() : '';
      if (san.startsWith('O-O-O') || san.startsWith('0-0-0') || uci === 'e1a1' || uci === 'e8a8') {
        uci = m.color === 'w' ? 'e1c1' : 'e8c8';
      } else if (san.startsWith('O-O') || san.startsWith('0-0') || uci === 'e1h1' || uci === 'e8h8') {
        uci = m.color === 'w' ? 'e1g1' : 'e8g8';
      }
      return uci + (m.promotion ? m.promotion.toLowerCase() : '');
    });

    return { baseCmd, moves, currentFen, currentTurn, isGameOver };
  }
}
