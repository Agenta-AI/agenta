import {
    Alert,
    AlertTitle,
    AlertDescription,
    AlertAction,
} from "@agenta/primitive-ui/components/alert"
import {Button} from "@agenta/primitive-ui/components/button"
import {Card, CardContent} from "@agenta/primitive-ui/components/card"
import {PencilSimple} from "@phosphor-icons/react"
import {Warning} from "@phosphor-icons/react"
import {Space} from "antd"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import useCustomWorkflowConfig from "@/oss/components/pages/app-management/modals/CustomWorkflowModal/hooks/useCustomWorkflowConfig"

import {customWorkflowBannerVisibleAtom} from "./atoms"
import {CustomWorkflowBannerProps} from "./types"

const CustomWorkflowBanner = ({
    showInPlayground = false,
    layout = "banner",
}: CustomWorkflowBannerProps) => {
    const showBanner = useAtomValue(customWorkflowBannerVisibleAtom)
    const {openModal} = useCustomWorkflowConfig({})
    const router = useRouter()
    const isPlaygroundPath =
        router.pathname.includes("/playground") || router.pathname.includes("/evaluations/results")

    if (showBanner && (showInPlayground || !isPlaygroundPath)) {
        if (layout === "card") {
            return (
                <main className="flex flex-col grow h-full overflow-hidden items-center justify-center">
                    <Card className="max-w-[520px] w-[90%] text-center">
                        <CardContent>
                            <h3 className="!mb-2 text-lg font-semibold leading-snug">
                                Unable to establish connection
                            </h3>
                            <p className="!mb-4 text-muted-foreground">
                                Agenta is unable to communicate with your server. Try refreshing or
                                re-configure your workflow URL.
                            </p>
                            <Space orientation="horizontal" align="center">
                                <Button onClick={() => openModal()} variant="outline">
                                    {<PencilSimple size={14} />}
                                    Configure
                                </Button>
                            </Space>
                        </CardContent>
                    </Card>
                </main>
            )
        }

        return (
            <Alert variant="warning" icon={<Warning size={16} />} className="m-2">
                <AlertTitle>Unable to establish connection</AlertTitle>
                <AlertDescription>
                    Agenta is unable to communicate with your server. Try refreshing or consider
                    re-configuring your workflow URL.
                </AlertDescription>
                <AlertAction>
                    <Button onClick={() => openModal()} variant="outline" size="sm">
                        <PencilSimple size={14} />
                        Configure
                    </Button>
                </AlertAction>
            </Alert>
        )
    }

    return null
}

export default CustomWorkflowBanner
