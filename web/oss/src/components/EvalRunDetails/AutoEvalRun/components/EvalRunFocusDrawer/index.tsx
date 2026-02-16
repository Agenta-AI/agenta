import {memo, useCallback, useMemo} from "react"

import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {
    closeFocusDrawerAtom,
    focusScenarioAtom,
    isFocusDrawerOpenAtom,
    resetFocusDrawerAtom,
} from "@/oss/components/EvalRunDetails/state/focusScenarioAtom"
import GenericDrawer from "@/oss/components/GenericDrawer"
import {RunIdProvider} from "@/oss/contexts/RunIdContext"
import {clearFocusDrawerQueryParams} from "@/oss/state/url/focusDrawer"

const FocusDrawerHeader = dynamic(() => import("./assets/FocusDrawerHeader"), {ssr: false})
const FocusDrawerContent = dynamic(() => import("./assets/FocusDrawerContent"), {ssr: false})
const FocusDrawerSidePanel = dynamic(() => import("./assets/FocusDrawerSidePanel"), {ssr: false})

const EvalRunFocusDrawer = () => {
    const isOpen = useAtomValue(isFocusDrawerOpenAtom)
    const focus = useAtomValue(focusScenarioAtom)
    const closeDrawer = useSetAtom(closeFocusDrawerAtom)
    const resetDrawer = useSetAtom(resetFocusDrawerAtom)

    const focusRunId = focus?.focusRunId ?? null

    const handleClose = useCallback(() => {
        closeDrawer(null)
    }, [closeDrawer])

    const handleAfterOpenChange = useCallback(
        (nextOpen: boolean) => {
            if (!nextOpen) {
                resetDrawer(null)
                clearFocusDrawerQueryParams()
            }
        },
        [resetDrawer],
    )

    const shouldRenderContent = useMemo(
        () => Boolean(focusRunId && focus?.focusScenarioId),
        [focusRunId, focus?.focusScenarioId],
    )

    if (!focusRunId) {
        return null
    }

    return (
        <RunIdProvider runId={focusRunId}>
            <GenericDrawer
                open={isOpen}
                onClose={handleClose}
                afterOpenChange={handleAfterOpenChange}
                expandable
                headerExtra={shouldRenderContent ? <FocusDrawerHeader /> : null}
                mainContent={shouldRenderContent ? <FocusDrawerContent /> : null}
                sideContent={shouldRenderContent ? <FocusDrawerSidePanel /> : null}
                className="[&_.ant-drawer-body]:p-0"
                sideContentDefaultSize={200}
            />
        </RunIdProvider>
    )
}

export default memo(EvalRunFocusDrawer)
