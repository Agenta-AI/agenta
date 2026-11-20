import {createContext} from "react"

/**
 * A narrower cap for every `ContentRail` inside one screen (a `max-w-[...]` class). The chat sets
 * it to the canvas column (720 px in a session, 780 px on the builder page); Settings keeps the
 * default.
 */
export const ContentRailCapContext = createContext<string | null>(null)
