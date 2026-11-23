import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import agentLayoutHeaderCatalog from "@agenta/i18n/catalogs/agentLayout.header"
import {BuilderIcon} from "@agenta/ui/agent-icon"
import {cn} from "@agenta/ui/styles"
import {Button, SimpleTooltip} from "@agenta/ui/ui"

import {useOpenAgentBuilder} from "../agent-layout/AgentPageBuilderHost"
import {NavDrawer} from "../nav/NavDrawer"

/**
 * The header of an agent page: a 48 px bar with the
 * page name at the left (on the content's edge when `column` is given), the page's own controls at the right, and the Builder icon at the far
 * right. The Builder icon shows only when the page can open the builder (`onOpenBuilder`).
 */
export const AgentPagesHeader = ({
    title,
    workspaceId,
    projectId,
    actions,
    onOpenBuilder: openBuilderProp,
    column,
}: {
    title: ReactNode
    workspaceId: string
    projectId: string
    /** The page's controls before the Builder icon (the Configuration page's version and save status). */
    actions?: ReactNode
    onOpenBuilder?: () => void
    /** The page's content column: the title starts on the content's left edge (ALIGN-01). */
    column?: string
}) => {
    const t = useT(agentLayoutHeaderCatalog)
    // Without the prop, the agent page builder host around the page opens it.
    const hostOpenBuilder = useOpenAgentBuilder()
    const onOpenBuilder = openBuilderProp ?? hostOpenBuilder ?? undefined
    return (
        <header
            data-testid="agent-pages-header"
            className={cn(
                "box-border flex h-12 shrink-0 items-center border-0 border-b border-solid border-border-muted bg-background",
                !column && "px-3",
            )}
        >
            <div className={cn("flex h-full min-w-0 flex-1 items-center gap-2", column)}>
                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                <h1 className="m-0 min-w-0 truncate text-heading text-foreground">{title}</h1>
                <div className="min-w-0 flex-1" />
                {actions}
                {actions && onOpenBuilder ? (
                    <span aria-hidden className="h-5 w-px shrink-0 bg-border-muted" />
                ) : null}
                {onOpenBuilder ? (
                    <SimpleTooltip title={t("agentLayout.header.builder")}>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("agentLayout.header.builder")}
                            className="shrink-0"
                            onClick={onOpenBuilder}
                        >
                            <BuilderIcon />
                        </Button>
                    </SimpleTooltip>
                ) : null}
            </div>
        </header>
    )
}
