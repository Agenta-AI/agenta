import {createContext, useContext, type ReactNode} from "react"

import type {SettingsAccess} from "./navigation"

/**
 * Who the viewer is, as far as Settings cares.
 *
 * The flags themselves are the HOST's to compute — edition, billing, project permissions and
 * org ownership all live in app state that no package can reach. The package owns the shape
 * and the tab-visibility rules that read it, so both apps show the same tabs to the same user.
 */
const SettingsAccessContext = createContext<SettingsAccess | null>(null)

export const SettingsAccessProvider = ({
    access,
    children,
}: {
    access: SettingsAccess
    children: ReactNode
}) => <SettingsAccessContext.Provider value={access}>{children}</SettingsAccessContext.Provider>

/** A host that renders no provider gets the closed set: nothing edition- or permission-gated. */
export const CLOSED_SETTINGS_ACCESS: SettingsAccess = {
    billingEnabled: false,
    canShowTools: false,
    canShowTriggers: false,
    canViewApiKeys: false,
    canViewEvents: false,
    isEE: false,
    isOwner: false,
}

export const useSettingsAccess = (): SettingsAccess =>
    useContext(SettingsAccessContext) ?? CLOSED_SETTINGS_ACCESS
