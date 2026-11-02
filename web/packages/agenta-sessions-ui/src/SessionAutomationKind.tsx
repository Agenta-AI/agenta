import {sessionAutomationKindLabel, type SessionAutomationVm} from "@agenta/sessions/row"
import clsx from "clsx"

export const SessionAutomationKind = ({
    kind,
    className,
}: {
    kind: SessionAutomationVm["kind"]
    className?: string
}) => (
    // Capped below `sm`: unshrinkable, it starved the title beside it down to ~10px.
    <span
        className={clsx(
            "max-w-[45%] shrink-0 truncate text-xs text-colorTextTertiary sm:max-w-none",
            className,
        )}
    >
        {sessionAutomationKindLabel(kind)}
    </span>
)
