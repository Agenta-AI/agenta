import {MessageOutlined} from "@ant-design/icons"
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
                            <span className="text-lg font-medium">No sessions found</span>
                            <span className="text-muted-foreground">
                                Try adjusting your filters or time range to view sessions.
                            </span>
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
                        <span className="text-lg font-medium">No sessions observed</span>
                        <span className="text-muted-foreground">
                            Sessions allow you to track multi-turn conversations with your LLM
                            application including the intermediate steps.
                        </span>
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
