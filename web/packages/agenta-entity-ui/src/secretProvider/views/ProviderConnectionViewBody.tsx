/**
 * One provider connection as a form view. The form is the connection card: it reports whether it
 * has edits (`dirty`) and saves through `submit`, which resolves when the connection is stored.
 * Save writes the project's connection, then the stack goes back to the list.
 */
import {useCallback, useContext, useMemo, useState} from "react"

import {
    isOrganizationConnection,
    providerConnectionsAtom,
    providerTitleForKind,
} from "@agenta/entities/secret"
import {invalidateAgentRequirements} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import providerListCatalog from "@agenta/i18n/catalogs/entityUi.providerList"
import {useViewForm, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"

import ProviderConnectionCard, {type ProviderCardSaveState} from "../ProviderConnectionCard"
import {providerDisplayTitle} from "../providerFieldText"

import {ProviderOwnerChoiceContext} from "./providerOwnerChoice"
import type {ProviderConnectionParams} from "./providerViews"

const ProviderConnectionViewBody = ({params}: ViewProps<ProviderConnectionParams>) => {
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
    useViewTitle(
        connection?.name ?? providerDisplayTitle(params.kind, providerTitleForKind(params.kind)),
    )

    const [card, setCard] = useState<ProviderCardSaveState | null>(null)
    // A new key can fix an agent that needs setup, without a new version.
    const onSaved = useCallback(() => void invalidateAgentRequirements(), [])

    useViewForm({
        dirty: card?.dirty ?? false,
        valid: card?.canSave ?? false,
        leaveDescription: t("entityUi.providerList.formLeaveDescription"),
        saveLabel: t("entityUi.providerList.saveConnection"),
        save: () => (card ? card.submit() : Promise.resolve(false)),
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
