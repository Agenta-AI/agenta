import {useProjectWatch} from "./useProjectWatch"
import type {RefreshSession} from "./watchEventSource"

/**
 * Null-rendering mount for the project watch. Mount it once, above every project-scoped screen —
 * the desktop does it in `Layout`, `/m` in `AppProviders`.
 *
 * `refreshSession` is a required prop rather than a configured seam so a host that forgets it
 * fails at typecheck, not silently at the first expired token.
 */
export const ProjectWatch = ({refreshSession}: {refreshSession: RefreshSession}) => {
    useProjectWatch({refreshSession})
    return null
}

export default ProjectWatch
