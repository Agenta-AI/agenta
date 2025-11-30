import {useCallback, useEffect, useMemo, useState} from "react"

import {Typography, message} from "antd"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"

import type {DeleteEvaluationModalDeletionConfig} from "./types"

interface DeleteEvaluationModalContentProps {
    evaluationType: string
    isMultiple?: boolean
    deletionConfig?: DeleteEvaluationModalDeletionConfig
    onLoadingChange?: (loading: boolean) => void
    registerOkHandler: (handler: () => Promise<void> | void) => void
}

const deletePreviewRuns = async (projectId: string | null | undefined, runIds: string[]) => {
    if (!projectId || runIds.length === 0) return
    await axios.delete(`/preview/evaluations/runs/`, {
        params: {project_id: projectId},
        data: {run_ids: runIds},
    })
}

const DeleteEvaluationModalContent = ({
    evaluationType,
    isMultiple = false,
    deletionConfig,
    onLoadingChange,
    registerOkHandler,
}: DeleteEvaluationModalContentProps) => {
    const [internalLoading, setInternalLoading] = useState(false)

    const store = useMemo(() => getDefaultStore(), [])

    useEffect(() => {
        onLoadingChange?.(internalLoading)
    }, [internalLoading, onLoadingChange])

    const handleBuiltInDelete = useCallback(async () => {
        if (!deletionConfig) return

        const {
            projectId,
            previewRunIds = [],
            invalidateQueryKeys = [],
            onSuccess,
            onError,
        } = deletionConfig

        if (!previewRunIds.length) {
            message.warning("Select evaluations to delete")
            return
        }

        setInternalLoading(true)
        const queryClient = store.get(queryClientAtom)

        try {
            if (previewRunIds.length) {
                if (!projectId) {
                    throw new Error("Project ID is required to delete preview runs")
                }
                await deletePreviewRuns(projectId, previewRunIds)
            }

            if (invalidateQueryKeys.length) {
                await Promise.all(
                    invalidateQueryKeys.map((queryKey) =>
                        queryClient.invalidateQueries({queryKey}),
                    ),
                )
            }

            message.success("Deleted successfully")
            await onSuccess?.()
        } catch (error) {
            console.error(error)
            message.error("Failed to delete evaluations")
            onError?.(error)
        } finally {
            setInternalLoading(false)
        }
    }, [deletionConfig, store])

    const handleOk = useCallback(async () => {
        if (deletionConfig) {
            await handleBuiltInDelete()
        }
    }, [deletionConfig, handleBuiltInDelete])

    useEffect(() => {
        registerOkHandler(handleOk)
    }, [handleOk, registerOkHandler])

    return (
        <section className="flex flex-col gap-1">
            <Typography.Text className="text-sm font-semibold mb-2">
                Are you sure you want to delete?
            </Typography.Text>

            <div className="flex flex-col gap-4">
                <Typography.Text>
                    {isMultiple
                        ? `The selected ${evaluationType.split(" | ").length} evaluations will be permanently deleted.`
                        : `A deleted ${evaluationType} cannot be restored.`}
                </Typography.Text>

                <div className="flex flex-col gap-1">
                    <Typography.Text>
                        {isMultiple
                            ? "You are about to delete the following evaluations:"
                            : "You are about to delete:"}
                    </Typography.Text>
                    <Typography.Text
                        className={`text-sm font-medium ${isMultiple ? "max-h-40 overflow-y-auto" : ""}`}
                    >
                        {isMultiple
                            ? evaluationType.split(" | ").map((item, index) => (
                                  <div key={index} className="py-1">
                                      • {item.trim()}
                                  </div>
                              ))
                            : evaluationType}
                    </Typography.Text>
                </div>
            </div>
        </section>
    )
}

export default DeleteEvaluationModalContent
