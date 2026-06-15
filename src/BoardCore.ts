import { Chess, type Square } from 'chess.js';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Config } from '@lichess-org/chessground/config';
import type { Color, Key, MoveMetadata } from '@lichess-org/chessground/types';
import { possibleMoves, isPromotion, shortToLongColor, getThreats } from './BoardHelper';

export interface BoardCoreState {
  showThreats: boolean;
  promotionDialogState: {
    isEnabled: boolean;
    color?: Color;
    callback?: (piece: string) => void;
  };
  historyViewerState: {
    isEnabled: boolean;
    plyViewing?: number;
  };
}

export class BoardCore {
  public game: Chess;
  public board!: Api;
  private boardElement: HTMLElement;
  private state: BoardCoreState;
  private onStateChange: () => void;
  private emitEvent: (event: string, ...args: any[]) => void;
  private initialConfig: Config;

  constructor(
    boardElement: HTMLElement,
    state: BoardCoreState,
    onStateChange: () => void,
    emitEvent: (event: string, ...args: any[]) => void,
    initialConfig: Config = {}
  ) {
    this.boardElement = boardElement;
    this.state = state;
    this.onStateChange = onStateChange;
    this.emitEvent = emitEvent;
    this.initialConfig = initialConfig;
    this.game = new Chess();
    
    this.initBoard();
  }

  private initBoard() {
    const config = this.buildConfig(this.initialConfig);
    this.board = Chessground(this.boardElement, config);
    this.updateGameState({ updateFen: false });
  }

  private buildConfig(userConfig: Config): Config {
    const defaultEvents = {
      after: (orig: Key, dest: Key, metadata: MoveMetadata) => {
        this.changeTurn(orig, dest, metadata);
      }
    };

    const config: Config = {
      fen: this.game.fen(),
      turnColor: this.getTurnColor(),
      movable: {
        free: false,
        color: this.getTurnColor(),
        dests: possibleMoves(this.game),
        events: defaultEvents,
      },
      ...userConfig,
    };

    return config;
  }

  private updateGameState({ updateFen = true } = {}): void {
    if (!this.state.historyViewerState.isEnabled) {
      if (updateFen) {
        this.board.set({ fen: this.game.fen() });
      }

      this.board.set({
        turnColor: this.getTurnColor(),
        movable: {
          color: this.getTurnColor(),
          dests: possibleMoves(this.game),
        }
      });

      this.displayInCheck(this.game.inCheck(), this.getTurnColor());

      if (this.state.showThreats) {
        this.drawThreats();
      }
    }

    this.emitEvents();
  }

  private displayInCheck(inCheck: boolean, color: Color): void {
    this.board.set({ check: inCheck ? color : undefined });
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
      const selectedPromotion = await new Promise<string>((resolve) => {
        this.state.promotionDialogState = {
          isEnabled: true,
          color: this.getTurnColor(),
          callback: (promoPiece) => {
            resolve(promoPiece);
          }
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
    this.board.set(other);
    if (fen) {
      this.setPosition(fen);
    }
    this.board.redrawAll();
  }

  resetBoard(): void {
    this.game.reset();
    this.state.historyViewerState = { isEnabled: false };
    this.onStateChange();
    this.board.set({
      fen: this.game.fen(),
      lastMove: undefined,
    });
    this.updateGameState({ updateFen: false });
  }

  undoLastMove(): void {
    const undoMove = this.game.undo();
    if (!undoMove) return;

    if (!this.state.historyViewerState.isEnabled) {
      this.board.set({ fen: undoMove.before });
      this.updateGameState({ updateFen: false });
      const lastMove = this.getLastMove();
      this.board.set({
        lastMove: lastMove ? [lastMove.from, lastMove.to] : undefined
      });
    }
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
      black: [] as string[]
    };
    for (const move of this.game.history({ verbose: true }) as any[]) {
      if (move.captured) {
        // move.color is 'w' or 'b'. If White captured a piece, it means the captured piece was Black.
        // Wait, the API getCapturedPieces in vue3-chessboard returns:
        // captured.black has the pieces captured by Black (meaning White pieces).
        // Let's match the exact behavior:
        const capturingColor = move.color === 'w' ? 'white' : 'black';
        captured[capturingColor].push(move.captured);
      }
    }
    return captured;
  }

  toggleOrientation(): void {
    this.board.toggleOrientation();
  }

  drawThreats(): void {
    this.state.showThreats = true;
    this.onStateChange();
    const threats = getThreats(this.game.moves({ verbose: true }) as any[]);
    this.board.setShapes(threats as any);
  }

  hideMoves(): void {
    this.state.showThreats = false;
    this.onStateChange();
    this.board.setShapes([]);
  }

  drawMove(from: Key, to: Key, brush: string): void {
    this.board.setShapes([
      { orig: from, dest: to, brush }
    ]);
  }

  move(moveObj: any): boolean {
    let resultMove;
    try {
      resultMove = this.game.move(moveObj);
    } catch {
      return false;
    }

    this.emitEvent('move', resultMove);

    if (resultMove.promotion) {
      this.emitEvent('promotion', {
        color: shortToLongColor(resultMove.color),
        promotedTo: resultMove.promotion.toUpperCase(),
        sanMove: resultMove.san
      });
    }

    if (!this.state.historyViewerState.isEnabled) {
      this.board.move(resultMove.from as Key, resultMove.to as Key);
      // For castling/promotion/en passant, update board representation after short delay
      if (resultMove.flags.includes('k') || resultMove.flags.includes('q') || resultMove.flags.includes('e') || resultMove.promotion) {
        setTimeout(() => {
          this.board.set({ fen: this.game.fen() });
        }, 50);
      }
      this.updateGameState({ updateFen: false });
    }
    return true;
  }

  getTurnColor(): Color {
    return shortToLongColor(this.game.turn());
  }

  getCurrentTurnNumber(): number {
    return this.game.moveNumber();
  }

  getCurrentPlyNumber(): number {
    return 2 * this.getCurrentTurnNumber() - (this.getTurnColor() === 'black' ? 1 : 2);
  }

  getLastMove() {
    const history = this.game.history({ verbose: true }) as any[];
    return history.length ? history[history.length - 1] : null;
  }

  getHistory(verbose = false) {
    return this.game.history({ verbose: verbose as any });
  }

  getFen(): string {
    return this.game.fen();
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

  getSquareColor(square: Key) {
    return this.game.squareColor(square as Square);
  }

  getSquare(square: Key) {
    return this.game.get(square as Square);
  }

  setPosition(fen: string): void {
    this.game.load(fen);
    this.state.historyViewerState = { isEnabled: false };
    this.onStateChange();
    this.updateGameState();
  }

  putPiece(piece: any, square: Key): boolean {
    const res = this.game.put(piece, square as Square);
    if (res) {
      this.updateGameState();
    }
    return res;
  }

  removePiece(square: Key): void {
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
  }

  getPgnInfo() {
    return this.game.header();
  }
}
