import {filtersAtom, sortAtom} from "@agenta/observability"
import {EmptyPlaceholder} from "@agenta/ui/components/presentational"
import {ChatCircleIcon} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

const SESSIONS_DOCS_URL =
    "https://agenta.ai/docs/observability/trace-with-python-sdk/track-chat-sessions"

export const EmptySessions = ({showOnboarding = true}: {showOnboarding?: boolean}) => {
    const filters = useAtomValue(filtersAtom)
    const sort = useAtomValue(sortAtom)

    const isFiltered = filters.length > 0 || sort?.customRange
    const icon = <ChatCircleIcon size={32} className="text-colorTextQuaternary" />

    if (isFiltered || !showOnboarding) {
        return (
            <div className="py-16">
                <EmptyPlaceholder
                    image={icon}
                    description={
                        <div className="flex flex-col gap-2">
                            <span className="text-lg font-medium text-colorText">
                                No sessions found
                            </span>
                            <span className="text-colorTextSecondary">
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
            <EmptyPlaceholder
                image={icon}
                description={
                    <div className="flex flex-col gap-2">
                        <span className="text-lg font-medium text-colorText">
                            No sessions observed
                        </span>
                        <span className="text-colorTextSecondary">
                            Sessions allow you to track multi-turn conversations with your LLM
                            application including the intermediate steps.
                        </span>
                    </div>
                }
                primaryCta={{
                    size: "middle",
                    text: "Getting started with sessions",
                    onClick: () => window.open(SESSIONS_DOCS_URL, "_blank"),
                }}
            />
        </div>
    )
}

export default EmptySessions
