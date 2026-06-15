import React, { useRef, useEffect, useState } from 'react';
import type { Config } from '@lichess-org/chessground/config';
import { BoardCore, type BoardCoreState } from '../BoardCore';

export interface ChessboardProps {
  boardConfig?: Config;
  playerColor?: 'white' | 'black' | 'both';
  onBoardCreated?: (api: BoardCore) => void;
  onMove?: (move: any) => void;
  onCheck?: (color: string) => void;
  onCheckmate?: (color: string) => void;
  onStalemate?: () => void;
  onDraw?: () => void;
  onPromotion?: (detail: any) => void;
}

export const Chessboard: React.FC<ChessboardProps> = ({
  boardConfig = {},
  playerColor,
  onBoardCreated,
  onMove,
  onCheck,
  onCheckmate,
  onStalemate,
  onDraw,
  onPromotion,
}) => {
  const boardRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<BoardCore | null>(null);

  const [state, setState] = useState<BoardCoreState>({
    showThreats: false,
    promotionDialogState: { isEnabled: false },
    historyViewerState: { isEnabled: false },
  });

  useEffect(() => {
    if (!boardRef.current) return;

    const core = new BoardCore(
      boardRef.current,
      state,
      () => {
        // Sync React component state with BoardCore state
        setState({
          showThreats: core['state'].showThreats,
          promotionDialogState: { ...core['state'].promotionDialogState },
          historyViewerState: { ...core['state'].historyViewerState },
        });
      },
      (event, ...args) => {
        if (event === 'move') onMove?.(args[0]);
        else if (event === 'check') onCheck?.(args[0]);
        else if (event === 'checkmate') onCheckmate?.(args[0]);
        else if (event === 'stalemate') onStalemate?.();
        else if (event === 'draw') onDraw?.();
        else if (event === 'promotion') onPromotion?.(args[0]);
      },
      {
        ...boardConfig,
        movable: {
          ...boardConfig.movable,
          color: playerColor || boardConfig.movable?.color,
        },
      }
    );

    coreRef.current = core;
    onBoardCreated?.(core);

    return () => {
      // Clean up logic if necessary
    };
  }, []);

  useEffect(() => {
    if (coreRef.current && boardConfig) {
      coreRef.current.setConfig(boardConfig);
    }
  }, [boardConfig]);

  const selectPromotion = (pieceData: string) => {
    state.promotionDialogState.callback?.(pieceData);
    setState((prev) => ({
      ...prev,
      promotionDialogState: { isEnabled: false },
    }));
  };

  return (
    <section
      className={`main-wrap ${state.promotionDialogState.isEnabled ? 'disabledBoard' : ''} ${
        state.historyViewerState.isEnabled ? 'viewingHistory' : ''
      }`}
    >
      <div className="main-board">
        {state.promotionDialogState.isEnabled && (
          <dialog className="promotion-dialog" open style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 1000,
            background: 'white',
            border: '2px solid #333',
            borderRadius: '8px',
            padding: '10px',
            boxShadow: '0 4px 15px rgba(0, 0, 0, 0.4)',
          }}>
            <div className="promotion-pieces" style={{ display: 'flex', gap: '12px' }}>
              {['q', 'n', 'r', 'b'].map((piece) => {
                const names: Record<string, string> = { q: 'queen', n: 'knight', r: 'rook', b: 'bishop' };
                const name = names[piece];
                return (
                  <button
                    key={piece}
                    type="button"
                    className={`promotion-piece-btn ${name} ${state.promotionDialogState.color}`}
                    onClick={() => selectPromotion(piece)}
                    style={{
                      background: '#f0f0f0',
                      border: '1px solid #ccc',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      width: '55px',
                      height: '55px',
                      backgroundSize: '80% 80%',
                      backgroundPosition: 'center',
                      backgroundRepeat: 'no-repeat',
                    }}
                  />
                );
              })}
            </div>
          </dialog>
        )}
        <div ref={boardRef} />
      </div>
    </section>
  );
};
