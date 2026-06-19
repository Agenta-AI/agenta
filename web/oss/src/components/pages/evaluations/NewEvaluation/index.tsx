import {useCallback, memo, useState} from "react"

import {CloseOutlined} from "@ant-design/icons"
import dynamic from "next/dynamic"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"

import type {NewEvaluationModalGenericProps} from "./types"

const modalContainerClass =
    "overflow-y-hidden [&>div]:h-full [&_.ant-modal-content]:h-full [&_.ant-modal-content]:flex " +
    "[&_.ant-modal-content]:flex-col [&_.ant-modal-body]:overflow-y-auto [&_.ant-modal-body]:flex-1 " +
    "[&_.ant-modal-body]:py-4"

const NewEvaluationModalInner = dynamic(() => import("./Components/NewEvaluationModalInner"), {
    ssr: false,
})

/**
 * Creates an automatic or human evaluation.
 *
 * Public props:
 * - `open`: Controls modal visibility.
 * - `onCancel`: Called when the modal is closed.
 * - `onSuccess`: Called after an evaluation is created.
 * - `evaluationType`: Controls the title and auto-only steps (`"auto"` or `"human"`).
 * - `preview`: Uses the human/preview submission flow when `true`.
 * - `preSelectedAppId`: Preselects and locks the application step.
 * - `preSelectedVariantIds`: Preselects revision IDs.
 * - `steps`: Controls step order, requiredness, dependencies, visibility, locking, and presets.
 * - `nameBuilder`: Builds the base for the generated evaluation name from current step values.
 * - Remaining Ant Design `ModalProps` are forwarded to the modal.
 *
 * Each `steps` item supports:
 * - `kind`: `"application" | "revision" | "testset" | "evaluator" | "advanced" |
 *   "traces" | "query"`.
 * - `required`: Requires the step to be complete before submission.
 * - `dependsOn`: Disables the step until the listed steps are complete.
 * - `hidden`: Keeps the step in state and submission but removes its tab.
 * - `locked`: Shows the step as read-only.
 * - `preset`: Sets the step's initial value.
 *
 * Source presets:
 * - `traces`: An array of trace IDs, for example `{kind: "traces", preset: traceIds}`.
 * - `query`: A query reference, for example `{kind: "query", preset: {queryId}}`.
 * - Configure only one source kind per modal.
 *
 * @example
 * <NewEvaluationModal
 *     open={open}
 *     onCancel={onClose}
 *     onSuccess={onSuccess}
 *     evaluationType="auto"
 *     preview={false}
 *     steps={[
 *         {kind: "application", required: true},
 *         {kind: "revision", required: true, dependsOn: ["application"]},
 *         {kind: "evaluator", required: true},
 *         {kind: "advanced", required: true},
 *     ]}
 * />
 */
const NewEvaluationModal = <Preview extends boolean = true>({
    onSuccess,
    preview = false as Preview,
    evaluationType,
    preSelectedVariantIds,
    preSelectedAppId,
    steps,
    nameBuilder,
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
                    steps={steps}
                    nameBuilder={nameBuilder}
                />
            )}
        </EnhancedModal>
    )
}

export default memo(NewEvaluationModal)
