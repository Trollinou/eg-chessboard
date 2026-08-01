import { Chess, parseSquare, makeSquare } from 'chessops';
import { parseFen, makeFen } from 'chessops/fen';
import { parseSan, makeSanAndPlay } from 'chessops/san';
import { isChildNode, ChildNode } from 'chessops/pgn';
import {
  isNormal,
  type Color as ChessopsColor,
  type Role,
  type Move as ChessopsMove,
} from 'chessops/types';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Config } from '@lichess-org/chessground/config';
import type { Color, Key, MoveMetadata } from '@lichess-org/chessground/types';
import type { DrawShape } from '@lichess-org/chessground/draw';

import {
  possibleMoves,
  isPromotion,
  shortToLongColor,
  getThreats,
  getFinalFenFromPgn,
} from './BoardHelper';
import type { Move, PgnNodeMeta, VariationInfo, PgnTreeNode } from './types';

import { DomHandler } from './core/DomHandler';
import { StockfishManager, type StockfishConfig } from './core/StockfishManager';
import { ExerciseManager } from './core/ExerciseManager';
import { AnnotationManager } from './core/AnnotationManager';
import { HistoryViewerManager } from './core/HistoryViewerManager';
import { PgnTreeManager } from './core/PgnTreeManager';

export interface BoardCoreState {
  showThreats: boolean;
  freeMode?: boolean;
  soloMode?: boolean;
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
}

export type { StockfishConfig, StockfishMode } from './core/StockfishManager';

export interface ChessDiagram {
  fen: string;
  shapes?: DrawShape[];
}

const roleToPieceSymbol: Record<Role, string> = {
  pawn: 'p',
  knight: 'n',
  bishop: 'b',
  rook: 'r',
  queen: 'q',
  king: 'k',
};

const pieceSymbolToRole: Record<string, Role> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

function boardPiecesToPlacementFen(pieces: Map<Key, { role: Role; color: Color }>): string {
  const roleToChar: Record<string, string> = {
    pawn: 'p',
    knight: 'n',
    bishop: 'b',
    rook: 'r',
    queen: 'q',
    king: 'k',
  };
  const ranks: string[] = [];
  for (let rank = 8; rank >= 1; rank--) {
    let rankStr = '';
    let emptyCount = 0;
    for (let fileIdx = 0; fileIdx < 8; fileIdx++) {
      const file = String.fromCharCode(97 + fileIdx);
      const square = `${file}${rank}` as Key;
      const piece = pieces.get(square);
      if (piece) {
        if (emptyCount > 0) {
          rankStr += emptyCount.toString();
          emptyCount = 0;
        }
        const char = roleToChar[piece.role] || 'p';
        rankStr += piece.color === 'white' ? char.toUpperCase() : char;
      } else {
        emptyCount++;
      }
    }
    if (emptyCount > 0) {
      rankStr += emptyCount.toString();
    }
    ranks.push(rankStr);
  }
  return ranks.join('/');
}

export class BoardCore {
  public pos: Chess;
  public board!: Api;

  private state: BoardCoreState;
  private onStateChange: () => void;
  private emitEvent: (event: string, ...args: unknown[]) => void;
  private initialConfig: Config;
  private userMovableColor: 'white' | 'black' | 'both' | undefined;
  private cachedFen: string | null = null;
  private isSyncing = false;

  // Sub-managers
  private domHandler: DomHandler;
  private stockfishManager: StockfishManager;
  private exerciseManager: ExerciseManager;
  private annotationManager: AnnotationManager;
  private historyViewerManager: HistoryViewerManager;
  private pgnTreeManager: PgnTreeManager;

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

    // Sub-managers initialization
    this.domHandler = new DomHandler(boardElement);
    this.exerciseManager = new ExerciseManager();
    this.annotationManager = new AnnotationManager();
    this.historyViewerManager = new HistoryViewerManager();
    this.pgnTreeManager = new PgnTreeManager();
    this.pgnTreeManager.setRootPos(this.pos);

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

  public get game(): Chess {
    return this.pos;
  }

  public get lastSuggestedMove(): string {
    return this.stockfishManager.lastSuggestedMove;
  }

