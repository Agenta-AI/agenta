import type {NextRouter} from "next/router"

import {projectSwitchUrl, writeLastContext, type LastContext} from "@/lib/context"

/** Moves to another project and stays on the same screen, remembered for the `/m` root. */
export const switchProjectContext = (router: NextRouter, next: LastContext) => {
    writeLastContext(next)
    void router.push(projectSwitchUrl(router.asPath, next))
}
