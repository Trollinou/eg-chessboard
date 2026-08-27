import { Chess, parseSquare } from 'chessops';
import { equalsIgnoreMoves } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
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
  type Role,
  type Move as ChessopsMove,
  type Color as ChessopsColor,
} from 'chessops/types';
import type { Key, Color } from '@lichess-org/chessground/types';

import type { Move, PgnNodeMeta, VariationInfo, PgnTreeNode } from '../types';
import { roleToPieceSymbol, pieceSymbolToRole, buildMovePojo, FILES } from './pieceMapping';
import { DomainEventBus } from './DomainEventBus';

export interface HistoryViewerState {
  isEnabled: boolean;
  plyViewing?: number;
  viewOnly?: boolean;
}

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

export class GameSession {
  public pos: Chess = Chess.default();
  private rootPos: Chess = Chess.default();
  private headers: Map<string, string> = defaultHeaders();
  private rootNode: Node<PgnNodeMeta> = new Node<PgnNodeMeta>();
  private currentNode: Node<PgnNodeMeta> = this.rootNode;

  private historyState: HistoryViewerState = { isEnabled: false };
  private soloHistory: Move[] = [];

  constructor(private eventBus: DomainEventBus) {
    this.resetTree(this.pos);
  }

  // --- Tree & Path Management ---

  public getRootNode(): Node<PgnNodeMeta> {
    return this.rootNode;
  }

  public getCurrentNode(): Node<PgnNodeMeta> {
    return this.currentNode;
  }

  public setCurrentNode(node: Node<PgnNodeMeta>): void {
    this.currentNode = node;
  }

  public getRootPos(): Chess {
    return this.rootPos;
  }

  public resetTree(startPos?: Chess): void {
    this.headers = defaultHeaders();
    this.rootNode = new Node<PgnNodeMeta>();
    this.currentNode = this.rootNode;
    this.rootPos = startPos ? startPos.clone() : Chess.default();
    const fen = makeFen(this.rootPos.toSetup());
    if (fen !== 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1') {
      this.headers.set('SetUp', '1');
      this.headers.set('FEN', fen);
    }
  }