  public set lastSuggestedMove(move: string) {
    this.stockfishManager.lastSuggestedMove = move;
  }

  private initBoard() {
    if (this.initialConfig.fen) {
      this.safeLoadFen(this.initialConfig.fen);
    }
    const config = this.buildConfig(this.initialConfig);
    this.board = Chessground(this.domHandler['boardElement'], config);
    this.updateGameState({ updateFen: false });
  }

  private safeLoadFen(fenStr: string): boolean {
    this.cachedFen = null;
    const setupRes = parseFen(fenStr);
    if (setupRes.isOk) {
      const chessRes = Chess.fromSetup(setupRes.value);
      if (chessRes.isOk) {
        this.pos = chessRes.value;
        this.pgnTreeManager.resetTree(this.pos);
        return true;
      }
    }

    console.warn('Invalid FEN loaded, fallback to manual piece placing:', fenStr);

    const parts = fenStr.split(' ');
    const placement = parts[0];

    const minSetupRes = parseFen(`4k3/8/8/8/8/8/8/4K3 ${parts[1] === 'b' ? 'b' : 'w'} - - 0 1`);
    if (minSetupRes.isOk) {
      const minChess = Chess.fromSetup(minSetupRes.value);
      if (minChess.isOk) {
        this.pos = minChess.value;
      }
    }
    this.pos.board.take(parseSquare('e1')!);
    this.pos.board.take(parseSquare('e8')!);
    this.pos.turn = parts[1] === 'b' ? 'black' : 'white';

    const ranks = placement.split('/');
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

    for (let r = 0; r < 8; r++) {
      const rankStr = ranks[r];
      if (!rankStr) continue;
      let fileIdx = 0;
      for (let i = 0; i < rankStr.length; i++) {
        const char = rankStr[i];
        if (/[1-8]/.test(char)) {
          fileIdx += parseInt(char, 10);
        } else {
          const color: ChessopsColor = char === char.toUpperCase() ? 'white' : 'black';
          const role = pieceSymbolToRole[char.toLowerCase()];
          const square = parseSquare(`${files[fileIdx]}${8 - r}`)!;
          if (fileIdx < 8 && role) {
            this.pos.board.set(square, { role, color });
          }
          fileIdx++;
        }
      }
    }
    this.pgnTreeManager.resetTree(this.pos);
    return false;
  }

  private buildConfig(userConfig: Config): Config {
    const defaultEvents = {
      after: (orig: Key, dest: Key, metadata: MoveMetadata) => {
        this.changeTurn(orig, dest, metadata);
      },
    };

    const isFree = !!this.state.freeMode;

    if (userConfig.movable?.color !== undefined) {
      this.userMovableColor = userConfig.movable.color;
    }

    const mergedMovable = {
      free: isFree,
      color: (isFree ? 'both' : this.userMovableColor || this.getTurnColor()) as
        'white' | 'black' | 'both',
      dests: isFree ? this.getPossibleMovesForBothColors() : possibleMoves(this.pos),
      events: defaultEvents,
      ...(userConfig.movable || {}),
    };

    if (userConfig.movable?.events) {
      mergedMovable.events = {
        ...defaultEvents,
        ...userConfig.movable.events,
      };
    }

    const mergedEvents = {
      change: () => {
        if (this.state.freeMode) {
          this.syncGameFromBoard();
        }
      },
      select: () => {},
      ...(userConfig.events || {}),
    };

    const userSelect = userConfig.events?.select;
    if (userSelect) {
      mergedEvents.select = (key: Key) => {
        userSelect(key);
      };
    }

    const userChange = userConfig.events?.change;
    if (userChange) {
      mergedEvents.change = () => {
        if (this.state.freeMode) {
          this.syncGameFromBoard();
        }
        userChange();
      };
    }

    const isPreserve = !!this.state.preserveShapesOnPositionChange;

    const mergedDrawable = {
      enabled: true,
      eraseOnMovablePieceClick: !isPreserve,
      onChange: (shapes: DrawShape[]) => {
        this.handleDrawableChange(shapes);
      },
      ...(userConfig.drawable || {}),
    };

    const config: Config = {
      fen: this.getFen(),
      turnColor: this.getTurnColor(),
      ...userConfig,
      movable: mergedMovable,
      events: mergedEvents,
      drawable: mergedDrawable,
    };

    return config;
  }

