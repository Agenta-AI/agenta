import {useCallback, useEffect, useRef, useState} from "react"

import {ArrowClockwise, PencilSimple} from "@phosphor-icons/react"
import {Alert, Button, message, Space} from "antd"
import clsx from "clsx"

import {useAppsData} from "@/oss/contexts/app.context"
import {findCustomWorkflowPath} from "@/oss/lib/shared/variant"

import {CustomWorkflowBannerProps} from "./types"

const CustomWorkflowBanner = ({
    isNewPlayground,
    setIsCustomWorkflowModalOpen,
    variant,
}: CustomWorkflowBannerProps) => {
    const {currentApp} = useAppsData()
    const [isDown, setIsDown] = useState(false)
    const controllerRef = useRef<AbortController | null>(null)
    const pollingRef = useRef<NodeJS.Timeout | null>(null)
    const [isRetryUrlHealthLoading, setIsRetryUrlHealthLoading] = useState(false)
    const [countdown, setCountdown] = useState(5)
    const [isConnectionRestored, setIsConnectionRestored] = useState(false)

    const checkWorkflowUrlHealth = useCallback(
        async (shouldThrow = false) => {
            if (controllerRef.current) {
                controllerRef.current.abort()
            }

            const controller = new AbortController()
            controllerRef.current = controller

            try {
                const {status} = (await findCustomWorkflowPath(variant?.uri || "", "/health")) || {}
                if (!status) throw new Error("Unable to establish connection")
                setIsConnectionRestored(true)
            } catch (error: any) {
                if (error.name !== "AbortError") {
                    setIsDown(true)
                    setIsConnectionRestored(false)
                    if (shouldThrow) {
                        throw error
                    }
                }
            }
        },
        [variant?.uri],
    )

    const startPollingWorkflowUrl = useCallback(() => {
        if (pollingRef.current) clearInterval(pollingRef.current)

        pollingRef.current = setInterval(() => {
            checkWorkflowUrlHealth()
        }, 60000)
    }, [checkWorkflowUrlHealth])

    useEffect(() => {
        if (currentApp?.app_type !== "custom") return

        checkWorkflowUrlHealth()
        startPollingWorkflowUrl()

        return () => {
            if (pollingRef.current) clearInterval(pollingRef.current)
            if (controllerRef.current) controllerRef.current.abort()
        }
    }, [currentApp?.app_type, checkWorkflowUrlHealth, startPollingWorkflowUrl])

    useEffect(() => {
        if (isConnectionRestored) {
            setCountdown(5)
            const timer = setInterval(() => {
                setCountdown((prevCountdown) => {
                    if (prevCountdown <= 1) {
                        clearInterval(timer)
                        setIsDown(false)
                        return 0
                    }
                    return prevCountdown - 1
                })
            }, 1000)

            return () => clearInterval(timer)
        }
    }, [isConnectionRestored])

    const retryWorkflowStatus = async () => {
        try {
            setIsRetryUrlHealthLoading(true)
            await checkWorkflowUrlHealth(true)
            startPollingWorkflowUrl()
        } catch (error) {
            message.error("Failed to restore connection")
        } finally {
            setIsRetryUrlHealthLoading(false)
        }
    }

    if (currentApp?.app_type === "custom" && isDown) {
        return (
            <Alert
                className={clsx(!isNewPlayground ? "m-6" : "m-2")}
                message={
                    isConnectionRestored ? "Connection restored" : "Unable to establish connection"
                }
                description={
                    isConnectionRestored
                        ? ""
                        : "Agenta is unable to communicate with your server. Try refreshing or consider re-configuring your workflow URL."
                }
                showIcon
                type={isConnectionRestored ? "success" : "warning"}
                action={
                    isConnectionRestored ? (
                        <Button size="small" onClick={() => setIsDown(false)}>
                            Close (auto closes in {countdown})
                        </Button>
                    ) : (
                        <Space direction="vertical">
                            <Button
                                icon={<ArrowClockwise size={14} />}
                                onClick={retryWorkflowStatus}
                                className="w-full"
                                type={isRetryUrlHealthLoading ? "dashed" : "primary"}
                                loading={isRetryUrlHealthLoading}
                            >
                                {isRetryUrlHealthLoading ? "Retrying" : "Retry"}
                            </Button>
                            <Button
                                icon={<PencilSimple size={14} />}
                                onClick={() => setIsCustomWorkflowModalOpen(true)}
                            >
                                Configure
                            </Button>
                        </Space>
                    )
                }
            />
        )
    }

    return null
}

export default CustomWorkflowBanner
