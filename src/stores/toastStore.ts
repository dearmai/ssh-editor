import { create } from 'zustand';

interface ToastState {
  messages: { id: string; text: string }[];
  error: (text: string) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  messages: [],
  error: (text) => set((s) => ({ messages: [...s.messages.slice(-3), { id: crypto.randomUUID(), text }] })),
  dismiss: (id) => set((s) => ({ messages: s.messages.filter((m) => m.id !== id) })),
}));

export const toastError = (text: string) => useToastStore.getState().error(text);
