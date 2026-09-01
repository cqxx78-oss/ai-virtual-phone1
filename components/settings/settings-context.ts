"use client";

import { createContext, type ReactNode } from "react";

export interface SettingsContextType {
    setSubpageTitle: (title: string | null) => void;
    setOverrideBack: (action: (() => void) | null) => void;
    setSubpageRightAction: (page: string, action: ReactNode | null) => void;
}

export const SettingsContext = createContext<SettingsContextType>({
    setSubpageTitle: () => { },
    setOverrideBack: () => { },
    setSubpageRightAction: () => { },
});
