import {useT} from "@agenta/i18n"
import emptyCatalog from "@agenta/i18n/catalogs/observabilityUi.empty"
import {filtersAtom, sortAtom} from "@agenta/observability"
import {EmptyState} from "@agenta/ui/composed"
import {Button} from "@agenta/ui/ui"
import {ChatCircleIcon} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

const SESSIONS_DOCS_URL =
    "https://agenta.ai/docs/observability/trace-with-python-sdk/track-chat-sessions"

export const EmptySessions = ({showOnboarding = true}: {showOnboarding?: boolean}) => {
    const t = useT(emptyCatalog)
    const filters = useAtomValue(filtersAtom)
    const sort = useAtomValue(sortAtom)

    const isFiltered = filters.length > 0 || sort?.customRange
    const icon = <ChatCircleIcon size={32} className="text-muted-foreground" />

    if (isFiltered || !showOnboarding) {
        return (
            <div className="py-16">
                <EmptyState
                    image={icon}
                    description={
                        <div className="flex flex-col gap-2">
                            <span className="text-title text-foreground">
                                {t("observabilityUi.empty.noSessionsFound")}
                            </span>
                            <span className="text-muted-foreground">
                                {t("observabilityUi.empty.adjustSessions")}
                            </span>
                        </div>
                    }
                />
            </div>
        )
    }

    return (
        <div className="py-16">
            <EmptyState
                image={icon}
                description={
                    <div className="flex flex-col gap-2">
                        <span className="text-title text-foreground">
                            {t("observabilityUi.empty.noSessionsObserved")}
                        </span>
                        <span className="text-muted-foreground">
                            {t("observabilityUi.empty.sessionsDescription")}
                        </span>
                    </div>
                }
            >
                <Button
                    onClick={() => window.open(SESSIONS_DOCS_URL, "_blank", "noopener,noreferrer")}
                >
                    {t("observabilityUi.empty.gettingStartedSessions")}
                </Button>
            </EmptyState>
        </div>
    )
}

export default EmptySessions
