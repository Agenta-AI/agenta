import {useCallback, useMemo, useRef, useState} from "react"

import {useToolIntegrationDetail} from "@agenta/entities/gatewayTool"
import {useT} from "@agenta/i18n"
import integrationViewsCatalog from "@agenta/i18n/catalogs/entityUi.integrationViews"
import {Button} from "@agenta/ui/ui"
import {useViewTitle, type ViewProps} from "@agenta/ui/view-stack"

import {readRunnerPermission} from "../../agentConfigPatch"
import {findIntegrationRow, integrationRowConnection} from "../../toolUtils"
import {IntegrationAccountBlock} from "../accounts/IntegrationAccountBlock"
import {
    IntegrationDrawerBody,
    IntegrationTitle,
    UnmigratedNotice,
} from "../IntegrationPermissionDrawer"
import {integrationTargetOf, removeIntegrationByRef} from "../itemKinds/tool"
import {RemoveFromAgentDialog} from "../RemoveFromAgentDialog"
import {useAgentConfigWriter} from "../useAgentConfigWriter"
import {useAgentTools} from "../useAgentTools"

import type {IntegrationViewParams} from "./integrationView"

const noCreate = () => undefined

const IntegrationViewBody = ({params, target, nav}: ViewProps<IntegrationViewParams>) => {
    const t = useT(integrationViewsCatalog)
    const revisionId = target.kind === "agent_draft" ? target.revisionId : ""
    const writer = useAgentConfigWriter(revisionId)
    const configRef = useRef(writer.agent)
    configRef.current = writer.agent
    const onChange = useCallback(
        (next: Record<string, unknown>) => writer.update(() => next),
        [writer],
    )
    const {
        integrationRows,
        setIntegrationAccount,
        setIntegrationPermissions,
        setIntegrationToolPermission,
    } = useAgentTools({config: writer.agent, onChange, configRef, openCreate: noCreate})
    const integrationTarget = integrationTargetOf(params.item)
    // Found by key in the list as it is now: a builder save that changes the list under the open
    // view never puts another integration here.
    const row = integrationTarget
        ? findIntegrationRow(integrationRows, integrationTarget)
        : undefined
    const {integration} = useToolIntegrationDetail(integrationTarget?.integration ?? "")
    const name = integration?.name || integrationTarget?.integration || ""
    useViewTitle(name)
    const accountContext = useMemo(
        () => ({revisionId, agent: writer.agent}),
        [revisionId, writer.agent],
    )
    const [confirming, setConfirming] = useState(false)

    if (!integrationTarget || !row) {
        return (
            <div className="flex flex-col items-start gap-3 px-4 py-6 text-sm">
                <span className="text-colorTextSecondary">
                    {t("entityUi.integrationViews.removedState")}
                </span>
                <Button variant="outline" size="sm" onClick={() => void nav.back()}>
                    {t("entityUi.integrationViews.back")}
                </Button>
            </div>
        )
    }

    const connectionSlug = integrationRowConnection(row) ?? ""
    const remove = () => {
        setConfirming(false)
        writer.update((agent) => ({
            ...agent,
            tools: removeIntegrationByRef(
                Array.isArray(agent.tools) ? (agent.tools as unknown[]) : [],
                params.item,
            ),
        }))
        void nav.back()
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 px-4 pb-1 pt-3">
                <IntegrationTitle target={integrationTarget} connectionSlug={connectionSlug} />
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
                {row.entry?.permissions ? (
                    <IntegrationDrawerBody
                        target={integrationTarget}
                        connectionSlug={connectionSlug}
                        permissions={row.entry.permissions}
                        onChangePermissions={(next) =>
                            setIntegrationPermissions(integrationTarget, next)
                        }
                        onChangeToolPermission={(toolKey, permission) =>
                            setIntegrationToolPermission(integrationTarget, toolKey, permission)
                        }
                        agentPolicy={readRunnerPermission(writer.agent)}
                        disabled={params.readOnly}
                        account={
                            row.entry ? (
                                <IntegrationAccountBlock
                                    target={integrationTarget}
                                    entry={row.entry}
                                    context={accountContext}
                                    onChange={(account) =>
                                        setIntegrationAccount(integrationTarget, account)
                                    }
                                    disabled={params.readOnly}
                                />
                            ) : undefined
                        }
                    />
                ) : (
                    <UnmigratedNotice target={integrationTarget} />
                )}
            </div>
            {params.readOnly ? null : (
                <div className="shrink-0 px-4 py-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-colorError"
                        onClick={() => setConfirming(true)}
                    >
                        {t("entityUi.integrationViews.removeFromAgent")}
                    </Button>
                </div>
            )}
            <RemoveFromAgentDialog
                open={confirming}
                name={name}
                description={t("entityUi.integrationViews.connectionStays")}
                onRemove={remove}
                onClose={() => setConfirming(false)}
            />
        </div>
    )
}

export default IntegrationViewBody
