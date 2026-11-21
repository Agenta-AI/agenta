import {atom, getDefaultStore} from "jotai"
import Router from "next/router"

/**
 * Whether the builder page shows the main sidebar in place of the builder sidebar: true after
 * "Back". A store atom, not page state, so "Builder" in the main sidebar can show the builder
 * sidebar again when the route does not change (a new chat is still open).
 */
export const builderSidebarHiddenAtom = atom(false)

/** Show the builder sidebar on the builder page again. */
export const showBuilderSidebar = () => getDefaultStore().set(builderSidebarHiddenAtom, false)

/** Open the builder page on a new chat with the builder sidebar, as "Builder" in the main sidebar does. */
export const openBuilderPage = (projectURL: string) => {
    showBuilderSidebar()
    void Router.push(`${projectURL}/builder`)
}
