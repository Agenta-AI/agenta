import {queryTriggerDeliveries, type TriggerDelivery} from "@agenta/entities/gatewayTrigger"
import {CheckCircleIcon, WarningCircleIcon} from "@phosphor-icons/react"
import {useQuery} from "@tanstack/react-query"
import {Skeleton, Tooltip} from "antd"
import {useAtomValue} from "jotai"

import {timeAgo} from "@/oss/components/AgentChatSlice/state/sessions"
import {projectIdAtom} from "@/oss/state/project"

const failed = (delivery: TriggerDelivery) => Boolean(delivery.data?.error)

/**
 * What the automations actually did, most recent first.
 *
 * Deliberately runs that have HAPPENED rather than a schedule of what's next: a completed run may
 * need attention, an upcoming one never does. Sourced from trigger deliveries, which are already
 * project-scoped and windowed — a delivery does not yet carry the session it produced, so these
 * rows are not clickable through to a transcript.
 */
const HomeAutomationsSection = () => {
    const projectId = useAtomValue(projectIdAtom) ?? ""

    const {data, isPending} = useQuery({
        queryKey: ["home", "trigger-deliveries", projectId],
        queryFn: () => queryTriggerDeliveries(),
        enabled: Boolean(projectId),
        staleTime: 60_000,
    })

    const deliveries = (data?.deliveries ?? []).slice(0, 5)
    if (!isPending && deliveries.length === 0) return null

    return (
        <section>
            <h3 className="m-0 mb-2 text-xs font-medium text-colorText">Recent automation runs</h3>

            {isPending ? (
                <Skeleton active paragraph={{rows: 3}} title={false} />
            ) : (
                deliveries.map((delivery) => (
                    <div
                        key={delivery.id}
                        className="flex items-center gap-3 border-0 border-b border-solid border-colorBorderSecondary px-2 py-2"
                    >
                        {failed(delivery) ? (
                            <WarningCircleIcon size={14} className="shrink-0 text-colorError" />
                        ) : (
                            <CheckCircleIcon size={14} className="shrink-0 text-colorSuccess" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-xs text-colorText">
                            {delivery.data?.event_key || "Automation run"}
                        </span>
                        {failed(delivery) ? (
                            <Tooltip title={delivery.data?.error}>
                                <span className="shrink-0 text-xs text-colorError">Failed</span>
                            </Tooltip>
                        ) : null}
                        <span className="shrink-0 text-xs text-colorTextTertiary">
                            {delivery.created_at ? timeAgo(Date.parse(delivery.created_at)) : "—"}
                        </span>
                    </div>
                ))
            )}
        </section>
    )
}

export default HomeAutomationsSection
