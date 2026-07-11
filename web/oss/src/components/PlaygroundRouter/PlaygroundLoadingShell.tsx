import type {ReactNode} from "react"

import {bgColors} from "@agenta/ui"
import {Robot} from "@phosphor-icons/react"
import {Typography} from "antd"
import {useAtomValue} from "jotai"

import {playgroundEarlyAgentStateAtom} from "@/oss/state/workflow"

interface PlaygroundLoadingShellProps {
    /** Force the agent-flavored header. Onboarding always targets an agent, so it need not
     * wait for the early app-id signal to resolve. Defaults to the early agent-state atom. */
    agent?: boolean
    /** Body rendered under the header — e.g. the agent chat skeleton during onboarding.
     * Header-only (the plain chunk-download fallback) when omitted. */
    children?: ReactNode
}

// Neutral chunk-download fallback. It must NOT prejudge the app as non-agent — the old
// shell hardcoded the eval stack (New Evaluation / Compare), which then vanished on agent
// reloads. Read the early app-id agent signal so an agent app shows the agent-flavored
// header from the first paint, and never render the eval actions here (the real header
// commits them once the workflow type is confirmed).
const PlaygroundLoadingShell = ({agent, children}: PlaygroundLoadingShellProps = {}) => {
    const earlyAgent = useAtomValue(playgroundEarlyAgentStateAtom) === "agent"
    const isAgent = agent ?? earlyAgent
    return (
        <div className="flex flex-col w-full h-[calc(100dvh-46px)] overflow-hidden">
            <div
                className={`flex items-center justify-between gap-4 px-2.5 py-2 ${bgColors.active}`}
            >
                {isAgent ? (
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--ant-color-fill-secondary)] text-[var(--ag-c-13C2C2)]">
                            <Robot size={15} weight="fill" />
                        </span>
                        <Typography className="text-[16px] leading-[18px] font-[600]">
                            Agent
                        </Typography>
                    </div>
                ) : (
                    <Typography className="text-[16px] leading-[18px] font-[600]">
                        Playground
                    </Typography>
                )}
            </div>
            {children ? <div className="min-h-0 flex-1">{children}</div> : null}
        </div>
    )
}

export default PlaygroundLoadingShell
