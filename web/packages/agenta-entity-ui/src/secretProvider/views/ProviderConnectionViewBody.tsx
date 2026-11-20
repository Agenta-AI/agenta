/**
 * One provider connection as a form view. The form itself is the production connection card;
 * the provider keys milestone redraws it. Save writes the project's connection, then the stack
 * goes back to the list.
 */
import {
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type SyntheticEvent,
} from "react"

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
import {useAtomValue, useSetAtom} from "jotai"

import ProviderConnectionCard, {type ProviderCardSaveState} from "../ProviderConnectionCard"
import {providerDisplayTitle} from "../providerFieldText"

import {ProviderOwnerChoiceContext} from "./providerOwnerChoice"
import type {ProviderConnectionViewParams} from "./providerViews"

/**
 * Controls whose click can change the form without an input event: toggles, options, and the
 * card's buttons ("Select all", "Clear"). A click that changes nothing (opening "Harnesses")
 * also counts, so leaving may ask once more than needed until the card reports its own edits.
 */
const TOGGLE_SELECTOR =
    '[role="checkbox"],[role="switch"],[role="radio"],[role="option"],button,[role="button"]'

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
    useViewTitle(
        connection?.name ?? providerDisplayTitle(params.kind, providerTitleForKind(params.kind)),
    )

    const [card, setCard] = useState<ProviderCardSaveState | null>(null)
    // The card does not report edits, so the view counts any input or toggle inside it.
    const [touched, setTouched] = useState(false)
    const touch = useCallback(() => setTouched(true), [])
    const touchToggle = useCallback((event: SyntheticEvent) => {
        if ((event.target as HTMLElement | null)?.closest?.(TOGGLE_SELECTOR)) setTouched(true)
    }, [])

    // The card's submit does not return its result: it calls `onSaved` on success and reports
    // an error otherwise. The view turns that into the promise the stack waits on.
    const pending = useRef<((ok: boolean) => void) | null>(null)
    const settle = useCallback((ok: boolean) => {
        pending.current?.(ok)
        pending.current = null
    }, [])
    useEffect(() => {
        if (card && !card.saving && card.error) settle(false)
    }, [card, settle])

    useViewForm({
        dirty: touched,
        valid: card?.canSave ?? false,
        leaveDescription: t("entityUi.providerList.formLeaveDescription"),
        saveLabel: t("entityUi.providerList.saveConnection"),
        save: () =>
            new Promise<boolean>((resolve) => {
                if (!card) return resolve(false)
                pending.current = resolve
                card.submit()
            }),
    })

    return (
        <div
            className="flex min-h-0 flex-1 flex-col px-4 py-3"
            onInputCapture={touch}
            onChangeCapture={touch}
            onClickCapture={touchToggle}
        >
            <ProviderConnectionCard
                key={connection?.id ?? params.kind}
                kind={params.kind}
                connection={connection}
                connections={own}
                ownerChoice={connection ? undefined : (ownerChoiceFor?.(params.kind) ?? undefined)}
                onSaveStateChange={setCard}
                onSaved={() => {
                    // A project save does not refresh the vault by itself; the list and the
                    // picker read it. A new key can also fix an agent that needs setup.
                    void invalidateAgentRequirements()
                    void refreshVault().finally(() => settle(true))
                }}
            />
        </div>
    )
}

export default ProviderConnectionViewBody
