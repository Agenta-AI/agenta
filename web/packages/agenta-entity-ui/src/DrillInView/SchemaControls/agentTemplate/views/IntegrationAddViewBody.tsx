import {useCallback, useEffect, useMemo, useRef} from "react"

import {personalAccountsAccessAtom} from "@agenta/entities/secret"
import {invalidateAgentRequirements} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import integrationDrawerCatalog from "@agenta/i18n/catalogs/entityUi.integrationDrawer"
import toolCatalogCatalog from "@agenta/i18n/catalogs/entityUi.toolCatalog"
import {useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"

import type {CreatedConnection} from "../../../../gatewayTool/components/ConnectForm"
import {
    IntegrationCatalog,
    type IntegrationCatalogAdding,
    type IntegrationCatalogProps,
} from "../IntegrationCatalog"
import {useAgentConfigWriter} from "../useAgentConfigWriter"
import {useAgentTools} from "../useAgentTools"

import type {IntegrationAddViewParams} from "./integrationAddView"
import {integrationConnectView} from "./integrationConnectView"

const noCreate = () => undefined

/** Adds apps to the agent: the agent configuration's rows and writes. */
const useAgentAdding = (revisionId: string): IntegrationCatalogAdding => {
    const writer = useAgentConfigWriter(revisionId)
    const configRef = useRef(writer.agent)
    configRef.current = writer.agent
    const onChange = useCallback(
        (next: Record<string, unknown>) => writer.update(() => next),
        [writer],
    )
    const {integrationRows, setIntegrationConnection, addPersonalIntegration} = useAgentTools({
        config: writer.agent,
        onChange,
        configRef,
        openCreate: noCreate,
    })
    return useMemo(
        () => ({
            integrationRows,
            onAddIntegration: setIntegrationConnection,
            onAddPersonalIntegration: addPersonalIntegration,
        }),
        [integrationRows, setIntegrationConnection, addPersonalIntegration],
    )
}

/** The catalog with an agent: a click on a connected app adds it. */
const AgentCatalog = ({
    revisionId,
    onConnect,
}: {
    revisionId: string
    onConnect: IntegrationCatalogProps["onConnect"]
}) => <IntegrationCatalog adding={useAgentAdding(revisionId)} onConnect={onConnect} />

const IntegrationAddViewBody = ({target, nav}: ViewProps<IntegrationAddViewParams>) => {
    const t = useT(integrationDrawerCatalog, toolCatalogCatalog)
    const forAgent = target.kind === "agent_draft"
    useViewTitle(
        forAgent
            ? t("entityUi.integrationDrawer.addIntegration")
            : t("entityUi.toolCatalog.browseIntegrations"),
    )
    // A sign-in here can fix a tagged integration without a new revision: check again on leaving.
    useEffect(() => () => void invalidateAgentRequirements(), [])
    // With personal accounts on, Connect asks "Who can use it", as Settings does.
    const askOwner = useAtomValue(personalAccountsAccessAtom) === "on"
    const {push} = nav
    const connect = useCallback(
        (integrationKey: string, onCreated: (created: CreatedConnection) => void) => {
            void push?.(
                integrationConnectView,
                {integrationKey, owners: askOwner ? ["user", "project"] : undefined, onCreated},
                {kind: "project"},
            )
        },
        [push, askOwner],
    )
    return (
        <div className="flex min-h-0 flex-1 flex-col pt-3">
            {forAgent ? (
                <AgentCatalog revisionId={target.revisionId} onConnect={connect} />
            ) : (
                // No agent here (chat, playground, prompts): browse and connect only.
                <IntegrationCatalog onConnect={connect} />
            )}
        </div>
    )
}

export default IntegrationAddViewBody