  private getPossibleMovesForBothColors(): Map<Key, Key[]> {
    const dests = possibleMoves(this.pos);
    const swapped = this.pos.clone();
    swapped.turn = swapped.turn === 'white' ? 'black' : 'white';
    const otherDests = possibleMoves(swapped);
    for (const [key, value] of otherDests.entries()) {
      dests.set(key, value);
    }
    return dests;
  }

  private syncGameFromBoard(): void {
    if (this.isSyncing) return;
    this.isSyncing = true;
    try {
      const placement = this.getPlacementFen();
      const currentFenParts = this.getFen().split(' ');
      const turn = currentFenParts[1] || 'w';
      const castling = currentFenParts[2] || '-';
      const ep = currentFenParts[3] || '-';
      const halfmove = currentFenParts[4] || '0';
      const fullmove = currentFenParts[5] || '1';

      const newFen = `${placement} ${turn} ${castling} ${ep} ${halfmove} ${fullmove}`;

      const setupRes = parseFen(newFen);
      if (setupRes.isOk) {
        const chessRes = Chess.fromSetup(setupRes.value);
        if (chessRes.isOk) {
          this.pos = chessRes.value;
          this.cachedFen = null;
        }
      }

      this.emitEvent('move', {
        after: newFen,
      });
    } finally {
      this.isSyncing = false;
    }
  }

  private updateGameState({ updateFen = true } = {}): void {
    if (!this.historyViewerManager.isViewingHistory()) {
      const currentShapes = this.getShapes();
      const savedShapes = this.state.preserveShapesOnPositionChange ? [...currentShapes] : null;

      const isFree = !!this.state.freeMode;
      const isSolo = !!this.state.soloMode;
      const isPreserve = !!this.state.preserveShapesOnPositionChange;

      if (
        isSolo &&
        this.userMovableColor &&
        (this.userMovableColor === 'white' || this.userMovableColor === 'black')
      ) {
        const requiredTurn: ChessopsColor = this.userMovableColor === 'white' ? 'white' : 'black';
        if (this.pos.turn !== requiredTurn) {
          this.pos.turn = requiredTurn;
        }
      }

      const lastMove = this.getLastMove();

      this.board.set({
        ...(updateFen ? { fen: this.getFen() } : {}),
        turnColor: this.getTurnColor(),
        check: this.pos.isCheck() ? this.getTurnColor() : undefined,
        animation: { enabled: !isPreserve && !isFree },
        lastMove: lastMove ? [lastMove.from as Key, lastMove.to as Key] : undefined,
        movable: {
          free: isFree,
          color: isFree ? 'both' : this.userMovableColor || this.getTurnColor(),
          dests:
            this.exerciseManager.getCustomDests() ||
            (isFree || (isSolo && (!this.userMovableColor || this.userMovableColor === 'both'))
              ? this.getPossibleMovesForBothColors()
              : possibleMoves(this.pos)),
        },
        drawable: {
          eraseOnMovablePieceClick: !isPreserve,
          ...(savedShapes
            ? {
                autoShapes: [],
                shapes: savedShapes,
              }
            : {}),
        },
      });

      if (this.state.showThreats) {
        this.drawThreats();
      } else if (!savedShapes) {
        this.updateCommentAndShapes(this.getFen());
      }
    }

    this.emitEvents();
  }

  private emitEvents(): void {
    if (this.pos.isCheck()) {
      this.emitEvent(this.pos.isCheckmate() ? 'checkmate' : 'check', this.getTurnColor());
    }
    if (this.pos.isStalemate()) {
      this.emitEvent('stalemate');
    } else if (this.pos.isEnd()) {
      this.emitEvent('draw');
    }
  }

