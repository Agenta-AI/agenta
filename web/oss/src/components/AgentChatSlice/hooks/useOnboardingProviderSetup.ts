/**
 * The connect-model gate's providers drawer, and what a save from it does to the agent.
 *
 * Opening is one click (the gate's button IS the drawer's trigger — no config-section hop). Saving
 * from that path also points the agent at the connection just made, because the alternative is what
 * the founder hit in live onboarding: connect a provider, watch the gate clear, and still be stuck
 * on a seeded default model whose provider has no key.
 *
 * "From that path" is a STATE, not a call-site flag: the drawer counts as onboarding when it was
 * opened while the project had no usable credential (`gateActive`). Adding a second connection
 * mid-session, from the picker's own footer, never reaches this hook — and would not qualify anyway.
 *
 * The switch runs on the CONNECTIONS LIST, not on the save callback: `onSaved` fires before the
 * vault refetch lands, so the new connection does not exist yet at that moment. The save arms; the
 * list growing is what fires.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    providerConnectionsAtom,
    vaultSecretsQueryAtom,
    type ProviderConnection,
} from "@agenta/entities/secret"
import {harnessCapabilitiesAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {
    buildConnectionPickerRows,
    modelLabel,
    providerForModel,
    readHarnessKind,
    selectableHarnesses,
    withHarnessKind,
    withModel,
} from "@agenta/entity-ui/drill-in"
import {draftConfigChangeSignalAtom, openAgentConfigSectionAtom} from "@agenta/shared/state"
import {atom, useAtomValue, useSetAtom} from "jotai"

import {onboardingModelSwitch} from "../assets/onboardingModelSwitch"

/** Narrowed to the refetch handle — the raw query atom churns identity on every fetch-state flip. */
const vaultRefetchAtom = atom((get) => get(vaultSecretsQueryAtom).refetch)

export interface OnboardingProviderSetup {
    open: boolean
    /** Opens the drawer, recording whether this counts as the onboarding path. */
    openDrawer: () => void
    closeDrawer: () => void
    /** Hand to `ProviderDrawer.onSaved`. */
    onSaved: () => void
    /** Every connection in the project, for the drawer's Connected section. */
    connections: ProviderConnection[]
}

export function useOnboardingProviderSetup(
    entityId: string,
    {gateActive}: {gateActive: boolean},
): OnboardingProviderSetup {
    const connections = useAtomValue(providerConnectionsAtom)
    const capabilities = useAtomValue(harnessCapabilitiesAtomFamily(""))
    const refetchVault = useAtomValue(vaultRefetchAtom)
    const config = useAtomValue(
        useMemo(() => workflowMolecule.selectors.configuration(entityId), [entityId]),
    )
    const setConfiguration = useSetAtom(workflowMolecule.actions.updateConfiguration)
    const raiseDraftSignal = useSetAtom(draftConfigChangeSignalAtom)
    const openConfigSection = useSetAtom(openAgentConfigSectionAtom)

    const [open, setOpen] = useState(false)
    // Armed on a save that came from the onboarding path; disarmed by the switch it triggers.
    const armedRef = useRef(false)
    const onboardingRef = useRef(false)
    const knownKeysRef = useRef<string[]>([])

    // Latest config, so the switch composes against what the agent holds when the vault answers —
    // not against the snapshot from the render that opened the drawer.
    const configRef = useRef(config)
    configRef.current = config

    const harnessIds = useMemo(
        () => selectableHarnesses(capabilities ? Object.keys(capabilities) : []),
        [capabilities],
    )

    const openDrawer = useCallback(() => {
        onboardingRef.current = gateActive
        knownKeysRef.current = connections.map((connection) => connection.id)
        setOpen(true)
    }, [gateActive, connections])

    const closeDrawer = useCallback(() => setOpen(false), [])

    const onSaved = useCallback(() => {
        armedRef.current = onboardingRef.current
        refetchVault()
    }, [refetchVault])

    useEffect(() => {
        if (!armedRef.current) return
        const rows = buildConnectionPickerRows({
            connections,
            capabilities,
            harnessIds,
            showSubscriptions: true,
        })
        // Nothing new yet: the refetch has not landed. Stay armed and wait for the next list.
        const appeared = rows.some(
            (row) => row.kind === "connection" && !knownKeysRef.current.includes(row.key),
        )
        if (!appeared) return
        armedRef.current = false

        const selection = onboardingModelSwitch({
            onboarding: true,
            previousConnectionKeys: knownKeysRef.current,
            rows,
        })
        if (!selection) {
            // The connection serves no model we can name. Open the picker rather than switch
            // blindly — the Model section IS the picker now.
            openConfigSection("model-harness")
            return
        }

        const current = configRef.current as Record<string, unknown> | null
        const currentHarness = readHarnessKind(current)
        const harness = selection.harness ?? currentHarness
        // Same single-dispatch write a `/model` pick performs: harness first, model onto that base,
        // so one update carries both and neither composes from a stale copy of the other.
        const base =
            selection.harness && selection.harness !== currentHarness
                ? (withHarnessKind(current, selection.harness) ?? current)
                : current
        const next = withModel(base, {
            modelId: selection.modelId,
            provider:
                selection.provider ?? providerForModel(capabilities, harness, selection.modelId),
            mode: selection.mode,
            slug: selection.slug,
        })
        if (!next) return
        setConfiguration(entityId, next)
        const label = modelLabel(capabilities, harness, selection.modelId) ?? selection.modelId
        raiseDraftSignal({
            revisionId: entityId,
            sectionKeys: ["model-harness"],
            origin: "provider-onboarding",
            summary: `Model set to ${label}`,
            at: Date.now(),
        })
    }, [
        connections,
        capabilities,
        harnessIds,
        entityId,
        openConfigSection,
        raiseDraftSignal,
        setConfiguration,
    ])

    return {open, openDrawer, closeDrawer, onSaved, connections}
}
