import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import agentLayoutHeaderCatalog from "@agenta/i18n/catalogs/agentLayout.header"
import {BuilderIcon} from "@agenta/ui/agent-icon"
import {Button, SimpleTooltip} from "@agenta/ui/ui"

import {useOpenAgentBuilder} from "../agent-layout/AgentPageBuilderHost"
import {NavDrawer} from "../nav/NavDrawer"

/**
 * The header of an agent page: a 48 px bar with the
 * page name at the left, the page's own controls at the right, and the Builder icon at the far
 * right. The Builder icon shows only when the page can open the builder (`onOpenBuilder`).
 */
export const AgentPagesHeader = ({
    title,
    workspaceId,
    projectId,
    actions,
    onOpenBuilder: openBuilderProp,
}: {
    title: ReactNode
    workspaceId: string
    projectId: string
    /** The page's controls before the Builder icon (the Configuration page's version and save status). */
    actions?: ReactNode
    onOpenBuilder?: () => void
}) => {
    const t = useT(agentLayoutHeaderCatalog)
    // Without the prop, the agent page builder host around the page opens it.
    const hostOpenBuilder = useOpenAgentBuilder()
    const onOpenBuilder = openBuilderProp ?? hostOpenBuilder ?? undefined
    return (
        <header
            data-testid="agent-pages-header"
            className="box-border flex h-12 shrink-0 items-center gap-2 border-0 border-b border-solid border-colorBorderSecondary bg-background px-3"
        >
            <NavDrawer workspaceId={workspaceId} projectId={projectId} />
            <h1 className="m-0 min-w-0 truncate text-[15px] font-semibold leading-5 text-foreground">
                {title}
            </h1>
            <div className="min-w-0 flex-1" />
            {actions}
            {actions && onOpenBuilder ? (
                <span aria-hidden className="h-5 w-px shrink-0 bg-colorBorderSecondary" />
            ) : null}
            {onOpenBuilder ? (
                <SimpleTooltip title={t("agentLayout.header.builder")}>
                    <Button
                        variant="ghost"
                        size="icon-compact"
                        aria-label={t("agentLayout.header.builder")}
                        // The header's icon buttons are 32 px (A04).
                        className="size-8 shrink-0"
                        onClick={onOpenBuilder}
                    >
                        <BuilderIcon />
                    </Button>
                </SimpleTooltip>
            ) : null}
        </header>
    )
}
