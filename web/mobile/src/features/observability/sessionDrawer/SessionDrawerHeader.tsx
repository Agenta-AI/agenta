import {useT} from "@agenta/i18n"
import sessionCatalog from "@agenta/i18n/catalogs/observability.sessionDrawer"
import {useSessions} from "@agenta/observability"
import {CopyTooltip} from "@agenta/ui/copy-tooltip"
import {Badge, Button} from "@agenta/ui/ui"
import {ArrowsIn, ArrowsOut, CaretDown, CaretUp, X} from "@phosphor-icons/react"
import {useAtom} from "jotai"

import {observabilitySessionAnnotationsVisibleAtom} from "./sessionDrawerPreferences"

interface SessionDrawerHeaderProps {
    sessionId: string
    onSelectSession: (sessionId: string) => void
    onClose: () => void
    /** Hidden when the panel is already as wide as the screen. */
    showWidthToggle: boolean
    expanded: boolean
    onToggleWidth: () => void
}

/**
 * Move through the sessions on screen, name the open one, and choose whether the annotations
 * column shows. Previous and next walk the rows of the list behind the drawer, in its order.
 */
export const SessionDrawerHeader = ({
    sessionId,
    onSelectSession,
    onClose,
    showWidthToggle,
    expanded,
    onToggleWidth,
}: SessionDrawerHeaderProps) => {
    const t = useT(sessionCatalog)
    const {sessionIds} = useSessions()
    const [annotationsVisible, setAnnotationsVisible] = useAtom(
        observabilitySessionAnnotationsVisibleAtom,
    )
    const index = sessionIds.indexOf(sessionId)
    const previous = index > 0 ? sessionIds[index - 1] : null
    const next = index !== -1 && index < sessionIds.length - 1 ? sessionIds[index + 1] : null

    return (
        <div className="flex flex-wrap items-center gap-2 border-0 border-b border-solid border-border px-4 py-3">
            {showWidthToggle ? (
                <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={onToggleWidth}
                    aria-label={
                        expanded
                            ? t("observability.sessionDrawer.makeNarrower")
                            : t("observability.sessionDrawer.makeWider")
                    }
                >
                    {expanded ? <ArrowsIn size={14} /> : <ArrowsOut size={14} />}
                </Button>
            ) : null}
            <Button
                variant="ghost"
                size="icon-sm"
                disabled={previous === null}
                onClick={() => previous !== null && onSelectSession(previous)}
                aria-label={t("observability.sessionDrawer.previousSession")}
            >
                <CaretUp size={14} />
            </Button>
            <Button
                variant="ghost"
                size="icon-sm"
                disabled={next === null}
                onClick={() => next !== null && onSelectSession(next)}
                aria-label={t("observability.sessionDrawer.nextSession")}
            >
                <CaretDown size={14} />
            </Button>
            <span className="text-sm font-medium text-foreground">
                {t("observability.sessionDrawer.session")}
            </span>
            <CopyTooltip
                copyText={sessionId}
                title={t("observability.sessionDrawer.copySessionId")}
            >
                <Badge className="max-w-full min-w-0 cursor-pointer font-mono">
                    <span className="truncate"># {sessionId}</span>
                </Badge>
            </CopyTooltip>
            <div className="ml-auto flex shrink-0 items-center gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAnnotationsVisible(!annotationsVisible)}
                >
                    {annotationsVisible
                        ? t("observability.sessionDrawer.hideAnnotations")
                        : t("observability.sessionDrawer.showAnnotations")}
                </Button>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={onClose}
                    aria-label={t("observability.sessionDrawer.close")}
                >
                    <X size={14} />
                </Button>
            </div>
        </div>
    )
}
