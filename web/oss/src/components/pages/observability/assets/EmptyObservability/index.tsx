import {memo} from "react"

import {SwapOutlined} from "@ant-design/icons"
import {useRouter} from "next/router"

import EmptyComponent from "@/oss/components/EmptyComponent"
import {useAppId} from "@/oss/hooks/useAppId"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import useURL from "@/oss/hooks/useURL"

const EmptyObservability = () => {
    const router = useRouter()
    const appId = useAppId()
    const {baseAppURL} = useURL()
    const {goToPlayground} = usePlaygroundNavigation()

    return (
        <div className="py-16">
            <EmptyComponent
                image={
                    <SwapOutlined style={{transform: "rotate(90deg)"}} className="text-[32px]" />
                }
                description="Monitor the performance and results of your LLM applications here."
                primaryCta={{
                    text: appId ? "Go to Playground" : "Create an Application",
                    onClick: () => (appId ? goToPlayground() : router.push(baseAppURL)),
                    tooltip: "Run your LLM app in the playground to generate and view insights.",
                }}
                secondaryCta={{
                    text: "Learn More",
                    onClick: () => router.push("https://docs.agenta.ai/observability/quickstart"),
                    tooltip:
                        "Explore more about tracking and analyzing your app's observability data.",
                }}
            />
        </div>
    )
}

export default memo(EmptyObservability)
