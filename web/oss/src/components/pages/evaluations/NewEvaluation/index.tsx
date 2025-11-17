import {memo, useCallback, useRef, useState} from "react"

import dynamic from "next/dynamic"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"

import {useStyles} from "./assets/styles"
import type {NewEvaluationModalGenericProps} from "./types"

const noopSubmit = async () => {}

const NewEvaluationModalContent = dynamic(() => import("./Components/NewEvaluationModalContent"), {
    ssr: false,
})

const NewEvaluationModal = <Preview extends boolean = true>({
    onSuccess,
    preview = false as Preview,
    evaluationType,
    ...props
}: NewEvaluationModalGenericProps<Preview>) => {
    const classes = useStyles()
    const submitHandlerRef = useRef<() => Promise<void> | void>(noopSubmit)
    const [submitLoading, setSubmitLoading] = useState(false)

    const handleRegisterSubmit = useCallback((handler: () => Promise<void> | void) => {
        submitHandlerRef.current = handler || noopSubmit
    }, [])

    const handleLoadingChange = useCallback((loading: boolean) => {
        setSubmitLoading(loading)
    }, [])

    const handleModalOk = useCallback(() => {
        return submitHandlerRef.current?.()
    }, [])

    const handleAfterClose = useCallback(() => {
        submitHandlerRef.current = noopSubmit
        setSubmitLoading(false)
        props.afterClose?.()
    }, [props.afterClose])

    return (
        <EnhancedModal
            title={<span>New {evaluationType === "auto" ? "Auto" : "Human"} Evaluation</span>}
            onOk={handleModalOk}
            okText="Start Evaluation"
            maskClosable={false}
            width={1200}
            className={classes.modalContainer}
            confirmLoading={submitLoading}
            afterClose={handleAfterClose}
            {...props}
        >
            <NewEvaluationModalContent
                evaluationType={evaluationType}
                preview={preview}
                open={Boolean(props.open)}
                onSuccess={onSuccess}
                onRegisterSubmit={handleRegisterSubmit}
                onLoadingChange={handleLoadingChange}
            />
        </EnhancedModal>
    )
}

export default memo(NewEvaluationModal)
