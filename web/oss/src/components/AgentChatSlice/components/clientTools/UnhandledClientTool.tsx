/**
 * Fallback surface for a parked client tool with no registered widget (design §"Where dispatch
 * lives"). It must SETTLE the part so the run never hangs silently: on mount it settles an error,
 * which resumes the run and lets the agent re-ask or move on. The row stays as a brief explanation.
 */
import {useEffect, useRef} from "react"

import {Warning} from "@phosphor-icons/react"

import type {ClientToolHandlerProps} from "./types"

const UnhandledClientTool = ({meta, settle}: ClientToolHandlerProps) => {
    const settledRef = useRef(false)
    useEffect(() => {
        if (settledRef.current || meta.settled) return
        settledRef.current = true
        settle({errorText: `This app can’t handle the "${meta.toolName}" request.`})
    }, [meta.settled, meta.toolName, settle])

    return (
        <div className="flex min-w-0 items-center gap-2 py-1">
            <Warning size={13} weight="fill" className="shrink-0 text-colorWarning" />
            <span className="!text-xs truncate text-muted-foreground">
                Can’t handle the “{meta.toolName}” request
            </span>
        </div>
    )
}

export default UnhandledClientTool
