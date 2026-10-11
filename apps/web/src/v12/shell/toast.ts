import { create } from "zustand";

export type ToastTone = "info" | "success" | "warn" | "error";
export interface Toast {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
  /** ms; 0 = sticky until dismissed. Errors default to sticky-ish 9 s. */
  duration: number;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, "id" | "duration" | "tone"> & Partial<Pick<Toast, "duration" | "tone">>) => number;
  dismiss: (id: number) => void;
}

let seq = 0;
const MAX = 4;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = ++seq;
    const tone = t.tone ?? "info";
    const toast: Toast = { id, title: t.title, description: t.description, tone, duration: t.duration ?? (tone === "error" ? 9000 : 5500) };
    set((s) => ({ toasts: [...s.toasts, toast].slice(-MAX) }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

/** Imperative helper usable from any tab: `toast({ title: "Draft saved", tone: "success" })`. Text only, never HTML. */
export const toast = (t: Parameters<ToastState["push"]>[0]) => useToasts.getState().push(t);
