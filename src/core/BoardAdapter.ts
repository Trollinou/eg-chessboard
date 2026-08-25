import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Config } from '@lichess-org/chessground/config';
import type { Key, MoveMetadata, Color, Role } from '@lichess-org/chessground/types';
import type { DrawShape } from '@lichess-org/chessground/draw';
import { parseSquare } from 'chessops';
import { makeFen } from 'chessops/fen';

import type { BoardMode, Move, PieceSet, BoardTheme } from '../types';
import { possibleMoves, isPromotion, shortToLongColor } from '../BoardHelper';
import { roleToPieceSymbol, pieceSymbolToRole, FILES } from './pieceMapping';
import { FenManager } from './FenManager';
import { DomainEventBus } from './DomainEventBus';
import { GameSession } from './GameSession';
import { AnnotationService } from './AnnotationService';
import type { ExerciseManager } from './ExerciseManager';

export interface BoardAdapterOptions {
  mode?: BoardMode;
  playerColor?: 'white' | 'black' | 'both';
  freeMode?: boolean;
  soloMode?: boolean;
  readOnly?: boolean;
  preserveShapesOnPositionChange?: boolean;
}

export class BoardAdapter {
  public board!: Api;
  private element: HTMLElement;
  private isSyncing = false;

  private pointerDownState: { x: number; y: number; square: Key } | null = null;
  private domListeners: Array<{
    target: EventTarget;
    type: string;
    listener: EventListenerOrEventListenerObject;
    options?: boolean | AddEventListenerOptions;
  }> = [];
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    element: HTMLElement,
    private eventBus: DomainEventBus,
    private session: GameSession,
    private annotationService: AnnotationService,
    private exerciseManager: ExerciseManager,
    private getOptions: () => BoardAdapterOptions,
    private promptPromotionDialog: (color: Color) => Promise<string>,
    initialConfig: Config = {},
    pieceSet: PieceSet = 'cburnett',
    boardTheme: BoardTheme = 'brown'
  ) {
    this.element = element;
    this.autoDecorateDom(pieceSet, boardTheme);
    this.initBoard(initialConfig);
    this.bindDomEvents();

    this.eventBus.on('history-navigated', (data) => {
      this.syncHistoryView(data.ply, data.fen, data.lastMove);
    });

    this.eventBus.on('position-changed', () => {
      if (!this.session.isViewingHistory()) {
        this.updateGameState({ updateFen: false });
      }
    });
  }

  public autoDecorateDom(pieceSet: PieceSet = 'cburnett', boardTheme: BoardTheme = 'brown'): void {
    if (!this.element.classList.contains('main-board')) {
      this.element.classList.add('main-board');
    }

    const parent = this.element.parentElement;
    const target = parent || this.element;

    if (parent && !parent.classList.contains('main-wrap')) {
      parent.classList.add('main-wrap');
    }

    const currentClasses = Array.from(target.classList);
    const pieceSetClass = currentClasses.find((c) => c.startsWith('piece-set-'));
    if (!pieceSetClass) {
      target.classList.add(`piece-set-${pieceSet}`);
    }

    const boardThemeClass = currentClasses.find((c) => c.startsWith('board-theme-'));
    if (!boardThemeClass) {
      target.classList.add(`board-theme-${boardTheme}`);
    }
  }

  public updateDomThemeClasses(pieceSet: PieceSet, boardTheme: BoardTheme): void {
    const parent = this.element.parentElement;
    const target = parent || this.element;

    Array.from(target.classList).forEach((c) => {
      if (c.startsWith('piece-set-') || c.startsWith('board-theme-')) {
        target.classList.remove(c);
      }
    });

    target.classList.add(`piece-set-${pieceSet}`);
    target.classList.add(`board-theme-${boardTheme}`);
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  private initBoard(initialConfig: Config): void {
    const config = this.buildConfig(initialConfig);
    this.board = Chessground(this.element, config);
    this.annotationService.setBoard(this.board);

    if (initialConfig.drawable?.shapes) {
      this.annotationService.setPreservedShapes(initialConfig.drawable.shapes);
    }
    this.updateGameState({ updateFen: false });
  }

  public buildConfig(userConfig: Config): Config {
    const defaultEvents = {
      after: (orig: Key, dest: Key, metadata: MoveMetadata) => {
        this.changeTurn(orig, dest, metadata);
      },
    };

    const options = this.getOptions();
    const isFree = !!options.freeMode;

    const mergedMovable = {
      free: isFree,
      color: (isFree ? 'both' : options.playerColor || this.session.getTurnColor()) as
        'white' | 'black' | 'both',
      dests: isFree ? FenManager.getPossibleMovesForBothColors(this.session.pos) : this.getDests(),
      showDests: userConfig.movable?.showDests ?? true,
      events: defaultEvents,
    };

    const isPreserve = !!options.preserveShapesOnPositionChange || options.mode === 'editor';
    const isGameMode = options.mode === 'game';

    const mergedDrawable = {
      enabled: userConfig.drawable?.enabled ?? true,
      visible: userConfig.drawable?.visible ?? true,
      defaultSnapToValidMove: userConfig.drawable?.defaultSnapToValidMove ?? isGameMode,
      eraseOnClick:
        (userConfig.drawable as { eraseOnClick?: boolean } | undefined)?.eraseOnClick ?? false,
      shapes: userConfig.drawable?.shapes ?? this.annotationService.getPreservedShapes(),
      autoShapes: userConfig.drawable?.autoShapes ?? [],
      brushes: userConfig.drawable?.brushes ?? {
        green: { key: 'g', color: '#15781B', opacity: 1, lineWidth: 10 },
        red: { key: 'r', color: '#882020', opacity: 1, lineWidth: 10 },
        blue: { key: 'b', color: '#003088', opacity: 1, lineWidth: 10 },
        yellow: { key: 'y', color: '#e68f00', opacity: 1, lineWidth: 10 },
      },
      onChange: (shapes: unknown[]) => {
        this.annotationService.handleDrawableChange(
          shapes as DrawShape[],
          options.mode || 'game',
          isPreserve,
          !!options.readOnly
        );
      },
    };

    const mergedEvents = {
      change: () => {
        const currentOptions = this.getOptions();
        if (currentOptions.freeMode || currentOptions.mode === 'editor') {
          this.syncGameFromBoard();
        }
      },
    };

    return {
      fen: makeFen(this.session.pos.toSetup()),
      orientation: 'white',
      turnColor: this.session.getTurnColor(),
      ...userConfig,
      premovable: {
        enabled: false,
        ...userConfig.premovable,
      },
      movable: {
        ...mergedMovable,
        ...userConfig.movable,
      },
      drawable: {
        ...mergedDrawable,
        ...userConfig.drawable,
      },
      events: {
        ...mergedEvents,
        ...userConfig.events,
      },
    };
  }

  public getDests(): Map<Key, Key[]> {
    const customDests = this.exerciseManager.getCustomDests();
    if (customDests !== null) {
      return customDests;
    }
    return possibleMoves(this.session.pos);
  }

  public updateGameState(opts?: { updateFen?: boolean; animate?: boolean }): void {
    if (!this.board) return;

    const options = this.getOptions();
    const isFree = !!options.freeMode;
    const isSolo = !!options.soloMode;

    if (
      isSolo &&
      options.playerColor &&
      (options.playerColor === 'white' || options.playerColor === 'black')
    ) {
      const requiredTurn = options.playerColor === 'white' ? 'white' : 'black';
      if (this.session.pos.turn !== requiredTurn) {
        this.session.pos.turn = requiredTurn;
      }
    }

    const isPreserve = !!options.preserveShapesOnPositionChange || options.mode === 'editor';
    const currentShapes = this.annotationService.getPreservedShapes();
    const savedShapes = isPreserve ? [...currentShapes] : null;

    const currentTurn = this.session.getTurnColor();
    const color = isFree ? 'both' : options.playerColor || currentTurn;

    let dests: Map<Key, Key[]> | undefined;
    if (isFree) {
      dests = FenManager.getPossibleMovesForBothColors(this.session.pos);
    } else if (options.soloMode) {
      dests = this.getDests();
    } else if (options.playerColor && options.playerColor !== 'both') {
      dests = options.playerColor === currentTurn ? this.getDests() : new Map();
    } else {
      dests = this.getDests();
    }

    const currentFen = this.session.getFen();
    const updateObj: Partial<Config> = {
      turnColor: currentTurn,
      movable: {
        color,
        dests,
        free: isFree,
      },
    };

    if (opts?.updateFen) {
      updateObj.fen = currentFen;
    }

    const lastMove = this.session.getLastMove();
    updateObj.lastMove = lastMove ? [lastMove.from as Key, lastMove.to as Key] : undefined;

    if (opts?.animate === false) {
      updateObj.animation = { enabled: false };
    }

    if (savedShapes && savedShapes.length > 0) {
      updateObj.drawable = {
        eraseOnMovablePieceClick: false,
        defaultSnapToValidMove: options.mode === 'game',
        shapes: savedShapes,
        autoShapes: [],
      };
    }

    this.board.set(updateObj);

    if (savedShapes && savedShapes.length > 0) {
      this.annotationService.applyBoardShapes(savedShapes, true, options.mode);
    } else {
      this.annotationService.updateCommentAndShapes(
        currentFen,
        options.mode,
        options.preserveShapesOnPositionChange
      );
    }

    if (opts?.animate === false) {
      this.board.set({ animation: { enabled: true } });
    }
  }

  public syncGameFromBoard(): void {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      if (!this.board?.state?.pieces) return;

      const placementFen = FenManager.boardPiecesToPlacementFen(this.board.state.pieces);
      const turn = this.session.pos.turn === 'white' ? 'w' : 'b';
      const fullFen = `${placementFen} ${turn} - - 0 1`;

      this.session.safeLoadFen(fullFen);

      const options = this.getOptions();
      const isFree = !!options.freeMode;

      this.board.set({
        turnColor: this.session.getTurnColor(),
        movable: {
          color: isFree ? 'both' : options.playerColor || this.session.getTurnColor(),
          dests: isFree
            ? FenManager.getPossibleMovesForBothColors(this.session.pos)
            : this.getDests(),
          free: isFree,
        },
      });

      const isPreserve = !!options.preserveShapesOnPositionChange || options.mode === 'editor';
      if (isPreserve && this.board) {
        this.annotationService.applyBoardShapes(
          this.annotationService.getPreservedShapes(),
          true,
          options.mode
        );
      }

      this.checkUnpromotedPawns();
    } finally {
      this.isSyncing = false;
    }
  }

  public async checkUnpromotedPawns(): Promise<void> {
    const options = this.getOptions();
    if (!options.freeMode && options.mode !== 'editor') return;

    for (const f of FILES) {
      // Rank 8: White Pawn Promotion
      const sq8Str = `${f}8`;
      const sq8 = parseSquare(sq8Str)!;
      const piece8 = this.session.pos.board.get(sq8);
      if (piece8 && piece8.role === 'pawn' && piece8.color === 'white') {
        const selectedPromotion = await this.promptPromotionDialog('white');
        const promotedRole = pieceSymbolToRole[selectedPromotion.toLowerCase()] || 'queen';
        this.session.pos.board.set(sq8, { role: promotedRole, color: 'white' });
        if (this.board?.state?.pieces) {
          this.board.state.pieces.set(sq8Str as Key, {
            role: promotedRole as Role,
            color: 'white',
          });
          this.board.set({ fen: '' });
          this.board.set({ fen: this.session.getFen() });
        }
        this.updateGameState();
        return;
      }

      // Rank 1: Black Pawn Promotion
      const sq1Str = `${f}1`;
      const sq1 = parseSquare(sq1Str)!;
      const piece1 = this.session.pos.board.get(sq1);
      if (piece1 && piece1.role === 'pawn' && piece1.color === 'black') {
        const selectedPromotion = await this.promptPromotionDialog('black');
        const promotedRole = pieceSymbolToRole[selectedPromotion.toLowerCase()] || 'queen';
        this.session.pos.board.set(sq1, { role: promotedRole, color: 'black' });
        if (this.board?.state?.pieces) {
          this.board.state.pieces.set(sq1Str as Key, {
            role: promotedRole as Role,
            color: 'black',
          });
          this.board.set({ fen: '' });
          this.board.set({ fen: this.session.getFen() });
        }
        this.updateGameState();
        return;
      }
    }
  }

  public async changeTurn(orig: Key, dest: Key, _metadata: MoveMetadata): Promise<void> {
    let targetPos = this.session.pos;
    if (this.session.isViewingHistory()) {
      const ply = this.session.getCurrentViewingPly();
      targetPos = this.session.syncGamePosToPly(ply);
    }

    const sq = parseSquare(orig)!;
    const piece = targetPos.board.get(sq);
    const destSq = parseSquare(dest);
    const destPiece = destSq ? targetPos.board.get(destSq) : undefined;
    const activePiece = piece || destPiece;

    const pieceType = activePiece ? roleToPieceSymbol[activePiece.role] : undefined;
    const pieceColor = activePiece
      ? activePiece.color === 'white'
        ? 'w'
        : 'b'
      : targetPos.turn === 'white'
        ? 'w'
        : 'b';

    const options = this.getOptions();

    if (pieceType === 'p' && isPromotion(dest, { type: pieceType, color: pieceColor })) {
      const selectedPromotion = await this.promptPromotionDialog(shortToLongColor(pieceColor));
      const res = this.session.executeMove(
        {
          from: orig,
          to: dest,
          promotion: selectedPromotion.toLowerCase(),
        },
        {
          freeMode: options.freeMode,
          readOnly: options.readOnly,
          soloMode: options.soloMode,
        }
      );

      if (!res.success && (options.freeMode || options.mode === 'editor')) {
        const promotedRole = pieceSymbolToRole[selectedPromotion.toLowerCase()] || 'queen';
        const color = pieceColor === 'w' ? 'white' : 'black';

        const pieces = new Map(this.board.state.pieces);
        pieces.set(dest, { role: promotedRole as Role, color });
        if (orig !== dest) {
          pieces.delete(orig);
        }
        this.board.setPieces(pieces);
        this.syncGameFromBoard();
      } else if (res.success) {
        this.syncAfterMove(res);
      }
    } else {
      const res = this.session.executeMove(
        {
          from: orig,
          to: dest,
        },
        {
          freeMode: options.freeMode,
          readOnly: options.readOnly,
          soloMode: options.soloMode,
        }
      );

      if (!res.success && (options.freeMode || options.mode === 'editor')) {
        const color = pieceColor === 'w' ? 'white' : 'black';
        const role = activePiece ? activePiece.role : 'pawn';
        const pieces = new Map(this.board.state.pieces);
        pieces.set(dest, { role, color });
        if (orig !== dest) {
          pieces.delete(orig);
        }
        this.board.setPieces(pieces);
        this.syncGameFromBoard();
      } else if (res.success) {
        this.syncAfterMove(res);
      }
    }
  }

  public syncAfterMove(res: {
    wasViewingHistory?: boolean;
    isNormalPromo?: boolean;
    move?: Move;
    colorBefore?: 'w' | 'b';
  }): void {
    if (!res.wasViewingHistory) {
      if (res.move) {
        this.board.move(res.move.from as Key, res.move.to as Key);
      }
      if (res.isNormalPromo) {
        setTimeout(() => {
          this.board.set({ fen: this.session.getFen() });
        }, 50);
      }
      this.updateGameState({ updateFen: true, animate: true });
    } else {
      this.board.set({ fen: '' });
      this.board.set({ fen: this.session.getFen() });
      this.updateGameState({ updateFen: true, animate: false });
      this.board.redrawAll();
    }

    if (res.move && res.isNormalPromo && res.colorBefore) {
      this.eventBus.emit('promotion-required', {
        from: res.move.from,
        to: res.move.to,
        promotedTo: res.move.promotion?.toUpperCase() || 'Q',
      });
    }
  }

  private syncHistoryView(_ply: number, fenViewing: string, lastMove?: [Key, Key]): void {
    if (!this.board) return;

    const options = this.getOptions();
    const isReadOnly = options.readOnly ?? true;

    const res = FenManager.safeLoadFen(fenViewing, () => {});
    const posViewing = res.pos;
    const turnColor = posViewing.turn === 'white' ? 'white' : 'black';

    let movableColor: 'white' | 'black' | 'both' | undefined = undefined;
    let movableDests: Map<Key, Key[]> | undefined = undefined;

    if (!isReadOnly) {
      movableColor = options.freeMode ? 'both' : options.playerColor || turnColor;
      movableDests = options.freeMode
        ? FenManager.getPossibleMovesForBothColors(posViewing)
        : possibleMoves(posViewing);
    }

    this.board.set({
      fen: fenViewing,
      turnColor,
      check: posViewing.isCheck() ? turnColor : undefined,
      viewOnly: false,
      premovable: { enabled: false },
      movable: {
        color: movableColor,
        dests: movableDests,
        free: !!options.freeMode,
      },
      lastMove,
    });
    this.board.redrawAll();
    this.annotationService.updateCommentAndShapes(
      fenViewing,
      options.mode,
      options.preserveShapesOnPositionChange
    );
  }

  // --- DOM Listeners & Bounds ---

  private bindDomEvents(): void {
    const addListener = (
      target: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions
    ) => {
      target.addEventListener(type, listener, options);
      this.domListeners.push({ target, type, listener, options });
    };

    const onDown = (e: Event) => {
      this.clearDomBounds();
      const me = e as MouseEvent | TouchEvent;
      if ('button' in me && me.button !== 0) return;
      const sq = this.getSquareFromEvent(me, this.getOrientation());
      if (sq) {
        let clientX = 0;
        let clientY = 0;
        if ('touches' in me && me.touches && me.touches.length > 0) {
          clientX = me.touches[0].clientX;
          clientY = me.touches[0].clientY;
        } else if ('clientX' in me) {
          clientX = me.clientX;
          clientY = me.clientY;
        }
        this.pointerDownState = { x: clientX, y: clientY, square: sq };
      } else {
        this.pointerDownState = null;
      }
    };

    const onUp = (e: Event) => {
      const me = e as MouseEvent | TouchEvent;
      if ('button' in me && me.button !== 0) {
        this.pointerDownState = null;
        return;
      }
      if (!this.pointerDownState) return;

      let clientX = 0;
      let clientY = 0;
      if ('changedTouches' in me && me.changedTouches && me.changedTouches.length > 0) {
        clientX = me.changedTouches[0].clientX;
        clientY = me.changedTouches[0].clientY;
      } else if ('clientX' in me) {
        clientX = me.clientX;
        clientY = me.clientY;
      }

      const dx = clientX - this.pointerDownState.x;
      const dy = clientY - this.pointerDownState.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 10) {
        const sq =
          this.getSquareFromEvent(me, this.getOrientation()) || this.pointerDownState.square;
        if (sq) {
          this.eventBus.emit('square-clicked', { square: sq });
        }
      }
      this.pointerDownState = null;
    };

    const onContextMenu = () => {
      this.clearDomBounds();
    };

    if (typeof window !== 'undefined' && 'PointerEvent' in window) {
      addListener(this.element, 'pointerdown', onDown as EventListener, { capture: true });
      addListener(this.element, 'pointerup', onUp as EventListener, { capture: true });
    } else {
      addListener(this.element, 'mousedown', onDown as EventListener, { capture: true });
      addListener(this.element, 'mouseup', onUp as EventListener, { capture: true });
      addListener(this.element, 'touchstart', onDown as EventListener, {
        passive: true,
        capture: true,
      });
      addListener(this.element, 'touchend', onUp as EventListener, {
        passive: true,
        capture: true,
      });
    }

    addListener(this.element, 'contextmenu', onContextMenu as EventListener, { capture: true });

    if (typeof window !== 'undefined' && typeof window.ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.clearDomBounds();
      });
      this.resizeObserver.observe(this.element);
    }
  }

  public getOrientation(): 'white' | 'black' {
    return this.board ? this.board.state.orientation : 'white';
  }

  public clearDomBounds(): void {
    if (this.board?.state?.dom?.bounds) {
      this.board.state.dom.bounds.clear();
    }
    const cgWrap = (this.element.querySelector('cg-board') ||
      this.element.querySelector('.cg-wrap')) as (Element & { _cgBounds?: unknown }) | null;
    if (cgWrap && cgWrap._cgBounds) {
      delete cgWrap._cgBounds;
    }
  }

  public getSquareFromEvent(
    e: MouseEvent | TouchEvent,
    orientation: 'white' | 'black'
  ): Key | null {
    let clientX = 0;
    let clientY = 0;

    if ('touches' in e && e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ('changedTouches' in e && e.changedTouches && e.changedTouches.length > 0) {
      clientX = e.changedTouches[0].clientX;
      clientY = e.changedTouches[0].clientY;
    } else if ('clientX' in e) {
      clientX = e.clientX;
      clientY = e.clientY;
    } else {
      return null;
    }

    const cgBoard =
      this.element.querySelector('cg-board') || this.element.querySelector('.cg-wrap');
    const bounds = cgBoard ? cgBoard.getBoundingClientRect() : this.element.getBoundingClientRect();

    if (
      clientX < bounds.left ||
      clientX > bounds.right ||
      clientY < bounds.top ||
      clientY > bounds.bottom
    ) {
      return null;
    }

    const relX = clientX - bounds.left;
    const relY = clientY - bounds.top;

    const fileIdx = Math.min(7, Math.max(0, Math.floor((relX / bounds.width) * 8)));
    const rankIdx = Math.min(7, Math.max(0, Math.floor((relY / bounds.height) * 8)));

    const file = orientation === 'white' ? FILES[fileIdx] : FILES[7 - fileIdx];
    const rank = orientation === 'white' ? 8 - rankIdx : rankIdx + 1;

    return `${file}${rank}` as Key;
  }

  public destroy(): void {
    for (const { target, type, listener, options } of this.domListeners) {
      target.removeEventListener(type, listener, options);
    }
    this.domListeners = [];
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.board) {
      this.board.destroy();
    }
  }
}
