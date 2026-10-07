import {useEffect, useState} from "react"

import {AgentaMark} from "@agenta/auth-ui"
import {agentWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"
import {useQuery} from "@tanstack/react-query"
import {useAtomValue} from "jotai"
import {AnimatePresence, motion} from "motion/react"

import {fetchProjects} from "@/lib/context"
import {useMotionPresets} from "@/lib/motion/presets"

import {
    BOOT_MAX_MS,
    BOOT_MIN_MS,
    BOOT_STATUSES,
    BOOT_TIP_MS,
    BOOT_TIPS,
    bootProgress,
    bootStage,
    type PostAuthBoot,
    type ProjectsAnswer,
} from "./postAuthBoot"

interface BootLoaderScreenProps {
    boot: PostAuthBoot
    /** The destination has answered (or the wait ran out); the loader can leave. */
    onDone: () => void
}

/**
 * The editorial post-sign-in loader: a status line, a large rotating tip, a thin progress bar.
 * Its stages follow what the app actually loads — the project list, then the project's agents,
 * which is what the home waits on to choose between onboarding and the app.
 */
export const BootLoaderScreen = ({boot, onDone}: BootLoaderScreenProps) => {
    const presets = useMotionPresets()
    // Same key and options as AuthGate and the root resolver, so this costs no request.
    const projectsQuery = useQuery({
        queryKey: ["mobile", "projects"],
        queryFn: () => fetchProjects(),
        staleTime: 30_000,
    })
    const projectId = useAtomValue(projectIdAtom)
    const agents = useAtomValue(agentWorkflowsListQueryStateAtom)

    const fresh =
        projectsQuery.dataUpdatedAt >= boot.startedAt ? projectsQuery.data : undefined
    const projects: ProjectsAnswer = !fresh
        ? "pending"
        : fresh.kind !== "ok"
          ? "failed"
          : fresh.projects.length
            ? "ok"
            : "empty"
    const stage = bootStage(projects, Boolean(projectId) && !agents.isPending)

    const [now, setNow] = useState(() => Date.now())
    const [stageSince, setStageSince] = useState({stage, at: boot.startedAt})
    if (stageSince.stage !== stage) setStageSince({stage, at: now})
    const [tip, setTip] = useState(0)

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 100)
        return () => clearInterval(timer)
    }, [])

    useEffect(() => {
        if (presets.reduced) return
        const timer = setInterval(() => setTip((index) => (index + 1) % BOOT_TIPS.length), BOOT_TIP_MS)
        return () => clearInterval(timer)
    }, [presets.reduced])

    const elapsed = now - boot.startedAt
    const done = (stage === 2 && elapsed >= BOOT_MIN_MS) || elapsed >= BOOT_MAX_MS
    useEffect(() => {
        if (done) onDone()
    }, [done, onDone])

    const status = BOOT_STATUSES[boot.account][stage]
    const progress = bootProgress(stage, now - stageSince.at)

    return (
        <div className="bg-background text-foreground flex size-full items-center justify-center p-[clamp(24px,6vw,96px)]">
            <div className="flex w-full max-w-[600px] flex-col gap-10">
                <div className="flex items-center gap-3" role="status" aria-live="polite">
                    <AgentaMark className="h-[18px] w-auto flex-none" markClassName="fill-foreground" />
                    <AnimatePresence mode="wait" initial={false}>
                        <motion.span
                            key={status}
                            variants={presets.crossfade}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            className="text-muted-foreground text-sm"
                        >
                            {status}
                        </motion.span>
                    </AnimatePresence>
                </div>
                <div className="min-h-[3.6em] text-[clamp(28px,3.4vw,48px)] leading-[1.15]">
                    <AnimatePresence mode="wait" initial={false}>
                        <motion.p
                            key={tip}
                            variants={presets.crossfade}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            className="m-0 font-semibold tracking-[-0.025em] text-balance"
                        >
                            {BOOT_TIPS[tip]}
                        </motion.p>
                    </AnimatePresence>
                </div>
                <div className="flex flex-col gap-3">
                    <div
                        className="bg-border h-0.5 w-full overflow-hidden rounded-full"
                        role="progressbar"
                        aria-label={status}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={progress}
                    >
                        <div
                            className="bg-foreground h-full w-full origin-left rounded-full motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-linear"
                            style={{transform: `scaleX(${progress / 100})`}}
                        />
                    </div>
                    <div className="text-muted-foreground flex justify-between text-xs tabular-nums">
                        <span className="font-medium tracking-[0.03em] uppercase">Did you know</span>
                        <span>{progress}%</span>
                    </div>
                </div>
            </div>
        </div>
    )
}
