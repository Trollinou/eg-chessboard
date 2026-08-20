import { Chess, parseSquare } from 'chessops';
import { makeFen } from 'chessops/fen';
import { isChildNode } from 'chessops/pgn';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Config } from '@lichess-org/chessground/config';
import type { Color, Key, MoveMetadata } from '@lichess-org/chessground/types';
import type { DrawShape } from '@lichess-org/chessground/draw';

import { getThreats, getFinalFenFromPgn } from './BoardHelper';
import type { Move, VariationInfo, PgnTreeNode, BoardMode } from './types';

import { DomHandler } from './core/DomHandler';
import { StockfishManager, type StockfishConfig } from './core/StockfishManager';
import { ExerciseManager } from './core/ExerciseManager';
import { AnnotationManager, type AnnotationContext } from './core/AnnotationManager';
import { HistoryViewerManager } from './core/HistoryViewerManager';
import { PgnTreeManager } from './core/PgnTreeManager';
import { FenManager } from './core/FenManager';
import { PromotionManager } from './core/PromotionManager';
import { BoardConfigBuilder, type BoardConfigContext } from './core/BoardConfigBuilder';
import { MoveManager, type MoveManagerContext } from './core/MoveManager';
import { pieceSymbolToRole } from './core/pieceMapping';

export interface BoardCoreState {
  showThreats: boolean;
  mode?: BoardMode;
  freeMode?: boolean;
  soloMode?: boolean;
  readOnly?: boolean;
  preserveShapesOnPositionChange?: boolean;
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
}

export type { StockfishConfig, StockfishMode } from './core/StockfishManager';

export interface ChessDiagram {
  fen: string;
  shapes?: DrawShape[];
}

export class BoardCore {
  public pos: Chess;
  public board!: Api;

  private state: BoardCoreState;
  private onStateChange: () => void;
  private emitEvent: (event: string, ...args: unknown[]) => void;
  private initialConfig: Config;
  private userMovableColor: 'white' | 'black' | 'both' | undefined;

  // Sub-managers
  private domHandler: DomHandler;
  private stockfishManager: StockfishManager;
  private exerciseManager: ExerciseManager;
  private annotationManager: AnnotationManager;
  private historyViewerManager: HistoryViewerManager;
  private pgnTreeManager: PgnTreeManager;
  private boardConfigBuilder: BoardConfigBuilder;

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
    this.initialConfig = initialConfig;
    this.userMovableColor = initialConfig.movable?.color;
    this.pos = Chess.default();

    this.applyModeDefaults();

    // Sub-managers initialization
    this.domHandler = new DomHandler(boardElement);
    this.exerciseManager = new ExerciseManager();
    this.annotationManager = new AnnotationManager();
    this.historyViewerManager = new HistoryViewerManager();
    this.pgnTreeManager = new PgnTreeManager();
    this.pgnTreeManager.setRootPos(this.pos);
    this.boardConfigBuilder = new BoardConfigBuilder();

    this.stockfishManager = new StockfishManager(
      stockfishConfig,
      (bestMove) => this.emitEvent('stockfish-hint', bestMove),
      (move) => this.move(move)
    );

    this.domHandler.bindClickAndBoundsListeners(
      (sq) => this.emitEvent('square-click', sq),
      () => this.clearDomBounds(),
      () => this.getOrientation()
    );

    this.initBoard();
    this.initStockfish();

