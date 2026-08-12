/**
 * The provider connection card — one pushed level inside the provider drawer, and the only place
 * a connection is configured. No modal, no toast: everything the user needs to know is on the
 * card, including why Done is disabled.
 *
 * Its five parts follow experience.md exactly: credential (schema-driven by provider kind) with
 * one Test action, an optional name, the active-model list, the collapsed harness policy, and a
 * Cancel/Done footer. Nothing is written until Done — Test spends the credential on one read and
 * keeps nothing.
 *
 * Design: docs/design/provider-connections-models/experience.md ("Provider connection card").
 */
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    buildModelOptions,
    connectionPolicyForSave,
    credentialFieldsForKind,
    credentialValuesFor,
    defaultNamePreview,
    doneState,
    harnessSupportsProviderKind,
    hasRequiredCredential,
    modelDisplayOrder,
    probeProviderMutationAtom,
    providerModelCatalog,
    providerTitleForKind,
    saveProviderConnectionAtom,
    secretKindForProviderKind,
    SecretKind,
    toProviderCredentials,
    type CredentialValues,
    type ProbeProviderResponse,
    type ProviderConnection,
} from "@agenta/entities/secret"
import {harnessCapabilitiesAtomFamily} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"
import {Button, Divider, InputAffix, LoadingButton, PasswordInput, Textarea} from "@agenta/ui/ui"
import {WarningCircle} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {harnessMetaFor, selectableHarnesses} from "../DrillInView/SchemaControls/harnessMeta"

import ActiveModelsSection from "./ActiveModelsSection"
import HarnessesSection, {type HarnessChoice} from "./HarnessesSection"

/** The harness the card checks by default for an API key, when the provider can reach it. */
const DEFAULT_HARNESS = "pi_core"

/** The capability map is global; the key only records which surface asked for it. */
const HARNESS_CATALOG_KEY = "agenta:settings:ai-providers"

export interface ProviderConnectionCardProps {
    /** The vault provider kind this card configures. */
    kind: string
    /** The saved connection being edited, or null for a new one. */
    connection?: ProviderConnection | null
    /** Every connection in the project — the default-name preview reads them. */
    connections: ProviderConnection[]
    onCancel: () => void
    /** Called after a successful save, so the host can refetch and close. */
    onSaved: () => void
}

