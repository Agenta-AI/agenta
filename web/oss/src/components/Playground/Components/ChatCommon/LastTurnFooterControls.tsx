import React, {useMemo} from "react"

import clsx from "clsx"
import {useAtomValue} from "jotai"

import AddButton from "@/oss/components/Playground/assets/AddButton"
import RunButton from "@/oss/components/Playground/assets/RunButton"
import {isAnyRunningForLogicalAtomFamily} from "@/oss/state/newPlayground/chat/view"

interface Props {
    logicalId: string
    onRun: () => void
    onCancelAll: () => void
    onAddMessage: () => void
    className?: string
}

const LastTurnFooterControls: React.FC<Props> = ({
    logicalId,
    onRun,
    onCancelAll,
    onAddMessage,
    className,
}) => {
    const isAnyRunning = useAtomValue(
        useMemo(() => isAnyRunningForLogicalAtomFamily(logicalId), [logicalId]),
    ) as boolean

    return (
        <div className={clsx("flex items-center gap-2 p-3 pl-0", className)}>
            {!isAnyRunning ? (
                <RunButton onClick={onRun} size="small" data-tour="run-button" />
            ) : (
                <RunButton isCancel onClick={onCancelAll} size="small" />
            )}
            <AddButton onClick={onAddMessage} size="small" label="Message" />
        </div>
    )
}

export default LastTurnFooterControls
