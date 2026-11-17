import type {CatalogKey} from "@agenta/i18n"
import type bootLoaderCatalog from "@agenta/i18n/catalogs/shell.bootLoader"
import {atom} from "jotai"

/** Set by `useAuthSuccess`, cleared by `PostAuthLoader` once the first screen has its data. */
/** `pending`: an OIDC code is still being exchanged, so the account kind is not known yet. */
export type AccountKind = "new" | "returning" | "pending"

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

export type BootTextKey = CatalogKey<typeof bootLoaderCatalog>

export const BOOT_STATUSES: Record<AccountKind, readonly [BootTextKey, BootTextKey, BootTextKey]> =
    {
        new: [
            "shell.bootLoader.statusNew1",
            "shell.bootLoader.statusNew2",
            "shell.bootLoader.statusAlmostReady",
        ],
        returning: [
            "shell.bootLoader.statusReturning1",
            "shell.bootLoader.statusReturning2",
            "shell.bootLoader.statusAlmostReady",
        ],
        pending: [
            "shell.bootLoader.statusPending1",
            "shell.bootLoader.statusPending2",
            "shell.bootLoader.statusAlmostReady",
        ],
    }

export const BOOT_TIPS: readonly BootTextKey[] = [
    "shell.bootLoader.tip1",
    "shell.bootLoader.tip2",
    "shell.bootLoader.tip3",
    "shell.bootLoader.tip4",
    "shell.bootLoader.tip5",
]

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
