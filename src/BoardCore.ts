import { Chess, parseSquare, makeSquare } from 'chessops';
import { parseFen, makeFen } from 'chessops/fen';
import { parseSan, makeSanAndPlay } from 'chessops/san';
import {
  parsePgn,
  makePgn,
  Node,
  ChildNode,
  isChildNode,
  transform,
  startingPosition,
  defaultHeaders,
  type PgnNodeData,
} from 'chessops/pgn';
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

class TransformContext {
  constructor(public pos: Chess) {}
  clone(): TransformContext {
    return new TransformContext(this.pos.clone());
  }
}

class EmptyContext {
  clone(): EmptyContext {
    return new EmptyContext();
  }
}

export class BoardCore {
  public pos: Chess;
  public board!: Api;
  private boardElement: HTMLElement;
  private state: BoardCoreState;
  private onStateChange: () => void;
  private emitEvent: (event: string, ...args: unknown[]) => void;
  private initialConfig: Config;

  // Stockfish Workers
  private whiteWorker: Worker | null = null;
  private blackWorker: Worker | null = null;
  private stockfishConfig: StockfishConfig = {};
  public lastSuggestedMove = '';
  private customDests: Map<Key, Key[]> | null = null;
  private soloHistory: Move[] = [];
  private isDrawingUpdate = false;
  private isProgrammaticShapeUpdate = false;
  private currentPreservedShapes: DrawShape[] = [];
  private lastMouseButton = -1;
  private userMovableColor: 'white' | 'black' | 'both' | undefined;
  private cachedFen: string | null = null;

  // PGN Tree Management
  private headers: Map<string, string> = defaultHeaders();
  private rootNode: Node<PgnNodeMeta> = new Node<PgnNodeMeta>();
  private currentNode: Node<PgnNodeMeta> = this.rootNode;
  private rootPos: Chess = Chess.default();

