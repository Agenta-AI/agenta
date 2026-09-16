import {projectIdAtom} from "@agenta/shared/state"
import {getDefaultStore} from "jotai"

/** `/m/w/<workspace>/p/<project>/…` — the project id the route already carries. */
const PROJECT_PATH = /\/w\/[^/]+\/p\/([^/]+)/

export const projectIdFromPath = (pathname: string): string | null =>
    PROJECT_PATH.exec(pathname)?.[1] ?? null

/**
 * Seed `projectIdAtom` from the URL at module load, before React renders anything.
 *
 * `ContextSync` and `useBindProjectContext` bind it in an EFFECT, a commit too late: every query
 * mounted in that first commit keys on a null project and mints a second, permanently disabled
 * cache entry — 10 dead ones on a session screen. Binding in render instead would notify the
 * already-mounted `ProjectWatch` mid-render, so it happens here, before anything is mounted.
 */
export const seedProjectContextFromUrl = (): void => {
    if (typeof window === "undefined") return
    const projectId = projectIdFromPath(window.location.pathname)
    if (!projectId) return
    const store = getDefaultStore()
    if (store.get(projectIdAtom) === null) store.set(projectIdAtom, projectId)
}

seedProjectContextFromUrl()
