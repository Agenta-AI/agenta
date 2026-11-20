/** The subagent view's link to the agent it calls. It takes the bridge as a required prop and
 *  mounts only when the host supplies one, so it never calls a hook conditionally. */
import {useT} from "@agenta/i18n"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import type {WorkflowReferenceBridge} from "@agenta/ui/drill-in"
import {Button} from "@agenta/ui/ui"

/** "Open agent": the subagent's own agent screen, in a new tab as in production. */
export function SubagentOpenAgentButton({
    bridge,
    slug,
}: {
    bridge: WorkflowReferenceBridge
    slug: string
}) {
    const t = useT(configItemsCatalog)
    const {detail} = bridge.useSubagentDetail(slug)
    const href = detail?.workflowId ? (bridge.agentHref?.(detail.workflowId) ?? null) : null
    if (!href) return null
    return (
        <Button variant="outline" size="sm" asChild>
            {/* no-underline: a bare anchor picks up the app's link styling inside a button. */}
            <a href={href} target="_blank" rel="noreferrer" className="no-underline">
                {t("entityUi.configItems.openAgent")}
            </a>
        </Button>
    )
}
