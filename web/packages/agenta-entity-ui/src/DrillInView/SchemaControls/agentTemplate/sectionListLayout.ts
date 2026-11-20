import {createContext, useContext} from "react"

/**
 * How a host lays out the agent's sections. "page": the Configuration page (canvas A04), one
 * section per card with its title and action above it. Null: the panel accordion (or the phone
 * rows when {@link PhoneSectionsContext} is set).
 */
export type SectionListLayout = "page"

export const SectionListLayoutContext = createContext<SectionListLayout | null>(null)

export const useSectionListLayout = (): SectionListLayout | null =>
    useContext(SectionListLayoutContext)
