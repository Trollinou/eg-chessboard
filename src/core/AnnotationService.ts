import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import type { Api } from '@lichess-org/chessground/api';
import { isChildNode } from 'chessops/pgn';

import type { BoardMode } from '../types';
import { getThreats } from '../BoardHelper';
import { FenManager } from './FenManager';
import { DomainEventBus } from './DomainEventBus';
import { GameSession } from './GameSession';

export class AnnotationService {
  private currentPreservedShapes: DrawShape[] = [];
  private currentComment = '';
  private isDrawingUpdate = false;
  private isProgrammaticShapeUpdate = false;
  private board: Api | null = null;

  constructor(
    private eventBus: DomainEventBus,
    private session: GameSession
  ) {}

  public setBoard(board: Api | null): void {
    this.board = board;
  }

  public getCurrentComment(): string {
    return this.currentComment;
  }

  public setCurrentComment(comment: string): void {
    this.currentComment = comment;
  }

  public getPreservedShapes(): DrawShape[] {
    return this.currentPreservedShapes;
  }

  public setPreservedShapes(shapes: DrawShape[]): void {
    this.currentPreservedShapes = shapes;
  }

  public getShapes(preserveShapesOnPositionChange: boolean): DrawShape[] {
    if (preserveShapesOnPositionChange) {
      return this.currentPreservedShapes;
    }
    return (
      this.board?.state?.drawable?.shapes ||
      this.board?.state?.drawable?.autoShapes ||
      this.currentPreservedShapes ||
      []
    );
  }

  public applyBoardShapes(
    shapes: DrawShape[],
    preserveShapesOnPositionChange: boolean,
    mode?: BoardMode
  ): void {
    this.currentPreservedShapes = shapes;
    this.isProgrammaticShapeUpdate = true;
    if (this.board) {
      this.board.setShapes(shapes);
      const isGameMode = mode ? mode === 'game' : this.board.state.drawable.defaultSnapToValidMove;
      this.board.set({
        drawable: {
          eraseOnMovablePieceClick: !preserveShapesOnPositionChange,
          defaultSnapToValidMove: isGameMode,
        },
      });
    }
    requestAnimationFrame(() => {
      this.isProgrammaticShapeUpdate = false;
    });
  }

  public handleDrawableChange(
    shapes: DrawShape[],
    mode: BoardMode,
    isPreserve: boolean,
    readOnly: boolean
  ): void {
    if (this.isDrawingUpdate || this.isProgrammaticShapeUpdate) return;

    this.isDrawingUpdate = true;
    try {
      const shouldPreserve = isPreserve || mode === 'editor';

      if (mode === 'editor') {
        const boardState = this.board as unknown as {
          state?: { drawable?: { current?: unknown } };
        };
        const isDrawingInChessground = !!boardState?.state?.drawable?.current;
        if (shapes.length > 0 || isDrawingInChessground) {
          this.setPreservedShapes(shapes);
        } else if (this.board && this.getPreservedShapes().length > 0) {
          this.applyBoardShapes(this.getPreservedShapes(), true);
        }
      } else if (mode === 'game' && shouldPreserve) {
        if (this.board && this.getPreservedShapes().length > 0) {
          this.applyBoardShapes(this.getPreservedShapes(), true);
        }
      } else {
        this.setPreservedShapes(shapes);
      }

      if (mode === 'study' && !readOnly) {
        const ply = this.session.getCurrentViewingPly();
        this.setCommentAtPly(ply, this.currentComment, shapes, false, mode, shouldPreserve);
      }

      this.eventBus.emit('shapes-changed', { shapes: this.getPreservedShapes() });
      this.eventBus.emit('state-changed');
    } finally {
      this.isDrawingUpdate = false;
    }
  }

  public updateCommentAndShapes(
    _fenStr: string,
    mode?: BoardMode,
    preserveShapesOnPositionChange?: boolean
  ): void {
    const path = this.session.getActivePath();
    const ply = this.session.getCurrentViewingPly(path.length);

    let rawComment = '';
    if (ply > 0 && ply <= path.length) {
      const targetNode = path[ply - 1];
      if (targetNode.data.comments) {
        rawComment = targetNode.data.comments.join(' ');
      }
    } else if (ply === 0 && path.length > 0 && path[0].data.startingComments) {
      rawComment = path[0].data.startingComments.join(' ');
    }

    const isPreserve = !!preserveShapesOnPositionChange || mode === 'editor';

    if (!rawComment) {
      this.currentComment = '';
      if (!isPreserve && this.board) {
        this.applyBoardShapes([], false);
      }
      this.eventBus.emit('comment-changed', { comment: '', ply });
      this.eventBus.emit('state-changed');
      return;
    }

    const parsed = this.parseComment(rawComment);
    this.currentComment = parsed.text;
    if (!isPreserve && this.board) {
      this.applyBoardShapes(parsed.shapes, false);
    }
    this.eventBus.emit('comment-changed', { comment: parsed.text, ply });
    this.eventBus.emit('state-changed');
  }

