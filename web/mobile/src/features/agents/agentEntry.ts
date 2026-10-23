import {getEnv} from "@/lib/env"

/** Agent overview page (`NEXT_PUBLIC_AGENT_OVERVIEW`). OFF: in-app links open the playground. */
export const isAgentOverviewEnabled = (): boolean =>
    (getEnv("NEXT_PUBLIC_AGENT_OVERVIEW") || "").toLowerCase() === "true"

/** Query value the agent route reads to forward a link to a blank playground session. */
export const OPEN_PLAYGROUND = "playground"

/** Where an in-app agent link lands: the overview, or (flag off) the agent's playground. */
export const agentEntryHref = (base: string, agentId: string): string =>
    isAgentOverviewEnabled()
        ? `${base}/agents/${agentId}`
        : `${base}/agents/${agentId}?open=${OPEN_PLAYGROUND}`
