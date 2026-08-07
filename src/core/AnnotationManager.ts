import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import type { Api } from '@lichess-org/chessground/api';

export class AnnotationManager {
  private currentPreservedShapes: DrawShape[] = [];
  public isDrawingUpdate = false;
  public isProgrammaticShapeUpdate = false;

  public getPreservedShapes(): DrawShape[] {
    return this.currentPreservedShapes;
  }

  public setPreservedShapes(shapes: DrawShape[]): void {
    this.currentPreservedShapes = shapes;
  }

  public applyBoardShapes(
    shapes: DrawShape[],
    board: Api | null,
    preserveShapesOnPositionChange: boolean
  ): void {
    this.currentPreservedShapes = shapes;
    this.isProgrammaticShapeUpdate = true;
    if (board) {
      board.setShapes(shapes);
      board.set({
        drawable: {
          eraseOnMovablePieceClick: !preserveShapesOnPositionChange,
        },
      });
    }
    requestAnimationFrame(() => {
      this.isProgrammaticShapeUpdate = false;
    });
  }

  public getShapes(board: Api | null, preserveShapesOnPositionChange: boolean): DrawShape[] {
    if (preserveShapesOnPositionChange) {
      return this.currentPreservedShapes;
    }
    return (
      board?.state?.drawable?.shapes ||
      board?.state?.drawable?.autoShapes ||
      this.currentPreservedShapes ||
      []
    );
  }

  public drawMove(
    from: Key | string,
    to: Key | string,
    brush: string,
    board: Api | null,
    preserveShapes: boolean
  ): void {
    this.applyBoardShapes([{ orig: from as Key, dest: to as Key, brush }], board, preserveShapes);
  }

  public drawCircle(
    square: Key | string,
    brush: string,
    board: Api | null,
    preserveShapes: boolean
  ): void {
    const currentShapes = board?.state?.drawable?.shapes || [];
    this.applyBoardShapes(
      [...currentShapes, { orig: square as Key, brush }],
      board,
      preserveShapes
    );
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

    const cplRegex = /\[%cpl\s+([^\]]+)\]/g;
    let cplMatch;
    while ((cplMatch = cplRegex.exec(commentStr)) !== null) {
      const list = cplMatch[1].split(',');
      for (const item of list) {
        const trimmed = item.trim();
        if (trimmed.length >= 3) {
          const brush = this.getBrushName(trimmed[0].toLowerCase());
          const orig = trimmed.substring(1, 3) as Key;
          shapes.push({ orig, brush });
        }
      }
    }

    text = text.replace(/\[%(cal|cpl)\s+[^\]]+\]/g, '').trim();

    return { text, shapes };
  }

  public shapesToPgnComment(shapes: DrawShape[]): string {
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
