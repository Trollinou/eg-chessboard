import { describe, it, expect, beforeEach } from 'vitest';
import { GameSession } from '../src/core/GameSession';
import { DomainEventBus } from '../src/core/DomainEventBus';

describe('GameSession', () => {
  let eventBus: DomainEventBus;
  let session: GameSession;

  beforeEach(() => {
    eventBus = new DomainEventBus();
    session = new GameSession(eventBus);
  });

  describe('Move Execution & Game Flow', () => {
    it('executes a legal move and updates turn and FEN', () => {
      const result = session.executeMove({ from: 'e2', to: 'e4' });
      expect(result.success).toBe(true);
      expect(result.move?.san).toBe('e4');
      expect(session.getTurnColor()).toBe('black');
      expect(session.getCurrentPlyNumber()).toBe(1);
    });

    it('rejects an illegal move', () => {
      const result = session.executeMove({ from: 'e2', to: 'e5' });
      expect(result.success).toBe(false);
      expect(session.getCurrentPlyNumber()).toBe(0);
    });

    it('handles multiple consecutive moves', () => {
      session.executeMove({ from: 'e2', to: 'e4' });
      session.executeMove({ from: 'e7', to: 'e5' });
      session.executeMove({ from: 'g1', to: 'f3' });
      session.executeMove({ from: 'b8', to: 'c6' });

      expect(session.getCurrentPlyNumber()).toBe(4);
      expect(session.getTurnColor()).toBe('white');
      expect(session.getLastMove()?.san).toBe('Nc6');
    });

    it('supports undoing the last move', () => {
      session.executeMove({ from: 'e2', to: 'e4' });
      expect(session.getCurrentPlyNumber()).toBe(1);

      session.undoLastMove();
      expect(session.getCurrentPlyNumber()).toBe(0);
      expect(session.getTurnColor()).toBe('white');
    });
  });

  describe('PGN Loading & Variations Tree', () => {
    it('loads a PGN and navigates the history', () => {
      const pgn = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *';
      session.loadPgn(pgn);

      expect(session.isViewingHistory()).toBe(true);
      expect(session.getCurrentViewingPly()).toBe(0); // viewStart on load

      const path = session.getActivePath();
      expect(path.length).toBe(6);

      // Navigate forward
      session.viewNext();
      expect(session.getCurrentViewingPly()).toBe(1);
      expect(path[0].data.san).toBe('e4');

      session.viewNext();
      expect(session.getCurrentViewingPly()).toBe(2);
      expect(path[1].data.san).toBe('e5');

      // Navigate back
      session.viewPrevious();
      expect(session.getCurrentViewingPly()).toBe(1);

      // Jump to end
      session.stopViewingHistory();
      expect(session.isViewingHistory()).toBe(false);
      expect(session.getCurrentPlyNumber()).toBe(6);
    });

    it('creates sub-variations when playing moves while viewing history in editor mode (readOnly: false)', () => {
      const pgn = '1. e4 e5 2. Nf3 Nc6';
      session.loadPgn(pgn);

      // Go to ply 1 (after 1. e4)
      session.viewHistory(1);
      expect(session.getCurrentViewingPly()).toBe(1);

      // Play alternate move 1... c5 (Sicilian) instead of 1... e5 (ply 2)
      const res = session.executeMove({ from: 'c7', to: 'c5' }, { readOnly: false });
      expect(res.success).toBe(true);
      expect(res.move?.san).toBe('c5');

      // Check variations at ply 2 (Black's move 1 alternatives)
      const variations = session.getVariationsAtPly(2);
      expect(variations.length).toBe(2);
      expect(variations.map((v) => v.san)).toContain('e5');
      expect(variations.map((v) => v.san)).toContain('c5');
    });

    it('promotes and deletes variations', () => {
      const pgn = '1. e4 e5 2. Nf3 Nc6';
      session.loadPgn(pgn);
      session.viewHistory(1);
      session.executeMove({ from: 'c7', to: 'c5' }, { readOnly: false });

      // Variations at ply 2: index 0 = e5, index 1 = c5
      // Promote variation at index 1 (c5) to mainline
      const promoted = session.promoteVariation(1, 2);
      expect(promoted).toBe(true);

      const variations = session.getVariationsAtPly(2);
      expect(variations[0].san).toBe('c5');
      expect(variations[0].isMainline).toBe(true);

      // Delete variation at index 1 (e5)
      const deleted = session.deleteVariation(1, 2);
      expect(deleted).toBe(true);
      expect(session.getVariationsAtPly(2).length).toBe(1);
    });

    it('generates complete PGN including variations and headers', () => {
      session.executeMove({ from: 'e2', to: 'e4' });
      session.executeMove({ from: 'e7', to: 'e5' });
      const pgnOutput = session.getPgn();
      expect(pgnOutput).toContain('1. e4 e5');
    });
  });

  describe('Arbitration & Game Over Rules', () => {
    it("detects Scholar's Mate (checkmate)", () => {
      session.executeMove({ from: 'e2', to: 'e4' });
      session.executeMove({ from: 'e7', to: 'e5' });
      session.executeMove({ from: 'd1', to: 'h5' });
      session.executeMove({ from: 'b8', to: 'c6' });
      session.executeMove({ from: 'f1', to: 'c4' });
      session.executeMove({ from: 'g8', to: 'f6' });
      session.executeMove({ from: 'h5', to: 'f7' });

      expect(session.getIsCheck()).toBe(true);
      expect(session.getIsCheckmate()).toBe(true);
      expect(session.getIsGameOver()).toBe(true);
      expect(session.getGameOverReason('fr')).toContain('Échec et mat');
    });

    it('detects Stalemate', () => {
      // Stalemate position setup
      session.newGame('k7/8/1Q6/8/8/8/8/7K b - - 0 1');
      expect(session.getIsStalemate()).toBe(true);
      expect(session.getIsGameOver()).toBe(true);
      expect(session.getIsDraw()).toBe(true);
      expect(session.getGameOverReason('fr').toLowerCase()).toContain('pat');
    });

    it('detects Threefold Repetition', () => {
      // 1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8
      session.executeMove({ from: 'g1', to: 'f3' });
      session.executeMove({ from: 'g8', to: 'f6' });
      session.executeMove({ from: 'f3', to: 'g1' });
      session.executeMove({ from: 'f6', to: 'g8' });
      session.executeMove({ from: 'g1', to: 'f3' });
      session.executeMove({ from: 'g8', to: 'f6' });
      session.executeMove({ from: 'f3', to: 'g1' });
      session.executeMove({ from: 'f6', to: 'g8' });

      expect(session.isThreefoldRepetition()).toBe(true);
      expect(session.getIsDraw()).toBe(true);
      expect(session.getGameOverReason('fr')).toContain('triple répétition');
    });
  });

  describe('Solo Mode & Piece Manipulation', () => {
    it('allows consecutive moves by the same color in soloMode', () => {
      const res1 = session.executeMove({ from: 'e2', to: 'e4' }, { soloMode: true });
      expect(res1.success).toBe(true);
      expect(session.getTurnColor()).toBe('white');

      const res2 = session.executeMove({ from: 'd2', to: 'd4' }, { soloMode: true });
      expect(res2.success).toBe(true);
      expect(session.getTurnColor()).toBe('white');
    });

    it('supports putting and removing pieces directly', () => {
      session.newGame('8/8/8/8/8/8/8/8 w - - 0 1');
      const put = session.putPiece({ type: 'q', color: 'w' }, 'd4');
      expect(put).toBe(true);
      expect(session.getSquare('d4')?.type).toBe('q');

      session.removePiece('d4');
      expect(session.getSquare('d4')).toBeNull();
    });
  });
});
