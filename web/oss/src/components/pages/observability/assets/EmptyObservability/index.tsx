import {memo} from "react"
import EmptyComponent from "@/oss/components/EmptyComponent"
import {SwapOutlined} from "@ant-design/icons"
import {useRouter} from "next/router"
import {useAppId} from "@/oss/hooks/useAppId"

const EmptyObservability = () => {
    const router = useRouter()
    const appId = useAppId()

    return (
        <div className="py-16">
            <EmptyComponent
                image={
                    <SwapOutlined style={{transform: "rotate(90deg)"}} className="text-[32px]" />
                }
                description="Monitor the performance and results of your LLM applications here."
                primaryCta={{
                    text: appId ? "Go to Playground" : "Create an Application",
                    onClick: () => router.push(appId ? `/apps/${appId}/playground` : "/apps"),
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
