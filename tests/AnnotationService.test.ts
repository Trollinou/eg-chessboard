import { describe, it, expect, beforeEach } from 'vitest';
import { AnnotationService } from '../src/core/AnnotationService';
import { DomainEventBus } from '../src/core/DomainEventBus';
import { GameSession } from '../src/core/GameSession';
import type { DrawShape } from '@lichess-org/chessground/draw';

describe('AnnotationService', () => {
  let eventBus: DomainEventBus;
  let session: GameSession;
  let annotationService: AnnotationService;

  beforeEach(() => {
    eventBus = new DomainEventBus();
    session = new GameSession(eventBus);
    annotationService = new AnnotationService(eventBus, session, () => ({
      mode: 'game',
      preserveShapesOnPositionChange: false,
    }));
  });

  describe('Comment Parsing & PGN Serialization', () => {
    it('parses arrows ([%cal ...]) from PGN comment text', () => {
      const comment = 'A strong move [%cal Ge2e4,Rd7d5] attacking the center.';
      const parsed = annotationService.parseComment(comment);

      expect(parsed.text).toBe('A strong move attacking the center.');
      expect(parsed.shapes).toHaveLength(2);
      expect(parsed.shapes[0]).toEqual({ orig: 'e2', dest: 'e4', brush: 'green' });
      expect(parsed.shapes[1]).toEqual({ orig: 'd7', dest: 'd5', brush: 'red' });
    });

    it('parses circles and colored squares ([%csl ...], [%cpl ...])', () => {
      const comment = 'Controlling key squares [%csl Ge4,Yd5,Bc6] in the center.';
      const parsed = annotationService.parseComment(comment);

      expect(parsed.text).toBe('Controlling key squares in the center.');
      expect(parsed.shapes).toHaveLength(3);
      expect(parsed.shapes[0]).toEqual({ orig: 'e4', brush: 'green' });
      expect(parsed.shapes[1]).toEqual({ orig: 'd5', brush: 'yellow' });
      expect(parsed.shapes[2]).toEqual({ orig: 'c6', brush: 'blue' });
    });

    it('serializes shapes to PGN annotation format', () => {
      const shapes: DrawShape[] = [
        { orig: 'e2', dest: 'e4', brush: 'green' },
        { orig: 'd7', dest: 'd5', brush: 'red' },
        { orig: 'e4', brush: 'yellow' },
      ];

      const pgnComment = annotationService.shapesToPgnComment(shapes);
      expect(pgnComment).toContain('[%cal Ge2e4,Rd7d5]');
      expect(pgnComment).toContain('[%csl Ye4]');
    });

    it('returns empty string when serializing empty shapes', () => {
      expect(annotationService.shapesToPgnComment([])).toBe('');
    });
  });

  describe('Comment & Shapes Management at Ply', () => {
    it('sets and retrieves comment and shapes on initial position (ply 0)', () => {
      const shapes: DrawShape[] = [{ orig: 'e2', dest: 'e4', brush: 'green' }];
      annotationService.setCommentAtPly(0, 'Starting position note', shapes);

      expect(session.getRootComments()).toEqual(['[%cal Ge2e4] Starting position note']);
      expect(annotationService.getCurrentComment()).toBe('Starting position note');
    });

    it('sets and retrieves comment and shapes on specific move ply', () => {
      session.executeMove({ from: 'e2', to: 'e4' });
      session.executeMove({ from: 'e7', to: 'e5' });

      const shapes: DrawShape[] = [{ orig: 'e5', brush: 'red' }];
      annotationService.setCommentAtPly(2, 'Black responds symmetrically', shapes);

      const path = session.getActivePath();
      expect(path[1].data.comments).toEqual(['[%csl Re5] Black responds symmetrically']);
    });

    it('updates current comment when navigating history', () => {
      session.executeMove({ from: 'e2', to: 'e4' });
      annotationService.setCommentAtPly(1, 'Good opening move');

      session.viewHistory(1);
      annotationService.updateCommentAndShapes(session.getFen());
      expect(annotationService.getCurrentComment()).toBe('Good opening move');

      session.viewHistory(0);
      annotationService.updateCommentAndShapes(session.getFen());
      expect(annotationService.getCurrentComment()).toBe('');
    });
  });

  describe('Brush Color Conversion', () => {
    it('maps brush characters to full names correctly', () => {
      expect(annotationService.getBrushName('g')).toBe('green');
      expect(annotationService.getBrushName('r')).toBe('red');
      expect(annotationService.getBrushName('b')).toBe('blue');
      expect(annotationService.getBrushName('y')).toBe('yellow');
      expect(annotationService.getBrushName('unknown')).toBe('green');
    });

    it('maps brush names to PGN characters correctly', () => {
      expect(annotationService.getBrushChar('green')).toBe('G');
      expect(annotationService.getBrushChar('red')).toBe('R');
      expect(annotationService.getBrushChar('blue')).toBe('B');
      expect(annotationService.getBrushChar('yellow')).toBe('Y');
      expect(annotationService.getBrushChar('unknown')).toBe('G');
    });
  });
});
