import type {NextRouter} from "next/router"

import {projectSwitchUrl, writeLastContext, type LastContext} from "@/lib/context"

/** Every project switch (drawer and Settings): same screen in the next project, remembered. */
export const switchSettingsContext = (router: NextRouter, next: LastContext) => {
    writeLastContext(next)
    void router.push(projectSwitchUrl(router.asPath, next))
}
