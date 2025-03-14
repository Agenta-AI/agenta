import {useCallback, useEffect, useRef, useState} from "react"

import {ArrowClockwise, PencilSimple} from "@phosphor-icons/react"
import {Alert, Button, Space} from "antd"
import clsx from "clsx"

import {useAppsData} from "@/oss/contexts/app.context"

import {findCustomWorkflowPath} from "../NewPlayground/hooks/usePlayground/assets/helpers"

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

    const checkWorkflowUrlHealth = useCallback(async () => {
        if (controllerRef.current) {
            controllerRef.current.abort()
        }

        const controller = new AbortController()
        controllerRef.current = controller

        try {
            const {status} = (await findCustomWorkflowPath(variant?.uri || "", "/health")) || {}
            if (!status) throw new Error("Unable to establish connection")
            setIsDown(false)
        } catch (error: any) {
            if (error.name !== "AbortError") {
                setIsDown(true)
            }
        }
    }, [variant?.uri])

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

    const retryWorkflowStatus = () => {
        checkWorkflowUrlHealth()
        startPollingWorkflowUrl()
    }

    if (currentApp?.app_type === "custom" && isDown) {
        return (
            <Alert
                className={clsx(!isNewPlayground ? "m-6" : "m-2")}
                message="Unable to establish connection"
                description="Agenta is unable to communicate with your server. Try refreshing or consider re-configuring your workflow URL."
                showIcon
                type="warning"
                action={
                    <Space direction="vertical">
                        <Button
                            icon={<ArrowClockwise size={14} />}
                            onClick={retryWorkflowStatus}
                            className="w-full"
                            type="primary"
                        >
                            Retry
                        </Button>
                        <Button
                            icon={<PencilSimple size={14} />}
                            onClick={() => setIsCustomWorkflowModalOpen(true)}
                        >
                            Configure
                        </Button>
                    </Space>
                }
            />
        )
    }

    return null
}

export default CustomWorkflowBanner
