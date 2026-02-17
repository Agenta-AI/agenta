import {MessageOutlined} from "@ant-design/icons"
import {Typography} from "antd"
import {useAtomValue} from "jotai"

import EmptyComponent from "@/oss/components/Placeholders/EmptyComponent"
import {filtersAtom, sortAtom} from "@/oss/state/newObservability/atoms/controls"

interface EmptySessionsProps {
    showOnboarding?: boolean
}

const EmptySessions = ({showOnboarding = true}: EmptySessionsProps) => {
    const filters = useAtomValue(filtersAtom)
    const sort = useAtomValue(sortAtom)

    const isFiltered = filters.length > 0 || sort?.customRange

    if (isFiltered || !showOnboarding) {
        return (
            <div className="py-16">
                <EmptyComponent
                    image={<MessageOutlined style={{fontSize: 32, color: "#d9d9d9"}} />}
                    description={
                        <div className="flex flex-col gap-2">
                            <Typography.Text className="text-lg font-medium">
                                No sessions found
                            </Typography.Text>
                            <Typography.Text type="secondary">
                                Try adjusting your filters or time range to view sessions.
                            </Typography.Text>
                        </div>
                    }
                />
            </div>
        )
    }

    return (
        <div className="py-16">
            <EmptyComponent
                image={<MessageOutlined style={{fontSize: 32, color: "#d9d9d9"}} />}
                description={
                    <div className="flex flex-col gap-2">
                        <Typography.Text className="text-lg font-medium">
                            No sessions observed
                        </Typography.Text>
                        <Typography.Text type="secondary">
                            Sessions allow you to track multi-turn conversations with your LLM
                            application including the intermediate steps.
                        </Typography.Text>
                    </div>
                }
                primaryCta={{
                    size: "middle",
                    text: "Getting started with sessions",
                    onClick: () =>
                        window.open(
                            "https://agenta.ai/docs/observability/trace-with-python-sdk/track-chat-sessions",
                            "_blank",
                        ),
                }}
            />
        </div>
    )
}

export default EmptySessions
