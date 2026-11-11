import { create } from 'zustand';

/** Capability advertised by the current server's ready snapshot. */
export const useChannelPokeStore = create<{
  supported: boolean;
  setSupported: (supported: boolean) => void;
  reset: () => void;
}>((set) => ({
  supported: false,
  setSupported: supported => set({ supported }),
  reset: () => set({ supported: false }),
}));
