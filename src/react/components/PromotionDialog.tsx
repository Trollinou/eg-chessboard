import React from 'react';

interface PromotionDialogProps {
  state: {
    isEnabled: boolean;
    color?: string;
    callback?: (piece: string) => void;
  };
  onPromotionSelected: () => void;
}

export const PromotionDialog: React.FC<PromotionDialogProps> = ({ state, onPromotionSelected }) => {
  const promotionPieces = [
    { name: 'Queen', data: 'q' },
    { name: 'Knight', data: 'n' },
    { name: 'Rook', data: 'r' },
    { name: 'Bishop', data: 'b' },
  ];

  const handleSelect = (pieceData: string) => {
    state.callback?.(pieceData);
    onPromotionSelected();
  };

  return (
    <dialog
      className="promotion-dialog"
      open
      style={{
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
      }}
    >
      <div className="promotion-pieces" style={{ display: 'flex', gap: '12px' }}>
        {promotionPieces.map((piece) => (
          <button
            key={piece.name}
            type="button"
            className={`promotion-piece-btn ${piece.name.toLowerCase()} ${state.color}`}
            onClick={() => handleSelect(piece.data)}
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
        ))}
      </div>
    </dialog>
  );
};
