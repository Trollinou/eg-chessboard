import type { Chess } from 'chessops';
import type { Api } from '@lichess-org/chessground/api';
import type { Config } from '@lichess-org/chessground/config';
import type { Color, Key, MoveMetadata } from '@lichess-org/chessground/types';
import type { DrawShape } from '@lichess-org/chessground/draw';

import { getFinalFenFromPgn, analyzeMoveTactics } from './BoardHelper';
import type {
  Move,
  VariationInfo,
  PgnTreeNode,
  BoardMode,
  PieceSet,
  BoardTheme,
  StockfishEvaluation,
  StockfishHint,
  HintRequestOptions,
  EngineStatus,
  GameReviewReport,
  BoardGlyph,
  GameTermination,
  CoachAlertReason,
  CoachAlertDetail,
} from './types';

import { DomainEventBus } from './core/DomainEventBus';
import { GameSession } from './core/GameSession';
import { AnnotationService } from './core/AnnotationService';
import { BoardAdapter } from './core/BoardAdapter';
import { StockfishManager, type StockfishConfig } from './core/StockfishManager';
import { ExerciseManager } from './core/ExerciseManager';

export interface BoardCoreState {
  showThreats: boolean;
  mode?: BoardMode;
  playerColor?: 'white' | 'black' | 'both';
  freeMode?: boolean;
  soloMode?: boolean;
  readOnly?: boolean;
  preserveShapesOnPositionChange?: boolean;
  pieceSet?: PieceSet;
  boardTheme?: BoardTheme;
  promotionDialogState: {
    isEnabled: boolean;
    color?: Color;
    callback?: (piece: string) => void;
  };
  historyViewerState: {
    isEnabled: boolean;
    plyViewing?: number;
    viewOnly?: boolean;
  };
  currentComment?: string;
  turnColor?: 'white' | 'black';
  ply?: number;
  fen?: string;
  isCheck?: boolean;
  isGameOver?: boolean;
  termination?: GameTermination | null;
  isCoachPaused?: boolean;
}

export type { StockfishConfig, StockfishMode } from './core/StockfishManager';
export type {
  StockfishEvaluation,
  EngineStatus,
  GameReviewReport,
  MoveAnalysisReport,
  MoveJudgement,
  CoachAlertReason,
  TacticalAnalysisResult,
  CoachAlertDetail,
} from './types';

export interface ChessDiagram {
  fen: string;
  shapes?: DrawShape[];
}

export class BoardCore {
  private eventBus: DomainEventBus;
  private session: GameSession;
  private annotationService: AnnotationService;
  private exerciseManager: ExerciseManager;
  private stockfishManager: StockfishManager;
  private adapter: BoardAdapter;

  private state: BoardCoreState;
  private onStateChange: () => void;
  private emitEvent: (event: string, ...args: unknown[]) => void;
  private dismissedCoachPly: number | null = null;

  constructor(
    boardElement: HTMLElement,
    state: BoardCoreState,
    onStateChange: () => void,
    emitEvent: (event: string, ...args: unknown[]) => void,
    initialConfig: Config = {},
    stockfishConfig: StockfishConfig = {},
    diagram?: ChessDiagram
  ) {
    this.state = state;
    this.onStateChange = onStateChange;
    this.emitEvent = emitEvent;

    if (initialConfig.movable?.color !== undefined) {
      this.state.playerColor = initialConfig.movable.color as 'white' | 'black' | 'both';
    }

    this.state.pieceSet = this.state.pieceSet ?? 'cburnett';
    this.state.boardTheme = this.state.boardTheme ?? 'brown';

    this.applyModeDefaults();

    // 1. Core Services with Dependency Injection & EventBus
    this.eventBus = new DomainEventBus();
    this.session = new GameSession(this.eventBus);
    this.annotationService = new AnnotationService(this.eventBus, this.session, () => ({
      mode: this.state.mode,
      preserveShapesOnPositionChange: this.state.preserveShapesOnPositionChange,
    }));
    this.exerciseManager = new ExerciseManager();

    this.stockfishManager = new StockfishManager(
      this.eventBus,
      this.session,
      stockfishConfig,
      (m) => this.move(m)
    );

    // 2. Adapter (Chessground & DOM View)
    this.adapter = new BoardAdapter(
      boardElement,
      this.eventBus,
      this.session,
      this.annotationService,
      () => ({
        mode: this.state.mode,
        playerColor: this.state.playerColor,
        freeMode: this.state.freeMode,
        soloMode: this.state.soloMode,
        readOnly: this.state.readOnly,
        preserveShapesOnPositionChange: this.state.preserveShapesOnPositionChange,
      }),
      (color) => this.promptPromotion(color),
      () => this.exerciseManager.getCustomDests(),
      initialConfig,
      this.state.pieceSet,
      this.state.boardTheme
    );

    // 3. Register EventBus Listeners to dispatch Framework/Host Callbacks
    this.registerEventBusListeners();

    // 4. Initial setup
    this.stockfishManager.initStockfish(!!this.state.freeMode);

    if (diagram) {
      this.setDiagram(diagram);
    }
  }

