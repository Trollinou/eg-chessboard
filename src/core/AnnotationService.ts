import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import type { Api } from '@lichess-org/chessground/api';

import type { BoardMode } from '../types';
import { getThreats } from '../BoardHelper';
import * as BoardHelper from '../BoardHelper';
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
    private session: GameSession,
    private getOptions?: () => { mode?: BoardMode; preserveShapesOnPositionChange?: boolean }
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
    preserveShapesOnPositionChange?: boolean,
    mode?: BoardMode
  ): void {
    const currentMode = mode ?? this.getOptions?.().mode ?? 'game';
    const isPreserve =
      preserveShapesOnPositionChange ??
      (!!this.getOptions?.().preserveShapesOnPositionChange || currentMode === 'editor');
    this.currentPreservedShapes = shapes;
    this.isProgrammaticShapeUpdate = true;
    if (this.board) {
      this.board.setShapes(shapes);
      const isGameMode = currentMode === 'game';
      this.board.set({
        drawable: {
          eraseOnMovablePieceClick: currentMode === 'study' ? false : !isPreserve,
          defaultSnapToValidMove: isGameMode,
        },
      });
    }
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => {
        this.isProgrammaticShapeUpdate = false;
      });
    } else {
      setTimeout(() => {
        this.isProgrammaticShapeUpdate = false;
      }, 0);
    }
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

      if (shouldPreserve) {
        if (shapes.length > 0) {
          this.setPreservedShapes(shapes);
        } else if (this.board && this.getPreservedShapes().length > 0) {
          this.applyBoardShapes(this.getPreservedShapes(), true, mode);
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
    const ply = this.session.getCurrentViewingPly();
    const rawComment = this.session.getRawCommentAtPly(ply);

    const currentMode = mode ?? this.getOptions?.().mode ?? 'game';
    const isPreserve =
      preserveShapesOnPositionChange ??
      (!!this.getOptions?.().preserveShapesOnPositionChange || currentMode === 'editor');

    if (!rawComment) {
      this.currentComment = '';
      if (!isPreserve && this.board) {
        this.applyBoardShapes([], false, currentMode);
      }
      this.eventBus.emit('comment-changed', { comment: '', ply });
      this.eventBus.emit('state-changed');
      return;
    }

    const parsed = this.parseComment(rawComment);
    this.currentComment = parsed.text;
    if (!isPreserve && this.board) {
      this.applyBoardShapes(parsed.shapes, false, currentMode);
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
    const shapesAnnotation = this.shapesToPgnComment(shapes);
    const combined = `${shapesAnnotation} ${text}`.trim();

    this.session.setRawCommentAtPly(ply, combined);

    const isViewingThisPly = this.session.getCurrentViewingPly() === ply;

    if (isViewingThisPly) {
      this.currentComment = text;
      if (updateBoardShapes) {
        const currentMode = mode ?? this.getOptions?.().mode ?? 'game';
        const isPreserve =
          preserveShapesOnPositionChange ??
          (!!this.getOptions?.().preserveShapesOnPositionChange || currentMode === 'editor');
        this.applyBoardShapes(shapes, isPreserve, currentMode);
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
      BoardHelper.getAllLegalMovesAsPojos(this.session.pos, this.session.getFen())
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

    text = text
      .replace(/\[%(?:cal|csl|cpl)\s+[^\]]+\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

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
