import {sessionAutomationKindLabel, type SessionAutomationVm} from "@agenta/sessions/row"
import clsx from "clsx"

export const SessionAutomationKind = ({
    kind,
    className,
}: {
    kind: SessionAutomationVm["kind"]
    className?: string
}) => (
    <span className={clsx("shrink-0 text-xs text-colorTextTertiary", className)}>
        {sessionAutomationKindLabel(kind)}
    </span>
)