  private async changeTurn(orig: Key, dest: Key, _metadata: MoveMetadata): Promise<void> {
    const sq = parseSquare(orig)!;
    const piece = this.pos.board.get(sq);
    const pieceType = piece ? roleToPieceSymbol[piece.role] : 'p';
    const pieceColor = piece
      ? piece.color === 'white'
        ? 'w'
        : 'b'
      : this.pos.turn === 'white'
        ? 'w'
        : 'b';

    if (isPromotion(dest, { type: pieceType, color: pieceColor })) {
      const selectedPromotion = await new Promise<string>((resolve) => {
        this.state.promotionDialogState = {
          isEnabled: true,
          color: shortToLongColor(pieceColor),
          callback: (promoPiece) => {
            resolve(promoPiece);
          },
        };
        this.onStateChange();
      });

      this.move({
        from: orig,
        to: dest,
        promotion: selectedPromotion.toLowerCase(),
      });
    } else {
      this.move({
        from: orig,
        to: dest,
      });
    }
  }

  private handleDrawableChange(shapes: DrawShape[]): void {
    if (this.annotationManager.isDrawingUpdate || this.annotationManager.isProgrammaticShapeUpdate)
      return;

    this.annotationManager.isDrawingUpdate = true;
    try {
      this.annotationManager.setPreservedShapes(shapes);
      if (this.state.preserveShapesOnPositionChange && this.board) {
        // User shapes maintained by Chessground
      } else {
        const historyViewerState = this.historyViewerManager.getState();
        const ply =
          historyViewerState.isEnabled && historyViewerState.plyViewing !== undefined
            ? historyViewerState.plyViewing
            : (this.getHistory(true) as Move[]).length;

        this.setCommentAtPly(ply, this.state.currentComment || '', shapes, false);
      }
      this.emitEvent('shapes-change', shapes);
    } finally {
      this.annotationManager.isDrawingUpdate = false;
    }
  }