  public findParentNode(
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

  public getActivePath(): ChildNode<PgnNodeMeta>[] {
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

  public syncGamePosToCurrentNode(): Chess {
    const path = this.getActivePath();
    const newPos = this.rootPos.clone();
    for (const child of path) {
      const m = parseSan(newPos, child.data.san);
      if (m) {
        newPos.play(m);
      }
    }
    return newPos;
  }

  public syncGamePosToPly(targetPly: number): Chess {
    const path = this.getActivePath();
    const newPos = this.rootPos.clone();
    const limit = Math.min(targetPly, path.length);
    for (let i = 0; i < limit; i++) {
      const m = parseSan(newPos, path[i].data.san);
      if (m) {
        newPos.play(m);
      }
    }
    return newPos;
  }

  // --- History Navigation ---

  public getHistoryViewerState(): Readonly<HistoryViewerState> {
    return { ...this.historyState };
  }

  public isViewingHistory(): boolean {
    return this.historyState.isEnabled;
  }

  public getCurrentViewingPly(fallbackPly: number = this.getActivePath().length): number {
    return this.historyState.isEnabled && this.historyState.plyViewing !== undefined
      ? this.historyState.plyViewing
      : fallbackPly;
  }

  public resetHistoryState(): void {
    this.historyState = { isEnabled: false };
  }

  public viewHistory(
    ply: number,
    viewOnly?: boolean
  ): { fen: string; lastMove?: [Key, Key] } | null {
    const path = this.getActivePath();
    if (ply < 0 || ply > path.length) return null;

    this.historyState = {
      isEnabled: true,
      plyViewing: ply,
      viewOnly: viewOnly ?? this.historyState.viewOnly,
    };

    const rootFen = makeFen(this.rootPos.toSetup());
    const fenViewing = ply === 0 ? rootFen : path[ply - 1].data.fen;
    const lastMove: [Key, Key] | undefined =
      ply > 0
        ? [path[ply - 1].data.move.from as Key, path[ply - 1].data.move.to as Key]
        : undefined;

    this.eventBus.emit('history-navigated', {
      ply,
      fen: fenViewing,
      isViewingHistory: true,
      lastMove,
    });
    this.eventBus.emit('state-changed');

    return { fen: fenViewing, lastMove };
  }

  public viewStart(viewOnly?: boolean): { fen: string; lastMove?: [Key, Key] } | null {
    return this.viewHistory(0, viewOnly);
  }

  public viewNext(viewOnly?: boolean): { fen: string; lastMove?: [Key, Key] } | null {
    const ply = this.getCurrentViewingPly(0);
    const path = this.getActivePath();
    if (ply < path.length) {
      return this.viewHistory(ply + 1, viewOnly);
    }
    return null;
  }

  public viewPrevious(viewOnly?: boolean): { fen: string; lastMove?: [Key, Key] } | null {
    const path = this.getActivePath();
    const ply = this.getCurrentViewingPly(path.length);
    if (ply > 0) {
      return this.viewHistory(ply - 1, viewOnly);
    }
    return null;
  }

  public stopViewingHistory(): void {
    if (this.historyState.isEnabled) {
      this.historyState = { isEnabled: false };
      const path = this.getActivePath();
      const lastMove: [Key, Key] | undefined = path.length
        ? [path[path.length - 1].data.move.from as Key, path[path.length - 1].data.move.to as Key]
        : undefined;

      this.eventBus.emit('history-navigated', {
        ply: path.length,
        fen: this.getFen(),
        isViewingHistory: false,
        lastMove,
      });
      this.eventBus.emit('state-changed');
    }
  }

  // --- Move Execution & Branches ---

  public executeMove(
    moveObj: string | { from: string; to: string; promotion?: string },
    options: {
      freeMode?: boolean;
      readOnly?: boolean;
      soloMode?: boolean;
    } = {}
  ): {
    success: boolean;
    move?: Move;
    wasViewingHistory?: boolean;
    isNormalPromo?: boolean;
    colorBefore?: 'w' | 'b';
  } {
    const wasViewingHistory = this.isViewingHistory();

    if (wasViewingHistory) {
      const ply = this.getCurrentViewingPly(this.getActivePath().length);
      const path = this.getActivePath();
      const targetNode = ply === 0 ? this.getRootNode() : path[ply - 1];

      if (options.readOnly) {
        const tempPos = this.syncGamePosToPly(ply);
        let tempParsed: ChessopsMove | undefined;
        if (typeof moveObj === 'string') {
          tempParsed = parseSan(tempPos, moveObj);
        } else {
          const fromSq = parseSquare(moveObj.from);
          const toSq = parseSquare(moveObj.to);
          if (fromSq !== undefined && toSq !== undefined) {
            tempParsed = { from: fromSq, to: toSq };
          }
        }
        if (tempParsed) {
          const fenBefore = makeFen(tempPos.toSetup());
          const movePojo = buildMovePojo(tempPos, tempParsed, fenBefore);
          const existingChild = targetNode.children.find(
            (child) =>
              child.data.san === movePojo.san ||
              (child.data.move.from === movePojo.from && child.data.move.to === movePojo.to)
          );
          if (!existingChild) {
            return { success: false };
          }
        }
      }

      this.setCurrentNode(targetNode);
      const syncedPos = this.syncGamePosToPly(ply);
      this.pos = syncedPos;
      this.historyState = { isEnabled: false };
    }

    let parsedMove: ChessopsMove | undefined;

    if (options.freeMode) {
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
      return { success: false };
    }

    const colorBefore: 'w' | 'b' = this.pos.turn === 'white' ? 'w' : 'b';
    const fenBefore = this.getFen();

    const movePojo = buildMovePojo(this.pos, parsedMove, fenBefore);

    if (options.soloMode) {
      this.soloHistory.push(movePojo);
      this.pos.turn = colorBefore === 'w' ? 'white' : 'black';
    }

    const currentNode = this.getCurrentNode();
    let childNode = currentNode.children.find(
      (child) =>
        child.data.san === movePojo.san ||
        (child.data.move.from === movePojo.from && child.data.move.to === movePojo.to)
    );

    if (!childNode) {
      childNode = new ChildNode<PgnNodeMeta>({
        san: movePojo.san,
        fen: movePojo.after,
        move: movePojo,
      });
      currentNode.children.push(childNode);
    }
    this.setCurrentNode(childNode);

    const isNormalPromo = isNormal(parsedMove) && !!parsedMove.promotion;

    this.eventBus.emit('move-executed', {
      move: movePojo,
      turnColor: this.getTurnColor(),
      ply: this.getCurrentPlyNumber(),
      isCheck: this.getIsCheck(),
      isGameOver: this.getIsGameOver(),
      isCheckmate: this.getIsCheckmate(),
      isStalemate: this.getIsStalemate(),
      isDraw: this.getIsDraw(),
    });

    this.eventBus.emit('turn-changed', {
      turnColor: this.getTurnColor(),
      ply: this.getCurrentPlyNumber(),
    });

    this.eventBus.emit('position-changed', {
      fen: this.getFen(),
      posUpdated: true,
    });

    this.eventBus.emit('state-changed');

    return {
      success: true,
      move: movePojo,
      wasViewingHistory,
      isNormalPromo,
      colorBefore,
    };
  }

  public undoLastMove(): boolean {
    const parentNode = this.findParentNode(this.rootNode, this.currentNode);
    if (!parentNode) return false;

    if (
      this.historyState.isEnabled &&
      this.historyState.plyViewing === this.getCurrentPlyNumber()
    ) {
      this.stopViewingHistory();
    }

    this.setCurrentNode(parentNode);
    this.pos = this.syncGamePosToCurrentNode();

    this.eventBus.emit('turn-changed', {
      turnColor: this.getTurnColor(),
      ply: this.getCurrentPlyNumber(),
    });
    this.eventBus.emit('position-changed', {
      fen: this.getFen(),
      posUpdated: true,
    });
    this.eventBus.emit('state-changed');

    return true;
  }

  // --- Variations Management ---

  public getVariationsAtPly(targetPly: number = this.getCurrentViewingPly()): VariationInfo[] {
    const path = this.getActivePath();
    const effectivePly = targetPly === 0 ? 1 : targetPly;
    if (effectivePly <= 0 || (path.length > 0 && effectivePly > path.length)) return [];

    const parentNode = effectivePly === 1 ? this.rootNode : path[effectivePly - 2];
    const currentChild = path.length >= effectivePly ? path[effectivePly - 1] : undefined;

    return parentNode.children.map((child, index) => ({
      index,
      san: child.data.san,
      fen: child.data.fen,
      move: child.data.move,
      isMainline: index === 0,
      isActive: child === currentChild,
      comments: child.data.comments,
    }));
  }

  public selectVariation(
    variationIndex: number,
    targetPly: number = this.getCurrentViewingPly()
  ): boolean {
    const path = this.getActivePath();
    const effectivePly = targetPly === 0 ? 1 : targetPly;
    if (effectivePly <= 0 || (path.length > 0 && effectivePly > path.length)) return false;

    const parentNode = effectivePly === 1 ? this.rootNode : path[effectivePly - 2];
    if (variationIndex < 0 || variationIndex >= parentNode.children.length) return false;

    const selectedChild = parentNode.children[variationIndex];
    let endNode: Node<PgnNodeMeta> = selectedChild;
    while (endNode.children.length > 0) {
      endNode = endNode.children[0];
    }

    this.currentNode = endNode;
    this.pos = this.syncGamePosToCurrentNode();

    const activePath = this.getActivePath();
    const newPly = Math.min(effectivePly, activePath.length);

    this.viewHistory(newPly);

    this.eventBus.emit('position-changed', { fen: this.getFen(), posUpdated: true });
    this.eventBus.emit('state-changed');
    return true;
  }

  public deleteVariation(
    variationIndex: number = 0,
    targetPly: number = this.getCurrentViewingPly()
  ): boolean {
    const path = this.getActivePath();
    const effectivePly = targetPly === 0 ? 1 : targetPly;
    if (effectivePly <= 0 || (path.length > 0 && effectivePly > path.length)) return false;

    const parentNode = effectivePly === 1 ? this.rootNode : path[effectivePly - 2];
    if (variationIndex < 0 || variationIndex >= parentNode.children.length) return false;

    parentNode.children.splice(variationIndex, 1);
    if (
      this.findParentNode(this.rootNode, this.currentNode) === null &&
      this.currentNode !== this.rootNode
    ) {
      this.currentNode = parentNode;
    }

    this.pos = this.syncGamePosToCurrentNode();
    const activePath = this.getActivePath();

    if (this.isViewingHistory()) {
      const viewingPly = Math.min(effectivePly, activePath.length);
      this.viewHistory(viewingPly);
    }

    this.eventBus.emit('position-changed', { fen: this.getFen(), posUpdated: true });
    this.eventBus.emit('state-changed');
    return true;
  }

  public promoteVariation(
    variationIndex: number = 0,
    targetPly: number = this.getCurrentViewingPly()
  ): boolean {
    const path = this.getActivePath();
    const effectivePly = targetPly === 0 ? 1 : targetPly;
    if (effectivePly <= 0 || (path.length > 0 && effectivePly > path.length)) return false;

    const parentNode = effectivePly === 1 ? this.rootNode : path[effectivePly - 2];
    if (variationIndex <= 0 || variationIndex >= parentNode.children.length) return false;

    const [promoted] = parentNode.children.splice(variationIndex, 1);
    parentNode.children.unshift(promoted);

    this.pos = this.syncGamePosToCurrentNode();
    const activePath = this.getActivePath();
    const newPly = Math.min(effectivePly, activePath.length);

    if (this.isViewingHistory()) {
      this.viewHistory(newPly);
    }

    this.eventBus.emit('position-changed', { fen: this.getFen(), posUpdated: true });
    this.eventBus.emit('state-changed');
    return true;
  }

  public getPgnTree(): PgnTreeNode {
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

  // --- PGN Serializing & Loading ---

  public loadPgn(pgnStr: string): void {
    const games = parsePgn(pgnStr);
    if (!games.length) return;
    const game = games[0];
    this.headers = game.headers || defaultHeaders();

    const startRes = startingPosition(this.headers);
    const startPos = startRes.isOk ? startRes.value : Chess.default();
    this.rootPos = startPos.clone();

    const ctx = new TransformContext(startPos.clone());
    this.rootNode = transform(game.moves, ctx, (c, node) => {
      const parsed = parseSan(c.pos, node.san);
      if (!parsed) return undefined;
      const fenBefore = makeFen(c.pos.toSetup());
      const movePojo = buildMovePojo(c.pos, parsed, fenBefore);

      const meta: PgnNodeMeta = {
        san: movePojo.san,
        fen: movePojo.after,
        move: movePojo,
        comments: node.comments,
        startingComments: node.startingComments,
        nags: node.nags,
      };
      return meta;
    });

    if (game.comments && game.comments.length > 0 && this.rootNode.children.length > 0) {
      const firstChild = this.rootNode.children[0];
      firstChild.data.startingComments = [
        ...(firstChild.data.startingComments || []),
        ...game.comments,
      ];
    }

    this.currentNode = this.rootNode;
    const mainline = Array.from(this.rootNode.mainlineNodes());
    if (mainline.length > 0) {
      this.currentNode = mainline[mainline.length - 1];
    }
    this.pos = this.syncGamePosToCurrentNode();
    this.resetHistoryState();

    this.eventBus.emit('turn-changed', {
      turnColor: this.getTurnColor(),
      ply: this.getCurrentPlyNumber(),
    });
    this.eventBus.emit('position-changed', {
      fen: this.getFen(),
      posUpdated: true,
    });
    this.eventBus.emit('state-changed');
  }

  public getPgn(): string {
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

  public getPgnInfo(): Record<string, string> {
    const headersObj: Record<string, string> = {};
    for (const [k, v] of this.headers.entries()) {
      headersObj[k] = v;
    }
    return headersObj;
  }

  // --- Position & Fen ---

  public safeLoadFen(fenStr: string): boolean {
    const setupRes = parseFen(fenStr);
    if (setupRes.isOk) {
      const chessRes = Chess.fromSetup(setupRes.value);
      if (chessRes.isOk) {
        this.pos = chessRes.value;
        this.resetTree(this.pos);
        return true;
      }
    }

    const parts = fenStr.split(' ');
    const placement = parts[0];

    let pos = Chess.default();
    const minSetupRes = parseFen(`4k3/8/8/8/8/8/8/4K3 ${parts[1] === 'b' ? 'b' : 'w'} - - 0 1`);
    if (minSetupRes.isOk) {
      const minChess = Chess.fromSetup(minSetupRes.value);
      if (minChess.isOk) {
        pos = minChess.value;
      }
    }
    pos.board.take(parseSquare('e1')!);
    pos.board.take(parseSquare('e8')!);
    pos.turn = parts[1] === 'b' ? 'black' : 'white';

    const ranks = placement.split('/');
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
          const square = parseSquare(`${FILES[fileIdx]}${8 - r}`)!;
          if (fileIdx < 8 && role) {
            pos.board.set(square, { role, color });
          }
          fileIdx++;
        }
      }
    }
    this.pos = pos;
    this.resetTree(this.pos);
    return false;
  }

  public newGame(fen?: string): void {
    if (fen) {
      this.safeLoadFen(fen);
    } else {
      this.pos = Chess.default();
      this.resetTree(this.pos);
    }
    this.soloHistory = [];
    this.resetHistoryState();

    this.eventBus.emit('turn-changed', {
      turnColor: this.getTurnColor(),
      ply: this.getCurrentPlyNumber(),
    });
    this.eventBus.emit('position-changed', {
      fen: this.getFen(),
      posUpdated: true,
    });
    this.eventBus.emit('state-changed');
  }

  public getFen(): string {
    return makeFen(this.pos.toSetup());
  }

  public getPlacementFen(boardPieces?: Map<Key, { role: Role; color: Color }>): string {
    if (boardPieces) {
      const ranks: string[] = [];
      for (let rank = 8; rank >= 1; rank--) {
        let rankStr = '';
        let emptyCount = 0;
        for (let fileIdx = 0; fileIdx < 8; fileIdx++) {
          const file = String.fromCharCode(97 + fileIdx);
          const square = `${file}${rank}` as Key;
          const piece = boardPieces.get(square);
          if (piece) {
            if (emptyCount > 0) {
              rankStr += emptyCount.toString();
              emptyCount = 0;
            }
            const char = roleToPieceSymbol[piece.role] || 'p';
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
    return this.getFen().split(' ')[0];
  }

  public putPiece(piece: { type: string; color: 'w' | 'b' }, square: Key | string): boolean {
    const role = pieceSymbolToRole[piece.type];
    const parsedSq = parseSquare(square);
    if (parsedSq === undefined || !role) return false;

    this.pos.board.set(parsedSq, {
      role,
      color: piece.color === 'w' ? 'white' : 'black',
    });
    this.eventBus.emit('position-changed', { fen: this.getFen(), posUpdated: true });
    this.eventBus.emit('state-changed');
    return true;
  }

  public removePiece(square: Key | string): void {
    const sq = parseSquare(square);
    if (sq !== undefined) {
      this.pos.board.take(sq);
      this.eventBus.emit('position-changed', { fen: this.getFen(), posUpdated: true });
      this.eventBus.emit('state-changed');
    }
  }

  // --- Getters & Arbitration ---

  public getTurnColor(): Color {
    return this.pos.turn === 'white' ? 'white' : 'black';
  }

  public getCurrentTurnNumber(): number {
    return this.pos.fullmoves;
  }

  public getCurrentPlyNumber(): number {
    return this.getActivePath().length;
  }

  public getLastMove(): Move | null {
    const path = this.getActivePath();
    return path.length ? path[path.length - 1].data.move : null;
  }

  public getHistory(verbose = false): Move[] | string[] {
    const path = this.getActivePath();
    if (verbose) {
      return path.map((n) => n.data.move);
    }
    return path.map((n) => n.data.san);
  }

  public getSoloHistory(): Move[] {
    return this.soloHistory;
  }

  public resetSoloHistory(): void {
    this.soloHistory = [];
  }

  public isThreefoldRepetition(targetPly?: number): boolean {
    const path = this.getActivePath();
    const limit = targetPly !== undefined ? Math.min(targetPly, path.length) : path.length;

    const positions: Chess[] = [this.rootPos.clone()];
    const simPos = this.rootPos.clone();

    for (let i = 0; i < limit; i++) {
      const m = parseSan(simPos, path[i].data.san);
      if (m) {
        simPos.play(m);
        positions.push(simPos.clone());
      }
    }

    const halfmoves = this.pos.halfmoves;
    const startIndex = Math.max(0, positions.length - 1 - halfmoves);

    let count = 0;
    for (let i = positions.length - 1; i >= startIndex; i--) {
      if (positions[i].turn === this.pos.turn) {
        if (equalsIgnoreMoves(this.pos, positions[i])) {
          count++;
          if (count >= 3) {
            return true;
          }
        }
      }
    }
    return false;
  }

  public getIsCheck(): boolean {
    return this.pos.isCheck();
  }

  public getIsCheckmate(): boolean {
    return this.pos.isCheckmate();
  }

  public getIsStalemate(): boolean {
    return this.pos.isStalemate();
  }

  public getIsInsufficientMaterial(): boolean {
    return this.pos.isInsufficientMaterial();
  }

  public getIsDraw(): boolean {
    return (
      this.pos.isStalemate() ||
      this.pos.isInsufficientMaterial() ||
      this.pos.halfmoves >= 100 ||
      this.isThreefoldRepetition(this.isViewingHistory() ? this.getCurrentViewingPly() : undefined)
    );
  }

  public getIsGameOver(): boolean {
    return this.getIsCheckmate() || this.getIsDraw();
  }

  public getInCheckColor(): 'white' | 'black' | null {
    return this.getIsCheck() ? this.getTurnColor() : null;
  }

  public getGameOverReason(lang: 'fr' | 'en' = 'fr'): string {
    if (this.pos.isCheckmate()) {
      const turnColor = this.pos.turn === 'white' ? 'white' : 'black';
      const winner =
        turnColor === 'white'
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
    if (this.pos.isStalemate()) return lang === 'fr' ? 'Match nul par Pat.' : 'Draw by stalemate.';
    if (this.pos.isInsufficientMaterial())
      return lang === 'fr'
        ? 'Match nul par matériel insuffisant.'
        : 'Draw by insufficient material.';
    if (
      this.isThreefoldRepetition(this.isViewingHistory() ? this.getCurrentViewingPly() : undefined)
    )
      return lang === 'fr' ? 'Match nul par triple répétition.' : 'Draw by threefold repetition.';
    if (this.pos.halfmoves >= 100)
      return lang === 'fr' ? 'Match nul par la règle des 50 coups.' : 'Draw by fifty-move rule.';
    if (this.pos.isEnd()) return lang === 'fr' ? 'Match nul.' : 'Draw.';
    return '';
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

  public getSquareColor(square: Key | string): 'dark' | 'light' | null {
    const sq = parseSquare(square);
    if (sq === undefined) return null;
    const rank = Math.floor(sq / 8);
    const file = sq % 8;
    return (rank + file) % 2 === 0 ? 'dark' : 'light';
  }

  public getMaterialCount(pieces: Map<Key, { role: Role; color: Color }>) {
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
        materialCount.materialWhite += piecesValues[piece.role] || 0;
      } else {
        materialCount.materialBlack += piecesValues[piece.role] || 0;
      }
    }
    materialCount.materialDiff = materialCount.materialWhite - materialCount.materialBlack;
    return materialCount;
  }

  public getCapturedPieces(history: Move[]) {
    const captured = {
      white: [] as string[],
      black: [] as string[],
    };
    for (const move of history) {
      if (move.captured) {
        const capturingColor = move.color === 'w' ? 'white' : 'black';
        captured[capturingColor].push(move.captured);
      }
    }
    return captured;
  }
}
