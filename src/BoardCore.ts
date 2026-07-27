import { Chess, type Square, type Move, type Piece, type PieceSymbol } from 'chess.js';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Config } from '@lichess-org/chessground/config';
import type { Color, Key, MoveMetadata } from '@lichess-org/chessground/types';
import type { DrawShape } from '@lichess-org/chessground/draw';
import { possibleMoves, isPromotion, shortToLongColor, getThreats } from './BoardHelper';

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

export class BoardCore {
  public game: Chess;
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
    this.game = new Chess();

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

  private initBoard() {
    if (this.initialConfig.fen) {
      this.safeLoadFen(this.initialConfig.fen);
    }
    const config = this.buildConfig(this.initialConfig);
    this.board = Chessground(this.boardElement, config);
    this.updateGameState({ updateFen: false });
  }

  private safeLoadFen(fen: string): boolean {
    try {
      this.game.load(fen);
      return true;
    } catch (e) {
      console.warn('Invalid FEN loaded in chess.js, fallback to manual piece placing:', fen, e);

      const parts = fen.split(' ');
      const placement = parts[0];
      const turn = parts[1] === 'b' ? 'b' : 'w';

      // Charger une position minimale valide pour régler le trait (turn)
      try {
        this.game.load(`4k3/8/8/8/8/8/8/4K3 ${turn} - - 0 1`);
      } catch {
        // En cas d'échec improbable, on utilise le comportement par défaut
      }

      // Retirer les rois temporaires
      this.game.remove('e1');
      this.game.remove('e8');

      // Placer les pièces de la FEN
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
            const color = char === char.toUpperCase() ? 'w' : 'b';
            const type = char.toLowerCase() as PieceSymbol;
            const square = `${files[fileIdx]}${8 - r}` as Square;
            if (fileIdx < 8) {
              this.game.put({ type, color }, square);
            }
            fileIdx++;
          }
        }
      }
      return false;
    }
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
      dests: isFree ? this.getPossibleMovesForBothColors() : possibleMoves(this.game),
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
      fen: this.game.fen(),
      turnColor: this.getTurnColor(),
      ...userConfig,
      movable: mergedMovable,
      events: mergedEvents,
      drawable: mergedDrawable,
    };

    return config;
  }

  private getPossibleMovesForBothColors(): Map<Key, Key[]> {
    const dests = possibleMoves(this.game);
    const originalFen = this.game.fen();
    // Swap turn FEN
    const parts = originalFen.split(' ');
    parts[1] = parts[1] === 'w' ? 'b' : 'w';
    const swappedFen = parts.join(' ');

    try {
      this.safeLoadFen(swappedFen);
      const otherDests = possibleMoves(this.game);
      for (const [key, value] of otherDests.entries()) {
        dests.set(key, value);
      }
    } catch {
      // Ignore
    } finally {
      this.safeLoadFen(originalFen);
    }
    return dests;
  }

  private isSyncing = false;
  private syncGameFromBoard(): void {
    if (this.isSyncing) return;
    this.isSyncing = true;
    try {
      const placement = this.getPlacementFen();
      const currentFenParts = this.game.fen().split(' ');
      const turn = currentFenParts[1] || 'w';
      const castling = currentFenParts[2] || '-';
      const ep = currentFenParts[3] || '-';
      const halfmove = currentFenParts[4] || '0';
      const fullmove = currentFenParts[5] || '1';

      const newFen = `${placement} ${turn} ${castling} ${ep} ${halfmove} ${fullmove}`;

      try {
        this.game.load(newFen);
      } catch {
        // Ignore
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

      // Fix mode solo : Réaligner le trait interne si une couleur spécifique est imposée
      if (
        isSolo &&
        this.userMovableColor &&
        (this.userMovableColor === 'white' || this.userMovableColor === 'black')
      ) {
        const requiredTurn = this.userMovableColor === 'white' ? 'w' : 'b';
        if (this.game.turn() !== requiredTurn) {
          const currentFen = this.game.fen();
          const parts = currentFen.split(' ');
          parts[1] = requiredTurn;
          const rewrittenFen = parts.join(' ');
          this.game.load(rewrittenFen, { skipValidation: true });
        }
      }

      this.board.set({
        ...(updateFen ? { fen: this.game.fen() } : {}),
        turnColor: this.getTurnColor(),
        check: this.game.inCheck() ? this.getTurnColor() : undefined,
        animation: { enabled: !isPreserve && !isFree },
        movable: {
          free: isFree,
          color: isFree ? 'both' : this.userMovableColor || this.getTurnColor(),
          dests:
            this.customDests ||
            (isFree || (isSolo && (!this.userMovableColor || this.userMovableColor === 'both'))
              ? this.getPossibleMovesForBothColors()
              : possibleMoves(this.game)),
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
        this.updateCommentAndShapes(this.game.fen());
      }
    }

    this.emitEvents();
  }

  private emitEvents(): void {
    if (this.game.inCheck()) {
      this.emitEvent(this.game.isCheckmate() ? 'checkmate' : 'check', this.getTurnColor());
    }
    if (this.game.isDraw()) {
      this.emitEvent('draw');
    }
    if (this.game.isStalemate()) {
      this.emitEvent('stalemate');
    }
  }

  private async changeTurn(orig: Key, dest: Key, _metadata: MoveMetadata): Promise<void> {
    const piece = this.game.get(orig as Square);
    if (isPromotion(dest, piece)) {
      const pieceColor = piece ? (piece.color === 'w' ? 'white' : 'black') : this.getTurnColor();
      const selectedPromotion = await new Promise<string>((resolve) => {
        this.state.promotionDialogState = {
          isEnabled: true,
          color: pieceColor,
          callback: (promoPiece) => {
            resolve(promoPiece);
          },
        };
        this.onStateChange();
      });

      this.move({
        from: orig,
        to: dest,
        promotion: selectedPromotion,
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

  private isSameFen(fen: string): boolean {
    const currentFen = this.getFen();
    if (fen === currentFen) return true;
    const normalize = (f: string) => f.trim().split(/\s+/).join(' ');
    if (normalize(fen) === normalize(currentFen)) return true;
    if (!fen.includes(' ') && fen.trim() === this.getPlacementFen()) return true;
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
    const { fen, ...other } = finalConfig;
    if (other.movable?.color !== undefined) {
      this.userMovableColor = other.movable.color as 'white' | 'black' | 'both';
    }
    this.board.set(other);
    if (fen && !this.isSameFen(fen)) {
      this.setPosition(fen);
    }
    if (other.drawable?.shapes) {
      this.applyBoardShapes(other.drawable.shapes);
    }
    this.board.redrawAll();
  }

  resetBoard(): void {
    this.game.reset();
    this.soloHistory = [];
    this.state.historyViewerState = { isEnabled: false };
    this.onStateChange();
    this.board.set({
      fen: this.game.fen(),
      lastMove: undefined,
    });
    this.updateGameState({ updateFen: false });
    this.initStockfish();
    this.triggerStockfish();
  }

  undoLastMove(): void {
    const undoMove = this.game.undo();
    if (!undoMove) return;

    if (
      this.state.historyViewerState.isEnabled &&
      this.state.historyViewerState.plyViewing === this.getCurrentPlyNumber()
    ) {
      this.stopViewingHistory();
    }

    if (!this.state.historyViewerState.isEnabled) {
      this.board.set({ fen: undoMove.before });
      this.updateGameState({ updateFen: false });
      const lastMove = this.getLastMove();
      this.board.set({
        lastMove: lastMove ? [lastMove.from, lastMove.to] : undefined,
      });
    }
    this.triggerStockfish();
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
    for (const move of this.game.history({ verbose: true }) as Move[]) {
      if (move.captured) {
        const capturingColor = move.color === 'w' ? 'white' : 'black';
        captured[capturingColor].push(move.captured);
      }
    }
    return captured;
  }

  /**
   * Retourne l'orientation actuelle du plateau de jeu.
   */
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
    const threats = getThreats(this.game.moves({ verbose: true }) as Move[]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.applyBoardShapes(threats as any);
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

  /**
   * Getter public sécurisé pour l'état global du Core.
   */
  public getState(): Readonly<BoardCoreState> {
    return { ...this.state };
  }

  /**
   * Le commentaire PGN nettoyé du coup courant.
   */
  public getCurrentComment(): string {
    return this.state.currentComment || '';
  }

  /**
   * L'état de visualisation dans l'historique PGN.
   */
  public getHistoryViewerState(): Readonly<BoardCoreState['historyViewerState']> {
    return { ...this.state.historyViewerState };
  }

  /**
   * Indique si l'utilisateur est actuellement en train de naviguer dans l'historique PGN.
   */
  public isViewingHistory(): boolean {
    return !!this.state.historyViewerState.isEnabled;
  }

  private parseComment(commentStr: string): { text: string; shapes: DrawShape[] } {
    const shapes: DrawShape[] = [];
    let text = commentStr;

    // Match [%cal Gf3h4,Rb1b2]
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

    // Match [%cpl Gf3,Rb1]
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

    // Strip all [%cal ...] and [%cpl ...] tags
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

  private updateCommentAndShapes(fen: string): void {
    const comments = this.game.getComments();
    const normalizeFen = (f: string) => f.split(' ').slice(0, 4).join(' ');
    const targetNorm = normalizeFen(fen);
    const commentObj = comments.find((c) => normalizeFen(c.fen) === targetNorm);
    const rawComment = commentObj
      ? commentObj.comment
      : normalizeFen(this.game.fen()) === targetNorm
        ? this.game.getComment() || ''
        : '';

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
    let resultMove;
    try {
      resultMove = this.game.move(moveObj);
      console.log('[BoardCore] move successful, result:', resultMove);
      if (this.state.soloMode) {
        const colorBefore = resultMove.color;
        this.soloHistory.push(resultMove);
        const nextFen = this.game.fen();
        const parts = nextFen.split(' ');
        parts[1] = colorBefore;
        const rewrittenFen = parts.join(' ');
        this.game.load(rewrittenFen, { skipValidation: true });
      }
    } catch (err) {
      console.error('[BoardCore] move failed, error:', err);
      return false;
    }

    if (!this.state.historyViewerState.isEnabled) {
      this.board.move(resultMove.from as Key, resultMove.to as Key);
      if (
        resultMove.flags.includes('k') ||
        resultMove.flags.includes('q') ||
        resultMove.flags.includes('e') ||
        resultMove.promotion
      ) {
        setTimeout(() => {
          this.board.set({ fen: this.game.fen() });
        }, 50);
      }
      this.updateGameState({ updateFen: false });
    }

    this.emitEvent('move', resultMove);

    if (resultMove.promotion) {
      this.emitEvent('promotion', {
        color: shortToLongColor(resultMove.color),
        promotedTo: resultMove.promotion.toUpperCase(),
        sanMove: resultMove.san,
      });
    }

    this.triggerStockfish();
    return true;
  }

  getTurnColor(): Color {
    return shortToLongColor(this.game.turn());
  }

  getCurrentTurnNumber(): number {
    return this.game.moveNumber();
  }

  getCurrentPlyNumber(): number {
    return (this.getHistory(true) as Move[]).length;
  }

  getLastMove() {
    const history = this.game.history({ verbose: true }) as Move[];
    return history.length ? history[history.length - 1] : null;
  }

  getHistory(verbose = false) {
    if (verbose) {
      return this.game.history({ verbose: true });
    }
    return this.game.history({ verbose: false });
  }

  getFen(): string {
    return this.game.fen();
  }

  getPlacementFen(): string {
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const roleToChar: Record<string, string> = {
      pawn: 'p',
      knight: 'n',
      bishop: 'b',
      rook: 'r',
      queen: 'q',
      king: 'k',
    };

    const pieces = this.board.state.pieces;
    const rows: string[] = [];

    for (const rank of ranks) {
      let emptyCount = 0;
      let rowStr = '';
      for (const file of files) {
        const square = `${file}${rank}`;
        const piece = pieces.get(square as Key);
        if (piece) {
          if (emptyCount > 0) {
            rowStr += emptyCount;
            emptyCount = 0;
          }
          const char = roleToChar[piece.role];
          rowStr += piece.color === 'white' ? char.toUpperCase() : char.toLowerCase();
        } else {
          emptyCount++;
        }
      }
      if (emptyCount > 0) {
        rowStr += emptyCount;
      }
      rows.push(rowStr);
    }
    return rows.join('/');
  }

  getPgn(): string {
    return this.game.pgn();
  }

  getIsGameOver(): boolean {
    return this.game.isGameOver();
  }

  getIsCheckmate(): boolean {
    return this.game.isCheckmate();
  }

  getIsCheck(): boolean {
    return this.game.inCheck();
  }

  getIsStalemate(): boolean {
    return this.game.isStalemate();
  }

  getIsDraw(): boolean {
    return this.game.isDraw();
  }

  getIsThreefoldRepetition(): boolean {
    return this.game.isThreefoldRepetition();
  }

  getIsInsufficientMaterial(): boolean {
    return this.game.isInsufficientMaterial();
  }

  /**
   * Retourne la couleur du joueur actuellement en échec, ou null sinon.
   */
  getInCheckColor(): 'white' | 'black' | null {
    return this.getIsCheck() ? this.getTurnColor() : null;
  }

  /**
   * Retourne la raison d'arrêt de la partie sous forme d'un message lisible (ex: "Échec et mat ! Les Blancs ont gagné.").
   */
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
    if (this.getIsThreefoldRepetition())
      return lang === 'fr' ? 'Match nul par répétition.' : 'Draw by repetition.';
    if (this.getIsInsufficientMaterial())
      return lang === 'fr'
        ? 'Match nul par matériel insuffisant.'
        : 'Draw by insufficient material.';
    return lang === 'fr' ? 'Match nul.' : 'Draw.';
  }

  /**
   * Détruit l'instance de BoardCore et libère toutes les ressources (Workers Stockfish, DOM Chessground).
   */
  destroy(): void {
    this.terminateStockfish();
    if (this.board) {
      this.board.destroy();
    }
  }

  getSquareColor(square: Key | string) {
    return this.game.squareColor(square as Square);
  }

  getSquare(square: Key | string) {
    return this.game.get(square as Square);
  }

  setPosition(fen: string): void {
    this.safeLoadFen(fen);

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

  getFinalFenFromPgn(pgn: string): string {
    const tempGame = new Chess();
    try {
      tempGame.loadPgn(pgn);
      return tempGame.fen();
    } catch {
      return this.getFen();
    }
  }

  putPiece(piece: Piece, square: Key | string): boolean {
    const sq = square as Square;
    this.game.remove(sq);
    const res = this.game.put(piece, sq);
    this.updateGameState();
    return res;
  }

  removePiece(square: Key | string): void {
    this.game.remove(square as Square);
    this.updateGameState();
  }

  loadPgn(pgn: string): void {
    this.game.loadPgn(pgn);
    this.state.historyViewerState = { isEnabled: false };
    this.onStateChange();
    this.updateGameState();
    const lastMove = this.getLastMove();
    if (lastMove) {
      this.board.set({ lastMove: [lastMove.from, lastMove.to] });
    }
    this.initStockfish();
    this.triggerStockfish();
  }

  getPgnInfo() {
    return this.game.header();
  }

  // NAVIGATION D'HISTORIQUE

  viewHistory(ply: number): void {
    const history = this.getHistory(true) as Move[];
    if (ply < 0 || ply > history.length) return;

    if (ply < history.length) {
      this.state.historyViewerState = {
        isEnabled: true,
        plyViewing: ply,
        viewOnly: this.board.state.viewOnly,
      };
      this.onStateChange();

      this.board.set({
        fen: history[ply].before,
        viewOnly: false,
        movable: {
          color: undefined,
          dests: undefined,
          free: false,
        },
        lastMove: ply > 0 ? [history[ply - 1].from as Key, history[ply - 1].to as Key] : undefined,
      });

      this.updateCommentAndShapes(history[ply].before);
    } else {
      this.stopViewingHistory();
    }
  }

  stopViewingHistory(): void {
    if (this.state.historyViewerState.isEnabled) {
      const history = this.getHistory(true) as Move[];
      const lastMove = history[history.length - 1];
      this.board.set({
        fen: this.game.fen(),
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

    // Worker Blanc
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

    // Worker Noir
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
    } else {
      console.warn(
        '[BoardCore] triggerStockfish: Worker not initialized for mode:',
        mode,
        'WhiteWorker:',
        !!this.whiteWorker,
        'BlackWorker:',
        !!this.blackWorker
      );
    }
  }

  private handleWhiteMessage(line: string) {
    console.log('[BoardCore] White Worker Message:', line);
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
    console.log('[BoardCore] Black Worker Message:', line);
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
    const history = this.getHistory(true) as Move[];
    if (ply < 0 || ply > history.length) return;

    if (history.length === 0) {
      const shapesAnnotation = this.shapesToPgnComment(shapes);
      const combined = `${shapesAnnotation} ${text}`.trim();
      this.game.setComment(combined);
      this.state.currentComment = text;
      if (updateBoardShapes && !this.state.preserveShapesOnPositionChange) {
        this.applyBoardShapes(shapes);
      }
      this.onStateChange();
      return;
    }

    // Get all comments from the existing game
    const oldComments = this.game.getComments();

    const tempGame = new Chess();
    const oldHeaders = this.game.header();

    // S'il y a une position initiale personnalisée (SetUp/FEN), on la charge en premier dans tempGame
    if (oldHeaders['SetUp'] === '1' && typeof oldHeaders['FEN'] === 'string') {
      try {
        tempGame.load(oldHeaders['FEN']);
      } catch (e) {
        console.warn('Failed to load custom starting FEN into tempGame:', e);
      }
    }

    // Copier toutes les entêtes (headers) existantes vers le nouveau tempGame
    for (const [key, value] of Object.entries(oldHeaders)) {
      if (value !== undefined && value !== null) {
        tempGame.header(key, value);
      }
    }

    const normalizeFen = (f: string) => f.split(' ').slice(0, 4).join(' ');

    const applyOldComment = (fen: string) => {
      const norm = normalizeFen(fen);
      const matched = oldComments.find((c) => normalizeFen(c.fen) === norm);
      if (matched) {
        tempGame.setComment(matched.comment);
      }
    };

    // Apply old comment on the starting position if any
    applyOldComment(tempGame.fen());

    // play up to ply
    for (let i = 0; i < ply; i++) {
      tempGame.move(history[i]);
      applyOldComment(tempGame.fen());
    }

    // set comment at this position (overwrite)
    const shapesAnnotation = this.shapesToPgnComment(shapes);
    const combined = `${shapesAnnotation} ${text}`.trim();
    tempGame.setComment(combined);

    // play rest of the game
    for (let i = ply; i < history.length; i++) {
      tempGame.move(history[i]);
      applyOldComment(tempGame.fen());
    }

    // load new game state
    this.game = tempGame;

    // update current comment if we are currently viewing this ply
    const isViewingThisPly = this.state.historyViewerState.isEnabled
      ? this.state.historyViewerState.plyViewing === ply
      : ply === history.length;

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
    const allDests = possibleMoves(this.game);
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
    const chessJsColor = byColor === 'white' ? 'w' : 'b';
    return this.game.isAttacked(square as Square, chessJsColor);
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
