type SlotMeta = { simStamp: string };

type SlotMetaEntry = {
  slot: number;
  meta: SlotMeta | null;
};

type SaveSlotsModalProps = {
  mode: "save" | "load";
  slotMetas: SlotMetaEntry[];
  onClose: () => void;
  onSaveSlot: (slot: number) => void;
  onLoadSlot: (slot: number) => void;
};

export const SaveSlotsModal = ({
  mode,
  slotMetas,
  onClose,
  onSaveSlot,
  onLoadSlot,
}: SaveSlotsModalProps) => (
  <div
    className="modal-backdrop"
    role="dialog"
    aria-modal="true"
    aria-label={mode === "save" ? "Save game" : "Load game"}
  >
    <div className="modal-card">
      <div className="modal-header">
        <h3>{mode === "save" ? "Save Game" : "Load Game"}</h3>
        <button type="button" className="modal-close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="modal-body">
        {slotMetas.map(({ slot, meta }) => (
          <button
            key={slot}
            type="button"
            className="slot-button"
            disabled={mode === "load" && !meta}
            onClick={() => (mode === "save" ? onSaveSlot(slot) : onLoadSlot(slot))}
          >
            <span>Slot {slot}</span>
            <span className="meta">{meta?.simStamp ? meta.simStamp : "Empty"}</span>
          </button>
        ))}
      </div>
    </div>
  </div>
);
