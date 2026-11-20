import {createContext, useContext} from "react"

/**
 * The phone way of showing the agent's sections: one row per section with its current value, and a
 * tap opens the section as its own screen. A container on a phone provides it and draws the
 * screen's header (the section title and the back arrow); without it the sections are the desktop
 * accordion.
 */
export interface PhoneSectionsApi {
    /** The key of the section shown as its own screen, or null for the list of rows. */
    openKey: string | null
    /** Show a section as its own screen; `title` is its header title. */
    open: (key: string, title: string) => void
}

export const PhoneSectionsContext = createContext<PhoneSectionsApi | null>(null)

export const usePhoneSections = (): PhoneSectionsApi | null => useContext(PhoneSectionsContext)
