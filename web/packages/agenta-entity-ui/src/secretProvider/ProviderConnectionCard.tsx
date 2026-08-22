/**
 * The provider connection card — one pushed level inside the provider drawer, and the only place
 * a connection is configured. No modal, no toast: everything the user needs to know is on the
 * card, including why the footer's Done is disabled.
 *
 * Its five parts follow experience.md exactly: credential (schema-driven by provider kind) with
 * one Test action, an optional name, the active-model list, the collapsed harness policy, and a
 * Cancel/Done footer. The footer itself is the drawer's — the card publishes its save wiring
 * through `onSaveStateChange`. Nothing is written until Done — Test spends the credential on one
 * read and keeps nothing.
 *
 * Layout: the credential, the name, and the harness policy are fixed height; Active models is the
 * one flexible region and scrolls inside itself, so every extra viewport pixel goes to the list
 * rather than to a gap above the footer. On a viewport too short for the fixed sections, the list
 * floors at three rows and the DRAWER BODY takes over the scrolling, header and footer still put.
 *
 * Design: docs/design/provider-connections-models/experience.md ("Provider connection card").
 */
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    buildModelOptions,
    connectionPolicyForSave,
    credentialFieldsForKind,
    credentialStatusLine,
    credentialValuesFor,
    defaultNamePreview,
    doneState,
    harnessSupportsProviderKind,
    hasRequiredCredential,
    manualModelPlaceholderForKind,
    modelDisplayOrder,
    probeProviderMutationAtom,
    probeFailureMessage,
    probeRequestFor,
    providerModelCatalog,
    providerTitleForKind,
    saveProviderConnectionAtom,
    secretKindForProviderKind,
    secretNoteForKind,
    SecretKind,
    storedCredentialFields,
    type CredentialValues,
    type ProbeProviderResponse,
    type ProviderConnection,
} from "@agenta/entities/secret"
import {harnessCapabilitiesAtomFamily} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"
import {InputAffix, LoadingButton, PasswordInput, Textarea} from "@agenta/ui/ui"
import {WarningCircle} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {harnessMetaFor, selectableHarnesses} from "../DrillInView/SchemaControls/harnessMeta"

import ActiveModelsSection from "./ActiveModelsSection"
import HarnessesSection, {type HarnessChoice} from "./HarnessesSection"

/** The harness the card checks by default for an API key, when the provider can reach it. */
const DEFAULT_HARNESS = "pi_core"

/** The capability map is global; the key only records which surface asked for it. */
const HARNESS_CATALOG_KEY = "agenta:settings:ai-providers"

/** Where a harness comes from, shown beside its name. Only Pi is a place today. */
const HARNESS_DOMAINS: Record<string, string> = {pi_core: "pi.dev"}

/**
 * The card's 13px row scale, reached through the affix wrapper: `InputAffix` sizes its inner
 * `<input>` from its own size variant, so a class on the wrapper never lands on the text.
 */
const FIELD_TYPE_SCALE = "[&_input]:!text-xs"

/**
 * A name field beside a secret field and a primary button reads as a login form, so Bitwarden and
 * friends offer to save or update a login over the drawer. Every field opts out explicitly.
 */
const PASSWORD_MANAGER_OPT_OUT = {
    "data-1p-ignore": true,
    "data-lpignore": "true",
    "data-bwignore": "true",
    "data-form-type": "other",
} as const

/** What the drawer's footer needs from the card to render Cancel/Done for it. */
export interface ProviderCardSaveState {
    canSave: boolean
    saving: boolean
    /** The last save failure, for the footer to state where the button was pressed. */
    error: string | null
    submit: () => void
}

export interface ProviderConnectionCardProps {
    /** The vault provider kind this card configures. */
    kind: string
    /** The saved connection being edited, or null for a new one. */
    connection?: ProviderConnection | null
    /** Every connection in the project — the default-name preview reads them. */
    connections: ProviderConnection[]
    /** Called after a successful save, so the host can refetch and close. */
    onSaved: () => void
    /**
     * Publishes the save wiring so the drawer can draw the footer outside the scrolling card.
     * Cancel is the drawer's own — it is the step that opened the card that gets undone.
     */
    onSaveStateChange?: (state: ProviderCardSaveState) => void
}

