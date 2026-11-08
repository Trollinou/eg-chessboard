import { describe, it, expect } from 'vitest';
import { Chess } from 'chessops';
import { parseFen, makeFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import { analyzeMoveTactics } from '../src/BoardHelper';
import { buildMovePojo } from '../src/core/pieceMapping';

function playMoveOnFen(fen: string, san: string) {
  const setup = parseFen(fen).unwrap();
  const pos = Chess.fromSetup(setup).unwrap();
  const parsed = parseSan(pos, san)!;
  const fenBefore = makeFen(pos.toSetup());
  const movePojo = buildMovePojo(pos, parsed, fenBefore);
  return { posAfter: pos, movePojo };
}

describe('TacticalAnalyzer (analyzeMoveTactics)', () => {
  it('short-circuits on checkmate (e.g. Qxf7#) and never flags checkmate as a blunder', () => {
    // Scholar's mate: 1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#
    const fenBeforeMate =
      'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
    const { posAfter, movePojo } = playMoveOnFen(fenBeforeMate, 'Qxf7#');

    const tactics = analyzeMoveTactics(posAfter, 'white', movePojo);
    expect(tactics.hasMajorThreat).toBe(false);
    expect(tactics.undefendedSquares).toEqual([]);
    expect(tactics.isKingInCheck).toBe(false);
  });

  it('does not confuse giving check (+) to opponent with own king being in check', () => {
    // White plays Bxf7+ supported by Queen or Knight (or simply Bb5+ check)
    const fen =
      'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    const { posAfter, movePojo } = playMoveOnFen(fen, 'Bb5');

    // Now Black plays a6, White plays Bxc6, etc. Or test direct check:
    const fenCheck =
      'rnbqkbnr/ppp2ppp/3p4/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3';
    const { posAfter: posAfterCheck, movePojo: moveCheck } = playMoveOnFen(
      fenCheck,
      'Bb5+'
    );

    const tactics = analyzeMoveTactics(posAfterCheck, 'white', moveCheck);
    expect(tactics.isKingInCheck).toBe(false);
    expect(tactics.hasMajorThreat).toBe(false);
    expect(tactics.undefendedSquares).toEqual([]);
  });

  it('ignores captures by enemy pieces that are pinned to the enemy king', () => {
    // Black Knight on d7 is pinned to Black King on e8 by White Bishop on a4.
    // White plays Nxe5 on e5 ( geometrically attacked ONLY by the pinned Knight on d7 ).
    const fen = 'r2qkbnr/pppn1ppp/8/4p3/B3P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 4';
    const { posAfter, movePojo } = playMoveOnFen(fen, 'Nxe5');

    const tactics = analyzeMoveTactics(posAfter, 'white', movePojo);
    expect(tactics.undefendedSquares).not.toContain('e5');
    expect(tactics.hasMajorThreat).toBe(false);
  });

  it('ignores capture by enemy king when the square is defended (e.g. Qxf7+ defended by Bc4)', () => {
    const fen =
      'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 3 3';
    const { posAfter, movePojo } = playMoveOnFen(fen, 'Qxf7+');

    const tactics = analyzeMoveTactics(posAfter, 'white', movePojo);
    expect(tactics.undefendedSquares).toEqual([]);
    expect(tactics.hasMajorThreat).toBe(false);
  });

  it('supports X-ray defenders (batteries: doubled rooks or Queen + Bishop)', () => {
    // White has doubled Rooks on d2 and d1, moves Rook d2-d5 where it is attacked by Black Knight on f6 and Black Rook on d8.
    // Because d1 Rook defends d5 through X-ray, White has 1 defender on d5 against 2 attackers (3 + 5 = 8 <= 5 + 5 = 10),
    // wait: test a battery defending against 2 equal attackers:
    // White has Bishop on c3 and Queen on d2 (battery on a5-e1 diagonal), moves Bishop to b4 attacked by Black Bishop on f8 and Black Rook on b8.
    // Or White has Rooks on d1 and d2, plays Rd6 (attacked only by Black Rook on d8):
    // Without X-ray, if Rd2 was behind another slider, e.g. White has Rook on e1, Rook on e2, plays Re5 attacked by Black Rook on e8 and Black Queen on d6.
    const fen = '4r1k1/8/3q4/8/8/8/4R3/4R1K1 w - - 0 1';
    const { posAfter, movePojo } = playMoveOnFen(fen, 'Re5');

    const tactics = analyzeMoveTactics(posAfter, 'white', movePojo);
    // Re5 (5) is defended by Re1 (5) and attacked by Re8 (5) and Qd6 (9).
    // minAttacker (5) + secondMinAttacker (9) = 14 > pieceValue (5) + minDefender (5) = 10.
    expect(tactics.undefendedSquares).not.toContain('e5');
    expect(tactics.hasMajorThreat).toBe(false);
  });

  it('excludes equal or winning captures from undefendedSquares (e.g. Bxc6, Rxd8)', () => {
    // Ruy Lopez Exchange: 1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6 (Bishop takes Knight defended by b7 and d7 pawns)
    const fen =
      'r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4';
    const { posAfter, movePojo } = playMoveOnFen(fen, 'Bxc6');

    const tactics = analyzeMoveTactics(posAfter, 'white', movePojo);
    expect(tactics.undefendedSquares).not.toContain('c6');
    expect(tactics.hasMajorThreat).toBe(false);
  });

  it('flags losing trade (e.g. Qxc6 where Queen takes defended Knight) as major threat', () => {
    // White Queen on b5 captures Black Knight on c6 (defended by b7 and d7 pawns)
    const fen =
      'r1bqkbnr/pppp1ppp/2n5/1Q2p3/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 2 3';
    const { posAfter, movePojo } = playMoveOnFen(fen, 'Qxc6');

    const tactics = analyzeMoveTactics(posAfter, 'white', movePojo);
    expect(tactics.undefendedSquares).toContain('c6');
    expect(tactics.hasMajorThreat).toBe(true);
  });

  it('flags hanging piece when moved directly onto an undefended attacked square', () => {
    // 1. e4 e5 2. Qh5 Nc6 3. Qg6 (hanging to f7/h7 pawns)
    const fen =
      'r1bqkbnr/pppp1ppp/2n5/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 2 3';
    const { posAfter, movePojo } = playMoveOnFen(fen, 'Qg6');

    const tactics = analyzeMoveTactics(posAfter, 'white', movePojo);
    expect(tactics.undefendedSquares).toContain('g6');
    expect(tactics.hasMajorThreat).toBe(true);
  });

  it('does not flag a Knight (3) defended by a Pawn (1) and attacked by Queen (9) + Rook (5)', () => {
    // White Knight on c3 defended by b2 pawn, attacked by Black Rook on c8 and Black Queen on a5
    const fen = '2r3k1/8/8/q7/8/2N5/1P6/6K1 w - - 0 1';
    const { posAfter, movePojo } = playMoveOnFen(fen, 'Kg2');

    const tactics = analyzeMoveTactics(posAfter, 'white', movePojo);
    expect(tactics.undefendedSquares).not.toContain('c3');
    expect(tactics.hasMajorThreat).toBe(false);
  });
});