  // Direct access to chessops Position & Chessground Board for compatibility
  public get pos(): Chess {
    return this.session.pos;
  }

  public get board(): Api {
    return this.adapter.board;
  }

  public get lastSuggestedMove(): string {
    return this.stockfishManager.lastSuggestedMove;
  }

  public set lastSuggestedMove(move: string) {
    this.stockfishManager.lastSuggestedMove = move;
  }

  public get lastSuggestedMoves(): string[] {
    return this.stockfishManager.lastSuggestedMoves;
  }

  public set lastSuggestedMoves(moves: string[]) {
    this.stockfishManager.lastSuggestedMoves = moves;
  }

  private applyModeDefaults(): void {
    if (!this.state.mode) {
      this.state.mode = 'game';
    }
    if (this.state.mode === 'editor' && this.state.preserveShapesOnPositionChange === undefined) {
      this.state.preserveShapesOnPositionChange = true;
    }
  }

  private normalizeCastlingUci(uci: string, san?: string): string {
    const clean = uci.trim().toLowerCase();
    if (clean === 'e1h1' || (san === 'O-O' && clean.startsWith('e1'))) return 'e1g1';
    if (clean === 'e1a1' || (san === 'O-O-O' && clean.startsWith('e1'))) return 'e1c1';
    if (clean === 'e8h8' || (san === 'O-O' && clean.startsWith('e8'))) return 'e8g8';
    if (clean === 'e8a8' || (san === 'O-O-O' && clean.startsWith('e8'))) return 'e8c8';
    return clean;
  }

  private isSuggestedMove(move: Move, suggestedUci: string): boolean {
    if (!suggestedUci) return false;
    const playedUci = `${move.from}${move.to}${move.promotion ? move.promotion.toLowerCase() : ''}`;
    return (
      this.normalizeCastlingUci(playedUci, move.san) ===
      this.normalizeCastlingUci(suggestedUci)
    );
  }

  private shouldInterceptWithCoach(data: {
    move: Move;
    turnColor: 'white' | 'black';
    ply: number;
    isCheck: boolean;
    isGameOver: boolean;
    isCheckmate: boolean;
    isStalemate: boolean;
    isDraw: boolean;
  }): boolean {
    const sfConfig = this.stockfishManager.getConfig();
    if (!sfConfig.coachMode) {
      return false;
    }

    const moveColor: Color = data.move.color === 'w' ? 'white' : 'black';
    const modeForColor = moveColor === 'white' ? sfConfig.whiteMode : sfConfig.blackMode;
    const isHumanMove =
      !modeForColor || modeForColor === 'disabled' || modeForColor === 'hint';

    if (!isHumanMove) {
      this.stockfishManager.lastSuggestedMoves = [];
      return false;
    }

    const wasSuggestedMove = this.stockfishManager.lastSuggestedMoves.some((suggestedUci) =>
      this.isSuggestedMove(data.move, suggestedUci)
    );
    this.stockfishManager.lastSuggestedMoves = [];

    this.clearGlyphs();

    if (data.isGameOver) {
      this.setGlyph(data.move.to, '!');
      if (this.state.isCoachPaused) {
        this.state.isCoachPaused = false;
        this.onStateChange();
      }
      return false;
    }

    const tactics = analyzeMoveTactics(this.session.pos, moveColor, data.move);
    for (const sq of tactics.pinnedSquares) {
      this.setGlyph(sq, 'pin');
    }

    if (wasSuggestedMove || this.dismissedCoachPly === data.ply) {
      this.setGlyph(data.move.to, '!');
      if (this.state.isCoachPaused) {
        this.state.isCoachPaused = false;
        this.onStateChange();
      }
      return false;
    }

    if (tactics.hasMajorThreat && tactics.undefendedSquares.length > 0) {
      for (const sq of tactics.undefendedSquares) {
        this.setGlyph(sq, 'undefended');
      }
      this.setGlyph(data.move.to, '??');
      this.state.isCoachPaused = true;
      this.onStateChange();

      const isBadTrade =
        !!data.move.captured &&
        tactics.undefendedSquares.includes(data.move.to as Key);
      const reason: CoachAlertReason = isBadTrade ? 'bad_trade' : 'hanging_piece';
      const detail: CoachAlertDetail = {
        ply: data.ply,
        move: data.move,
        judgement: 'blunder',
        glyph: '??',
        reason,
        undefendedSquares: tactics.undefendedSquares,
        pinnedSquares: tactics.pinnedSquares,
      };
      this.emitEvent('coach-alert', detail);
      return true;
    }

    this.setGlyph(data.move.to, '!');
    if (this.state.isCoachPaused) {
      this.state.isCoachPaused = false;
      this.onStateChange();
    }
    return false;
  }

