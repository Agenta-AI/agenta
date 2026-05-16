import {memo} from "react"

import {annotationSessionController} from "@agenta/annotation"
import {Tray} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import {useAtomValue} from "jotai"

import {useAnnotationNavigation} from "../../context"

import type {EmptyQueueStateProps} from "./assets/type"

const EmptyQueueState = memo(function EmptyQueueState({onViewChange}: EmptyQueueStateProps) {
    const navigation = useAnnotationNavigation()
    const queueKind = useAtomValue(annotationSessionController.selectors.queueKind())
    const isTraces = queueKind === "traces"

    return (
        <div className="flex flex-col flex-1 items-center justify-center gap-4 min-h-0">
            <div className="flex items-center justify-center size-20 rounded-full bg-[var(--ant-color-fill-quaternary)]">
                <Tray size={32} className="text-[var(--ant-color-text-secondary)]" />
            </div>

            <div className="flex flex-col items-center gap-2 text-center">
                <Typography.Text strong className="!text-base">
                    There&apos;s nothing to see here
                </Typography.Text>
                <Typography.Text type="secondary" className="text-sm">
                    Currently there are no runs &amp; annotations in this queue,
                    <br />
                    {isTraces ? "please add runs from traces." : "please add items from test sets."}
                </Typography.Text>
            </div>

            <div className="flex items-center gap-2">
                <Button size="small" onClick={() => onViewChange("list")}>
                    View previous annotations
                </Button>
                {isTraces && navigation.navigateToObservability && (
                    <Button
                        size="small"
                        type="primary"
                        className="!bg-[#051729] !border-[#051729] hover:!bg-[#0a2540] hover:!border-[#0a2540]"
                        onClick={() => navigation.navigateToObservability?.()}
                    >
                        Go to observability
                    </Button>
                )}
            </div>
        </div>
    )
})

export default EmptyQueueState
