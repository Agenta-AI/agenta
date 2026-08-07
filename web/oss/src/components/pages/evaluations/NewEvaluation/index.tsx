import {useCallback, memo, useState} from "react"

import {EnhancedModal} from "@agenta/ui/components/modal"
import {CloseOutlined} from "@ant-design/icons"
import dynamic from "next/dynamic"

import type {NewEvaluationModalGenericProps} from "./types"

// `.ant-modal-content` was the same node EnhancedModal's className now lands on directly
// (not a descendant); `.ant-modal-body` is still a real descendant, now `[data-slot="modal-body"]`.
// Dropped `[&>div]:h-full`: under the old antd DOM it only ever matched the single
// `.ant-modal-content` wrapper, but this modal also renders a header + default footer as
// direct children now, so keeping it would incorrectly force them to h-full too.
const modalContainerClass =
    "overflow-y-hidden h-full flex flex-col " +
    '[&_[data-slot="modal-body"]]:overflow-y-auto [&_[data-slot="modal-body"]]:flex-1 [&_[data-slot="modal-body"]]:py-4'

const NewEvaluationModalInner = dynamic(() => import("./Components/NewEvaluationModalInner"), {
    ssr: false,
})

/**
 * NewEvaluationModal - A thin wrapper component that renders the modal shell.
 *
 * All heavy logic (data fetching, state management, submission) is moved to
 * NewEvaluationModalInner, which only mounts when the modal is open.
 * This prevents unnecessary API calls and state initialization when the modal is closed.
 */
const NewEvaluationModal = <Preview extends boolean = true>({
    onSuccess,
    preview = false as Preview,
    evaluationType,
    preSelectedVariantIds,
    preSelectedAppId,
    ...props
}: NewEvaluationModalGenericProps<Preview>) => {
    const [submitLoading, setSubmitLoading] = useState(false)

    const handleSubmitStateChange = useCallback((loading: boolean) => {
        setSubmitLoading(loading)
    }, [])

    const onSubmit = useCallback(async () => {
        // Call the submit handler from the inner component
        if (typeof window !== "undefined" && (window as any).__newEvalModalSubmit) {
            await (window as any).__newEvalModalSubmit()
        }
    }, [])

    return (
        <EnhancedModal
            title={<span>New {evaluationType === "auto" ? "Auto" : "Human"} Evaluation</span>}
            onOk={onSubmit}
            okText="Start Evaluation"
            maskClosable={false}
            width={1200}
            className={modalContainerClass}
            confirmLoading={submitLoading}
            okButtonProps={{"data-tour": "run-eval-confirm"}}
            closeIcon={
                <span data-tour="new-eval-modal-close">
                    <CloseOutlined />
                </span>
            }
            styles={{
                container: {
                    height: 700,
                },
            }}
            {...props}
        >
            {/* Conditionally render inner component so it remounts on each open,
                ensuring fresh state without manual reset effects */}
            {props.open && (
                <NewEvaluationModalInner
                    onSuccess={onSuccess}
                    preview={preview}
                    evaluationType={evaluationType}
                    onSubmitStateChange={handleSubmitStateChange}
                    preSelectedVariantIds={preSelectedVariantIds}
                    preSelectedAppId={preSelectedAppId}
                />
            )}
        </EnhancedModal>
    )
}

export default memo(NewEvaluationModal)