  private registerEventBusListeners(): void {
    this.eventBus.on('move-executed', (data) => {
      this.emitEvent('move', data.move);
      if (data.isCheckmate) {
        this.emitEvent('checkmate', data.turnColor === 'white' ? 'black' : 'white');
      } else if (data.isCheck) {
        this.emitEvent('check', data.turnColor);
      }
      if (data.isStalemate) {
        this.emitEvent('stalemate');
      }
      if (data.isDraw) {
        this.emitEvent('draw');
      }
      if (this.shouldInterceptWithCoach(data)) {
        return;
      }
      this.stockfishManager.triggerStockfish(!!this.state.freeMode);
    });

    this.eventBus.on('turn-changed', (data) => {
      this.emitEvent('turn-change', data.turnColor, data.ply);
    });

    this.eventBus.on('stockfish-hint', (data) => {
      if (data.drawArrows && data.hints.length > 0) {
        this.drawMoves(
          data.hints.map((h) => ({ from: h.from, to: h.to, brush: h.brush })),
          true
        );
      }
      this.emitEvent('stockfish-hint', data.bestMove, data.hints);
    });

    this.eventBus.on('stockfish-eval', (data) => {
      this.emitEvent('evaluation', data.evaluation);
    });

    this.eventBus.on('stockfish-status', (data) => {
      this.emitEvent('engine-status', data.status);
    });

    this.eventBus.on('stockfish-game-review', (data) => {
      this.emitEvent('game-review-progress', data.progress || 0);
    });

    this.eventBus.on('square-clicked', (data) => {
      this.emitEvent('square-click', data.square);
    });

    this.eventBus.on('promotion-required', (data) => {
      this.emitEvent('promotion', data);
    });

    this.eventBus.on('shapes-changed', (data) => {
      this.emitEvent('shapes-change', data.shapes);
    });

    this.eventBus.on('game-resigned', (data) => {
      this.adapter.updateGameState();
      this.emitEvent('resign', data);
    });

    this.eventBus.on('draw-agreed', () => {
      this.adapter.updateGameState();
      this.emitEvent('draw');
    });

    this.eventBus.on('draw-offered', (data) => {
      this.emitEvent('draw-offer', data.fromColor);
    });

    this.eventBus.on('draw-declined', (data) => {
      this.emitEvent('draw-declined', data);
    });

    this.eventBus.on('state-changed', () => {
      this.onStateChange();
    });
  }

  private promptPromotion(color: Color): Promise<string> {
    return new Promise<string>((resolve) => {
      this.state.promotionDialogState = {
        isEnabled: true,
        color,
        callback: (promoPiece) => {
          this.state.promotionDialogState = { isEnabled: false };
          this.onStateChange();
          resolve(promoPiece);
        },
      };
      this.onStateChange();
    });
  }

