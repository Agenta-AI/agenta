import {useCallback, useMemo} from "react"

import {CaretDown, CaretUp, SidebarSimple} from "@phosphor-icons/react"
import {Button, Tag, Typography} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import TooltipWithCopyAction from "@/oss/components/EnhancedUIs/Tooltip"
import {sessionIdsAtom} from "@/oss/state/newObservability"
import {openSessionDrawerWithUrlAtom} from "@/oss/state/url/session"

import useSessionDrawer from "../../hooks/useSessionDrawer"
import {isAnnotationVisibleAtom} from "../../store/sessionDrawerStore"

const SessionHeader = () => {
    const {sessionId} = useSessionDrawer()
    const [isAnnotationVisible, setIsAnnotationVisible] = useAtom(isAnnotationVisibleAtom)
    const sessionIds = useAtomValue(sessionIdsAtom)
    const openSessionDrawer = useSetAtom(openSessionDrawerWithUrlAtom)

    const currentIndex = useMemo(() => {
        if (!sessionId || !sessionIds) return -1
        return sessionIds.indexOf(sessionId)
    }, [sessionId, sessionIds])

    const handleNext = useCallback(() => {
        if (currentIndex < sessionIds.length - 1) {
            openSessionDrawer({sessionId: sessionIds[currentIndex + 1]})
        }
    }, [currentIndex, sessionIds, openSessionDrawer])

    const handlePrev = useCallback(() => {
        if (currentIndex > 0) {
            openSessionDrawer({sessionId: sessionIds[currentIndex - 1]})
        }
    }, [currentIndex, sessionIds, openSessionDrawer])

    const isNextDisabled = currentIndex === sessionIds.length - 1 || currentIndex === -1
    const isPrevDisabled = currentIndex === 0 || currentIndex === -1

    return (
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
                <div className="flex gap-1">
                    <Button
                        type="text"
                        icon={<CaretUp size={16} />}
                        onClick={handlePrev}
                        disabled={isPrevDisabled}
                    />
                    <Button
                        type="text"
                        icon={<CaretDown size={16} />}
                        onClick={handleNext}
                        disabled={isNextDisabled}
                    />
                </div>

                <Typography.Text className="text-sm font-medium">Session</Typography.Text>
                <TooltipWithCopyAction copyText={sessionId || ""} title="Copy session id">
                    <Tag className="font-mono bg-[#0517290F]" bordered={false}>
                        # {sessionId || "-"}
                    </Tag>
                </TooltipWithCopyAction>
            </div>

            <Button
                size="small"
                type={!isAnnotationVisible ? "primary" : "default"}
                icon={<SidebarSimple size={14} />}
                onClick={() => setIsAnnotationVisible(!isAnnotationVisible)}
            >
                {!isAnnotationVisible ? "Show" : "Hide"} annotations
            </Button>
        </div>
    )
}

export default SessionHeader
