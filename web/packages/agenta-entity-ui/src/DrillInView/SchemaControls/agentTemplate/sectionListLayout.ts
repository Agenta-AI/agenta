import {createContext, useContext} from "react"

/**
 * How a host lays out the agent's sections. "page": the Configuration page (canvas A04), one
 * section per card with its title and action above it. "pane": the builder page pane (canvas
 * B03), the accordion with full-width 45 px rows in a wide column. Null: the panel accordion
 * (canvas F01), or the phone rows when {@link PhoneSectionsContext} is set.
 */
export type SectionListLayout = "page" | "pane"

export const SectionListLayoutContext = createContext<SectionListLayout | null>(null)

export const useSectionListLayout = (): SectionListLayout | null =>
    useContext(SectionListLayoutContext)
