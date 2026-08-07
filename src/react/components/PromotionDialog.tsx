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
    <dialog className="promotion-dialog" open>
      <div className="promotion-pieces">
        {promotionPieces.map((piece) => (
          <button
            key={piece.name}
            type="button"
            className={`promotion-piece-btn ${piece.name.toLowerCase()} ${state.color}`}
            aria-label={piece.name}
            onClick={() => handleSelect(piece.data)}
          />
        ))}
      </div>
    </dialog>
  );
};
