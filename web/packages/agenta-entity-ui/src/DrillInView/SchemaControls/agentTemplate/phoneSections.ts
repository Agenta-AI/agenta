import {createContext, useCallback, useContext, useMemo, useState} from "react"

/** A section shown as its own screen on a phone. */
export interface PhoneSection {
    key: string
    title: string
}

/**
 * The phone way of showing the agent's sections: one row per section with its current value, and a
 * tap shows the section as its own screen. A container on a phone provides it and draws the
 * screen's header (the section title and the back arrow); without it the sections are the desktop
 * accordion.
 */
export interface PhoneSectionsApi {
    /** The key of the section shown as its own screen, or null for the list of rows. */
    shownKey: string | null
    /** Show a section as its own screen; `title` is its header title. */
    show: (key: string, title: string) => void
}

export const PhoneSectionsContext = createContext<PhoneSectionsApi | null>(null)

export const usePhoneSections = (): PhoneSectionsApi | null => useContext(PhoneSectionsContext)

/**
 * The state a phone container keeps for its section screen: the shown section, the value for
 * {@link PhoneSectionsContext} (null when `phone` is false, so the sections stay the accordion),
 * and the way back to the rows.
 */
export const usePhoneSectionScreen = (phone: boolean) => {
    const [shown, setShown] = useState<PhoneSection | null>(null)
    // Stable, so a caller can depend on it.
    const show = useCallback((key: string, title: string) => setShown({key, title}), [])
    const close = useCallback(() => setShown(null), [])
    const api = useMemo<PhoneSectionsApi | null>(
        () => (phone ? {shownKey: shown?.key ?? null, show} : null),
        [phone, shown, show],
    )
    return {shown: phone ? shown : null, api, close}
}
