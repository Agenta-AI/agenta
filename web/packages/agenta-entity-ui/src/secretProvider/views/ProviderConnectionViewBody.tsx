/**
 * One provider connection as a form view. The form is the connection card: it reports whether it
 * has edits (`dirty`) and saves through `submit`, which resolves when the connection is stored.
 * Save writes the project's connection, refreshes the vault, then the stack goes back to the list.
 */
import {useCallback, useContext, useMemo, useRef, useState} from "react"

import {
    isOrganizationConnection,
    providerConnectionsAtom,
    providerTitleForKind,
    refreshVaultSecretsAtom,
} from "@agenta/entities/secret"
import {invalidateAgentRequirements} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import providerListCatalog from "@agenta/i18n/catalogs/entityUi.providerList"
import {useViewForm, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {useAtomValue, useSetAtom, useStore} from "jotai"

import ProviderConnectionCard, {type ProviderCardSaveState} from "../ProviderConnectionCard"
import {providerDisplayTitle} from "../providerFieldText"

import {ProviderOwnerChoiceContext} from "./providerOwnerChoice"
import {providerSaveFollowUpAtom} from "./providerSaveFollowUp"
import type {ProviderConnectionViewParams} from "./providerViews"

const ProviderConnectionViewBody = ({params}: ViewProps<ProviderConnectionViewParams>) => {
    const t = useT(providerListCatalog)
    const connections = useAtomValue(providerConnectionsAtom)
    const own = useMemo(
        () => connections.filter((connection) => !isOrganizationConnection(connection)),
        [connections],
    )
    const connection = params.connectionId
        ? (own.find((candidate) => candidate.id === params.connectionId) ?? null)
        : null
    const ownerChoiceFor = useContext(ProviderOwnerChoiceContext)
    const refreshVault = useSetAtom(refreshVaultSecretsAtom)
    const store = useStore()
    useViewTitle(
        connection?.name ?? providerDisplayTitle(params.kind, providerTitleForKind(params.kind)),
    )

    const [card, setCard] = useState<ProviderCardSaveState | null>(null)
    // The id the save stored, for the model picker's follow-up.
    const savedId = useRef<string | undefined>(undefined)
    const onSaved = useCallback((id?: string) => {
        savedId.current = id
        // A new key can fix an agent that needs setup, without a new version.
        void invalidateAgentRequirements()
    }, [])

    useViewForm({
        dirty: card?.dirty ?? false,
        valid: card?.canSave ?? false,
        leaveDescription: t("entityUi.providerList.formLeaveDescription"),
        saveLabel: t("entityUi.providerList.saveConnection"),
        save: async () => {
            if (!card || !(await card.submit())) return false
            // A project save does not refresh the vault by itself; the list and the picker
            // read it.
            await refreshVault()
            // The model picker that sent the person here switches a new local agent to the new
            // connection's model, as the provider drawer's save did.
            const followUp = store.get(providerSaveFollowUpAtom)
            if (followUp) {
                store.set(providerSaveFollowUpAtom, null)
                void followUp.run(savedId.current)
            }
            return true
        },
    })

    return (
        <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
            <ProviderConnectionCard
                key={connection?.id ?? params.kind}
                kind={params.kind}
                connection={connection}
                connections={own}
                ownerChoice={connection ? undefined : (ownerChoiceFor?.(params.kind) ?? undefined)}
                onSaveStateChange={setCard}
                onSaved={onSaved}
            />
        </div>
    )
}

export default ProviderConnectionViewBody
