import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"
import Head from "next/head"

import {useBadgedFavicon} from "@/lib/useBadgedFavicon"

import {useAnySessionRunning} from "../sessions/useAnySessionRunning"
import {useFinishedWhileHidden} from "../sessions/useFinishedWhileHidden"

/**
 * A dot on the tab's favicon: green while any session runs, amber once a run finished while you
 * were away — so a run you started and navigated away from, or left in a background tab, still
 * shows, and its finishing is announced rather than taking the dot with it before you look.
 *
 * Both icon links are overridden by key: Chrome favours the SVG entry, Safari the ICO. With no
 * state to show this renders nothing and `_app`'s own links stand again, the way `PageTitle` yields.
 */
export const RunningFavicon = () => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const running = useAnySessionRunning(projectId)
    const unseen = useFinishedWhileHidden(running)
    const badge = running ? "running" : unseen ? "finished" : null
    const badged = useBadgedFavicon("/m/assets/favicon.ico", badge)
    if (!badged) return null
    return (
        <Head>
            <link key="favicon-ico" rel="icon" href={badged} type="image/png" sizes="any" />
            <link key="favicon-svg" rel="icon" href={badged} type="image/png" />
        </Head>
    )
}