  private isSameFen(fenStr: string): boolean {
    const currentFen = this.getFen();
    if (fenStr === currentFen) return true;
    const normalize = (f: string) => f.trim().split(/\s+/).join(' ');
    if (normalize(fenStr) === normalize(currentFen)) return true;
    if (!fenStr.includes(' ') && fenStr.trim() === this.getPlacementFen()) return true;
    return false;
  }

  // --- PUBLIC API CONTRACT ---

  public setMode(mode: BoardMode): void {
    if (this.state.mode === mode) return;
    this.state.mode = mode;
    this.applyModeDefaults();
    this.adapter.updateGameState({ updateFen: false });
    this.onStateChange();
  }

  public getMode(): BoardMode {
    return this.state.mode || 'game';
  }

  public closePromotionDialog(): void {
    this.state.promotionDialogState = { isEnabled: false };
    this.onStateChange();
  }

  public setFreeMode(freeMode: boolean): void {
    if (this.state.freeMode === freeMode) return;
    this.state.freeMode = freeMode;
    this.adapter.updateGameState({ updateFen: false });
    this.onStateChange();
  }

  public setSoloMode(soloMode: boolean): void {
    if (this.state.soloMode === soloMode) return;
    this.state.soloMode = soloMode;
    this.adapter.updateGameState({ updateFen: false });
    this.onStateChange();
  }

  public setPreserveShapesOnPositionChange(preserve: boolean): void {
    if (this.state.preserveShapesOnPositionChange === preserve) return;
    this.state.preserveShapesOnPositionChange = preserve;
    if (preserve && this.board) {
      const currentBoardShapes = this.board.state.drawable.shapes || [];
      if (currentBoardShapes.length > 0) {
        this.annotationService.setPreservedShapes(currentBoardShapes);
      }
    }
    if (this.board) {
      this.board.set({
        drawable: {
          eraseOnMovablePieceClick: this.getMode() === 'study' ? false : !preserve,
          defaultSnapToValidMove: this.getMode() === 'game',
        },
      });
    }
    this.onStateChange();
  }

  public setPlayerColor(color: 'white' | 'black' | 'both'): void {
    if (this.state.playerColor === color) return;
    this.state.playerColor = color;
    this.adapter.updateGameState({ updateFen: false });
    this.onStateChange();
  }

  public clearDomBounds(): void {
    this.adapter.clearDomBounds();
  }

  public redraw(clearBounds = true): void {
    if (clearBounds) {
      this.clearDomBounds();
    }
    this.board?.redrawAll();
  }

  public getSquareFromEvent(e: MouseEvent | TouchEvent): Key | null {
    return this.adapter.getSquareFromEvent(e, this.getOrientation());
  }

  public setConfig(config: Config, fillDefaults = false): void {
    const finalConfig = fillDefaults ? this.adapter.buildConfig(config) : config;
    if (finalConfig.movable?.events && 'after' in finalConfig.movable.events) {
      const origAfter = finalConfig.movable.events.after;
      finalConfig.movable.events.after = origAfter
        ? async (orig: Key, dest: Key, metadata: MoveMetadata) => {
            await this.adapter.changeTurn(orig, dest, metadata);
            origAfter(orig, dest, metadata);
          }
        : (orig: Key, dest: Key, metadata: MoveMetadata) =>
            this.adapter.changeTurn(orig, dest, metadata);
    }
    const { fen: configFen, ...other } = finalConfig;
    if (other.movable?.color !== undefined) {
      this.state.playerColor = other.movable.color as 'white' | 'black' | 'both';
      this.onStateChange();
    }
    const existingShapes = this.annotationService.getShapes(
      !!this.state.preserveShapesOnPositionChange
    );
    this.board.set(other);
    if (configFen && !this.isSameFen(configFen)) {
      this.setPosition(configFen);
    }
    if (other.drawable?.shapes) {
      this.annotationService.applyBoardShapes(
        other.drawable.shapes,
        !!this.state.preserveShapesOnPositionChange
      );
    } else if (existingShapes && existingShapes.length > 0) {
      this.annotationService.applyBoardShapes(
        existingShapes,
        !!this.state.preserveShapesOnPositionChange
      );
    }
    this.board.redrawAll();
  }

  public resetBoard(): void {
    this.newGame();
  }

