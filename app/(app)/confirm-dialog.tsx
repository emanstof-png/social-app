"use client";

/**
 * A modal confirm dialog (spec 18 item 4; docs/CONVENTIONS.md#dialogs). The
 * caller owns whether it is open; this component owns only the moment
 * between the trigger click and the decision. Dismissing -- Cancel or the
 * backdrop -- does nothing; only confirming runs the caller's action.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-lg border border-black/10 bg-background p-5 dark:border-white/15"
      >
        <h2 className="font-medium">{title}</h2>
        <p className="mt-2 text-sm opacity-75">{description}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-black/15 px-3 py-1.5 text-xs font-medium dark:border-white/20"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