  constructor(
    boardElement: HTMLElement,
    state: BoardCoreState,
    onStateChange: () => void,
    emitEvent: (event: string, ...args: unknown[]) => void,
    initialConfig: Config = {},
    stockfishConfig: StockfishConfig = {},
    diagram?: ChessDiagram
  ) {
    this.boardElement = boardElement;
    this.state = state;
    this.onStateChange = onStateChange;
    this.emitEvent = emitEvent;
    this.initialConfig = initialConfig;
    this.stockfishConfig = stockfishConfig;
    this.userMovableColor = initialConfig.movable?.color;
    this.pos = Chess.default();
    this.rootPos = this.pos.clone();

    this.boardElement.addEventListener(
      'touchstart',
      () => {
        this.lastMouseButton = 0;
        this.redraw(true);
      },
      { capture: true }
    );

    this.boardElement.addEventListener(
      'mousedown',
      (e: MouseEvent) => {
        this.lastMouseButton = e.button;
        this.redraw(true);
      },
      { capture: true }
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

  private initBoard() {
    if (this.initialConfig.fen) {
      this.safeLoadFen(this.initialConfig.fen);
    }
    const config = this.buildConfig(this.initialConfig);
    this.board = Chessground(this.boardElement, config);
    this.updateGameState({ updateFen: false });
  }

  private safeLoadFen(fenStr: string): boolean {
    this.cachedFen = null;
    const setupRes = parseFen(fenStr);
    if (setupRes.isOk) {
      const chessRes = Chess.fromSetup(setupRes.value);
      if (chessRes.isOk) {
        this.pos = chessRes.value;
        this.rootPos = this.pos.clone();
        this.rootNode = new Node<PgnNodeMeta>();
        this.currentNode = this.rootNode;
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
    this.rootPos = this.pos.clone();
    this.rootNode = new Node<PgnNodeMeta>();
    this.currentNode = this.rootNode;
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
      select: (key: Key) => {
        this.emitEvent('square-click', key);
      },
      ...(userConfig.events || {}),
    };

    const userSelect = userConfig.events?.select;
    if (userSelect) {
      mergedEvents.select = (key: Key) => {
        this.emitEvent('square-click', key);
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

  private isSyncing = false;
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
    if (!this.state.historyViewerState.isEnabled) {
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

      this.board.set({
        ...(updateFen ? { fen: this.getFen() } : {}),
        turnColor: this.getTurnColor(),
        check: this.pos.isCheck() ? this.getTurnColor() : undefined,
        animation: { enabled: !isPreserve && !isFree },
        movable: {
          free: isFree,
          color: isFree ? 'both' : this.userMovableColor || this.getTurnColor(),
          dests:
            this.customDests ||
            (isFree || (isSolo && (!this.userMovableColor || this.userMovableColor === 'both'))
              ? this.getPossibleMovesForBothColors()
              : possibleMoves(this.pos)),
        },
        drawable: {
          eraseOnMovablePieceClick: !isPreserve,
          ...(savedShapes
            ? {
                autoShapes: isPreserve ? savedShapes : [],
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

  // PUBLIC API

  closePromotionDialog(): void {
    this.state.promotionDialogState = { isEnabled: false };
    this.onStateChange();
  }

  setFreeMode(freeMode: boolean): void {
    this.state.freeMode = freeMode;
    this.updateGameState({ updateFen: false });
    this.onStateChange();
  }

  setSoloMode(soloMode: boolean): void {
    this.state.soloMode = soloMode;
    this.updateGameState({ updateFen: false });
    this.onStateChange();
  }

  setPreserveShapesOnPositionChange(preserve: boolean): void {
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

  setPlayerColor(color: 'white' | 'black' | 'both'): void {
    this.userMovableColor = color;
    this.updateGameState({ updateFen: false });
  }

  redraw(clearBounds = true): void {
    const boardState = this.board as unknown as {
      state?: { dom?: { bounds?: { clear?: () => void } } };
    };
    if (clearBounds && boardState?.state?.dom?.bounds?.clear) {
      boardState.state.dom.bounds.clear();
    }
    this.board?.redrawAll();
  }

  private isSameFen(fenStr: string): boolean {
    const currentFen = this.getFen();
    if (fenStr === currentFen) return true;
    const normalize = (f: string) => f.trim().split(/\s+/).join(' ');
    if (normalize(fenStr) === normalize(currentFen)) return true;
    if (!fenStr.includes(' ') && fenStr.trim() === this.getPlacementFen()) return true;
    return false;
  }

  setConfig(config: Config, fillDefaults = false): void {
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
      this.applyBoardShapes(other.drawable.shapes);
    }
    this.board.redrawAll();
  }

  resetBoard(): void {
    this.pos = Chess.default();
    this.cachedFen = null;
    this.rootPos = this.pos.clone();
    this.rootNode = new Node<PgnNodeMeta>();
    this.currentNode = this.rootNode;
    this.headers = defaultHeaders();
    this.soloHistory = [];
    this.state.historyViewerState = { isEnabled: false };
    this.onStateChange();
    this.board.set({
      fen: this.getFen(),
      lastMove: undefined,
    });
    this.updateGameState({ updateFen: false });
    this.initStockfish();
    this.triggerStockfish();
  }

  undoLastMove(): void {
    const parentNode = this.findParentNode(this.rootNode, this.currentNode);
    if (!parentNode) return;

    if (
      this.state.historyViewerState.isEnabled &&
      this.state.historyViewerState.plyViewing === this.getCurrentPlyNumber()
    ) {
      this.stopViewingHistory();
    }

    this.currentNode = parentNode;
    this.syncGamePosToCurrentNode();

    if (!this.state.historyViewerState.isEnabled) {
      this.board.set({ fen: this.getFen() });
      this.updateGameState({ updateFen: false });
      const lastMove = this.getLastMove();
      this.board.set({
        lastMove: lastMove ? [lastMove.from as Key, lastMove.to as Key] : undefined,
      });
    }
    this.triggerStockfish();
  }

  private findParentNode(
    root: Node<PgnNodeMeta>,
    target: Node<PgnNodeMeta>
  ): Node<PgnNodeMeta> | null {
    for (const child of root.children) {
      if (child === target) return root;
      const found = this.findParentNode(child, target);
      if (found) return found;
    }
    return null;
  }

  getMaterialCount() {
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

  getCapturedPieces() {
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

  toggleOrientation(): void {
    this.board.toggleOrientation();
  }

  private applyBoardShapes(shapes: DrawShape[]): void {
    this.currentPreservedShapes = shapes;
    this.isProgrammaticShapeUpdate = true;
    if (this.board) {
      if (this.state.preserveShapesOnPositionChange) {
        this.board.set({
          drawable: {
            autoShapes: shapes,
            shapes: shapes,
          },
        });
      } else {
        this.board.setShapes(shapes);
      }
    }
    requestAnimationFrame(() => {
      this.isProgrammaticShapeUpdate = false;
    });
  }

  private handleDrawableChange(shapes: DrawShape[]): void {
    if (this.isDrawingUpdate || this.isProgrammaticShapeUpdate) return;

    if (
      this.state.preserveShapesOnPositionChange &&
      shapes.length === 0 &&
      this.lastMouseButton === 0
    ) {
      return;
    }

    this.isDrawingUpdate = true;
    try {
      this.currentPreservedShapes = shapes;
      if (this.state.preserveShapesOnPositionChange && this.board) {
        this.board.set({
          drawable: {
            autoShapes: shapes,
          },
        });
      } else {
        const ply =
          this.state.historyViewerState.isEnabled &&
          this.state.historyViewerState.plyViewing !== undefined
            ? this.state.historyViewerState.plyViewing
            : (this.getHistory(true) as Move[]).length;

        this.setCommentAtPly(ply, this.state.currentComment || '', shapes, false);
      }
      this.emitEvent('shapes-change', shapes);
    } finally {
      this.isDrawingUpdate = false;
    }
  }

  drawThreats(): void {
    this.state.showThreats = true;
    this.onStateChange();
    const threats = getThreats(this.getAllLegalMovesAsPojos());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.applyBoardShapes(threats as any);
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

  hideMoves(): void {
    this.state.showThreats = false;
    this.onStateChange();
    this.applyBoardShapes([]);
  }

  drawMove(from: Key | string, to: Key | string, brush: string): void {
    this.applyBoardShapes([{ orig: from as Key, dest: to as Key, brush }]);
  }

  drawCircle(square: Key | string, brush: string): void {
    const currentShapes = this.board.state.drawable.shapes || [];
    this.applyBoardShapes([...currentShapes, { orig: square as Key, brush }]);
  }

  setShapes(shapes: DrawShape[] | unknown[]): void {
    this.applyBoardShapes(shapes as DrawShape[]);
  }

  public getState(): Readonly<BoardCoreState> {
    return { ...this.state };
  }

  public getCurrentComment(): string {
    return this.state.currentComment || '';
  }

  public getHistoryViewerState(): Readonly<BoardCoreState['historyViewerState']> {
    return { ...this.state.historyViewerState };
  }

  public isViewingHistory(): boolean {
    return !!this.state.historyViewerState.isEnabled;
  }

  private parseComment(commentStr: string): { text: string; shapes: DrawShape[] } {
    const shapes: DrawShape[] = [];
    let text = commentStr;

    const calRegex = /\[%cal\s+([^\]]+)\]/g;
    let calMatch;
    while ((calMatch = calRegex.exec(commentStr)) !== null) {
      const list = calMatch[1].split(',');
      for (const item of list) {
        if (item.length >= 5) {
          const brush = this.getBrushName(item[0].toLowerCase());
          const orig = item.substring(1, 3) as Key;
          const dest = item.substring(3, 5) as Key;
          shapes.push({ orig, dest, brush });
        }
      }
    }

    const cplRegex = /\[%cpl\s+([^\]]+)\]/g;
    let cplMatch;
    while ((cplMatch = cplRegex.exec(commentStr)) !== null) {
      const list = cplMatch[1].split(',');
      for (const item of list) {
        if (item.length >= 3) {
          const brush = this.getBrushName(item[0].toLowerCase());
          const orig = item.substring(1, 3) as Key;
          shapes.push({ orig, brush });
        }
      }
    }

    text = text.replace(/\[%(cal|cpl)\s+[^\]]+\]/g, '').trim();

    return { text, shapes };
  }

  private getBrushName(char: string): string {
    switch (char) {
      case 'g':
        return 'green';
      case 'r':
        return 'red';
      case 'b':
        return 'blue';
      case 'y':
        return 'yellow';
      default:
        return 'green';
    }
  }

  private updateCommentAndShapes(_fenStr: string): void {
    let rawComment = '';
    if (isChildNode(this.currentNode) && this.currentNode.data.comments) {
      rawComment = this.currentNode.data.comments.join(' ');
    }

    if (!rawComment) {
      this.state.currentComment = '';
      if (this.isViewingHistory() && !this.state.preserveShapesOnPositionChange) {
        this.applyBoardShapes([]);
      }
      this.onStateChange();
      return;
    }

    const parsed = this.parseComment(rawComment);
    this.state.currentComment = parsed.text;
    if (!this.state.preserveShapesOnPositionChange) {
      this.applyBoardShapes(parsed.shapes);
    }
    this.onStateChange();
  }

  move(moveObj: string | { from: string; to: string; promotion?: string }): boolean {
    console.log('[BoardCore] move called with:', moveObj);
    let parsedMove: ChessopsMove | undefined;

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
      this.soloHistory.push(movePojo);
      this.pos.turn = colorBefore === 'w' ? 'white' : 'black';
    }

    let childNode: ChildNode<PgnNodeMeta> | undefined;
    for (const child of this.currentNode.children) {
      if (
        child.data.san === sanStr ||
        (child.data.move.from === fromStr && child.data.move.to === toStr)
      ) {
        childNode = child;
        break;
      }
    }

    if (!childNode) {
      childNode = new ChildNode<PgnNodeMeta>({
        san: sanStr,
        fen: fenAfter,
        move: movePojo,
      });
      this.currentNode.children.push(childNode);
    }
    this.currentNode = childNode;

    if (!this.state.historyViewerState.isEnabled) {
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

  getTurnColor(): Color {
    return shortToLongColor(this.pos.turn === 'white' ? 'w' : 'b');
  }

  getCurrentTurnNumber(): number {
    return this.pos.fullmoves;
  }

  getCurrentPlyNumber(): number {
    return this.getActivePath().length;
  }

  getLastMove(): Move | null {
    const path = this.getActivePath();
    return path.length ? path[path.length - 1].data.move : null;
  }

  private getActivePath(): ChildNode<PgnNodeMeta>[] {
    const path: ChildNode<PgnNodeMeta>[] = [];
    let node: Node<PgnNodeMeta> = this.currentNode;
    while (isChildNode(node)) {
      path.unshift(node);
      const parent = this.findParentNode(this.rootNode, node);
      if (!parent) break;
      node = parent;
    }
    return path;
  }

  getHistory(verbose = false): Move[] | string[] {
    const path = this.getActivePath();
    if (verbose) {
      return path.map((n) => n.data.move);
    }
    return path.map((n) => n.data.san);
  }

  getFen(): string {
    if (!this.cachedFen) {
      this.cachedFen = makeFen(this.pos.toSetup());
    }
    return this.cachedFen;
  }

  getPlacementFen(): string {
    return this.getFen().split(' ')[0];
  }

  getPgn(): string {
    const pgnTree: Node<PgnNodeData> = transform(
      this.rootNode,
      new EmptyContext(),
      (_ctx, meta) => ({
        san: meta.san,
        comments: meta.comments,
        startingComments: meta.startingComments,
        nags: meta.nags,
      })
    );
    return makePgn({
      headers: this.headers,
      moves: pgnTree,
    });
  }

  getIsGameOver(): boolean {
    return this.pos.isEnd();
  }

  getIsCheckmate(): boolean {
    return this.pos.isCheckmate();
  }

  getIsCheck(): boolean {
    return this.pos.isCheck();
  }

  getIsStalemate(): boolean {
    return this.pos.isStalemate();
  }

  getIsDraw(): boolean {
    return this.pos.isEnd() && !this.pos.isCheckmate();
  }

  getIsThreefoldRepetition(): boolean {
    return false;
  }

  getIsInsufficientMaterial(): boolean {
    return this.pos.isInsufficientMaterial();
  }

  getInCheckColor(): 'white' | 'black' | null {
    return this.getIsCheck() ? this.getTurnColor() : null;
  }

  getGameOverReason(lang: 'fr' | 'en' = 'fr'): string {
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

  destroy(): void {
    this.terminateStockfish();
    if (this.board) {
      this.board.destroy();
    }
  }

  getSquareColor(square: Key | string) {
    const sq = parseSquare(square);
    if (sq === undefined) return null;
    const rank = Math.floor(sq / 8);
    const file = sq % 8;
    return (rank + file) % 2 === 0 ? 'dark' : 'light';
  }

  getSquare(square: Key | string) {
    const sq = parseSquare(square);
    if (sq === undefined) return undefined;
    const piece = this.pos.board.get(sq);
    if (!piece) return null;
    return {
      type: roleToPieceSymbol[piece.role],
      color: piece.color === 'white' ? ('w' as const) : ('b' as const),
    };
  }

  setPosition(fenStr: string): void {
    this.safeLoadFen(fenStr);

    this.state.historyViewerState = { isEnabled: false };
    this.onStateChange();

    this.updateGameState();

    this.initStockfish();
    this.triggerStockfish();
  }

  setDiagram(diagram: ChessDiagram): void {
    this.setPosition(diagram.fen);
    this.applyBoardShapes(diagram.shapes || []);
  }

  getDiagram(): ChessDiagram {
    return {
      fen: this.getFen(),
      shapes: this.getShapes(),
    };
  }

  getShapes(): DrawShape[] {
    if (this.state.preserveShapesOnPositionChange && this.currentPreservedShapes.length > 0) {
      return this.currentPreservedShapes;
    }
    return (
      this.board?.state?.drawable?.shapes ||
      this.board?.state?.drawable?.autoShapes ||
      this.currentPreservedShapes ||
      []
    );
  }

  getCurrentShapes(): DrawShape[] {
    return this.getShapes();
  }

  getFinalFenFromPgn(pgnStr: string): string {
    return getFinalFenFromPgn(pgnStr, this.getFen());
  }

  putPiece(piece: { type: string; color: 'w' | 'b' }, square: Key | string): boolean {
    const sq = parseSquare(square);
    if (sq === undefined) return false;
    const role = pieceSymbolToRole[piece.type];
    if (!role) return false;
    this.pos.board.set(sq, { role, color: piece.color === 'w' ? 'white' : 'black' });
    this.updateGameState();
    return true;
  }

  removePiece(square: Key | string): void {
    const sq = parseSquare(square);
    if (sq !== undefined) {
      this.pos.board.take(sq);
      this.updateGameState();
    }
  }

  loadPgn(pgnStr: string): void {
    const games = parsePgn(pgnStr);
    if (!games.length) return;
    const game = games[0];
    this.headers = game.headers || defaultHeaders();

    const startRes = startingPosition(this.headers);
    const startPos = startRes.isOk ? startRes.value : Chess.default();
    this.rootPos = startPos.clone();
    this.pos = startPos.clone();

    const ctx = new TransformContext(startPos.clone());
    this.rootNode = transform(game.moves, ctx, (c, node) => {
      const parsed = parseSan(c.pos, node.san);
      if (!parsed) return undefined;
      const fenBefore = makeFen(c.pos.toSetup());
      const fromStr = isNormal(parsed) ? makeSquare(parsed.from) : '';
      const toStr = makeSquare(parsed.to);
      const pieceBefore = isNormal(parsed) ? c.pos.board.get(parsed.from) : undefined;
      const colorBefore: 'w' | 'b' = c.pos.turn === 'white' ? 'w' : 'b';
      let capturedPiece = c.pos.board.get(parsed.to);
      const isEnPassant =
        isNormal(parsed) &&
        pieceBefore?.role === 'pawn' &&
        fromStr[0] !== toStr[0] &&
        !capturedPiece;

      if (isEnPassant) {
        capturedPiece = { role: 'pawn', color: colorBefore === 'w' ? 'black' : 'white' };
      }
      const promoChar =
        isNormal(parsed) && parsed.promotion ? roleToPieceSymbol[parsed.promotion] : undefined;

      const sanStr = makeSanAndPlay(c.pos, parsed);
      const fenAfter = makeFen(c.pos.toSetup());

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

      const meta: PgnNodeMeta = {
        san: sanStr,
        fen: fenAfter,
        move: movePojo,
        comments: node.comments,
        startingComments: node.startingComments,
        nags: node.nags,
      };
      return meta;
    });

    this.currentNode = this.rootNode;
    const mainline = Array.from(this.rootNode.mainlineNodes());
    if (mainline.length > 0) {
      this.currentNode = mainline[mainline.length - 1];
    }
    this.syncGamePosToCurrentNode();

    this.state.historyViewerState = { isEnabled: false };
    this.onStateChange();
    this.updateGameState();
    const lastMove = this.getLastMove();
    if (lastMove) {
      this.board.set({ lastMove: [lastMove.from as Key, lastMove.to as Key] });
    }
    this.initStockfish();
    this.triggerStockfish();
  }

  private syncGamePosToCurrentNode(): void {
    const path = this.getActivePath();
    this.pos = this.rootPos.clone();
    this.cachedFen = null;
    for (const child of path) {
      const m = parseSan(this.pos, child.data.san);
      if (m) {
        this.pos.play(m);
      }
    }
  }

  getPgnInfo() {
    const headersObj: Record<string, string> = {};
    for (const [k, v] of this.headers.entries()) {
      headersObj[k] = v;
    }
    return headersObj;
  }

  // NAVIGATION D'HISTORIQUE

  viewHistory(ply: number): void {
    const path = this.getActivePath();
    if (ply < 0 || ply > path.length) return;

    if (ply < path.length) {
      this.state.historyViewerState = {
        isEnabled: true,
        plyViewing: ply,
        viewOnly: this.board.state.viewOnly,
      };
      this.onStateChange();

      const fenViewing = ply === 0 ? makeFen(this.rootPos.toSetup()) : path[ply - 1].data.fen;

      this.board.set({
        fen: fenViewing,
        viewOnly: false,
        movable: {
          color: undefined,
          dests: undefined,
          free: false,
        },
        lastMove:
          ply > 0
            ? [path[ply - 1].data.move.from as Key, path[ply - 1].data.move.to as Key]
            : undefined,
      });

      this.updateCommentAndShapes(fenViewing);
    } else {
      this.stopViewingHistory();
    }
  }

  stopViewingHistory(): void {
    if (this.state.historyViewerState.isEnabled) {
      const path = this.getActivePath();
      const lastMove = path.length ? path[path.length - 1].data.move : null;
      this.board.set({
        fen: this.getFen(),
        viewOnly: this.state.historyViewerState.viewOnly,
        lastMove: lastMove ? [lastMove.from as Key, lastMove.to as Key] : undefined,
      });
      this.state.historyViewerState = { isEnabled: false };
      this.onStateChange();
      this.updateGameState({ updateFen: false });
    }
  }

  viewStart(): void {
    this.viewHistory(0);
  }

  viewNext(): void {
    if (
      this.state.historyViewerState.isEnabled &&
      this.state.historyViewerState.plyViewing !== undefined
    ) {
      this.viewHistory(this.state.historyViewerState.plyViewing + 1);
    }
  }

  viewPrevious(): void {
    const ply =
      this.state.historyViewerState.isEnabled &&
      this.state.historyViewerState.plyViewing !== undefined
        ? this.state.historyViewerState.plyViewing
        : this.getCurrentPlyNumber();
    this.viewHistory(ply - 1);
  }

  getVariationsAtPly(ply?: number): VariationInfo[] {
    const path = this.getActivePath();
    const targetPly =
      ply !== undefined
        ? ply
        : this.state.historyViewerState.isEnabled &&
            this.state.historyViewerState.plyViewing !== undefined
          ? this.state.historyViewerState.plyViewing
          : path.length;

    if (targetPly <= 0 || targetPly > path.length) return [];

    const parentNode = targetPly === 1 ? this.rootNode : path[targetPly - 2];
    const currentChild = path[targetPly - 1];

    return parentNode.children.map((child, index) => ({
      index,
      san: child.data.san,
      fen: child.data.fen,
      move: child.data.move,
      isMainline: child === currentChild,
      comments: child.data.comments,
    }));
  }

  selectVariation(variationIndex: number): boolean {
    const path = this.getActivePath();
    const targetPly =
      this.state.historyViewerState.isEnabled &&
      this.state.historyViewerState.plyViewing !== undefined
        ? this.state.historyViewerState.plyViewing
        : path.length;

    if (targetPly <= 0 || targetPly > path.length) return false;

    const parentNode = targetPly === 1 ? this.rootNode : path[targetPly - 2];
    if (variationIndex < 0 || variationIndex >= parentNode.children.length) return false;

    const selectedChild = parentNode.children[variationIndex];
    let endNode: Node<PgnNodeMeta> = selectedChild;
    while (endNode.children.length > 0) {
      endNode = endNode.children[0];
    }

    this.currentNode = endNode;
    this.syncGamePosToCurrentNode();

    if (this.state.historyViewerState.isEnabled) {
      this.viewHistory(targetPly);
    } else {
      this.updateGameState();
    }
    this.onStateChange();
    return true;
  }

  getPgnTree(): PgnTreeNode {
    const buildTreeNode = (node: Node<PgnNodeMeta>): PgnTreeNode => {
      const isChild = isChildNode(node);
      return {
        san: isChild ? node.data.san : undefined,
        fen: isChild ? node.data.fen : makeFen(this.rootPos.toSetup()),
        move: isChild ? node.data.move : undefined,
        comments: isChild ? node.data.comments : undefined,
        variations: node.children.map((child) => buildTreeNode(child)),
      };
    };
    return buildTreeNode(this.rootNode);
  }

  // STOCKFISH INTEGRATION

  public updateStockfishConfig(config: StockfishConfig) {
    this.stockfishConfig = { ...this.stockfishConfig, ...config };
    this.initStockfish();
    this.triggerStockfish();
  }

  private initStockfish() {
    console.log('[BoardCore] initStockfish called. Config:', this.stockfishConfig);
    if (this.state.freeMode) {
      console.log('[BoardCore] initStockfish aborted: freeMode is active');
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

  private terminateStockfish() {
    if (this.whiteWorker) {
      this.whiteWorker.terminate();
      this.whiteWorker = null;
    }
    if (this.blackWorker) {
      this.blackWorker.terminate();
      this.blackWorker = null;
    }
  }

  private getEnginePositionCommand(): string {
    const history = this.getHistory(true) as Move[];
    const movesStr = history.map((m) => m.from + m.to + (m.promotion || '')).join(' ');
    return movesStr ? `position startpos moves ${movesStr}` : 'position startpos';
  }

  private triggerStockfish() {
    if (this.state.freeMode || this.getIsGameOver()) {
      console.log('[BoardCore] triggerStockfish ignored: freeMode or game over');
      this.terminateStockfish();
      return;
    }

    const turn = this.getTurnColor();
    const mode = turn === 'white' ? this.stockfishConfig.whiteMode : this.stockfishConfig.blackMode;

    if (!mode || mode === 'disabled') {
      return;
    }

    const movetime = this.stockfishConfig.stockfishMoveTime || 1000;
    console.log('[BoardCore] triggerStockfish. Turn:', turn, 'Mode:', mode, 'MoveTime:', movetime);

    if (turn === 'white' && this.whiteWorker) {
      const positionCmd = this.getEnginePositionCommand();
      console.log('[BoardCore] Sending to White Worker:', positionCmd, `go movetime ${movetime}`);
      this.whiteWorker.postMessage(positionCmd);
      this.whiteWorker.postMessage(`go movetime ${movetime}`);
    } else if (turn === 'black' && this.blackWorker) {
      const positionCmd = this.getEnginePositionCommand();
      console.log('[BoardCore] Sending to Black Worker:', positionCmd, `go movetime ${movetime}`);
      this.blackWorker.postMessage(positionCmd);
      this.blackWorker.postMessage(`go movetime ${movetime}`);
    }
  }

  private handleWhiteMessage(line: string) {
    if (line.startsWith('bestmove')) {
      const parts = line.split(' ');
      const bestMove = parts[1];
      if (bestMove && bestMove !== '(none)') {
        const mode = this.stockfishConfig.whiteMode;
        if (mode === 'hint') {
          this.lastSuggestedMove = bestMove;
          this.emitEvent('stockfish-hint', bestMove);
        } else if (mode === 'elo') {
          const from = bestMove.slice(0, 2);
          const to = bestMove.slice(2, 4);
          const promotion = bestMove.length > 4 ? bestMove.charAt(4) : undefined;
          this.move({ from, to, promotion });
        }
      }
    }
  }

  private handleBlackMessage(line: string) {
    if (line.startsWith('bestmove')) {
      const parts = line.split(' ');
      const bestMove = parts[1];
      if (bestMove && bestMove !== '(none)') {
        const mode = this.stockfishConfig.blackMode;
        if (mode === 'hint') {
          this.lastSuggestedMove = bestMove;
          this.emitEvent('stockfish-hint', bestMove);
        } else if (mode === 'elo') {
          const from = bestMove.slice(0, 2);
          const to = bestMove.slice(2, 4);
          const promotion = bestMove.length > 4 ? bestMove.charAt(4) : undefined;
          this.move({ from, to, promotion });
        }
      }
    }
  }

  private shapesToPgnComment(shapes: DrawShape[]): string {
    if (shapes.length === 0) return '';
    const cal: string[] = [];
    const cpl: string[] = [];

    for (const s of shapes) {
      const brushChar = this.getBrushChar(s.brush || 'green');
      if (s.orig && s.dest) {
        cal.push(`${brushChar}${s.orig}${s.dest}`);
      } else if (s.orig) {
        cpl.push(`${brushChar}${s.orig}`);
      }
    }

    let annotation = '';
    if (cal.length > 0) {
      annotation += `[%cal ${cal.join(',')}]`;
    }
    if (cpl.length > 0) {
      annotation += `[%cpl ${cpl.join(',')}]`;
    }
    return annotation;
  }

  private getBrushChar(brushName: string): string {
    switch (brushName.toLowerCase()) {
      case 'green':
        return 'G';
      case 'red':
        return 'R';
      case 'blue':
        return 'B';
      case 'yellow':
        return 'Y';
      default:
        return 'G';
    }
  }

  setCommentAtPly(
    ply: number,
    text: string,
    shapes: DrawShape[] = [],
    updateBoardShapes = true
  ): void {
    const path = this.getActivePath();
    if (ply < 0 || ply > path.length) return;

    const targetNode = ply === 0 ? this.rootNode : path[ply - 1];
    const shapesAnnotation = this.shapesToPgnComment(shapes);
    const combined = `${shapesAnnotation} ${text}`.trim();

    if (isChildNode(targetNode)) {
      targetNode.data.comments = combined ? [combined] : [];
    }

    const isViewingThisPly = this.state.historyViewerState.isEnabled
      ? this.state.historyViewerState.plyViewing === ply
      : ply === path.length;

    if (isViewingThisPly) {
      this.state.currentComment = text;
      if (updateBoardShapes) {
        this.applyBoardShapes(shapes);
      }
      this.onStateChange();
    }
  }

  setComment(text: string, shapes: DrawShape[] = []): void {
    const ply =
      this.state.historyViewerState.isEnabled &&
      this.state.historyViewerState.plyViewing !== undefined
        ? this.state.historyViewerState.plyViewing
        : (this.getHistory(true) as Move[]).length;
    this.setCommentAtPly(ply, text, shapes);
  }

  setCustomDests(dests: Map<Key, Key[]> | null): void {
    this.customDests = dests;
    this.updateGameState({ updateFen: false });
  }

  restrictMovesToPieces(squares: Key[] | null): void {
    if (!squares) {
      this.setCustomDests(null);
      return;
    }
    const allDests = possibleMoves(this.pos);
    const filteredDests = new Map<Key, Key[]>();
    for (const sq of squares) {
      const destsForSq = allDests.get(sq);
      if (destsForSq) {
        filteredDests.set(sq, destsForSq);
      }
    }
    this.setCustomDests(filteredDests);
  }

  isSquareAttacked(square: Key, byColor: 'white' | 'black'): boolean {
    const sq = parseSquare(square);
    if (sq === undefined) return false;
    const color: ChessopsColor = byColor === 'white' ? 'white' : 'black';
    return this.pos.kingAttackers(sq, color, this.pos.board.occupied).nonEmpty();
  }

  getPieces(): Map<Key, { type: string; color: 'w' | 'b' }> {
    const piecesMap = new Map<Key, { type: string; color: 'w' | 'b' }>();
    const boardState = this.board.state.pieces;
    const roleToPieceType: Record<string, string> = {
      pawn: 'p',
      knight: 'n',
      bishop: 'b',
      rook: 'r',
      queen: 'q',
      king: 'k',
    };
    for (const [square, piece] of boardState) {
      const type = roleToPieceType[piece.role];
      if (type) {
        piecesMap.set(square as Key, {
          type,
          color: piece.color === 'white' ? 'w' : 'b',
        });
      }
    }
    return piecesMap;
  }

  getSoloHistory(): Move[] {
    return this.soloHistory;
  }
}