  public undoLastMove(): void {
    this.state.isCoachPaused = false;
    this.dismissedCoachPly = null;
    this.clearGlyphs();
    this.session.undoLastMove();
    if (!this.session.isViewingHistory()) {
      this.board.set({ fen: this.getFen() });
      this.adapter.updateGameState({ updateFen: false });
      const lastMove = this.getLastMove();
      this.board.set({
        lastMove: lastMove ? [lastMove.from as Key, lastMove.to as Key] : undefined,
      });
    }
    this.onStateChange();
    this.stockfishManager.triggerStockfish(!!this.state.freeMode);
  }

  /**
   * Annule le dernier coup suite à une alerte du Coach, nettoie les glyphes
   * et réactive le tour du joueur.
   */
  public coachUndo(): boolean {
    this.state.isCoachPaused = false;
    this.dismissedCoachPly = null;
    this.clearGlyphs();
    this.hideMoves();
    this.stockfishManager.lastSuggestedMove = '';
    const undone = this.session.undoLastMove();
    if (undone && !this.session.isViewingHistory()) {
      this.board.set({ fen: this.getFen() });
      this.adapter.updateGameState({ updateFen: false });
      const last = this.getLastMove();
      this.board.set({
        lastMove: last ? [last.from as Key, last.to as Key] : undefined,
      });
    }
    this.onStateChange();
    return undone;
  }

  /**
   * Confirme le coup malgré l'alerte du Coach et déclenche immédiatement
   * la réponse de Stockfish sans réinitialiser le Worker.
   */
  public coachProceed(): void {
    if (!this.state.isCoachPaused) return;
    this.dismissedCoachPly = this.getCurrentPlyNumber();
    this.state.isCoachPaused = false;
    this.onStateChange();
    this.stockfishManager.triggerStockfish(!!this.state.freeMode);
  }

  public getBoard(): Api {
    return this.board;
  }

  public getMaterialCount() {
    return this.session.getMaterialCount(this.board.state.pieces);
  }

  public getCapturedPieces() {
    return this.session.getCapturedPieces(this.getHistory(true) as Move[]);
  }

  public getOrientation(): 'white' | 'black' {
    return this.adapter.getOrientation();
  }

  public toggleOrientation(): void {
    this.board.toggleOrientation();
  }

  public drawThreats(): void {
    this.state.showThreats = true;
    this.onStateChange();
    this.annotationService.drawThreats(!!this.state.preserveShapesOnPositionChange);
  }

  public hideMoves(): void {
    this.state.showThreats = false;
    this.onStateChange();
    this.annotationService.applyBoardShapes([], !!this.state.preserveShapesOnPositionChange);
  }

  public drawMove(from: Key | string, to: Key | string, brush: string, append = false): void {
    this.annotationService.drawMove(
      from,
      to,
      brush,
      !!this.state.preserveShapesOnPositionChange,
      append
    );
  }

  public drawMoves(
    moves: Array<{ from: Key | string; to: Key | string; brush?: string }>,
    append = true
  ): void {
    this.annotationService.drawMoves(
      moves,
      !!this.state.preserveShapesOnPositionChange,
      append
    );
  }

  public drawCircle(square: Key | string, brush: string): void {
    this.annotationService.drawCircle(square, brush, !!this.state.preserveShapesOnPositionChange);
  }

  public setShapes(shapes: DrawShape[] | unknown[]): void {
    this.annotationService.applyBoardShapes(
      shapes as DrawShape[],
      !!this.state.preserveShapesOnPositionChange
    );
  }

  public setGlyph(square: Key | string, glyph: BoardGlyph | null): void {
    this.annotationService.setGlyph(square, glyph);
  }

  public clearGlyphs(): void {
    this.annotationService.clearGlyphs();
  }

  public getGlyphs(): Map<Key, BoardGlyph> {
    return this.annotationService.getGlyphs();
  }

  public getGlyph(square: Key | string): BoardGlyph | null {
    return this.annotationService.getGlyph(square);
  }

  public getState(): Readonly<BoardCoreState> {
    return Object.freeze({
      ...this.state,
      promotionDialogState: { ...this.state.promotionDialogState },
      historyViewerState: this.session.getHistoryViewerState(),
      currentComment: this.annotationService.getCurrentComment(),
      turnColor: this.session.getTurnColor(),
      ply: this.session.getCurrentPlyNumber(),
      fen: this.session.getFen(),
      isCheck: this.session.getIsCheck(),
      isGameOver: this.session.getIsGameOver(),
      termination: this.session.getTermination(),
      isCoachPaused: !!this.state.isCoachPaused,
    });
  }

