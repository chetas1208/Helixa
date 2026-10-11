import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { btnPrimary, btnQuiet, fieldCls } from "./ui";

export const NAME_MAX = 80;

/** Pure: trimmed name or an error message (backend accepts 1..80 characters). */
export function validateWorkspaceName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.trim();
  if (name.length === 0) return { ok: false, error: "Enter a name." };
  if (name.length > NAME_MAX) return { ok: false, error: `Use at most ${NAME_MAX} characters.` };
  return { ok: true, name };
}

interface Props {
  open: boolean;
  title: string;
  description: string;
  submitLabel: string;
  initialName: string;
  pending: boolean;
  error: string | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
}

export function NameDialog({ open, title, description, submitLabel, initialName, pending, error, onSubmit, onClose }: Props) {
  const [value, setValue] = useState(initialName);
  const [localError, setLocalError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setValue(initialName);
      setLocalError(null);
    }
  }, [open, initialName]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = validateWorkspaceName(value);
    if (!v.ok) return setLocalError(v.error);
    setLocalError(null);
    onSubmit(v.name);
  };
  const shown = localError ?? error;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[71] w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/15 bg-[#0b1220]/95 p-5 shadow-2xl">
          <Dialog.Title className="text-base font-semibold text-slate-50">{title}</Dialog.Title>
          <Dialog.Description className="mt-1.5 text-sm leading-relaxed text-slate-300">{description}</Dialog.Description>
          <form onSubmit={submit} className="mt-4" noValidate>
            <label htmlFor="ws-name" className="text-sm text-slate-200">
              Workspace name
            </label>
            <input
              id="ws-name"
              autoFocus
              value={value}
              maxLength={NAME_MAX + 20}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={!!shown}
              aria-describedby={shown ? "ws-name-err" : undefined}
              className={`${fieldCls} mt-1 w-full`}
            />
            <p id="ws-name-err" role="alert" className="mt-1.5 min-h-[1.25rem] text-sm text-amber-200">
              {shown}
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className={btnQuiet} onClick={onClose} disabled={pending}>
                Cancel
              </button>
              <button type="submit" className={btnPrimary} disabled={pending}>
                {pending ? "Working..." : submitLabel}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
