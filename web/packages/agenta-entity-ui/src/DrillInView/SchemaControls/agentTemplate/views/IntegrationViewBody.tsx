import {useCallback, useMemo, useRef, useState} from "react"

import {USER_ACCOUNT_SOURCE} from "@agenta/entities/accountChoice"
import {usePersonalToolConnections, useToolIntegrationDetail} from "@agenta/entities/gatewayTool"
import {personalAccountsAccessAtom} from "@agenta/entities/secret"
import {useT} from "@agenta/i18n"
import integrationViewsCatalog from "@agenta/i18n/catalogs/entityUi.integrationViews"
import {Button} from "@agenta/ui/ui"
import {useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"

import {personalConnectionsFor} from "../../../../accounts/personalAccounts"
import {readRunnerPermission} from "../../agentConfigPatch"
import {
    findIntegrationRow,
    integrationRowConnection,
    setGatewayConnectionAccount,
} from "../../toolUtils"
import {IntegrationAccountBlock} from "../accounts/IntegrationAccountBlock"
import {
    IntegrationDrawerBody,
    IntegrationTitle,
    UnmigratedNotice,
} from "../IntegrationPermissionList"
import {integrationTargetOf, removeIntegrationByRef} from "../itemKinds/tool"
import {IntegrationRemoveDialog} from "../sections/IntegrationsSection"
import {useAgentConfigWriter} from "../useAgentConfigWriter"
import {useAgentTools} from "../useAgentTools"

import {integrationConnectView} from "./integrationConnectView"
import type {IntegrationViewParams} from "./integrationView"

const noCreate = () => undefined

const IntegrationViewBody = ({params, target, nav}: ViewProps<IntegrationViewParams>) => {
    const t = useT(integrationViewsCatalog)
    const writer = useAgentConfigWriter(target.kind === "agent_draft" ? target.revisionId : "")
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
    const integrationTarget = useMemo(() => integrationTargetOf(params.item), [params.item])
    // Found by key in the list as it is now: a builder save that changes the list under the open
    // view never puts another integration here.
    const row = integrationTarget
        ? findIntegrationRow(integrationRows, integrationTarget)
        : undefined
    const {integration} = useToolIntegrationDetail(integrationTarget?.integration ?? "")
    const name = integration?.name || integrationTarget?.integration || ""
    useViewTitle(name)
    const accountContext = useMemo(
        () => ({revisionId: writer.revisionId, agent: writer.agent}),
        [writer.revisionId, writer.agent],
    )
    const [confirming, setConfirming] = useState(false)
    const access = useAtomValue(personalAccountsAccessAtom)
    const {connections: personal} = usePersonalToolConnections()
    const {push} = nav
    // The connect view can return after auto-save replaced the revision: write through the latest.
    const writerRef = useRef(writer)
    writerRef.current = writer
    // Connect from the account part: the viewer's own account, or a shared one the agent then uses.
    const connect = useCallback(
        (owner: "user" | "project") => {
            if (!integrationTarget) return
            void push?.(
                integrationConnectView,
                {
                    integrationKey: integrationTarget.integration,
                    owners: [owner],
                    onCreated: (created) => {
                        if (created.owner !== "project") return
                        writerRef.current.update((agent) => ({
                            ...agent,
                            tools: setGatewayConnectionAccount(
                                Array.isArray(agent.tools) ? (agent.tools as unknown[]) : [],
                                integrationTarget,
                                {accountSource: "agent", slug: created.slug},
                            ),
                        }))
                    },
                },
                {kind: "project"},
            )
        },
        [push, integrationTarget],
    )

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
    const eachPerson = row.entry?.accountSource === USER_ACCOUNT_SOURCE
    const notConnected =
        eachPerson &&
        access === "on" &&
        personalConnectionsFor(personal, integrationTarget).length === 0
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
                <IntegrationTitle
                    target={integrationTarget}
                    connectionSlug={eachPerson ? "" : connectionSlug}
                    notConnected={notConnected}
                />
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
                        disabled={writer.readOnly}
                        account={
                            row.entry ? (
                                <IntegrationAccountBlock
                                    target={integrationTarget}
                                    entry={row.entry}
                                    context={accountContext}
                                    onChange={(account) =>
                                        setIntegrationAccount(integrationTarget, account)
                                    }
                                    onConnect={connect}
                                    disabled={writer.readOnly}
                                />
                            ) : undefined
                        }
                    />
                ) : (
                    <UnmigratedNotice target={integrationTarget} />
                )}
            </div>
            {writer.readOnly ? null : (
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
            {confirming ? (
                <IntegrationRemoveDialog
                    row={row}
                    onRemove={remove}
                    onClose={() => setConfirming(false)}
                />
            ) : null}
        </div>
    )
}

export default IntegrationViewBody
