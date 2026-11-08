import { createContext, useContext } from 'react';

/** The existing stack owns visibility; retained/transitioning views are not foreground. */
export const MobileScreenVisibility = createContext(true);
export function useMobileScreenVisible(): boolean { return useContext(MobileScreenVisibility); }
