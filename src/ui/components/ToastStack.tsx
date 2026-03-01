export type ToastPart =
  | { kind: "text"; value: string }
  | { kind: "location"; value: string; locationId: string }
  | { kind: "personnel"; value: string; personnelId: string };

export type ToastMessage = {
  id: string;
  parts: ToastPart[];
};

type ToastStackProps = {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
  onLocationClick: (locationId: string) => void;
  onPersonnelClick: (personnelId: string) => void;
  onToastClick?: (id: string) => void;
};

export const ToastStack = ({
  toasts,
  onDismiss,
  onLocationClick,
  onPersonnelClick,
  onToastClick,
}: ToastStackProps) => (
  <div className="toast-stack">
    {toasts.map((toast) => (
      <div
        key={toast.id}
        className={`toast${onToastClick ? " toast-clickable" : ""}`}
      >
        <span
          className="toast-content"
          role={onToastClick ? "button" : undefined}
          tabIndex={onToastClick ? 0 : undefined}
          onClick={
            onToastClick ? () => onToastClick(toast.id) : undefined
          }
          onKeyDown={
            onToastClick
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onToastClick(toast.id);
                  }
                }
              : undefined
          }
        >
          {toast.parts.map((part, index) =>
            part.kind === "location" ? (
              <button
                key={`${toast.id}-loc-${part.locationId}-${index}`}
                type="button"
                className="toast-location"
                onClick={(e) => {
                  e.stopPropagation();
                  onLocationClick(part.locationId);
                }}
              >
                {part.value}
              </button>
            ) : part.kind === "personnel" ? (
              <button
                key={`${toast.id}-person-${part.personnelId}-${index}`}
                type="button"
                className="toast-agent"
                onClick={(e) => {
                  e.stopPropagation();
                  onPersonnelClick(part.personnelId);
                }}
              >
                {part.value}
              </button>
            ) : (
              <span key={`${toast.id}-text-${index}`}>{part.value}</span>
            ),
          )}
        </span>
        <button
          type="button"
          className="toast-close"
          aria-label="Dismiss notification"
          onClick={() => onDismiss(toast.id)}
        >
          ×
        </button>
      </div>
    ))}
  </div>
);