  public getCurrentComment(): string {
    return this.annotationService.getCurrentComment();
  }

  public getHistoryViewerState(): Readonly<BoardCoreState['historyViewerState']> {
    return this.session.getHistoryViewerState();
  }

  public isViewingHistory(): boolean {
    return this.session.isViewingHistory();
  }

  public move(moveObj: string | { from: string; to: string; promotion?: string }): boolean {
    const res = this.session.executeMove(moveObj, {
      freeMode: this.state.freeMode,
      readOnly: this.state.readOnly,
      soloMode: this.state.soloMode,
    });
    if (res.success) {
      this.adapter.syncAfterMove(res);
      return true;
    }
    return false;
  }

  public getTurnColor(): Color {
    return this.session.getTurnColor();
  }

  public getCurrentTurnNumber(): number {
    return this.session.getCurrentTurnNumber();
  }

  public getCurrentPlyNumber(): number {
    return this.session.getCurrentPlyNumber();
  }

  public getLastMove(): Move | null {
    return this.session.getLastMove();
  }

  public getHistory(verbose = false): Move[] | string[] {
    return this.session.getHistory(verbose);
  }

  public getFen(): string {
    return this.session.getFen();
  }

  public getPlacementFen(): string {
    return this.session.getPlacementFen(this.board?.state?.pieces);
  }

  public getPgn(): string {
    return this.session.getPgn();
  }

  public getIsGameOver(): boolean {
    return this.session.getIsGameOver();
  }

  public getIsCheckmate(): boolean {
    return this.session.getIsCheckmate();
  }

  public getIsCheck(): boolean {
    return this.session.getIsCheck();
  }

  public getIsStalemate(): boolean {
    return this.session.getIsStalemate();
  }

  public getIsDraw(): boolean {
    return this.session.getIsDraw();
  }

  public getIsThreefoldRepetition(): boolean {
    return this.session.isThreefoldRepetition();
  }

  public getIsInsufficientMaterial(): boolean {
    return this.session.getIsInsufficientMaterial();
  }

  public getInCheckColor(): 'white' | 'black' | null {
    return this.session.getInCheckColor();
  }

  public getTermination(): GameTermination | null {
    return this.session.getTermination();
  }

  public resign(color?: 'white' | 'black'): boolean {
    const res = this.session.resign(color);
    if (res.success) {
      this.adapter.updateGameState();
      return true;
    }
    return false;
  }

  public agreeDraw(): boolean {
    const res = this.session.agreeDraw();
    if (res.success) {
      this.adapter.updateGameState();
      return true;
    }
    return false;
  }

  public async offerDraw(
    color?: 'white' | 'black'
  ): Promise<{ accepted: boolean; reason?: string; score?: number }> {
    const offeringColor: 'white' | 'black' =
      color ?? (this.state.playerColor === 'black' ? 'black' : 'white');
    const opponentColor: 'white' | 'black' = offeringColor === 'white' ? 'black' : 'white';

    if (this.stockfishManager.isStockfishActiveForColor(opponentColor)) {
      const result = await this.stockfishManager.evaluateDrawOffer(offeringColor);
      if (result.accepted) {
        this.agreeDraw();
        return { accepted: true, reason: result.reason, score: result.score };
      } else {
        this.emitEvent('draw-declined', {
          byColor: opponentColor,
          reason: result.reason,
          score: result.score,
        });
        return { accepted: false, reason: result.reason, score: result.score };
      }
    }

    this.emitEvent('draw-offer', offeringColor);
    return { accepted: false, reason: 'pending_opponent' };
  }

  public acceptDraw(): boolean {
    return this.agreeDraw();
  }

  public declineDraw(
    byColor?: 'white' | 'black',
    reason: 'too_early' | 'advantage' = 'advantage'
  ): void {
    const decliningColor =
      byColor ?? (this.state.playerColor === 'white' ? 'black' : 'white');
    this.emitEvent('draw-declined', { byColor: decliningColor, reason });
  }

