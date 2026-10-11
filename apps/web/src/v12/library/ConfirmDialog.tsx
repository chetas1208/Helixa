import * as Dialog from "@radix-ui/react-dialog";
import { btnPrimary, btnQuiet } from "./ui";

export function ConfirmDialog({
  open, title, description, confirmLabel, pending, error, onConfirm, onClose,
}: { open: boolean; title: string; description: string; confirmLabel: string; pending: boolean; error: string | null; onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[71] w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/15 bg-[#0b1220]/95 p-5 shadow-2xl">
          <Dialog.Title className="text-base font-semibold text-slate-50">{title}</Dialog.Title>
          <Dialog.Description className="mt-1.5 text-sm leading-relaxed text-slate-300">{description}</Dialog.Description>
          <p role="alert" className="mt-2 min-h-[1.25rem] text-sm text-amber-200">{error}</p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className={btnQuiet} onClick={onClose} disabled={pending}>Cancel</button>
            <button type="button" className={btnPrimary} onClick={onConfirm} disabled={pending}>{pending ? "Working..." : confirmLabel}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
