/**
 * Fallback surface for a parked client tool with no registered widget (design §"Where dispatch
 * lives"). It must SETTLE the part so the run never hangs silently: on mount it settles a neutral
 * non-error output, which resumes the run and lets the agent re-ask or move on.
 */
import {useEffect, useRef} from "react"

import {Info} from "@phosphor-icons/react"
import {Typography} from "antd"

import type {ClientToolHandlerProps} from "./types"

const {Text} = Typography

const UnhandledClientTool = ({meta, settle}: ClientToolHandlerProps) => {
    const settledRef = useRef(false)
    useEffect(() => {
        if (settledRef.current || meta.settled) return
        settledRef.current = true
        settle({output: {status: "not_handled", message: "Not handled by this client."}})
    }, [meta.settled, settle])

    return (
        <div className="flex min-w-0 items-center gap-2 py-1" title={meta.toolName}>
            <Info size={13} className="shrink-0 text-colorTextTertiary" />
            <Text type="secondary" className="!text-xs !text-colorTextTertiary truncate">
                Not handled by this client
            </Text>
        </div>
    )
}

export default UnhandledClientTool