  public getGameOverReason(lang: 'fr' | 'en' = 'fr'): string {
    return this.session.getGameOverReason(lang);
  }

  public destroy(): void {
    this.stockfishManager.terminateStockfish();
    this.adapter.destroy();
    this.annotationService.setBoard(null);
    this.eventBus.clear();
  }

  public getSquareColor(square: Key | string): 'dark' | 'light' | null {
    return this.session.getSquareColor(square);
  }

  public getSquare(square: Key | string) {
    return this.session.getSquare(square);
  }

  public setPosition(fenStr: string): void {
    this.state.isCoachPaused = false;
    this.dismissedCoachPly = null;
    this.clearGlyphs();
    this.session.safeLoadFen(fenStr);
    if (this.board) {
      this.board.set({ selected: undefined });
    }
    this.adapter.updateGameState({ updateFen: true });
    this.onStateChange();
    this.stockfishManager.initStockfish(!!this.state.freeMode);
    this.stockfishManager.triggerStockfish(!!this.state.freeMode);
  }

  public setDiagram(diagram: ChessDiagram): void {
    this.setPosition(diagram.fen);
    this.annotationService.applyBoardShapes(
      diagram.shapes || [],
      !!this.state.preserveShapesOnPositionChange
    );
  }

  public getDiagram(): ChessDiagram {
    return {
      fen: this.getFen(),
      shapes: this.getShapes(),
    };
  }

  public getShapes(): DrawShape[] {
    return this.annotationService.getShapes(!!this.state.preserveShapesOnPositionChange);
  }

  public getFinalFenFromPgn(pgnStr: string): string {
    return getFinalFenFromPgn(pgnStr, this.getFen());
  }

  public putPiece(piece: { type: string; color: 'w' | 'b' }, square: Key | string): boolean {
    if (this.board) {
      this.board.set({ selected: undefined });
    }
    const success = this.session.putPiece(piece, square);
    if (success) {
      this.adapter.updateGameState({ updateFen: true });
    }
    return success;
  }

  public removePiece(square: Key | string): void {
    if (this.board) {
      this.board.set({ selected: undefined });
    }
    this.session.removePiece(square);
    this.adapter.updateGameState({ updateFen: true });
  }

  public loadPgn(pgnStr: string): void {
    this.state.isCoachPaused = false;
    this.dismissedCoachPly = null;
    this.clearGlyphs();
    this.session.loadPgn(pgnStr);
    if (!this.session.isViewingHistory()) {
      this.adapter.updateGameState({ updateFen: true });
      const lastMove = this.getLastMove();
      if (lastMove) {
        this.board.set({ lastMove: [lastMove.from as Key, lastMove.to as Key] });
      }
    }
    this.onStateChange();
    this.stockfishManager.initStockfish(!!this.state.freeMode);
    this.stockfishManager.triggerStockfish(!!this.state.freeMode);
  }

  public getPgnInfo(): Record<string, string> {
    return this.session.getPgnInfo();
  }

  public setPieceSet(pieceSet: PieceSet): void {
    if (this.state.pieceSet === pieceSet) return;
    this.state.pieceSet = pieceSet;
    this.adapter.updateDomThemeClasses(pieceSet, this.getBoardTheme());
    this.onStateChange();
  }

  public getPieceSet(): PieceSet {
    return this.state.pieceSet ?? 'cburnett';
  }

  public setBoardTheme(boardTheme: BoardTheme): void {
    if (this.state.boardTheme === boardTheme) return;
    this.state.boardTheme = boardTheme;
    this.adapter.updateDomThemeClasses(this.getPieceSet(), boardTheme);
    this.onStateChange();
  }

  public getBoardTheme(): BoardTheme {
    return this.state.boardTheme ?? 'brown';
  }

  public setReadOnly(readOnly: boolean): void {
    if (this.state.readOnly === readOnly) return;
    this.state.readOnly = readOnly;
    this.adapter.updateGameState({ updateFen: false });
    this.onStateChange();
  }

  public isReadOnly(): boolean {
    return !!this.state.readOnly;
  }