const ProviderConnectionCard = ({
    kind,
    connection,
    connections,
    onCancel,
    onSaved,
}: ProviderConnectionCardProps) => {
    const projectId = useAtomValue(projectIdAtom)
    const capabilities = useAtomValue(harnessCapabilitiesAtomFamily(HARNESS_CATALOG_KEY))
    const probeMutation = useAtomValue(probeProviderMutationAtom)
    const saveConnection = useSetAtom(saveProviderConnectionAtom)

    const fields = useMemo(() => credentialFieldsForKind(kind), [kind])
    const title = providerTitleForKind(kind)
    const isStandard = secretKindForProviderKind(kind) === SecretKind.ProviderKey

    const storedCredential = useMemo<CredentialValues>(
        () =>
            connection
                ? credentialValuesFor(connection)
                : Object.fromEntries(fields.map((field) => [field.key, ""])),
        [connection, fields],
    )

    const [credential, setCredential] = useState<CredentialValues>(storedCredential)
    const [name, setName] = useState(connection?.name ?? "")
    const [probe, setProbe] = useState<ProbeProviderResponse | null>(null)
    const [probeFailure, setProbeFailure] = useState<string | null>(null)
    const [saveError, setSaveError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [manualModels, setManualModels] = useState<string[]>([])
    // `null` means "not chosen yet" — the defaults apply until the user touches the list.
    const [checkedModels, setCheckedModels] = useState<string[] | null>(connection?.models ?? null)
    const [harnesses, setHarnesses] = useState<string[] | null>(connection?.harnesses ?? null)

    // The card is remounted per provider by its key in the drawer, but a Settings row click can
    // swap the connection under a mounted card; reseed rather than show the previous one's state.
    const seededFor = useRef<string | null>(connection?.id ?? null)
    useEffect(() => {
        const identity = connection?.id ?? null
        if (seededFor.current === identity) return
        seededFor.current = identity
        setCredential(storedCredential)
        setName(connection?.name ?? "")
        setProbe(null)
        setProbeFailure(null)
        setSaveError(null)
        setManualModels([])
        setCheckedModels(connection?.models ?? null)
        setHarnesses(connection?.harnesses ?? null)
    }, [connection, storedCredential])

    const credentialFilled = hasRequiredCredential(kind, credential)
    const storedCredentialUnchanged = useMemo(
        () =>
            !!connection &&
            fields.every(
                (field) => (credential[field.key] ?? "") === (storedCredential[field.key] ?? ""),
            ),
        [connection, credential, fields, storedCredential],
    )

    const credentialStatus = probe?.credential.status ?? null
    const discovered = probe?.discovery.status === "fetched"

    // Standard providers name a family the harness catalog knows; the credential-set kinds carry
    // whatever the endpoint serves, so their list comes from discovery and manual entry alone.
    const catalog = useMemo(
        () => providerModelCatalog(capabilities, isStandard ? kind : ""),
        [capabilities, isStandard, kind],
    )

    const available = useMemo(
        () => (discovered ? (probe?.discovery.models ?? []) : catalog.models),
        [discovered, probe, catalog.models],
    )

    const effectiveChecked = useMemo(() => {
        if (checkedModels) return checkedModels
        // Untouched: Agenta's defaults, narrowed to what a live fetch actually offered.
        return discovered
            ? catalog.defaults.filter((id) => available.includes(id))
            : catalog.defaults
    }, [checkedModels, catalog.defaults, discovered, available])

    // Fixed for as long as the fetch is: the saved selection and Agenta's defaults lead, the rest
    // follow in provider order. Deliberately not derived from `effectiveChecked` — re-sorting on
    // every tick would move the next row out from under the cursor.
    const modelOrder = useMemo(
        () =>
            modelDisplayOrder({
                available,
                prioritized: [...(connection?.models ?? []), ...catalog.defaults],
                manual: manualModels,
            }),
        [available, connection?.models, catalog.defaults, manualModels],
    )

    const modelOptions = useMemo(
        () =>
            buildModelOptions({
                available,
                checked: effectiveChecked,
                manual: manualModels,
                defaults: catalog.defaults,
                discovered,
                order: modelOrder,
            }),
        [available, effectiveChecked, manualModels, catalog.defaults, discovered, modelOrder],
    )

    const harnessChoices = useMemo<HarnessChoice[]>(
        () =>
            selectableHarnesses(Object.keys(capabilities ?? {})).map((id) => ({
                id,
                label: harnessMetaFor(id).label,
                supported: harnessSupportsProviderKind(capabilities, id, kind),
            })),
        [capabilities, kind],
    )

    // Null when no harness declares this deployment: the card checks nothing, and the save leaves
    // the policy out rather than storing "no harness may use this".
    const defaultHarness = useMemo(
        () =>
            harnessChoices.find((choice) => choice.id === DEFAULT_HARNESS)?.supported
                ? DEFAULT_HARNESS
                : null,
        [harnessChoices],
    )

    const effectiveHarnesses = useMemo(
        () => harnesses ?? (defaultHarness ? [defaultHarness] : []),
        [harnesses, defaultHarness],
    )

    // Available as soon as there is a credential to attach models to, not only after a successful
    // test: a manual model id must be enterable for every provider in every state, including the
    // ones Agenta cannot test at all. Testing still gates Done, which is what protects the save.
    const showModels = credentialFilled || !!connection

    const done = doneState({
        credentialFilled,
        status: credentialStatus,
        storedCredentialUnchanged,
        transportFailed: !!probeFailure,
    })

    // What an empty name would become. A connection being edited keeps its own name out of the
    // count, so clearing the field previews the name it already has rather than the next one.
    const namePreview = defaultNamePreview(
        kind,
        connections.filter((candidate) => candidate.id !== connection?.id),
    )

    const runProbe = useCallback(async () => {
        if (!projectId) return
        setProbeFailure(null)
        setSaveError(null)
        try {
            const result = await probeMutation.mutateAsync({
                projectId,
                kind,
                provider: toProviderCredentials(kind, credential),
            })
            setProbe(result)
            if (!result) setProbeFailure(`Agenta could not read ${title}'s answer.`)
        } catch {
            setProbe(null)
            setProbeFailure(`Agenta could not reach ${title} to test this credential.`)
        }
    }, [projectId, probeMutation, kind, credential, title])

    const setField = (key: string, value: string) => {
        setCredential((previous) => ({...previous, [key]: value}))
        // The last verdict belonged to the previous credential; keep showing it and Done would
        // save an untested key under a stale "accepted".
        setProbe(null)
        setProbeFailure(null)
    }

    const toggleModel = (id: string, checked: boolean) =>
        setCheckedModels(
            checked
                ? [...effectiveChecked.filter((model) => model !== id), id]
                : effectiveChecked.filter((model) => model !== id),
        )

    const onSave = async () => {
        setSaving(true)
        setSaveError(null)
        try {
            await saveConnection({
                draft: {
                    kind,
                    name,
                    credential,
                    ...connectionPolicyForSave({
                        checkedModels,
                        modelIds: modelOptions
                            .filter((option) => option.checked)
                            .map((option) => option.id),
                        harnesses,
                        defaultHarness,
                    }),
                },
                fallbackName: namePreview,
                connectionId: connection?.id,
            })
            onSaved()
        } catch {
            setSaveError(`Agenta could not save this ${title} connection. Try again.`)
        } finally {
            setSaving(false)
        }
    }

    const credentialMessage = probeFailure ?? probe?.credential.message ?? null
    const credentialFailed = credentialStatus === "invalid" || !!probeFailure

    return (
        <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-3">
                {fields.map((field) => {
                    const value = credential[field.key] ?? ""
                    const label = `${field.label}${field.required ? " *" : ""}`

                    return (
                        <div key={field.key} className="flex flex-col gap-1">
                            <span className="font-medium text-colorText">{label}</span>
                            {field.attributes?.kind === "json" ||
                            field.attributes?.kind === "textarea" ? (
                                <Textarea
                                    placeholder={field.placeholder}
                                    rows={field.attributes.rows ?? 8}
                                    className="font-mono"
                                    spellCheck={false}
                                    value={value}
                                    onChange={(event) => setField(field.key, event.target.value)}
                                />
                            ) : field.attributes?.type === "password" ? (
                                <PasswordInput
                                    placeholder={field.placeholder}
                                    value={value}
                                    onValueChange={(next) => setField(field.key, next)}
                                />
                            ) : (
                                <InputAffix
                                    placeholder={field.placeholder}
                                    value={value}
                                    onValueChange={(next) => setField(field.key, next)}
                                />
                            )}
                            {field.note ? (
                                <span className="text-colorTextSecondary">{field.note}</span>
                            ) : null}
                        </div>
                    )
                })}

                <div className="flex items-center gap-3">
                    <LoadingButton
                        variant="outline"
                        loading={probeMutation.isPending}
                        disabled={!credentialFilled || !projectId}
                        onClick={() => void runProbe()}
                    >
                        {credentialFailed ? "Retry" : "Test"}
                    </LoadingButton>
                    <span className="text-colorTextSecondary">
                        Nothing is saved until Done. Encrypted at rest.
                    </span>
                </div>

                {credentialMessage ? (
                    <span
                        className={
                            credentialFailed
                                ? "flex items-center gap-1 text-colorError"
                                : "text-colorTextSecondary"
                        }
                    >
                        {credentialFailed ? <WarningCircle size={16} /> : null}
                        {credentialMessage}
                        {credentialFailed ? " Nothing has been saved." : null}
                    </span>
                ) : null}
            </section>

            <div className="flex flex-col gap-1">
                <span className="font-medium text-colorText">Name (optional)</span>
                <InputAffix placeholder={namePreview} value={name} onValueChange={setName} />
            </div>

            {showModels ? (
                <ActiveModelsSection
                    options={modelOptions}
                    followingDefaults={!checkedModels}
                    onToggle={toggleModel}
                    onSelectAll={() => setCheckedModels(modelOptions.map((option) => option.id))}
                    onClear={() => setCheckedModels([])}
                    onAddManual={(id) => {
                        setManualModels((previous) =>
                            previous.includes(id) ? previous : [...previous, id],
                        )
                        setCheckedModels([...effectiveChecked.filter((model) => model !== id), id])
                    }}
                    fetchedAt={discovered ? (probe?.fetched_at ?? null) : null}
                    onRefetch={() => void runProbe()}
                    refetching={probeMutation.isPending}
                />
            ) : null}

            <HarnessesSection
                choices={harnessChoices}
                selected={effectiveHarnesses}
                unrestricted={!harnesses && !defaultHarness}
                onToggle={(id, checked) =>
                    setHarnesses(
                        checked
                            ? [...effectiveHarnesses.filter((harness) => harness !== id), id]
                            : effectiveHarnesses.filter((harness) => harness !== id),
                    )
                }
            />

            {/* Sticky so Done stays reachable while a long model list scrolls above it. */}
            <div className="sticky bottom-0 -mx-6 -mb-6 flex flex-col gap-2 bg-colorBgContainer px-6 pb-6 pt-2">
                <Divider className="m-0" />
                {done.note ? <span className="text-colorTextSecondary">{done.note}</span> : null}
                {saveError ? (
                    <span className="flex items-center gap-1 text-colorError">
                        <WarningCircle size={16} />
                        {saveError}
                    </span>
                ) : null}
                <div className="flex items-center justify-end gap-2">
                    <Button variant="outline" onClick={onCancel}>
                        Cancel
                    </Button>
                    <LoadingButton
                        variant="default"
                        loading={saving}
                        disabled={!done.enabled}
                        onClick={() => void onSave()}
                    >
                        Done
                    </LoadingButton>
                </div>
            </div>
        </div>
    )
}

export default ProviderConnectionCard