const ProviderConnectionCard = ({
    kind,
    connection,
    connections,
    onSaved,
    onSaveStateChange,
}: ProviderConnectionCardProps) => {
    const projectId = useAtomValue(projectIdAtom)
    const capabilities = useAtomValue(harnessCapabilitiesAtomFamily(HARNESS_CATALOG_KEY))
    const probeMutation = useAtomValue(probeProviderMutationAtom)
    const saveConnection = useSetAtom(saveProviderConnectionAtom)

    const fields = useMemo(() => credentialFieldsForKind(kind), [kind])
    const title = providerTitleForKind(kind)
    // Test sits beside the field that carries the key. A kind without one (Vertex's credentials
    // JSON, Bedrock's either/or pair) has no single field to attach it to, so it stands alone.
    const testedField = useMemo(
        () => (fields.some((field) => field.key === "apiKey") ? "apiKey" : null),
        [fields],
    )
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

    // A saved write-only record returns no values, so its secret fields arrive empty every time.
    // They still count as filled — otherwise editing only the model list would demand the key again.
    const storedFields = useMemo(() => storedCredentialFields(connection), [connection])
    // Typed OR already in the vault. Test used to demand typed material, because an empty form had
    // no credential to spend; the probe now takes a `secret_id` and resolves the stored one itself,
    // so a write-only connection is testable without retyping a key it can never read back.
    const credentialFilled = hasRequiredCredential(kind, credential, storedFields)
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
                domain: HARNESS_DOMAINS[id],
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
    // ones Agenta cannot test at all. Testing still gates Save, which is what protects the write.
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
        const request = probeRequestFor(kind, credential, connection)
        try {
            const result = await probeMutation.mutateAsync({
                projectId,
                kind: request.kind,
                provider: request.provider,
                secretId: request.secret_id,
            })
            setProbe(result)
            if (!result) setProbeFailure(`Agenta could not read ${title}'s answer.`)
        } catch (error) {
            setProbe(null)
            setProbeFailure(probeFailureMessage(error, title))
        }
    }, [projectId, probeMutation, kind, credential, connection, title])

    const setField = (key: string, value: string) => {
        setCredential((previous) => ({...previous, [key]: value}))
        // The last verdict belonged to the previous credential; keep showing it and Save would
        // store an untested key under a stale "accepted".
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

    // The drawer draws the footer, so the card hands it a stable submit and the flags behind it.
    // The ref keeps `submit` identical across renders: only a flag change re-renders the drawer.
    const saveRef = useRef(onSave)
    saveRef.current = onSave
    const submit = useCallback(() => void saveRef.current(), [])

    useEffect(() => {
        onSaveStateChange?.({canSave: done.enabled, saving, error: saveError, submit})
    }, [onSaveStateChange, done.enabled, saving, saveError, submit])

    const credentialMessage = probeFailure ?? probe?.credential.message ?? null
    const credentialFailed = credentialStatus === "invalid" || !!probeFailure

    // The provider's own verdict plus what the same call fetched. Required-ness is carried by
    // Done's disabled state, so no field wears an asterisk.
    const statusLine = credentialMessage
        ? credentialStatusLine(
              credentialMessage,
              discovered ? (probe?.discovery.models.length ?? 0) : null,
          )
        : null

    const testButton = (
        <LoadingButton
            variant="outline"
            className="shrink-0"
            loading={probeMutation.isPending}
            disabled={!credentialFilled || !projectId}
            onClick={() => void runProbe()}
        >
            {credentialFailed ? "Retry" : "Test"}
        </LoadingButton>
    )

    return (
        <div className="flex min-h-full flex-1 flex-col gap-4 text-xs">
            <section className="flex shrink-0 flex-col gap-3">
                {fields.map((field) => {
                    const value = credential[field.key] ?? ""
                    const block =
                        field.attributes?.kind === "json" || field.attributes?.kind === "textarea"
                            ? field.attributes
                            : null
                    const secret =
                        field.attributes?.kind === "text" && field.attributes.type === "password"
                    // Test belongs beside the credential it spends. A JSON credential is a block,
                    // not a line, so it gets the button underneath instead.
                    const inlineTest = field.key === testedField && !block
                    // Stored but unreadable: the field is a replace box, never a prefilled value.
                    const replaceOnly = storedFields.includes(field.key)

                    return (
                        <div key={field.key} className="flex flex-col gap-1">
                            <span className="font-medium text-colorText">
                                {/* TODO(copy: owner) */}
                                {replaceOnly
                                    ? field.key === "apiKey"
                                        ? "Replace key"
                                        : `Replace ${field.label}`
                                    : field.label}
                            </span>
                            {replaceOnly ? (
                                <span className="text-[11px] text-colorTextTertiary">
                                    {/* TODO(copy: owner) */}
                                    {connection?.keyPreview
                                        ? `Key configured (${connection.keyPreview}). Leave blank to keep it.`
                                        : "Key configured. Leave blank to keep it."}
                                </span>
                            ) : null}
                            <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1">
                                    {block ? (
                                        <Textarea
                                            placeholder={field.placeholder}
                                            rows={block.rows ?? 8}
                                            className="font-mono !text-xs"
                                            spellCheck={false}
                                            autoComplete="off"
                                            {...PASSWORD_MANAGER_OPT_OUT}
                                            value={value}
                                            onChange={(event) =>
                                                setField(field.key, event.target.value)
                                            }
                                        />
                                    ) : secret ? (
                                        <PasswordInput
                                            placeholder={field.placeholder}
                                            className={FIELD_TYPE_SCALE}
                                            autoComplete="new-password"
                                            {...PASSWORD_MANAGER_OPT_OUT}
                                            value={value}
                                            onValueChange={(next) => setField(field.key, next)}
                                        />
                                    ) : (
                                        <InputAffix
                                            placeholder={field.placeholder}
                                            className={FIELD_TYPE_SCALE}
                                            autoComplete="off"
                                            {...PASSWORD_MANAGER_OPT_OUT}
                                            value={value}
                                            onValueChange={(next) => setField(field.key, next)}
                                        />
                                    )}
                                </div>
                                {inlineTest ? testButton : null}
                            </div>
                            {field.note ? (
                                <span className="text-[11px] text-colorTextTertiary">
                                    {field.note}
                                </span>
                            ) : null}
                        </div>
                    )
                })}

                {testedField === null ? <div>{testButton}</div> : null}

                {/* The credential's verdict left, the one encryption disclaimer right. */}
                <div className="flex items-start justify-between gap-3">
                    {statusLine ? (
                        <span
                            className={
                                credentialFailed
                                    ? "flex min-w-0 items-start gap-1 text-colorError"
                                    : "flex min-w-0 items-start gap-1.5 text-colorSuccess"
                            }
                        >
                            {credentialFailed ? (
                                <WarningCircle size={14} className="mt-0.5 shrink-0" />
                            ) : (
                                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-colorSuccess" />
                            )}
                            <span>
                                {statusLine}
                                {credentialFailed ? " Nothing has been saved." : null}
                            </span>
                        </span>
                    ) : (
                        <span />
                    )}
                    <span className="shrink-0 text-[11px] text-colorTextTertiary">
                        Encrypted at rest
                    </span>
                </div>

                <span className="text-[11px] text-colorTextTertiary">
                    {secretNoteForKind(kind, title)}
                </span>

                {/* Why the footer's Done is disabled (or what saving now would mean), stated where
                    the credential that decides it is. */}
                {done.note ? (
                    <span className="text-[11px] text-colorTextTertiary">{done.note}</span>
                ) : null}
            </section>

            <div className="flex shrink-0 flex-col gap-1">
                <span className="font-medium text-colorText">
                    Name <span className="font-normal text-colorTextTertiary">— optional</span>
                </span>
                <InputAffix
                    placeholder={namePreview}
                    className={FIELD_TYPE_SCALE}
                    autoComplete="off"
                    {...PASSWORD_MANAGER_OPT_OUT}
                    value={name}
                    onValueChange={setName}
                />
            </div>

            {showModels ? (
                <ActiveModelsSection
                    options={modelOptions}
                    manualPlaceholder={manualModelPlaceholderForKind(kind)}
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

            <div className="shrink-0 border-0 border-t border-solid border-colorSplit" />

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
        </div>
    )
}

export default ProviderConnectionCard