  public newGame(fen?: string): void {
    this.state.isCoachPaused = false;
    this.dismissedCoachPly = null;
    this.clearGlyphs();
    this.stockfishManager.lastSuggestedMove = '';
    this.session.newGame(fen);
    this.session.resetSoloHistory();
    this.board.set({
      fen: this.getFen(),
      lastMove: undefined,
      selected: undefined,
    });
    this.adapter.updateGameState({ updateFen: false });
    this.onStateChange();
    this.stockfishManager.newGame();
    this.stockfishManager.initStockfish(!!this.state.freeMode);
    this.stockfishManager.triggerStockfish(!!this.state.freeMode);
  }

  public viewHistory(ply: number): void {
    this.session.viewHistory(ply);
  }

  public stopViewingHistory(): void {
    this.session.stopViewingHistory();
  }

  public viewStart(): void {
    this.session.viewStart();
  }

  public viewNext(): void {
    this.session.viewNext();
  }

  public viewPrevious(): void {
    this.session.viewPrevious();
  }

  public getVariationsAtPly(ply?: number): VariationInfo[] {
    return this.session.getVariationsAtPly(ply);
  }

  public selectVariation(variationIndex: number): boolean {
    return this.session.selectVariation(variationIndex);
  }

  public deleteVariation(variationIndex?: number): boolean {
    return this.session.deleteVariation(variationIndex);
  }

  public promoteVariation(variationIndex?: number): boolean {
    return this.session.promoteVariation(variationIndex);
  }

  public getPgnTree(): PgnTreeNode {
    return this.session.getPgnTree();
  }

  public updateStockfishConfig(config: StockfishConfig): void {
    if (config.coachMode === false && this.state.isCoachPaused) {
      this.state.isCoachPaused = false;
      this.onStateChange();
    }
    this.stockfishManager.updateStockfishConfig(
      config,
      !!this.state.freeMode,
      !!this.state.isCoachPaused
    );
  }

  public getEngineStatus(): EngineStatus {
    return this.stockfishManager.getEngineStatus();
  }

  public getLastEvaluation(): StockfishEvaluation | null {
    return this.stockfishManager.getLastEvaluation();
  }

  public getLastEvaluations(): StockfishEvaluation[] {
    return this.stockfishManager.getLastEvaluations();
  }

  public getLastHints(): StockfishHint[] {
    return this.stockfishManager.getLastHints();
  }

  public requestHint(options?: HintRequestOptions): Promise<StockfishHint[]> {
    return this.stockfishManager.requestHint(options);
  }

  public startLiveAnalysis(): void {
    this.stockfishManager.startLiveAnalysis();
  }

  public stopLiveAnalysis(): void {
    this.stockfishManager.stopLiveAnalysis();
  }

  public reviewGame(options?: {
    depth?: number;
    onProgress?: (percent: number) => void;
    signal?: AbortSignal;
  }): Promise<GameReviewReport> {
    return this.stockfishManager.reviewGame(options);
  }

  public cancelReview(): void {
    this.stockfishManager.cancelReview();
  }

  public setCommentAtPly(
    ply: number,
    text: string,
    shapes: DrawShape[] = [],
    updateBoardShapes = true
  ): void {
    this.annotationService.setCommentAtPly(
      ply,
      text,
      shapes,
      updateBoardShapes,
      this.getMode(),
      !!this.state.preserveShapesOnPositionChange
    );
  }

  public setComment(text: string, shapes: DrawShape[] = []): void {
    const ply = this.session.getCurrentViewingPly();
    this.setCommentAtPly(ply, text, shapes);
  }

  public setCustomDests(dests: Map<Key, Key[]> | null): void {
    this.exerciseManager.setCustomDests(dests);
    this.adapter.updateGameState({ updateFen: false });
  }

  public restrictMovesToPieces(squares: Key[] | null): void {
    this.exerciseManager.restrictMovesToPieces(squares, this.session.pos);
    this.adapter.updateGameState({ updateFen: false });
  }

  public isSquareAttacked(square: Key, byColor: 'white' | 'black'): boolean {
    return this.exerciseManager.isSquareAttacked(square, byColor, this.session.pos);
  }

  public getPieces(): Map<Key, { type: string; color: 'w' | 'b' }> {
    return this.exerciseManager.getPieces(this.board.state.pieces);
  }

  public getSoloHistory(): Move[] {
    return this.session.getSoloHistory();
  }
}