  private updateCommentAndShapes(_fenStr: string): void {
    const currentNode = this.pgnTreeManager.getCurrentNode();
    let rawComment = '';
    if (isChildNode(currentNode) && currentNode.data.comments) {
      rawComment = currentNode.data.comments.join(' ');
    }

    if (!rawComment) {
      this.state.currentComment = '';
      if (this.isViewingHistory() && !this.state.preserveShapesOnPositionChange) {
        this.annotationManager.applyBoardShapes([], this.board, false);
      }
      this.onStateChange();
      return;
    }

    const parsed = this.annotationManager.parseComment(rawComment);
    this.state.currentComment = parsed.text;
    if (!this.state.preserveShapesOnPositionChange) {
      this.annotationManager.applyBoardShapes(parsed.shapes, this.board, false);
    }
    this.onStateChange();
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

  // PUBLIC API CONTRACT

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
    if (this.board) {
      this.board.set({
        drawable: {
          eraseOnMovablePieceClick: !preserve,
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

  private isSameFen(fenStr: string): boolean {
    const currentFen = this.getFen();
    if (fenStr === currentFen) return true;
    const normalize = (f: string) => f.trim().split(/\s+/).join(' ');
    if (normalize(fenStr) === normalize(currentFen)) return true;
    if (!fenStr.includes(' ') && fenStr.trim() === this.getPlacementFen()) return true;
    return false;
  }

  public setConfig(config: Config, fillDefaults = false): void {
    const finalConfig = fillDefaults ? this.buildConfig(config) : config;
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
        !!this.state.preserveShapesOnPositionChange
      );
    }
    this.board.redrawAll();
  }

  public resetBoard(): void {
    this.pos = Chess.default();
    this.cachedFen = null;
    this.pgnTreeManager.resetTree(this.pos);
    this.exerciseManager.resetSoloHistory();
    this.historyViewerManager.resetState();
    this.onStateChange();
    this.board.set({
      fen: this.getFen(),
      lastMove: undefined,
    });
    this.updateGameState({ updateFen: false });
    this.initStockfish();
    this.triggerStockfish();
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
    this.cachedFen = null;

    if (!this.historyViewerManager.isViewingHistory()) {
      this.board.set({ fen: this.getFen() });
      this.updateGameState({ updateFen: false });
      const lastMove = this.getLastMove();
      this.board.set({
        lastMove: lastMove ? [lastMove.from as Key, lastMove.to as Key] : undefined,
      });
    }
    this.triggerStockfish();
  }

  public getMaterialCount() {
    const pieces = this.board.state.pieces;
    const piecesValues: Record<string, number> = {
      pawn: 1,
      knight: 3,
      bishop: 3,
      rook: 5,
      queen: 9,
      king: 0,
    };

    const materialCount = {
      materialWhite: 0,
      materialBlack: 0,
      materialDiff: 0,
    };

    for (const piece of pieces.values()) {
      if (piece.color === 'white') {
        materialCount.materialWhite += piecesValues[piece.role];
      } else {
        materialCount.materialBlack += piecesValues[piece.role];
      }
    }
    materialCount.materialDiff = materialCount.materialWhite - materialCount.materialBlack;
    return materialCount;
  }

  public getCapturedPieces() {
    const captured = {
      white: [] as string[],
      black: [] as string[],
    };
    for (const move of this.getHistory(true) as Move[]) {
      if (move.captured) {
        const capturingColor = move.color === 'w' ? 'white' : 'black';
        captured[capturingColor].push(move.captured);
      }
    }
    return captured;
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
    const threats = getThreats(this.getAllLegalMovesAsPojos());
    this.annotationManager.applyBoardShapes(
      threats as unknown as DrawShape[],
      this.board,
      !!this.state.preserveShapesOnPositionChange
    );
  }

  private getAllLegalMovesAsPojos(): Move[] {
    const moves: Move[] = [];
    const fenBefore = this.getFen();
    const ctx = this.pos.ctx();
    for (const [from, dests] of this.pos.allDests(ctx)) {
      for (const destSq of dests) {
        const piece = this.pos.board.get(from);
        const role = piece ? piece.role : 'pawn';
        const color = piece ? (piece.color === 'white' ? 'w' : 'b') : 'w';
        const origStr = makeSquare(from);
        const destStr = makeSquare(destSq);
        let capturedPiece = this.pos.board.get(destSq);
        const isEnPassant = piece?.role === 'pawn' && origStr[0] !== destStr[0] && !capturedPiece;
        if (isEnPassant) {
          capturedPiece = { role: 'pawn', color: color === 'w' ? 'black' : 'white' };
        }

        const temp = this.pos.clone();
        const moveObj: ChessopsMove = { from, to: destSq };
        const sanStr = makeSanAndPlay(temp, moveObj);
        const fenAfter = makeFen(temp.toSetup());

        moves.push({
          from: origStr,
          to: destStr,
          piece: roleToPieceSymbol[role],
          color,
          san: sanStr,
          captured: capturedPiece ? roleToPieceSymbol[capturedPiece.role] : undefined,
          before: fenBefore,
          after: fenAfter,
        });
      }
    }
    return moves;
  }

  public hideMoves(): void {
    this.state.showThreats = false;
    this.onStateChange();
    this.annotationManager.applyBoardShapes(
      [],
      this.board,
      !!this.state.preserveShapesOnPositionChange
    );
  }

  public drawMove(from: Key | string, to: Key | string, brush: string): void {
    this.annotationManager.drawMove(
      from,
      to,
      brush,
      this.board,
      !!this.state.preserveShapesOnPositionChange
    );
  }

  public drawCircle(square: Key | string, brush: string): void {
    this.annotationManager.drawCircle(
      square,
      brush,
      this.board,
      !!this.state.preserveShapesOnPositionChange
    );
  }

  public setShapes(shapes: DrawShape[] | unknown[]): void {
    this.annotationManager.applyBoardShapes(
      shapes as DrawShape[],
      this.board,
      !!this.state.preserveShapesOnPositionChange
    );
  }

  public getState(): Readonly<BoardCoreState> {
    return {
      ...this.state,
      historyViewerState: this.historyViewerManager.getState(),
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
    console.log('[BoardCore] move called with:', moveObj);
    let parsedMove: ChessopsMove | undefined;

    if (this.state.freeMode) {
      if (typeof moveObj === 'string') {
        const posWhite = this.pos.clone();
        posWhite.turn = 'white';
        const moveWhite = parseSan(posWhite, moveObj);
        if (moveWhite && posWhite.isLegal(moveWhite)) {
          this.pos.turn = 'white';
          parsedMove = moveWhite;
        } else {
          const posBlack = this.pos.clone();
          posBlack.turn = 'black';
          const moveBlack = parseSan(posBlack, moveObj);
          if (moveBlack && posBlack.isLegal(moveBlack)) {
            this.pos.turn = 'black';
            parsedMove = moveBlack;
          }
        }
      } else {
        const fromSq = parseSquare(moveObj.from);
        const toSq = parseSquare(moveObj.to);
        if (fromSq !== undefined && toSq !== undefined) {
          const promoRole = moveObj.promotion
            ? pieceSymbolToRole[moveObj.promotion.toLowerCase()]
            : undefined;
          parsedMove = { from: fromSq, to: toSq, promotion: promoRole };
          const piece = this.pos.board.get(fromSq);
          if (piece) {
            this.pos.turn = piece.color;
          }
        }
      }
    } else {
      if (typeof moveObj === 'string') {
        parsedMove = parseSan(this.pos, moveObj);
      } else {
        const fromSq = parseSquare(moveObj.from);
        const toSq = parseSquare(moveObj.to);
        if (fromSq !== undefined && toSq !== undefined) {
          const promoRole = moveObj.promotion
            ? pieceSymbolToRole[moveObj.promotion.toLowerCase()]
            : undefined;
          parsedMove = { from: fromSq, to: toSq, promotion: promoRole };
        }
      }
    }

    if (!parsedMove || !this.pos.isLegal(parsedMove)) {
      console.error('[BoardCore] move failed or illegal:', moveObj);
      return false;
    }

    const colorBefore: 'w' | 'b' = this.pos.turn === 'white' ? 'w' : 'b';
    const fenBefore = this.getFen();
    const fromStr = isNormal(parsedMove) ? makeSquare(parsedMove.from) : '';
    const toStr = makeSquare(parsedMove.to);
    const pieceBefore = isNormal(parsedMove) ? this.pos.board.get(parsedMove.from) : undefined;
    let capturedPiece = this.pos.board.get(parsedMove.to);
    const isEnPassant =
      isNormal(parsedMove) &&
      pieceBefore?.role === 'pawn' &&
      fromStr[0] !== toStr[0] &&
      !capturedPiece;

    if (isEnPassant) {
      capturedPiece = { role: 'pawn', color: colorBefore === 'w' ? 'black' : 'white' };
    }

    const promoChar =
      isNormal(parsedMove) && parsedMove.promotion
        ? roleToPieceSymbol[parsedMove.promotion]
        : undefined;
    const sanStr = makeSanAndPlay(this.pos, parsedMove);
    this.cachedFen = null;
    const fenAfter = this.getFen();

    const movePojo: Move = {
      from: fromStr,
      to: toStr,
      piece: pieceBefore ? roleToPieceSymbol[pieceBefore.role] : 'p',
      color: colorBefore,
      san: sanStr,
      captured: capturedPiece ? roleToPieceSymbol[capturedPiece.role] : undefined,
      promotion: promoChar,
      before: fenBefore,
      after: fenAfter,
    };

    if (this.state.soloMode) {
      this.exerciseManager.addSoloMove(movePojo);
      this.pos.turn = colorBefore === 'w' ? 'white' : 'black';
      this.cachedFen = null;
    }

    const currentNode = this.pgnTreeManager.getCurrentNode();
    let childNode = currentNode.children.find(
      (child) =>
        child.data.san === sanStr ||
        (child.data.move.from === fromStr && child.data.move.to === toStr)
    );

    if (!childNode) {
      childNode = new ChildNode<PgnNodeMeta>({
        san: sanStr,
        fen: fenAfter,
        move: movePojo,
      });
      currentNode.children.push(childNode!);
    }
    this.pgnTreeManager.setCurrentNode(childNode!);

    if (!this.historyViewerManager.isViewingHistory()) {
      this.board.move(fromStr as Key, toStr as Key);
      if (isNormal(parsedMove) && parsedMove.promotion) {
        setTimeout(() => {
          this.board.set({ fen: this.getFen() });
        }, 50);
      }
      this.updateGameState({ updateFen: true });
    }

    this.emitEvent('move', movePojo);

    if (isNormal(parsedMove) && parsedMove.promotion) {
      this.emitEvent('promotion', {
        color: shortToLongColor(colorBefore),
        promotedTo: roleToPieceSymbol[parsedMove.promotion].toUpperCase(),
        sanMove: sanStr,
      });
    }

    this.triggerStockfish();
    return true;
  }

  public getTurnColor(): Color {
    return shortToLongColor(this.pos.turn === 'white' ? 'w' : 'b');
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
    if (!this.cachedFen) {
      this.cachedFen = makeFen(this.pos.toSetup());
    }
    return this.cachedFen;
  }

  public getPlacementFen(): string {
    if (this.board?.state?.pieces) {
      return boardPiecesToPlacementFen(this.board.state.pieces);
    }
    return this.getFen().split(' ')[0];
  }

  public getPgn(): string {
    return this.pgnTreeManager.getPgn();
  }

  public getIsGameOver(): boolean {
    return this.pos.isEnd();
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
    return this.pos.isEnd() && !this.pos.isCheckmate();
  }

  public getIsThreefoldRepetition(): boolean {
    return false;
  }

  public getIsInsufficientMaterial(): boolean {
    return this.pos.isInsufficientMaterial();
  }

  public getInCheckColor(): 'white' | 'black' | null {
    return this.getIsCheck() ? this.getTurnColor() : null;
  }

  public getGameOverReason(lang: 'fr' | 'en' = 'fr'): string {
    if (!this.getIsGameOver()) return '';
    if (this.getIsCheckmate()) {
      const winner =
        this.getTurnColor() === 'white'
          ? lang === 'fr'
            ? 'Noirs'
            : 'Black'
          : lang === 'fr'
            ? 'Blancs'
            : 'White';
      return lang === 'fr'
        ? `Échec et mat ! Les ${winner} ont gagné.`
        : `Checkmate! ${winner} won.`;
    }
    if (this.getIsStalemate()) return lang === 'fr' ? 'Match nul par Pat.' : 'Draw by stalemate.';
    if (this.getIsInsufficientMaterial())
      return lang === 'fr'
        ? 'Match nul par matériel insuffisant.'
        : 'Draw by insufficient material.';
    return lang === 'fr' ? 'Match nul.' : 'Draw.';
  }

  public destroy(): void {
    this.stockfishManager.terminateStockfish();
    if (this.board) {
      this.board.destroy();
    }
    this.domHandler.destroy();
  }

  public getSquareColor(square: Key | string) {
    const sq = parseSquare(square);
    if (sq === undefined) return null;
    const rank = Math.floor(sq / 8);
    const file = sq % 8;
    return (rank + file) % 2 === 0 ? 'dark' : 'light';
  }

  public getSquare(square: Key | string) {
    const sq = parseSquare(square);
    if (sq === undefined) return undefined;
    const piece = this.pos.board.get(sq);
    if (!piece) return null;
    return {
      type: roleToPieceSymbol[piece.role],
      color: piece.color === 'white' ? ('w' as const) : ('b' as const),
    };
  }

  public setPosition(fenStr: string): void {
    this.safeLoadFen(fenStr);
    this.historyViewerManager.resetState();
    this.onStateChange();
    this.updateGameState();
    this.initStockfish();
    this.triggerStockfish();
  }

  public setDiagram(diagram: ChessDiagram): void {
    this.setPosition(diagram.fen);
    this.annotationManager.applyBoardShapes(
      diagram.shapes || [],
      this.board,
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
    return this.annotationManager.getShapes(
      this.board,
      !!this.state.preserveShapesOnPositionChange
    );
  }

  public getCurrentShapes(): DrawShape[] {
    return this.getShapes();
  }

  public getFinalFenFromPgn(pgnStr: string): string {
    return getFinalFenFromPgn(pgnStr, this.getFen());
  }

  public putPiece(piece: { type: string; color: 'w' | 'b' }, square: Key | string): boolean {
    const sq = parseSquare(square);
    if (sq === undefined) return false;
    const role = pieceSymbolToRole[piece.type];
    if (!role) return false;
    this.pos.board.set(sq, { role, color: piece.color === 'w' ? 'white' : 'black' });
    this.cachedFen = null;
    this.updateGameState();
    return true;
  }

  public removePiece(square: Key | string): void {
    const sq = parseSquare(square);
    if (sq !== undefined) {
      this.pos.board.take(sq);
      this.cachedFen = null;
      this.updateGameState();
    }
  }

  public loadPgn(pgnStr: string): void {
    this.pos = this.pgnTreeManager.loadPgn(pgnStr);
    this.cachedFen = null;
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

  public viewHistory(ply: number): void {
    const path = this.pgnTreeManager.getActivePath();
    const rootFen = makeFen(this.pgnTreeManager.getRootPos().toSetup());
    this.historyViewerManager.viewHistory(
      ply,
      path,
      rootFen,
      this.board,
      () => this.onStateChange(),
      (fenViewing) => this.updateCommentAndShapes(fenViewing)
    );
  }

  public stopViewingHistory(): void {
    this.historyViewerManager.stopViewingHistory(
      this.board,
      () => this.onStateChange(),
      () => {
        const path = this.pgnTreeManager.getActivePath();
        const lastMove = path.length ? path[path.length - 1].data.move : null;
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
    this.viewHistory(0);
  }

  public viewNext(): void {
    const historyState = this.historyViewerManager.getState();
    if (historyState.isEnabled && historyState.plyViewing !== undefined) {
      this.viewHistory(historyState.plyViewing + 1);
    }
  }

  public viewPrevious(): void {
    const historyState = this.historyViewerManager.getState();
    const ply =
      historyState.isEnabled && historyState.plyViewing !== undefined
        ? historyState.plyViewing
        : this.getCurrentPlyNumber();
    this.viewHistory(ply - 1);
  }

  public getVariationsAtPly(ply?: number): VariationInfo[] {
    const historyState = this.historyViewerManager.getState();
    const targetPly =
      ply !== undefined
        ? ply
        : historyState.isEnabled && historyState.plyViewing !== undefined
          ? historyState.plyViewing
          : this.pgnTreeManager.getActivePath().length;
    return this.pgnTreeManager.getVariationsAtPly(targetPly);
  }

  public selectVariation(variationIndex: number): boolean {
    const historyState = this.historyViewerManager.getState();
    const targetPly =
      historyState.isEnabled && historyState.plyViewing !== undefined
        ? historyState.plyViewing
        : this.pgnTreeManager.getActivePath().length;

    const success = this.pgnTreeManager.selectVariation(variationIndex, targetPly);
    if (!success) return false;

    this.pos = this.pgnTreeManager.syncGamePosToCurrentNode();
    this.cachedFen = null;

    if (historyState.isEnabled) {
      this.viewHistory(targetPly);
    } else {
      this.updateGameState();
    }
    this.onStateChange();
    return true;
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

    const targetNode = ply === 0 ? this.pgnTreeManager.getRootNode() : path[ply - 1];
    const shapesAnnotation = this.annotationManager.shapesToPgnComment(shapes);
    const combined = `${shapesAnnotation} ${text}`.trim();

    if (isChildNode(targetNode)) {
      targetNode.data.comments = combined ? [combined] : [];
    }

    const historyState = this.historyViewerManager.getState();
    const isViewingThisPly = historyState.isEnabled
      ? historyState.plyViewing === ply
      : ply === path.length;

    if (isViewingThisPly) {
      this.state.currentComment = text;
      if (updateBoardShapes) {
        this.annotationManager.applyBoardShapes(
          shapes,
          this.board,
          !!this.state.preserveShapesOnPositionChange
        );
      }
      this.onStateChange();
    }
  }

  public setComment(text: string, shapes: DrawShape[] = []): void {
    const historyState = this.historyViewerManager.getState();
    const ply =
      historyState.isEnabled && historyState.plyViewing !== undefined
        ? historyState.plyViewing
        : (this.getHistory(true) as Move[]).length;
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
