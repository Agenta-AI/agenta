import {useCallback, useEffect, useRef} from "react"

import {personalAccountsAccessAtom} from "@agenta/entities/secret"
import {invalidateAgentRequirements} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import integrationDrawerCatalog from "@agenta/i18n/catalogs/entityUi.integrationDrawer"
import {useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"

import type {CreatedConnection} from "../../../../gatewayTool/components/ConnectForm"
import {IntegrationCatalog} from "../IntegrationCatalog"
import {useAgentConfigWriter} from "../useAgentConfigWriter"
import {useAgentTools} from "../useAgentTools"

import type {IntegrationAddViewParams} from "./integrationAddView"
import {integrationConnectView} from "./integrationConnectView"

const noCreate = () => undefined

const IntegrationAddViewBody = ({target, nav}: ViewProps<IntegrationAddViewParams>) => {
    const t = useT(integrationDrawerCatalog)
    useViewTitle(t("entityUi.integrationDrawer.addIntegration"))
    // A sign-in here can fix a tagged integration without a new revision: check again on leaving.
    useEffect(() => () => void invalidateAgentRequirements(), [])
    const writer = useAgentConfigWriter(target.kind === "agent_draft" ? target.revisionId : "")
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
            <IntegrationCatalog
                integrationRows={integrationRows}
                onAddIntegration={setIntegrationConnection}
                onAddPersonalIntegration={addPersonalIntegration}
                onConnect={connect}
            />
        </div>
    )
}

export default IntegrationAddViewBody
