import type {AgentSidebarSession} from "../../../mobile/src/features/agent-sidebar/agentSidebarItems"

/** The canvas data of the Main and A01 frames: two agents and their sessions. */
export const SIDEBARS_PROJECT_URL = "/w/demo/p/demo"

export const SUPPORT_TRIAGE = {id: "agent-support-triage", name: "Support triage"}
export const EMAIL_WRITER = {id: "agent-email-writer", name: "Email writer"}
export const SIDEBARS_AGENTS = [SUPPORT_TRIAGE, EMAIL_WRITER]

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
/** A time on the day before yesterday or earlier, whatever the hour now. */
const daysAgo = (days: number) => {
    const date = new Date()
    date.setDate(date.getDate() - days)
    date.setHours(12, 0, 0, 0)
    return date.toISOString()
}
/** Yesterday at noon. */
const yesterday = () => daysAgo(1)

const session = (
    sessionId: string,
    title: string,
    activityAt: string,
    status: AgentSidebarSession["status"] = "idle",
): AgentSidebarSession => ({
    sessionId,
    appId: SUPPORT_TRIAGE.id,
    name: title,
    archived: false,
    ownerUserId: "me",
    title,
    activityAt,
    status,
    isAutomation: false,
})

/** The open session of both frames. */
export const OPEN_SESSION_ID = "s-charged-twice"

/** A01: "Sessions 42", six latest sessions over three days, 36 older. */
export const SUPPORT_TRIAGE_SESSIONS: AgentSidebarSession[] = [
    session(OPEN_SESSION_ID, "Charged twice for March", hoursAgo(0.1), "alive"),
    session("s-safari", "Login fails on Safari", hoursAgo(0.5), "running"),
    session("s-invoice", "Invoice copy for March", hoursAgo(0.8), "waiting"),
    session("s-export", "Export to CSV is empty", hoursAgo(1)),
    session("s-health", "Health check after a configuration change", yesterday()),
    session("s-address", "Change of billing address", daysAgo(3)),
]
export const SUPPORT_TRIAGE_TOTAL = 42

/** Main: each agent section with its sessions; the sidebar shows 4 of each. */
export const MAIN_SECTIONS = [
    {
        agent: SUPPORT_TRIAGE,
        sessions: [
            "Charged twice for March",
            "Login fails on Safari",
            "Invoice copy for March",
            "Export to CSV is empty",
            "Change of billing address",
        ],
    },
    {
        agent: EMAIL_WRITER,
        sessions: ["Dentalis AG", "Praxisplan", "Medident Software", "Kieferwerk", "Zahnwerk"],
    },
]
