import { Chess } from 'chessops';
import { makeFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import {
  parsePgn,
  makePgn,
  Node,
  isChildNode,
  transform,
  startingPosition,
  defaultHeaders,
  type PgnNodeData,
} from 'chessops/pgn';
import type { PgnNodeMeta, VariationInfo, PgnTreeNode } from '../types';
import { buildMovePojo } from './pieceMapping';

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

  public getActivePath(): import('chessops/pgn').ChildNode<PgnNodeMeta>[] {
    const path: import('chessops/pgn').ChildNode<PgnNodeMeta>[] = [];
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
    const effectivePly = targetPly === 0 ? 1 : targetPly;
    if (effectivePly <= 0 || (path.length > 0 && effectivePly > path.length)) return [];

    const parentNode = effectivePly === 1 ? this.rootNode : path[effectivePly - 2];
    const currentChild = path.length >= effectivePly ? path[effectivePly - 1] : undefined;

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
    return true;
  }

  public deleteVariation(variationIndex: number, targetPly: number): boolean {
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
    return true;
  }

  public promoteVariation(variationIndex: number, targetPly: number): boolean {
    const path = this.getActivePath();
    const effectivePly = targetPly === 0 ? 1 : targetPly;
    if (effectivePly <= 0 || (path.length > 0 && effectivePly > path.length)) return false;

    const parentNode = effectivePly === 1 ? this.rootNode : path[effectivePly - 2];
    if (variationIndex <= 0 || variationIndex >= parentNode.children.length) return false;

    const [promoted] = parentNode.children.splice(variationIndex, 1);
    parentNode.children.unshift(promoted);
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