  public setCommentAtPly(
    ply: number,
    text: string,
    shapes: DrawShape[] = [],
    updateBoardShapes = true,
    mode: BoardMode = 'game',
    preserveShapesOnPositionChange = false
  ): void {
    const path = this.session.getActivePath();
    if (ply < 0 || ply > path.length) return;

    const shapesAnnotation = this.shapesToPgnComment(shapes);
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

    const isViewingThisPly = this.session.getCurrentViewingPly(path.length) === ply;

    if (isViewingThisPly) {
      this.currentComment = text;
      if (updateBoardShapes) {
        const isPreserve = !!preserveShapesOnPositionChange || mode === 'editor';
        this.applyBoardShapes(shapes, isPreserve);
      }
      this.eventBus.emit('comment-changed', { comment: text, ply });
      this.eventBus.emit('state-changed');
    }
  }

  public drawMove(
    from: Key | string,
    to: Key | string,
    brush: string,
    preserveShapes: boolean
  ): void {
    this.applyBoardShapes([{ orig: from as Key, dest: to as Key, brush }], preserveShapes);
  }

  public drawCircle(square: Key | string, brush: string, preserveShapes: boolean): void {
    const currentShapes = this.board?.state?.drawable?.shapes || [];
    this.applyBoardShapes([...currentShapes, { orig: square as Key, brush }], preserveShapes);
  }

  public drawThreats(preserveShapes: boolean): void {
    const threats = getThreats(
      FenManager.getAllLegalMovesAsPojos(this.session.pos, this.session.getFen())
    );
    this.applyBoardShapes(threats as unknown as DrawShape[], preserveShapes);
  }

  public parseComment(commentStr: string): { text: string; shapes: DrawShape[] } {
    const shapes: DrawShape[] = [];
    let text = commentStr;

    const calRegex = /\[%cal\s+([^\]]+)\]/g;
    let calMatch;
    while ((calMatch = calRegex.exec(commentStr)) !== null) {
      const list = calMatch[1].split(',');
      for (const item of list) {
        const trimmed = item.trim();
        if (trimmed.length >= 5) {
          const brush = this.getBrushName(trimmed[0].toLowerCase());
          const orig = trimmed.substring(1, 3) as Key;
          const dest = trimmed.substring(3, 5) as Key;
          shapes.push({ orig, dest, brush });
        }
      }
    }

    const cslRegex = /\[%(?:csl|cpl)\s+([^\]]+)\]/gi;
    let cslMatch;
    while ((cslMatch = cslRegex.exec(commentStr)) !== null) {
      const list = cslMatch[1].split(',');
      for (const item of list) {
        const trimmed = item.trim();
        if (trimmed.length >= 3) {
          const brush = this.getBrushName(trimmed[0].toLowerCase());
          const orig = trimmed.substring(1, 3).toLowerCase() as Key;
          shapes.push({ orig, brush });
        }
      }
    }

    text = text.replace(/\[%(?:cal|csl|cpl)\s+[^\]]+\]/gi, '').trim();

    return { text, shapes };
  }

  public shapesToPgnComment(shapes: DrawShape[]): string {
    if (shapes.length === 0) return '';
    const cal: string[] = [];
    const csl: string[] = [];

    for (const s of shapes) {
      const brushChar = this.getBrushChar(s.brush || 'green');
      if (s.orig && s.dest) {
        cal.push(`${brushChar}${s.orig}${s.dest}`);
      } else if (s.orig) {
        csl.push(`${brushChar}${s.orig}`);
      }
    }

    let annotation = '';
    if (cal.length > 0) {
      annotation += `[%cal ${cal.join(',')}]`;
    }
    if (csl.length > 0) {
      annotation += `[%csl ${csl.join(',')}]`;
    }
    return annotation;
  }

  public getBrushName(char: string): string {
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

  public getBrushChar(brushName: string): string {
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
}
