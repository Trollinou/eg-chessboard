import { Chess, makeSquare } from 'chessops';
import { makeFen } from 'chessops/fen';
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
import { isNormal, type Role } from 'chessops/types';
import type { Move, PgnNodeMeta, VariationInfo, PgnTreeNode } from '../types';

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

const roleToPieceSymbol: Record<Role, string> = {
  pawn: 'p',
  knight: 'n',
  bishop: 'b',
  rook: 'r',
  queen: 'q',
  king: 'k',
};

export class PgnTreeManager {
  private headers: Map<string, string> = defaultHeaders();
  private rootNode: Node<PgnNodeMeta> = new Node<PgnNodeMeta>();
  private currentNode: Node<PgnNodeMeta> = this.rootNode;
  private rootPos: Chess = Chess.default();

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

  public setRootPos(pos: Chess): void {
    this.rootPos = pos.clone();
  }

  public resetTree(startPos?: Chess): void {
    this.headers = defaultHeaders();
    this.rootNode = new Node<PgnNodeMeta>();
    this.currentNode = this.rootNode;
    this.rootPos = startPos ? startPos.clone() : Chess.default();
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

  public loadPgn(pgnStr: string): Chess {
    const games = parsePgn(pgnStr);
    if (!games.length) return Chess.default();
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
    return this.syncGamePosToCurrentNode();
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

  public getVariationsAtPly(targetPly: number): VariationInfo[] {
    const path = this.getActivePath();
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

  public selectVariation(variationIndex: number, targetPly: number): boolean {
    const path = this.getActivePath();
    if (targetPly <= 0 || targetPly > path.length) return false;

    const parentNode = targetPly === 1 ? this.rootNode : path[targetPly - 2];
    if (variationIndex < 0 || variationIndex >= parentNode.children.length) return false;

    const selectedChild = parentNode.children[variationIndex];
    let endNode: Node<PgnNodeMeta> = selectedChild;
    while (endNode.children.length > 0) {
      endNode = endNode.children[0];
    }

    this.currentNode = endNode;
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
}
