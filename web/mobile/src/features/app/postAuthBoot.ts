import {atom} from "jotai"

/**
 * The hand-off between a successful sign-in and the first real screen. Set by `useAuthSuccess`,
 * cleared by `PostAuthLoader` once the destination has its data.
 */
export type AccountKind = "new" | "returning"

export interface PostAuthBoot {
    account: AccountKind
    /** Answers older than this predate the sign-in and say nothing about readiness. */
    startedAt: number
}

export const postAuthBootAtom = atom<PostAuthBoot | null>(null)

/** What the projects query has said since the sign-in. */
export type ProjectsAnswer = "pending" | "ok" | "empty" | "failed"

/** 0: resolving the workspace, 1: loading the project's agents, 2: everything has answered. */
export type BootStage = 0 | 1 | 2

/** Only a project with agents to load has a stage 1; any other answer is final. */
export const bootStage = (projects: ProjectsAnswer, agentsSettled: boolean): BootStage =>
    projects === "pending" ? 0 : projects === "ok" && !agentsSettled ? 1 : 2

export const BOOT_STATUSES: Record<AccountKind, readonly [string, string, string]> = {
    new: ["Creating your workspace", "Setting up your first project", "Almost ready"],
    returning: ["Loading your agents", "Restoring recent sessions", "Almost ready"],
}

export const BOOT_TIPS = [
    "You can talk to your agents in Slack, Telegram or WhatsApp.",
    "Correct an agent once and it remembers next time.",
    "Every session runs in its own sandbox, isolated from the others.",
    "Agents can run on a schedule or when something happens in a connected app.",
    "You can run agents on your Claude or ChatGPT subscription.",
] as const

/** How long each tip shows before the next. Reduced motion keeps the first one. */
export const BOOT_TIP_MS = 3600

/** Shortest hold, so a fast boot does not flash. */
export const BOOT_MIN_MS = 1200
/** Longest hold: past it the loader steps aside and the screen shows its own state. */
export const BOOT_MAX_MS = 20_000

const STAGE_RANGE: Record<BootStage, [number, number]> = {0: [4, 38], 1: [40, 78], 2: [100, 100]}

/** Bar fill in percent: a stage's floor, creeping toward its ceiling while it waits. */
export const bootProgress = (stage: BootStage, msInStage: number): number => {
    const [floor, ceiling] = STAGE_RANGE[stage]
    return Math.round(floor + (ceiling - floor) * (1 - Math.exp(-msInStage / 1500)))
}
