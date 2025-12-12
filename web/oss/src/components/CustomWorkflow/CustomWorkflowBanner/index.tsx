import {PencilSimple} from "@phosphor-icons/react"
import {Alert, Button, Card, Space, Typography} from "antd"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import useCustomWorkflowConfig from "@/oss/components/pages/app-management/modals/CustomWorkflowModal/hooks/useCustomWorkflowConfig"
import {customWorkflowBannerVisibleAtom} from "@/oss/state/variant/atoms/appStatus"

import {CustomWorkflowBannerProps} from "./types"

const CustomWorkflowBanner = ({
    showInPlayground = false,
    layout = "banner",
}: CustomWorkflowBannerProps) => {
    const showBanner = useAtomValue(customWorkflowBannerVisibleAtom)
    const {openModal} = useCustomWorkflowConfig({configureWorkflow: true})
    const router = useRouter()
    const isPlaygroundPath =
        router.pathname.includes("/playground") || router.pathname.includes("/evaluations/results")

    if (showBanner && (showInPlayground || !isPlaygroundPath)) {
        if (layout === "card") {
            return (
                <main className="flex flex-col grow h-full overflow-hidden items-center justify-center">
                    <Card className="max-w-[520px] w-[90%] text-center">
                        <Typography.Title level={3} className="!mb-2">
                            Unable to establish connection
                        </Typography.Title>
                        <Typography.Paragraph type="secondary" className="!mb-4">
                            Agenta is unable to communicate with your server. Try refreshing or
                            re-configure your workflow URL.
                        </Typography.Paragraph>
                        <Space direction="horizontal" align="center">
                            <Button icon={<PencilSimple size={14} />} onClick={() => openModal()}>
                                Configure
                            </Button>
                        </Space>
                    </Card>
                </main>
            )
        }

        return (
            <Alert
                className="m-2"
                message={"Unable to establish connection"}
                description={
                    "Agenta is unable to communicate with your server. Try refreshing or consider re-configuring your workflow URL."
                }
                showIcon
                type={"warning"}
                action={
                    <Space direction="vertical">
                        <Button icon={<PencilSimple size={14} />} onClick={() => openModal()}>
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
