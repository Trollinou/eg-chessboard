import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { DrawShape } from '@lichess-org/chessground/draw';
import {
  Chessboard,
  type BoardCore,
  type BoardTheme,
  type ChessDiagram,
  type Move,
  type PieceSet,
} from '../src/react/Chessboard';

export interface ReactSandboxProps {
  pieceSet: PieceSet;
  boardTheme: BoardTheme;
}

interface LogEntry {
  id: number;
  source: string;
  type: 'move' | 'click' | 'shapes' | 'checkmate';
  message: string;
  time: string;
}

const TACTICAL_DIAGRAM: ChessDiagram = {
  fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
  shapes: [
    { orig: 'h5', dest: 'f7', brush: 'green' },
    { orig: 'c4', dest: 'f7', brush: 'yellow' },
  ],
};

const PARENT_DIAGRAM: ChessDiagram = {
  fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
  shapes: [{ orig: 'c7', dest: 'c5', brush: 'blue' }],
};

const IFRAME_LAYOUT_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 16px;
    background: #0f172a;
    color: #f3f4f6;
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
  }
  .iframe-boards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 20px;
    align-items: start;
  }
  .iframe-block-card {
    background: rgba(17, 24, 39, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    padding: 14px;
  }
  .iframe-block-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
    gap: 8px;
  }
  .iframe-block-title {
    font-weight: 700;
    font-size: 0.95rem;
    color: #e2e8f0;
  }
  .iframe-block-meta {
    font-size: 0.78rem;
    color: #94a3b8;
    margin-top: 8px;
    word-break: break-all;
  }
  .iframe-board-box {
    width: 100%;
    max-width: 360px;
    margin: 0 auto;
  }
  .iframe-btn {
    background: #4f46e5;
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
  }
  .iframe-btn:hover { background: #4338ca; }
`;

interface IframeGutenbergCanvasProps {
  children: React.ReactNode;
}

const IframeGutenbergCanvas: React.FC<IframeGutenbergCanvasProps> = ({ children }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null);

  const syncHeadStyles = useCallback((iframeDoc: Document) => {
    const iframeHead = iframeDoc.head;
    if (!iframeHead) return;

    iframeHead.querySelectorAll('[data-synced-style="true"]').forEach((el) => el.remove());

    const parentStyles = document.querySelectorAll('style, link[rel="stylesheet"]');
    parentStyles.forEach((node) => {
      const clone = iframeDoc.importNode(node, true) as HTMLElement;
      clone.setAttribute('data-synced-style', 'true');
      iframeHead.appendChild(clone);
    });
  }, []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const initIframeDocument = () => {
      const iframeDoc = iframe.contentDocument;
      if (!iframeDoc) return;

      if (!iframeDoc.head) {
        const head = iframeDoc.createElement('head');
        iframeDoc.documentElement?.appendChild(head);
      }
      if (!iframeDoc.body) {
        const body = iframeDoc.createElement('body');
        iframeDoc.documentElement?.appendChild(body);
      }

      if (!iframeDoc.head.querySelector('base')) {
        const baseEl = iframeDoc.createElement('base');
        baseEl.href = `${window.location.origin}/`;
        iframeDoc.head.appendChild(baseEl);
      }

      if (!iframeDoc.head.querySelector('[data-iframe-layout="true"]')) {
        const layoutStyle = iframeDoc.createElement('style');
        layoutStyle.setAttribute('data-iframe-layout', 'true');
        layoutStyle.textContent = IFRAME_LAYOUT_CSS;
        iframeDoc.head.appendChild(layoutStyle);
      }

      syncHeadStyles(iframeDoc);

      let rootEl = iframeDoc.getElementById('gutenberg-editor-canvas');
      if (!rootEl) {
        rootEl = iframeDoc.createElement('div');
        rootEl.id = 'gutenberg-editor-canvas';
        iframeDoc.body.appendChild(rootEl);
      }

      setMountNode(rootEl);
    };

    if (iframe.contentDocument?.readyState === 'complete') {
      queueMicrotask(initIframeDocument);
    } else {
      iframe.addEventListener('load', initIframeDocument, { once: true });
    }

    const observer = new MutationObserver(() => {
      const doc = iframeRef.current?.contentDocument;
      if (doc) {
        syncHeadStyles(doc);
      }
    });
    observer.observe(document.head, { childList: true, subtree: true });

    return () => {
      iframe.removeEventListener('load', initIframeDocument);
      observer.disconnect();
    };
  }, [syncHeadStyles]);

  return (
    <>
      <iframe
        ref={iframeRef}
        name="editor-canvas"
        title="Simulation Gutenberg apiVersion 3 (Iframe)"
        style={{
          width: '100%',
          height: '650px',
          border: '2px solid rgba(99, 102, 241, 0.45)',
          borderRadius: '12px',
          background: '#0f172a',
          display: 'block',
        }}
      />
      {mountNode ? createPortal(children, mountNode) : null}
    </>
  );
};

export const ReactMultiBoardApp: React.FC<ReactSandboxProps> = ({ pieceSet, boardTheme }) => {
  const board1CoreRef = useRef<BoardCore | null>(null);
  const board2CoreRef = useRef<BoardCore | null>(null);
  const board3CoreRef = useRef<BoardCore | null>(null);
  const logIdRef = useRef(0);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [board1Fen, setBoard1Fen] = useState<string>('');
  const [board2Fen, setBoard2Fen] = useState<string>(TACTICAL_DIAGRAM.fen ?? '');
  const [board3Fen, setBoard3Fen] = useState<string>(PARENT_DIAGRAM.fen ?? '');
  const [board1ShapesCount, setBoard1ShapesCount] = useState<number>(0);
  const [board2ShapesCount, setBoard2ShapesCount] = useState<number>(
    TACTICAL_DIAGRAM.shapes?.length ?? 0
  );
  const [showParentBoard, setShowParentBoard] = useState<boolean>(true);

  const appendLog = useCallback((source: string, type: LogEntry['type'], message: string) => {
    const nextId = ++logIdRef.current;
    const time = new Date().toLocaleTimeString('fr-FR');
    setLogs((prev) => [{ id: nextId, source, type, message, time }, ...prev].slice(0, 30));
  }, []);

  const handleResetBoard1 = useCallback(() => {
    board1CoreRef.current?.resetBoard();
    setBoard1Fen(board1CoreRef.current?.getFen() ?? '');
    appendLog('Bloc Iframe #1', 'click', 'Position réinitialisée');
  }, [appendLog]);

  const handleResetBoard2 = useCallback(() => {
    board2CoreRef.current?.setDiagram(TACTICAL_DIAGRAM);
    setBoard2Fen(board2CoreRef.current?.getFen() ?? '');
    setBoard2ShapesCount(TACTICAL_DIAGRAM.shapes?.length ?? 0);
    appendLog('Bloc Iframe #2', 'click', 'Diagramme tactique restauré');
  }, [appendLog]);

  const handleResetBoard3 = useCallback(() => {
    board3CoreRef.current?.setDiagram(PARENT_DIAGRAM);
    setBoard3Fen(board3CoreRef.current?.getFen() ?? '');
    appendLog('Bloc Parent #3', 'click', 'Position parent restaurée');
  }, [appendLog]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="glass-card" style={{ padding: '1rem 1.25rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>
              ⚛️ Sandbox React Multi-Échiquiers &amp; Gutenberg <code>apiVersion: 3</code> (Iframe)
            </h2>
            <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: '#9ca3af' }}>
              React et <code>eg-chessboard</code> tournent dans la fenêtre parente, mais les Blocs
              #1 et #2 sont montés dans le <code>contentDocument</code> d&apos;une{' '}
              <code>&lt;iframe name=&quot;editor-canvas&quot;&gt;</code> via{' '}
              <code>createPortal</code>. Testez le drag &amp; drop, le clic-clic, le clic droit
              (flèches/cercles) et le scroll dans l&apos;iframe.
            </p>
          </div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={showParentBoard}
              onChange={(e) => setShowParentBoard(e.target.checked)}
            />
            Afficher aussi le Bloc #3 hors iframe (DOM parent)
          </label>
        </div>
      </div>

      <IframeGutenbergCanvas>
        <div className="iframe-boards-grid">
          {/* Iframe Board #1 */}
          <div className="iframe-block-card">
            <div className="iframe-block-header">
              <span className="iframe-block-title">🟦 Bloc Iframe #1 — Partie libre (Both)</span>
              <button type="button" className="iframe-btn" onClick={handleResetBoard1}>
                Réinitialiser
              </button>
            </div>
            <div className="board-wrapper iframe-board-box">
              <Chessboard
                mode="game"
                playerColor="both"
                pieceSet={pieceSet}
                boardTheme={boardTheme}
                onBoardCreated={(core: BoardCore) => {
                  board1CoreRef.current = core;
                  setBoard1Fen(core.getFen());
                  requestAnimationFrame(() => core.redraw(true));
                }}
                onMove={(move: Move) => {
                  setBoard1Fen(move.after);
                  appendLog('Bloc Iframe #1', 'move', `${move.san} (${move.from}→${move.to})`);
                }}
                onSquareClick={(sq: string) => {
                  appendLog('Bloc Iframe #1', 'click', `Clic case ${sq}`);
                }}
                onShapesChange={(shapes: DrawShape[]) => {
                  setBoard1ShapesCount(shapes.length);
                  appendLog('Bloc Iframe #1', 'shapes', `${shapes.length} forme(s)`);
                }}
                onCheckmate={(winner: string) => {
                  appendLog('Bloc Iframe #1', 'checkmate', `Échec et mat ! Gagnant : ${winner}`);
                }}
              />
            </div>
            <div className="iframe-block-meta">
              <div>
                <strong>Formes :</strong> {board1ShapesCount}
              </div>
              <div>
                <strong>FEN :</strong> <code>{board1Fen}</code>
              </div>
            </div>
          </div>

          {/* Iframe Board #2 */}
          <div className="iframe-block-card">
            <div className="iframe-block-header">
              <span className="iframe-block-title">🟩 Bloc Iframe #2 — Étude / Tactique</span>
              <button type="button" className="iframe-btn" onClick={handleResetBoard2}>
                Restaurer diagramme
              </button>
            </div>
            <div className="board-wrapper iframe-board-box">
              <Chessboard
                mode="study"
                readOnly={false}
                playerColor="both"
                diagram={TACTICAL_DIAGRAM}
                pieceSet={pieceSet}
                boardTheme={boardTheme}
                onBoardCreated={(core: BoardCore) => {
                  board2CoreRef.current = core;
                  setBoard2Fen(core.getFen());
                  requestAnimationFrame(() => core.redraw(true));
                }}
                onMove={(move: Move) => {
                  setBoard2Fen(move.after);
                  appendLog('Bloc Iframe #2', 'move', `${move.san} (${move.from}→${move.to})`);
                }}
                onSquareClick={(sq: string) => {
                  appendLog('Bloc Iframe #2', 'click', `Clic case ${sq}`);
                }}
                onShapesChange={(shapes: DrawShape[]) => {
                  setBoard2ShapesCount(shapes.length);
                  appendLog('Bloc Iframe #2', 'shapes', `${shapes.length} forme(s)`);
                }}
                onCheckmate={(winner: string) => {
                  appendLog('Bloc Iframe #2', 'checkmate', `Échec et mat ! Gagnant : ${winner}`);
                }}
              />
            </div>
            <div className="iframe-block-meta">
              <div>
                <strong>Formes :</strong> {board2ShapesCount}
              </div>
              <div>
                <strong>FEN :</strong> <code>{board2Fen}</code>
              </div>
            </div>
          </div>
        </div>
      </IframeGutenbergCanvas>

      {/* Bottom grid: optional Parent DOM Board #3 + Multi-Instance Event Log */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: showParentBoard ? 'minmax(320px, 420px) 1fr' : '1fr',
          gap: '1.25rem',
          alignItems: 'start',
        }}
      >
        {showParentBoard && (
          <div className="glass-card" style={{ padding: '1rem' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '0.75rem',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '0.95rem' }}>
                🟨 Bloc Parent #3 — Hors Iframe (DOM standard)
              </h3>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                onClick={handleResetBoard3}
              >
                Restaurer
              </button>
            </div>
            <div
              className="board-wrapper"
              style={{ width: '100%', maxWidth: '360px', margin: '0 auto' }}
            >
              <Chessboard
                mode="game"
                playerColor="both"
                diagram={PARENT_DIAGRAM}
                pieceSet={pieceSet}
                boardTheme={boardTheme}
                onBoardCreated={(core: BoardCore) => {
                  board3CoreRef.current = core;
                  setBoard3Fen(core.getFen());
                  requestAnimationFrame(() => core.redraw(true));
                }}
                onMove={(move: Move) => {
                  setBoard3Fen(move.after);
                  appendLog('Bloc Parent #3', 'move', `${move.san} (${move.from}→${move.to})`);
                }}
                onSquareClick={(sq: string) => {
                  appendLog('Bloc Parent #3', 'click', `Clic case ${sq}`);
                }}
                onShapesChange={(shapes: DrawShape[]) => {
                  appendLog('Bloc Parent #3', 'shapes', `${shapes.length} forme(s)`);
                }}
              />
            </div>
            <div style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: '#9ca3af' }}>
              <strong>FEN :</strong> <code>{board3Fen}</code>
            </div>
          </div>
        )}

        <div className="glass-card" style={{ padding: '1rem' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '0.75rem',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '0.95rem' }}>
              📡 Journal d&apos;isolation multi-instances ({logs.length})
            </h3>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '4px 10px', fontSize: '0.78rem' }}
              onClick={() => setLogs([])}
            >
              Vider
            </button>
          </div>
          <div
            style={{
              maxHeight: '360px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              fontSize: '0.82rem',
            }}
          >
            {logs.length === 0 ? (
              <div style={{ color: '#9ca3af', fontStyle: 'italic' }}>
                Interagissez avec n&apos;importe quel échiquier pour vérifier que seul le bloc
                concerné émet ses événements.
              </div>
            ) : (
              logs.map((entry) => (
                <div
                  key={entry.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    background: 'rgba(0, 0, 0, 0.25)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                  }}
                >
                  <span style={{ color: '#6b7280', fontFamily: 'monospace' }}>{entry.time}</span>
                  <strong style={{ color: '#a5b4fc', minWidth: '120px' }}>{entry.source}</strong>
                  <span style={{ color: '#e5e7eb' }}>{entry.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export function mountReactSandbox(
  container: HTMLElement,
  initialProps: ReactSandboxProps
): {
  updateProps: (nextProps: ReactSandboxProps) => void;
  unmount: () => void;
} {
  const root: Root = createRoot(container);
  root.render(<ReactMultiBoardApp {...initialProps} />);

  return {
    updateProps(nextProps: ReactSandboxProps) {
      root.render(<ReactMultiBoardApp {...nextProps} />);
    },
    unmount() {
      root.unmount();
    },
  };
}
