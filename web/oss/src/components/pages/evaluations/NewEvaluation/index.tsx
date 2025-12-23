import {useCallback, memo, useState} from "react"

import dynamic from "next/dynamic"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"

import {useStyles} from "./assets/styles"
import type {NewEvaluationModalGenericProps} from "./types"

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
    const classes = useStyles()
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
            className={classes.modalContainer}
            confirmLoading={submitLoading}
            styles={{
                container: {
                    height: 800,
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