    if (diagram) {
      this.setDiagram(diagram);
    }
  }

  // --- Private helpers ---

  private get isPreserveShapes(): boolean {
    return !!this.state.preserveShapesOnPositionChange;
  }

  private applyModeDefaults(): void {
    if (!this.state.mode) {
      this.state.mode = 'game';
    }
    if (this.state.mode === 'editor' && this.state.preserveShapesOnPositionChange === undefined) {
      this.state.preserveShapesOnPositionChange = true;
    }
  }

  private getHistoryNavigationArgs() {
    return {
      path: this.pgnTreeManager.getActivePath(),
      rootFen: makeFen(this.pgnTreeManager.getRootPos().toSetup()),
      board: this.board,
      onStateChange: () => this.onStateChange(),
      updateCommentAndShapes: (fenViewing: string) => this.updateCommentAndShapes(fenViewing),
      opts: {
        isReadOnly: this.isReadOnly(),
        freeMode: !!this.state.freeMode,
      },
    };
  }

  public get game(): Chess {
    return this.pos;
  }

  /**
   * Obtient ou définit le dernier coup suggéré (hint) par Stockfish en notation UCI (ex: "e2e4").
   */
  public get lastSuggestedMove(): string {
    return this.stockfishManager.lastSuggestedMove;
  }

  public set lastSuggestedMove(move: string) {
    this.stockfishManager.lastSuggestedMove = move;
  }

  private getBoardConfigContext(): BoardConfigContext {
    return {
      state: this.state,
      pos: this.pos,
      board: this.board,
      exerciseManager: this.exerciseManager,
      historyViewerManager: this.historyViewerManager,
      annotationManager: this.annotationManager,
      pgnTreeManager: this.pgnTreeManager,
      userMovableColor: this.userMovableColor,
      setUserMovableColor: (color) => {
        this.userMovableColor = color;
      },
      getTurnColor: () => this.getTurnColor(),
      getCurrentPlyNumber: () => this.getCurrentPlyNumber(),
      getFen: () => this.getFen(),
      getPlacementFen: () => this.getPlacementFen(),
      getMode: () => this.getMode(),
      getShapes: () => this.getShapes(),
      getLastMove: () => this.getLastMove(),
      changeTurn: (orig, dest, metadata) => this.changeTurn(orig, dest, metadata),
      handleDrawableChange: (shapes) => this.handleDrawableChange(shapes as DrawShape[]),
      drawThreats: () => this.drawThreats(),
      updateCommentAndShapes: (fenStr) => this.updateCommentAndShapes(fenStr),
      emitEvent: (event, ...args) => this.emitEvent(event, ...args),
      checkUnpromotedPawns: () => this.checkUnpromotedPawns(),
      setPos: (pos) => {
        this.pos = pos;
      },
    };
  }

  private getMoveManagerContext(): MoveManagerContext {
    return {
      state: this.state,
      pos: this.pos,
      board: this.board,
      pgnTreeManager: this.pgnTreeManager,
      exerciseManager: this.exerciseManager,
      historyViewerManager: this.historyViewerManager,
      onStateChange: () => this.onStateChange(),
      emitEvent: (event, ...args) => this.emitEvent(event, ...args),
      getFen: () => this.getFen(),
      getMode: () => this.getMode(),
      updateGameState: (opts) => this.updateGameState(opts),
      triggerStockfish: () => this.triggerStockfish(),
      syncGameFromBoard: () => this.syncGameFromBoard(),
      setPos: (pos: Chess) => {
        this.pos = pos;
      },
    };
  }

  private getAnnotationContext(): AnnotationContext {
    return {
      state: this.state,
      board: this.board,
      pgnTreeManager: this.pgnTreeManager,
      historyViewerManager: this.historyViewerManager,
      getMode: () => this.getMode(),
      getHistory: (verbose) => this.getHistory(verbose),
      setCommentAtPly: (ply, text, shapes, updateBoardShapes) =>
        this.setCommentAtPly(ply, text, shapes, updateBoardShapes),
      emitEvent: (event, ...args) => this.emitEvent(event, ...args),
      onStateChange: () => this.onStateChange(),
    };
  }

  private initBoard() {
    if (this.initialConfig.fen) {
      this.safeLoadFen(this.initialConfig.fen);
    }
    const config = this.boardConfigBuilder.buildConfig(
      this.initialConfig,
      this.getBoardConfigContext()
    );
    this.board = Chessground(this.domHandler.getElement(), config);
    if (this.initialConfig.drawable?.shapes) {
      this.annotationManager.setPreservedShapes(this.initialConfig.drawable.shapes);
    }
    this.updateGameState({ updateFen: false });
  }

  private safeLoadFen(fenStr: string): boolean {
    const res = FenManager.safeLoadFen(fenStr, (pos) => {
      this.pos = pos;
      this.pgnTreeManager.resetTree(this.pos);
    });
    this.pos = res.pos;
    return res.isStandardOk;
  }

  private syncGameFromBoard(): void {
    this.boardConfigBuilder.syncGameFromBoard(this.getBoardConfigContext());
  }

  private async checkUnpromotedPawns(): Promise<void> {
    await PromotionManager.checkUnpromotedPawns(
      this.pos,
      this.state,
      () => this.getMode(),
      () => this.onStateChange(),
      () => this.updateGameState(),
      this.board
    );
  }

  private updateGameState(opts?: { updateFen?: boolean; animate?: boolean }): void {
    this.boardConfigBuilder.updateGameState(this.getBoardConfigContext(), opts);
    this.onStateChange();
  }

  private async changeTurn(orig: Key, dest: Key, metadata: MoveMetadata): Promise<void> {
    await MoveManager.changeTurn(orig, dest, metadata, this.getMoveManagerContext());
  }

  private handleDrawableChange(shapes: DrawShape[]): void {
    this.annotationManager.handleDrawableChange(shapes, this.getAnnotationContext());
  }

  private updateCommentAndShapes(fenStr: string): void {
    this.annotationManager.updateCommentAndShapes(fenStr, this.getAnnotationContext());
  }

  private initStockfish(): void {
    this.stockfishManager.initStockfish(!!this.state.freeMode);
  }

  private triggerStockfish(): void {
    this.stockfishManager.triggerStockfish(
      !!this.state.freeMode,
      this.getIsGameOver(),
      this.getTurnColor(),
      () => this.getEnginePositionCommand()
    );
  }

  private getEnginePositionCommand(): string {
    const history = this.getHistory(true) as Move[];
    const movesStr = history.map((m) => m.from + m.to + (m.promotion || '')).join(' ');
    return movesStr ? `position startpos moves ${movesStr}` : 'position startpos';
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
    this.state.mode = mode;
    this.applyModeDefaults();
    this.updateGameState({ updateFen: false });
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
    this.state.freeMode = freeMode;
    this.updateGameState({ updateFen: false });
    this.onStateChange();
  }

  public setSoloMode(soloMode: boolean): void {
    this.state.soloMode = soloMode;
    this.updateGameState({ updateFen: false });
    this.onStateChange();
  }

  public setPreserveShapesOnPositionChange(preserve: boolean): void {
    this.state.preserveShapesOnPositionChange = preserve;
    if (preserve && this.board) {
      const boardState = this.board as unknown as {
        state?: { drawable?: { shapes?: DrawShape[]; autoShapes?: DrawShape[] } };
      };
      const currentBoardShapes =
        boardState?.state?.drawable?.shapes || boardState?.state?.drawable?.autoShapes || [];
      if (currentBoardShapes.length > 0) {
        this.annotationManager.setPreservedShapes(currentBoardShapes);
      }
    }
    if (this.board) {
      this.board.set({
        drawable: {
          eraseOnMovablePieceClick: !preserve,
          defaultSnapToValidMove: this.getMode() === 'game',
        },
      });
    }
    this.onStateChange();
  }

  public setPlayerColor(color: 'white' | 'black' | 'both'): void {
    this.userMovableColor = color;
    this.updateGameState({ updateFen: false });
  }

  public clearDomBounds(): void {
    this.domHandler.clearDomBounds(this.board);
  }

  public redraw(clearBounds = true): void {
    if (clearBounds) {
      this.clearDomBounds();
    }
    this.board?.redrawAll();
  }

  public getSquareFromEvent(e: MouseEvent | TouchEvent): Key | null {
    return this.domHandler.getSquareFromEvent(e, this.getOrientation());
  }

  public setConfig(config: Config, fillDefaults = false): void {
    const finalConfig = fillDefaults
      ? this.boardConfigBuilder.buildConfig(config, this.getBoardConfigContext())
      : config;
    if (finalConfig.movable?.events && 'after' in finalConfig.movable.events) {
      const origAfter = finalConfig.movable.events.after;
      finalConfig.movable.events.after = origAfter
        ? async (orig: Key, dest: Key, metadata: MoveMetadata) => {
            await this.changeTurn(orig, dest, metadata);
            origAfter(orig, dest, metadata);
          }
        : (orig: Key, dest: Key, metadata: MoveMetadata) => this.changeTurn(orig, dest, metadata);
    }
    const { fen: configFen, ...other } = finalConfig;
    if (other.movable?.color !== undefined) {
      this.userMovableColor = other.movable.color as 'white' | 'black' | 'both';
    }
    this.board.set(other);
    if (configFen && !this.isSameFen(configFen)) {
      this.setPosition(configFen);
    }
    if (other.drawable?.shapes) {
      this.annotationManager.applyBoardShapes(
        other.drawable.shapes,
        this.board,
        this.isPreserveShapes
      );
    }
    this.board.redrawAll();
  }

  public resetBoard(): void {
    this.newGame();
  }

  public undoLastMove(): void {
    const parentNode = this.pgnTreeManager.findParentNode(
      this.pgnTreeManager.getRootNode(),
      this.pgnTreeManager.getCurrentNode()
    );
    if (!parentNode) return;

    const historyState = this.historyViewerManager.getState();
    if (historyState.isEnabled && historyState.plyViewing === this.getCurrentPlyNumber()) {
      this.stopViewingHistory();
    }

    this.pgnTreeManager.setCurrentNode(parentNode);
    this.pos = this.pgnTreeManager.syncGamePosToCurrentNode();

    if (!this.historyViewerManager.isViewingHistory()) {
      this.board.set({ fen: this.getFen() });
      this.updateGameState({ updateFen: false });
      const lastMove = this.getLastMove();
      this.board.set({
        lastMove: lastMove ? [lastMove.from as Key, lastMove.to as Key] : undefined,
      });
    }
    this.onStateChange();
    this.triggerStockfish();
  }

  public getBoard(): Api {
    return this.board;
  }

  public getMaterialCount() {
    return FenManager.getMaterialCount(this.board.state.pieces);
  }

  public getCapturedPieces() {
    return FenManager.getCapturedPieces(this.getHistory(true) as Move[]);
  }

  public getOrientation(): 'white' | 'black' {
    return this.board ? this.board.state.orientation : 'white';
  }

  public toggleOrientation(): void {
    this.board.toggleOrientation();
  }

  public drawThreats(): void {
    this.state.showThreats = true;
    this.onStateChange();
    const threats = getThreats(FenManager.getAllLegalMovesAsPojos(this.pos, this.getFen()));
    this.annotationManager.applyBoardShapes(
      threats as unknown as DrawShape[],
      this.board,
      this.isPreserveShapes
    );
  }

  public hideMoves(): void {
    this.state.showThreats = false;
    this.onStateChange();
    this.annotationManager.applyBoardShapes([], this.board, this.isPreserveShapes);
  }

  public drawMove(from: Key | string, to: Key | string, brush: string): void {
    this.annotationManager.drawMove(from, to, brush, this.board, this.isPreserveShapes);
  }

  public drawCircle(square: Key | string, brush: string): void {
    this.annotationManager.drawCircle(square, brush, this.board, this.isPreserveShapes);
  }

  public setShapes(shapes: DrawShape[] | unknown[]): void {
    this.annotationManager.applyBoardShapes(
      shapes as DrawShape[],
      this.board,
      this.isPreserveShapes
    );
  }

  public getState(): Readonly<BoardCoreState> {
    return {
      ...this.state,
      historyViewerState: this.historyViewerManager.getState(),
      turnColor: this.getTurnColor(),
      ply: this.getCurrentPlyNumber(),
      fen: this.getFen(),
      isCheck: this.getIsCheck(),
      isGameOver: this.getIsGameOver(),
    };
  }

  public getCurrentComment(): string {
    return this.state.currentComment || '';
  }

  public getHistoryViewerState(): Readonly<BoardCoreState['historyViewerState']> {
    return this.historyViewerManager.getState();
  }

  public isViewingHistory(): boolean {
    return this.historyViewerManager.isViewingHistory();
  }

  public move(moveObj: string | { from: string; to: string; promotion?: string }): boolean {
    return MoveManager.executeMove(moveObj, this.getMoveManagerContext());
  }

  public getTurnColor(): Color {
    return this.pos.turn === 'white' ? 'white' : 'black';
  }

  public getCurrentTurnNumber(): number {
    return this.pos.fullmoves;
  }

  public getCurrentPlyNumber(): number {
    return this.pgnTreeManager.getActivePath().length;
  }

  public getLastMove(): Move | null {
    return this.historyViewerManager.getLastMove(this.pgnTreeManager.getActivePath());
  }

  public getHistory(verbose = false): Move[] | string[] {
    return this.historyViewerManager.getHistory(this.pgnTreeManager.getActivePath(), verbose);
  }

  public getFen(): string {
    return makeFen(this.pos.toSetup());
  }

  public getPlacementFen(): string {
    if (this.board?.state?.pieces) {
      return FenManager.boardPiecesToPlacementFen(this.board.state.pieces);
    }
    return this.getFen().split(' ')[0];
  }

  public getPgn(): string {
    return this.pgnTreeManager.getPgn();
  }

  public getIsGameOver(): boolean {
    return this.pos.isCheckmate() || this.getIsDraw();
  }

  public getIsCheckmate(): boolean {
    return this.pos.isCheckmate();
  }

  public getIsCheck(): boolean {
    return this.pos.isCheck();
  }

  public getIsStalemate(): boolean {
    return this.pos.isStalemate();
  }

  public getIsDraw(): boolean {
    return (
      this.pos.isStalemate() ||
      this.pos.isInsufficientMaterial() ||
      this.pos.halfmoves >= 100 ||
      this.getIsThreefoldRepetition()
    );
  }

  public getIsThreefoldRepetition(): boolean {
    const ply = this.isViewingHistory()
      ? this.historyViewerManager.getCurrentViewingPly(this.pgnTreeManager.getActivePath().length)
      : undefined;
    return this.pgnTreeManager.isThreefoldRepetition(this.pos, ply);
  }

  public getIsInsufficientMaterial(): boolean {
    return this.pos.isInsufficientMaterial();
  }

  public getInCheckColor(): 'white' | 'black' | null {
    return this.getIsCheck() ? this.getTurnColor() : null;
  }

  public getGameOverReason(lang: 'fr' | 'en' = 'fr'): string {
    return FenManager.getGameOverReason(this.pos, lang, this.getIsThreefoldRepetition());
  }

  public destroy(): void {
    this.stockfishManager.terminateStockfish();
    if (this.board) {
      this.board.destroy();
    }
    this.domHandler.destroy();
  }

  public getSquareColor(square: Key | string) {
    return FenManager.getSquareColor(square);
  }

  public getSquare(square: Key | string) {
    return FenManager.getSquare(this.pos, square);
  }

  public setPosition(fenStr: string): void {
    this.safeLoadFen(fenStr);
    this.historyViewerManager.resetState();
    this.onStateChange();
    if (this.board) {
      this.board.set({ selected: undefined });
    }
    this.updateGameState();
    this.initStockfish();
    this.triggerStockfish();
  }

  public setDiagram(diagram: ChessDiagram): void {
    this.setPosition(diagram.fen);
    this.annotationManager.applyBoardShapes(
      diagram.shapes || [],
      this.board,
      this.isPreserveShapes
    );
  }

  public getDiagram(): ChessDiagram {
    return {
      fen: this.getFen(),
      shapes: this.getShapes(),
    };
  }

  public getShapes(): DrawShape[] {
    return this.annotationManager.getShapes(this.board, this.isPreserveShapes);
  }

  public getCurrentShapes(): DrawShape[] {
    return this.getShapes();
  }

  public getFinalFenFromPgn(pgnStr: string): string {
    return getFinalFenFromPgn(pgnStr, this.getFen());
  }

  public putPiece(piece: { type: string; color: 'w' | 'b' }, square: Key | string): boolean {
    const role = pieceSymbolToRole[piece.type];
    const parsedSq = parseSquare(square);
    if (parsedSq === undefined || !role) return false;

    if (this.board) {
      this.board.set({ selected: undefined });
    }
    this.pos.board.set(parsedSq, {
      role,
      color: piece.color === 'w' ? 'white' : 'black',
    });
    this.updateGameState();
    return true;
  }

  public removePiece(square: Key | string): void {
    const sq = parseSquare(square);
    if (sq !== undefined) {
      if (this.board) {
        this.board.set({ selected: undefined });
      }
      this.pos.board.take(sq);
      this.updateGameState();
    }
  }

  public loadPgn(pgnStr: string): void {
    this.pos = this.pgnTreeManager.loadPgn(pgnStr);
    this.historyViewerManager.resetState();
    this.onStateChange();
    this.updateGameState();
    const lastMove = this.getLastMove();
    if (lastMove) {
      this.board.set({ lastMove: [lastMove.from as Key, lastMove.to as Key] });
    }
    this.initStockfish();
    this.triggerStockfish();
  }

  public getPgnInfo() {
    return this.pgnTreeManager.getPgnInfo();
  }

  public setReadOnly(readOnly: boolean): void {
    this.state.readOnly = readOnly;
    this.updateGameState({ updateFen: false });
    this.onStateChange();
  }

  public isReadOnly(): boolean {
    return !!this.state.readOnly;
  }

  public newGame(fen?: string): void {
    if (fen) {
      this.safeLoadFen(fen);
    } else {
      this.pos = Chess.default();
      this.pgnTreeManager.resetTree(this.pos);
    }
    this.exerciseManager.resetSoloHistory();
    this.historyViewerManager.resetState();
    this.onStateChange();
    this.board.set({
      fen: this.getFen(),
      lastMove: undefined,
      selected: undefined,
    });
    this.updateGameState({ updateFen: false });
    this.initStockfish();
    this.triggerStockfish();
  }

  public viewHistory(ply: number): void {
    const args = this.getHistoryNavigationArgs();
    this.historyViewerManager.viewHistory(
      ply,
      args.path,
      args.rootFen,
      args.board,
      args.onStateChange,
      args.updateCommentAndShapes,
      args.opts
    );
  }

  public stopViewingHistory(): void {
    this.historyViewerManager.stopViewingHistory(
      this.board,
      () => this.onStateChange(),
      () => {
        const path = this.pgnTreeManager.getActivePath();
        const lastMove = path.length ? path[path.length - 1].data.move : null;
        this.board.set({ fen: '' });
        this.board.set({
          fen: this.getFen(),
          viewOnly: this.historyViewerManager.getState().viewOnly,
          lastMove: lastMove ? [lastMove.from as Key, lastMove.to as Key] : undefined,
        });
        this.updateGameState({ updateFen: false });
      }
    );
  }

  public viewStart(): void {
    const args = this.getHistoryNavigationArgs();
    this.historyViewerManager.viewStart(
      args.path,
      args.rootFen,
      args.board,
      args.onStateChange,
      args.updateCommentAndShapes,
      args.opts
    );
  }

  public viewNext(): void {
    const args = this.getHistoryNavigationArgs();
    this.historyViewerManager.viewNext(
      args.path,
      args.rootFen,
      args.board,
      args.onStateChange,
      args.updateCommentAndShapes,
      args.opts
    );
  }

  public viewPrevious(): void {
    const args = this.getHistoryNavigationArgs();
    this.historyViewerManager.viewPrevious(
      args.path,
      args.rootFen,
      args.board,
      args.onStateChange,
      args.updateCommentAndShapes,
      args.opts
    );
  }

  public getVariationsAtPly(ply?: number): VariationInfo[] {
    const targetPly = this.historyViewerManager.getCurrentViewingPly(
      ply !== undefined ? ply : this.pgnTreeManager.getActivePath().length
    );
    return this.pgnTreeManager.getVariationsAtPly(targetPly);
  }

  public selectVariation(variationIndex: number): boolean {
    const targetPly = this.historyViewerManager.getCurrentViewingPly(
      this.pgnTreeManager.getActivePath().length
    );

    const success = this.pgnTreeManager.selectVariation(variationIndex, targetPly);
    if (!success) return false;

    this.pos = this.pgnTreeManager.syncGamePosToCurrentNode();

    const newPly = targetPly + 1;
    const activePath = this.pgnTreeManager.getActivePath();

    if (this.historyViewerManager.isViewingHistory()) {
      if (newPly >= activePath.length) {
        this.stopViewingHistory();
      } else {
        this.viewHistory(newPly);
      }
    } else {
      this.updateGameState();
    }
    this.onStateChange();
    return true;
  }

  public deleteVariation(variationIndex?: number): boolean {
    const targetPly = this.historyViewerManager.getCurrentViewingPly(
      this.pgnTreeManager.getActivePath().length
    );
    const idx = variationIndex !== undefined ? variationIndex : 0;
    const success = this.pgnTreeManager.deleteVariation(idx, targetPly);
    if (success) {
      this.pos = this.pgnTreeManager.syncGamePosToCurrentNode();
      const activePath = this.pgnTreeManager.getActivePath();
      if (this.historyViewerManager.isViewingHistory()) {
        const viewingPly = Math.min(targetPly, activePath.length);
        if (viewingPly >= activePath.length) {
          this.stopViewingHistory();
        } else {
          this.viewHistory(viewingPly);
        }
      } else {
        this.updateGameState();
      }
      this.onStateChange();
    }
    return success;
  }

  public promoteVariation(variationIndex?: number): boolean {
    const targetPly = this.historyViewerManager.getCurrentViewingPly(
      this.pgnTreeManager.getActivePath().length
    );
    const idx = variationIndex !== undefined ? variationIndex : 0;
    const success = this.pgnTreeManager.promoteVariation(idx, targetPly);
    if (success) {
      this.pos = this.pgnTreeManager.syncGamePosToCurrentNode();
      const activePath = this.pgnTreeManager.getActivePath();
      const newPly = targetPly + 1;
      if (this.historyViewerManager.isViewingHistory()) {
        if (newPly >= activePath.length) {
          this.stopViewingHistory();
        } else {
          this.viewHistory(newPly);
        }
      } else {
        this.updateGameState();
      }
      this.onStateChange();
    }
    return success;
  }

  public getPgnTree(): PgnTreeNode {
    return this.pgnTreeManager.getPgnTree();
  }

  public updateStockfishConfig(config: StockfishConfig): void {
    this.stockfishManager.updateStockfishConfig(
      config,
      !!this.state.freeMode,
      this.getIsGameOver(),
      this.getTurnColor(),
      () => this.getEnginePositionCommand()
    );
  }

  public setCommentAtPly(
    ply: number,
    text: string,
    shapes: DrawShape[] = [],
    updateBoardShapes = true
  ): void {
    const path = this.pgnTreeManager.getActivePath();
    if (ply < 0 || ply > path.length) return;

    const shapesAnnotation = this.annotationManager.shapesToPgnComment(shapes);
    const combined = `${shapesAnnotation} ${text}`.trim();

    if (ply === 0) {
      if (path.length > 0) {
        path[0].data.startingComments = combined ? [combined] : [];
      }
    } else {
      const targetNode = path[ply - 1];
      if (isChildNode(targetNode)) {
        targetNode.data.comments = combined ? [combined] : [];
      }
    }

    const isViewingThisPly = this.historyViewerManager.getCurrentViewingPly(path.length) === ply;

    if (isViewingThisPly) {
      this.state.currentComment = text;
      if (updateBoardShapes) {
        this.annotationManager.applyBoardShapes(shapes, this.board, this.isPreserveShapes);
      }
      this.onStateChange();
    }
  }

  public setComment(text: string, shapes: DrawShape[] = []): void {
    const ply = this.historyViewerManager.getCurrentViewingPly(
      (this.getHistory(true) as Move[]).length
    );
    this.setCommentAtPly(ply, text, shapes);
  }

  public setCustomDests(dests: Map<Key, Key[]> | null): void {
    this.exerciseManager.setCustomDests(dests);
    this.updateGameState({ updateFen: false });
  }

  public restrictMovesToPieces(squares: Key[] | null): void {
    this.exerciseManager.restrictMovesToPieces(squares, this.pos);
    this.updateGameState({ updateFen: false });
  }

  public isSquareAttacked(square: Key, byColor: 'white' | 'black'): boolean {
    return this.exerciseManager.isSquareAttacked(square, byColor, this.pos);
  }

  public getPieces(): Map<Key, { type: string; color: 'w' | 'b' }> {
    return this.exerciseManager.getPieces(this.board.state.pieces);
  }

  public getSoloHistory(): Move[] {
    return this.exerciseManager.getSoloHistory();
  }
}
