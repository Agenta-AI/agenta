/**
 * The provider connection form: the one place a connection is configured, in the provider
 * views, the provider drawer and the run error drawer.
 *
 * Fields in this order: Name (required, pre-filled), the credential, "Who can use it" where the
 * host offers it, Active models, Harnesses. The host draws Cancel and Save: the form publishes
 * its save state through `onSaveStateChange`.
 *
 * The key check runs by itself (there is no "Test" button): on a paste, on a blur after an edit,
 * when a saved connection opens (with the stored key, which the browser never sends), and on
 * "Check again" or "Update". "Stop" or a new edit drops the running check. A standard provider
 * shows its models and harnesses only after the check passes; a provider with several
 * credential fields keeps the dashed "Active models" box until then.
 *
 * Spec: openspec model-providers ("Automatic key check" and the per-provider forms).
 */
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {organizationLabel} from "@agenta/entities/organization"
import {
    buildModelOptions,
    connectionPolicyForSave,
    credentialFieldsForKind,
    credentialValuesFor,
    DEFAULT_ENDPOINT_PROTOCOL,
    defaultNamePreview,
    doneState,
    endpointProtocolFieldForKind,
    harnessSupportsProviderKind,
    hasRequiredCredential,
    httpStatusOf,
    initialEndpointProtocol,
    manualModelPlaceholderForKind,
    modelDisplayOrder,
    nextConnectionName,
    probeFailureMessage,
    probeRequestFor,
    providerModelCatalog,
    providerTitleForKind,
    saveProviderConnectionAtom,
    secretKindForProviderKind,
    SecretKind,
    storedCredentialFields,
    type CredentialValues,
    type LlmEndpointProtocol,
    type OrganizationSecretProjects,
    type ProbeProviderResponse,
    type ProviderConnection,
    type ProviderFieldConfig,
} from "@agenta/entities/secret"
import {harnessCapabilitiesAtomFamily} from "@agenta/entities/workflow"
import {createT, useT} from "@agenta/i18n"
import providerConnectionCatalog from "@agenta/i18n/catalogs/entityUi.providerConnection"
import providerKeyFormCatalog from "@agenta/i18n/catalogs/entityUi.providerKeyForm"
import {projectIdAtom} from "@agenta/shared/state"
import type {OwnerKind} from "@agenta/shared/types"
import {message} from "@agenta/ui/app-message"
import {Button, InputAffix, PasswordInput, Segmented, Spinner, Textarea} from "@agenta/ui/ui"
import {WarningCircle} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {harnessMetaFor, selectableHarnesses} from "../DrillInView/SchemaControls/harnessMeta"
import {OwnerRadioGroup} from "../secret/OwnerRadioGroup"
import {PASSWORD_MANAGER_OPT_OUT} from "../secret/passwordManagerOptOut"

import ActiveModelsSection from "./ActiveModelsSection"
import HarnessesSection, {type HarnessChoice} from "./HarnessesSection"
import OrganizationProjectsSection, {
    type OrganizationConnectionScope,
} from "./OrganizationProjectsSection"
import {
    providerDisplayTitle,
    translateProtocolField,
    translateProviderField,
} from "./providerFieldText"
import {useKeyCheck, type KeyCheckRequest} from "./useKeyCheck"
import {
    organizationSavedToast,
    organizationSaveError,
    sameProjects,
} from "./useOrganizationProjectsDraft"
import {DEFAULT_KEY_HARNESS as DEFAULT_HARNESS} from "./useSaveProviderKey"

/** The capability map is global; the key only records which surface asked for it. */
const HARNESS_CATALOG_KEY = "agenta:settings:ai-providers"

/** Where a harness comes from, shown beside its name. Only Pi is a place today. */
const HARNESS_DOMAINS: Record<string, string> = {pi_core: "pi.dev"}

/**
 * The card's 13px row scale, reached through the affix wrapper: `InputAffix` sizes its inner
 * `<input>` from its own size variant, so a class on the wrapper never lands on the text.
 */
const FIELD_TYPE_SCALE = "[&_input]:!text-xs"

/** How long a multi-field form waits after the last keystroke before it checks by itself. */
const SETTLE_MS = 800

/** The two ways to sign in to AWS Bedrock, and the fields of each. */
type BedrockWay = "apiKey" | "accessKeys"
const BEDROCK_WAY_FIELDS: Record<BedrockWay, string[]> = {
    apiKey: ["bearerToken"],
    accessKeys: ["accessKeyId", "accessKey"],
}
const BEDROCK_FIELDS = [...BEDROCK_WAY_FIELDS.apiKey, ...BEDROCK_WAY_FIELDS.accessKeys]

/** A saved Bedrock connection opens on the way it was saved with; a new one on the API key. */
const initialBedrockWay = (connection: ProviderConnection | null | undefined): BedrockWay =>
    connection?.source.accessKeyId ? "accessKeys" : "apiKey"

/** A field whose value is a secret: the vault never returns it, and it is never shown. */
const isSecretField = (field: ProviderFieldConfig): boolean =>
    field.attributes?.kind === "json" ||
    (field.attributes?.kind === "text" && field.attributes.type === "password")

/** What the host needs from the form to draw Cancel and Save for it. */
export interface ProviderCardSaveState {
    canSave: boolean
    saving: boolean
    /** The last save failure, for the host to state where the button was pressed. */
    error: string | null
    /** The form differs from what it opened with. */
    dirty: boolean
    /** Saves the connection; resolves `true` when it is stored. */
    submit: () => Promise<boolean>
}

export interface ProviderConnectionCardProps {
    /** The vault provider kind this card configures. */
    kind: string
    /** The saved connection being edited, or null for a new one. */
    connection?: ProviderConnection | null
    /** Every connection in the project — the default-name preview reads them. */
    connections: ProviderConnection[]
    /** Called after a successful save, so the host can refetch and close. */
    onSaved: (savedConnectionId?: string) => void
    /** Publishes the save wiring so the host can draw Cancel and Save outside the form. */
    onSaveStateChange?: (state: ProviderCardSaveState) => void
    /**
     * Set for an organization connection: it saves to the organization, names itself
     * "{provider} (Organization)", and ends with "Projects that can use it". Read-only for a
     * member, for whom the form checks the stored key as saved.
     */
    organization?: OrganizationConnectionScope
    /**
     * A new connection in Settings, for someone who may manage the organization's connections:
     * "Who can use it" after the credential, the project (the default) or the organization.
     * Choosing the organization saves as `organization` would.
     */
    ownerChoice?: ProviderOwnerChoice
}

/** The two owners a new Settings connection can have. */
export interface ProviderOwnerChoice {
    /** For "Everyone in {project}". */
    projectName: string
    /** The organization's scope, as the organization's own connections get it. */
    organization: OrganizationConnectionScope
    /** The organization's connections, for the default-name preview. */
    connections: ProviderConnection[]
}

type ProviderOwner = Exclude<OwnerKind, "user">

const tNow = createT(providerConnectionCatalog)

/** Who a saved organization connection reaches, or null for a project connection. */
const savedProjectsOf = (
    connection: ProviderConnection | null | undefined,
): OrganizationSecretProjects | null =>
    connection?.availability
        ? {
              availability: connection.availability,
              projectIds: connection.selectedProjectIds ?? [],
          }
        : null

const ALL_PROJECTS: OrganizationSecretProjects = {availability: "all_projects", projectIds: []}

/** One line under the credential fields. */
type StatusLine =
    | {tone: "progress"}
    | {tone: "success" | "neutral" | "error"; text: string; checkAgain: boolean}

const ProviderConnectionCard = ({
    kind,
    connection,
    connections,
    onSaved,
    onSaveStateChange,
    organization: organizationScope,
    ownerChoice: ownerChoiceProp,
}: ProviderConnectionCardProps) => {
    const t = useT(providerConnectionCatalog, providerKeyFormCatalog)
    // Only a new connection asks; a saved one keeps its owner.
    const ownerChoice = connection ? undefined : ownerChoiceProp
    const [owner, setOwner] = useState<ProviderOwner>("project")
    const organization =
        ownerChoice && owner === "organization" ? ownerChoice.organization : organizationScope
    const readOnly = !!organization?.readOnly
    const projectId = useAtomValue(projectIdAtom)
    const capabilities = useAtomValue(harnessCapabilitiesAtomFamily(HARNESS_CATALOG_KEY))
    const saveConnection = useSetAtom(saveProviderConnectionAtom)
    const keyCheck = useKeyCheck()

    const fields = useMemo(() => credentialFieldsForKind(kind), [kind])
    const title = providerTitleForKind(kind)
    // Shown in the active language; the default connection name keeps `title`, since it is saved.
    const displayTitle = providerDisplayTitle(kind, title)
    const isStandard = secretKindForProviderKind(kind) === SecretKind.ProviderKey
    const isBedrock = kind === "bedrock"
    const takesBaseUrl = fields.some((field) => field.key === "apiBaseUrl")

    const storedCredential = useMemo<CredentialValues>(
        () =>
            connection
                ? credentialValuesFor(connection)
                : Object.fromEntries(fields.map((field) => [field.key, ""])),
        [connection, fields],
    )

    const [credential, setCredential] = useState<CredentialValues>(storedCredential)
    // `null` is "not typed": the field shows the default name, and a save stores it.
    const [name, setName] = useState<string | null>(connection?.name ?? null)
    const [bedrockWay, setBedrockWay] = useState<BedrockWay>(() => initialBedrockWay(connection))
    const [saveError, setSaveError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [manualModels, setManualModels] = useState<string[]>([])
    // `null` means "not chosen yet" — the defaults apply until the user touches the list.
    const [checkedModels, setCheckedModels] = useState<string[] | null>(connection?.models ?? null)
    const [harnesses, setHarnesses] = useState<string[] | null>(connection?.harnesses ?? null)
    // Only the kinds that declare one carry it. `null` is "this record declares none", which a
    // save leaves alone: a new connection declares the default, an existing one declares what it
    // already did, and nothing but the control itself turns silence into a declaration.
    const protocolField = useMemo(() => endpointProtocolFieldForKind(kind), [kind])
    const [protocol, setProtocol] = useState<LlmEndpointProtocol | null>(
        initialEndpointProtocol(connection),
    )
    // A new organization connection starts with every project.
    const savedProjects = useMemo(() => savedProjectsOf(connection), [connection])
    const [projects, setProjects] = useState<OrganizationSecretProjects>(
        savedProjects ?? ALL_PROJECTS,
    )

    // What the form opened with, to tell the host whether it has edits.
    const snapshot = JSON.stringify({
        credential,
        name,
        bedrockWay,
        manualModels,
        checkedModels,
        harnesses,
        protocol,
        owner,
        projects,
    })
    const openedWith = useRef(snapshot)

    // The saved connection the list was last fetched for, when it opened.
    const refreshedFor = useRef<string | null>(null)
    // The field a paste landed in: its next change starts the check.
    const pastedInto = useRef<string | null>(null)

    // The hosts key the card by the connection id, so another connection mounts a new card.
    const dirty = !readOnly && snapshot !== openedWith.current

    // Bedrock shows, checks and saves only the fields of the chosen way to sign in.
    const otherWayFields = useMemo(
        () =>
            isBedrock
                ? BEDROCK_FIELDS.filter((key) => !BEDROCK_WAY_FIELDS[bedrockWay].includes(key))
                : [],
        [isBedrock, bedrockWay],
    )
    const forChosenWay = useCallback(
        (values: CredentialValues): CredentialValues =>
            otherWayFields.length
                ? {
                      ...values,
                      ...Object.fromEntries(otherWayFields.map((key) => [key, ""])),
                  }
                : values,
        [otherWayFields],
    )
    const chosenCredential = useMemo(() => forChosenWay(credential), [forChosenWay, credential])

    // A saved write-only record returns no values, so its secret fields arrive empty every time.
    // They still count as filled — otherwise editing only the model list would demand the key again.
    // A Bedrock way other than the one the connection opened with has nothing stored yet.
    const wayChanged = isBedrock && bedrockWay !== initialBedrockWay(connection)
    const storedFields = useMemo(
        () =>
            storedCredentialFields(connection).filter(
                (key) =>
                    !otherWayFields.includes(key) && !(wayChanged && BEDROCK_FIELDS.includes(key)),
            ),
        [connection, otherWayFields, wayChanged],
    )
    const credentialFilled = hasRequiredCredential(kind, chosenCredential, storedFields)
    /** A saved connection whose credential fields hold what it opened with. */
    const unchangedFromStored = useCallback(
        (values: CredentialValues) =>
            !!connection &&
            (!isBedrock || bedrockWay === initialBedrockWay(connection)) &&
            fields.every(
                (field) =>
                    otherWayFields.includes(field.key) ||
                    (values[field.key] ?? "") === (storedCredential[field.key] ?? ""),
            ),
        [connection, isBedrock, bedrockWay, fields, storedCredential, otherWayFields],
    )
    const storedCredentialUnchanged = unchangedFromStored(credential)

    // Bedrock needs its region as well as one way to sign in before a check can say anything.
    const readyToCheck = useCallback(
        (values: CredentialValues) =>
            hasRequiredCredential(kind, values, storedFields) &&
            (!isBedrock || !!(values.region ?? "").trim()),
        [kind, storedFields, isBedrock],
    )

    // A member checks the organization connection exactly as saved: any field sent would be an
    // edit, which only an owner or admin may make.
    const requestFor = useCallback(
        (values: CredentialValues): KeyCheckRequest => {
            const request =
                readOnly && connection
                    ? {kind: undefined, provider: {}, secret_id: connection.id}
                    : probeRequestFor(kind, values, connection)
            return organization && request.secret_id
                ? {...request, secretScope: "organization"}
                : request
        },
        [readOnly, connection, kind, organization],
    )
    // A member's check of the stored organization row runs through the current project, so only
    // where the project may use it. An owner or admin reads the row from any project, and a
    // typed key is checked on its own.
    const testableFor = (request: KeyCheckRequest) =>
        !request.secretScope ||
        !readOnly ||
        connection?.availability !== "selected_projects" ||
        (!!projectId && (connection.selectedProjectIds ?? []).includes(projectId))

    // "key": an edited credential is checked, and the line under the field follows it.
    // "refresh": a saved connection's stored credential fetches the list again, and the line
    // under the list follows it.
    const [checkMode, setCheckMode] = useState<"key" | "refresh">("key")
    const runCheck = (values: CredentialValues, force: boolean) => {
        const request = requestFor(values)
        if (!testableFor(request)) return
        setCheckMode(unchangedFromStored(values) ? "refresh" : "key")
        setSaveError(null)
        void keyCheck.check(request, {force})
    }

    /**
     * Starts the check by itself when the credential is complete and changed since the last
     * check. A paste always checks.
     */
    const autoCheck = (values: CredentialValues, pasted = false) => {
        if (readOnly || !keyCheck.ready) return
        const chosen = forChosenWay(values)
        if (!readyToCheck(chosen)) return
        // A saved connection with nothing edited refreshes when it opens and on "Update" only.
        if (unchangedFromStored(chosen)) return
        runCheck(chosen, pasted)
    }

    // A saved connection fetches its list again when it opens, with the stored key.
    useEffect(() => {
        if (!connection || !keyCheck.ready || refreshedFor.current === connection.id) return
        if (!connection.hasStoredCredential && !readyToCheck(storedCredential)) return
        refreshedFor.current = connection.id
        runCheck(storedCredential, true)
        // Once per opened connection; the request reads the form as it opened.
    }, [connection, keyCheck.ready])

    const checkState = keyCheck.state
    const probe: ProbeProviderResponse | null =
        checkState.phase === "done" ? checkState.result : null
    const checking = checkState.phase === "checking"
    const checkFailed = checkState.phase === "failed"
    const credentialStatus = probe?.credential.status ?? null
    const discovered = probe?.discovery.status === "fetched"
    // A key that works, or one Agenta cannot prove: the models come next.
    const passed = credentialStatus === "valid" || credentialStatus === "unknown"

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

    const availableNames = useMemo(
        () => ({...(connection?.modelNames ?? {}), ...(probe?.discovery.model_names ?? {})}),
        [connection?.modelNames, probe?.discovery.model_names],
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
                prioritized: [...catalog.defaults, ...(connection?.models ?? [])],
                manual: manualModels,
            }),
        [available, catalog.defaults, connection?.models, manualModels],
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
                names: availableNames,
            }),
        [
            available,
            effectiveChecked,
            manualModels,
            catalog.defaults,
            discovered,
            modelOrder,
            availableNames,
        ],
    )

    const harnessChoices = useMemo<HarnessChoice[]>(
        () =>
            selectableHarnesses(Object.keys(capabilities ?? {})).map((id) => ({
                id,
                label: harnessMetaFor(id).label,
                supported: harnessSupportsProviderKind(capabilities, id, kind, protocol),
                domain: HARNESS_DOMAINS[id],
            })),
        [capabilities, kind, protocol],
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

    // The models show once the check passed, and at once for a saved connection.
    const showModels = passed || !!connection
    // A standard provider keeps its harnesses with its models; the forms with several credential
    // fields show them from the start, under the dashed "Active models" box.
    const showHarnesses = !readOnly && (showModels || !isStandard)

    const done = doneState({
        credentialFilled,
        status: credentialStatus,
        storedCredentialUnchanged,
        transportFailed: checkFailed,
    })

    // What an empty name would become. A connection being edited keeps its own name out of the
    // count, so the preview never names it after itself.
    const previewPool =
        ownerChoice && owner === "organization" ? ownerChoice.connections : connections
    const otherConnections = previewPool.filter((candidate) => candidate.id !== connection?.id)
    // An organization connection's default name says it is the organization's, as the API's does.
    const namePreview = organization
        ? nextConnectionName(
              `${title} (Organization)`,
              otherConnections.map((candidate) => candidate.name),
          )
        : defaultNamePreview(kind, otherConnections)
    const nameValue = name ?? namePreview
    const checkedCount = modelOptions.filter((option) => option.checked).length

    const canSave =
        !readOnly &&
        done.enabled &&
        !!nameValue.trim() &&
        // A list with models needs one checked; an endpoint with no list saves with none, and
        // an edit that leaves a saved choice as it was keeps it.
        (modelOptions.length === 0 ||
            checkedCount > 0 ||
            (!!connection && checkedModels === (connection.models ?? null)))

    // A form with several credential fields checks by itself a moment after the last required
    // field is filled, even when the focus stays in it.
    const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(() => () => clearTimeout(settleTimer.current ?? undefined), [])

    const setField = (key: string, value: string, pasted = false) => {
        const next = {...credential, [key]: value}
        setCredential(next)
        // The last answer belonged to the previous credential; keep it and Save would store an
        // untested key under a stale "works".
        keyCheck.drop()
        clearTimeout(settleTimer.current ?? undefined)
        if (pasted) autoCheck(next, true)
        else if (!isStandard) settleTimer.current = setTimeout(() => autoCheck(next), SETTLE_MS)
    }

    const changeBedrockWay = (next: BedrockWay) => {
        setBedrockWay(next)
        // A delayed check of the other way would answer for the wrong keys.
        clearTimeout(settleTimer.current ?? undefined)
        keyCheck.drop()
    }

    // A harness the new protocol cannot reach leaves the saved list rather than staying in it as
    // policy no run can honour. Only the chosen set is pruned; an untouched card has chosen none.
    const changeProtocol = (next: LlmEndpointProtocol) => {
        setProtocol(next)
        setHarnesses(
            (previous) =>
                previous?.filter((id) =>
                    harnessSupportsProviderKind(capabilities, id, kind, next),
                ) ?? null,
        )
    }

    const toggleModel = (id: string, checked: boolean) =>
        setCheckedModels(
            checked
                ? [...effectiveChecked.filter((model) => model !== id), id]
                : effectiveChecked.filter((model) => model !== id),
        )

    const onSave = async (): Promise<boolean> => {
        setSaving(true)
        setSaveError(null)
        const draft = {
            kind,
            name: nameValue.trim(),
            credential: chosenCredential,
            // Omitted for a record that declares no protocol, which keeps it undeclared:
            // sending the control's displayed default would narrow a gateway nobody
            // described, and an Anthropic-compatible one would lose every Claude Code row.
            ...(protocolField && protocol ? {protocol} : {}),
            modelNames: Object.fromEntries(
                modelOptions.flatMap((option) =>
                    option.checked && option.name ? [[option.id, option.name]] : [],
                ),
            ),
            ...connectionPolicyForSave({
                checkedModels,
                modelIds: modelOptions
                    .filter((option) => option.checked)
                    .map((option) => option.id),
                harnesses,
                defaultHarness,
            }),
        }
        const savedName = nameValue.trim() || namePreview
        try {
            const savedConnectionId = await saveConnection({
                draft,
                fallbackName: namePreview,
                connectionId: connection?.id,
                ...(organization
                    ? {
                          organization: {
                              projects,
                              projectsChanged:
                                  !savedProjects || !sameProjects(savedProjects, projects),
                          },
                      }
                    : {}),
            })
            if (organization) message.success(organizationSavedToast(savedName, projects))
            onSaved(savedConnectionId ?? undefined)
            return true
        } catch (error) {
            setSaveError(
                (organization && organizationSaveError(error, organization.name, savedName)) ||
                    tNow("entityUi.providerConnection.couldNotSave", {provider: displayTitle}),
            )
            return false
        } finally {
            setSaving(false)
        }
    }

    // The host draws Save, so the card hands it a stable submit and the flags behind it.
    const saveRef = useRef(onSave)
    saveRef.current = onSave
    const submit = useCallback(() => saveRef.current(), [])

    useEffect(() => {
        onSaveStateChange?.({canSave, saving, error: saveError, dirty, submit})
    }, [onSaveStateChange, canSave, saving, saveError, dirty, submit])

    // The detail of a failed check goes to the logs; the form says what it means.
    const failedError = checkState.phase === "failed" ? checkState.error : undefined
    useEffect(() => {
        if (failedError !== undefined)
            console.warn("[provider key check]", probeFailureMessage(failedError, title))
    }, [failedError, title])

    const checkAgain = () => runCheck(chosenCredential, true)

    // The line under the credential fields: the check that runs, or what it answered.
    const statusLine = ((): StatusLine | null => {
        if (checkState.phase === "idle") return null
        // Stopped: nothing to report, and "Check again" starts it again.
        if (checkState.phase === "stopped")
            return checkMode === "key" ? {tone: "neutral", text: "", checkAgain: true} : null
        if (checking) return checkMode === "key" ? {tone: "progress"} : null
        if (checkFailed) {
            if (checkMode === "refresh") return null
            const refused = takesBaseUrl && httpStatusOf(checkState.error) === 422
            return {
                tone: "error",
                text: refused
                    ? t("entityUi.providerKeyForm.addressRefused")
                    : t("entityUi.providerKeyForm.checkFailed"),
                checkAgain: !refused,
            }
        }
        if (!probe) return null
        if (credentialStatus === "invalid") {
            return {
                tone: "error",
                text: t("entityUi.providerKeyForm.keyRejected", {provider: displayTitle}),
                checkAgain: true,
            }
        }
        // A refresh with the stored key reports on the list, not on the key.
        if (checkMode === "refresh") return null
        if (credentialStatus === "valid") {
            return {
                tone: "success",
                text: discovered
                    ? t("entityUi.providerKeyForm.keyWorks", {
                          count: probe.discovery.models?.length ?? 0,
                      })
                    : t("entityUi.providerKeyForm.keyWorksNoList"),
                checkAgain: false,
            }
        }
        if (probe.discovery.status === "failed") {
            return {
                tone: "neutral",
                text: t("entityUi.providerKeyForm.notReachedInTime", {provider: displayTitle}),
                checkAgain: true,
            }
        }
        if (kind === "custom" && probe.discovery.status === "unsupported") {
            return {
                tone: "neutral",
                text: t("entityUi.providerKeyForm.noModelList"),
                checkAgain: false,
            }
        }
        if (kind === "custom" && !(chosenCredential.apiKey ?? "").trim()) {
            return {
                tone: "neutral",
                text: t("entityUi.providerKeyForm.answeredWithoutKey"),
                checkAgain: false,
            }
        }
        return {tone: "neutral", text: t("entityUi.providerKeyForm.noFreeCheck"), checkAgain: false}
    })()

    // A refresh with the stored key that did not come back: the saved list stays.
    const unreachableNote =
        checkMode === "refresh" &&
        (checkFailed || (credentialStatus !== "invalid" && probe?.discovery.status === "failed"))
            ? t("entityUi.providerKeyForm.unreachable", {provider: displayTitle})
            : null

    const protocolText = protocolField ? translateProtocolField(protocolField) : null
    const shownFields = fields.filter((field) => !otherWayFields.includes(field.key))
    const firstSecretField = shownFields.find(isSecretField)?.key

    const renderField = (declaredField: ProviderFieldConfig) => {
        const field = translateProviderField(declaredField, kind, {perKindLabels: true})
        const value = credential[field.key] ?? ""
        const block =
            field.attributes?.kind === "json" || field.attributes?.kind === "textarea"
                ? field.attributes
                : null
        const secret = field.attributes?.kind === "text" && field.attributes.type === "password"
        // Stored but unreadable: the field is a replace box, never a prefilled value.
        const replaceOnly = storedFields.includes(field.key)
        const isKey = field.key === "apiKey"
        const label = replaceOnly
            ? isKey
                ? t("entityUi.providerConnection.replaceKey")
                : t("entityUi.providerConnection.replaceField", {field: field.label})
            : isKey && kind === "custom"
              ? t("entityUi.providerKeyForm.apiKeyOptional")
              : field.key === "accessKey"
                ? t("entityUi.providerKeyForm.secretAccessKey")
                : field.label
        const placeholder =
            isKey && replaceOnly && connection?.keyPreview
                ? t("entityUi.providerKeyForm.replaceKeyPlaceholder", {
                      preview: connection.keyPreview,
                  })
                : isKey && isStandard && !replaceOnly
                  ? t("entityUi.providerKeyForm.pasteKey", {provider: displayTitle})
                  : field.placeholder
        // Only the hints that say what to type (a base URL's shape); the secret notes are the
        // "Encrypted at rest" tag, and the Bedrock either/or note is the "Sign in with" switch.
        const note = replaceOnly
            ? isKey
                ? t("entityUi.providerKeyForm.leaveBlank")
                : t("entityUi.providerConnection.savedValueKeep")
            : !isSecretField(field) && field.key !== "bearerToken"
              ? field.note
              : undefined
        const common = {
            disabled: readOnly,
            placeholder,
            ...PASSWORD_MANAGER_OPT_OUT,
            onPaste: () => {
                pastedInto.current = field.key
            },
            onBlur: () => autoCheck(credential),
        }
        const change = (next: string) => {
            const pasted = pastedInto.current === field.key
            pastedInto.current = null
            setField(field.key, next, pasted)
        }

        return (
            <div key={field.key} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-colorText">{label}</span>
                    {field.key === firstSecretField ? (
                        <span className="shrink-0 text-[11px] text-colorTextTertiary">
                            {t("entityUi.providerConnection.encryptedAtRest")}
                        </span>
                    ) : null}
                </div>
                {block ? (
                    <Textarea
                        {...common}
                        rows={block.rows ?? 8}
                        className="font-mono !text-xs"
                        spellCheck={false}
                        autoComplete="off"
                        value={value}
                        onChange={(event) => change(event.target.value)}
                    />
                ) : secret ? (
                    <PasswordInput
                        {...common}
                        autoFocus={!connection && field.key === firstSecretField}
                        className={FIELD_TYPE_SCALE}
                        autoComplete="new-password"
                        value={value}
                        onValueChange={change}
                    />
                ) : (
                    <InputAffix
                        {...common}
                        className={FIELD_TYPE_SCALE}
                        autoComplete="off"
                        value={value}
                        onValueChange={change}
                    />
                )}
                {note ? <span className="text-[11px] text-colorTextTertiary">{note}</span> : null}
            </div>
        )
    }
    const wayFields = shownFields.filter((field) => BEDROCK_FIELDS.includes(field.key))
    const otherFields = shownFields.filter((field) => !BEDROCK_FIELDS.includes(field.key))

    const statusNode = statusLine ? (
        statusLine.tone === "progress" ? (
            <span className="flex items-center gap-2 text-colorTextSecondary" role="status">
                <Spinner size="small" />
                <span>{t("entityUi.providerKeyForm.checking", {provider: displayTitle})}</span>
                <Button
                    variant="link"
                    size="sm"
                    className="h-auto px-0"
                    onClick={() => keyCheck.stop()}
                >
                    {t("entityUi.providerKeyForm.stop")}
                </Button>
            </span>
        ) : (
            <span
                className={
                    statusLine.tone === "error"
                        ? "flex min-w-0 items-start gap-1 text-colorError"
                        : statusLine.tone === "success"
                          ? "flex min-w-0 items-start gap-1.5 text-colorSuccess"
                          : "flex min-w-0 items-start gap-1 text-colorTextSecondary"
                }
                role={statusLine.tone === "error" ? "alert" : "status"}
            >
                {statusLine.tone === "error" ? (
                    <WarningCircle size={14} className="mt-0.5 shrink-0" />
                ) : statusLine.tone === "success" ? (
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-colorSuccess" />
                ) : null}
                <span>
                    {statusLine.text}
                    {statusLine.checkAgain ? (
                        <>
                            {statusLine.text ? " " : null}
                            <Button
                                variant="link"
                                size="sm"
                                className="h-auto px-0 align-baseline"
                                onClick={checkAgain}
                            >
                                {t("entityUi.providerKeyForm.checkAgain")}
                            </Button>
                        </>
                    ) : null}
                </span>
            </span>
        )
    ) : // Before any check, a new standard key says what will happen.
    isStandard && !connection && !readOnly ? (
        <span className="text-[11px] text-colorTextTertiary">
            {t("entityUi.providerKeyForm.keyCheckHint")}
        </span>
    ) : null

    return (
        <div className="flex min-h-full flex-1 flex-col gap-4 text-xs">
            {/* A member cannot rename an organization connection, so the field is not offered. */}
            {readOnly ? null : (
                <div className="flex shrink-0 flex-col gap-1">
                    <span className="font-medium text-colorText">
                        {t("entityUi.providerKeyForm.name")}
                    </span>
                    <InputAffix
                        className={FIELD_TYPE_SCALE}
                        autoComplete="off"
                        {...PASSWORD_MANAGER_OPT_OUT}
                        value={nameValue}
                        onValueChange={setName}
                    />
                </div>
            )}

            <section className="flex shrink-0 flex-col gap-3">
                {otherFields.map(renderField)}

                {isBedrock ? (
                    <div className="flex flex-col gap-1.5">
                        <span className="font-medium text-colorText">
                            {t("entityUi.providerKeyForm.signInWith")}
                        </span>
                        <OwnerRadioGroup<BedrockWay>
                            aria-label={t("entityUi.providerKeyForm.signInWith")}
                            value={bedrockWay}
                            onChange={changeBedrockWay}
                            options={[
                                {
                                    value: "apiKey",
                                    label: t("entityUi.providerKeyForm.bedrockApiKey"),
                                    note: t("entityUi.providerKeyForm.bedrockApiKeyHint"),
                                },
                                {
                                    value: "accessKeys",
                                    label: t("entityUi.providerKeyForm.bedrockAccessKeys"),
                                    note: t("entityUi.providerKeyForm.bedrockAccessKeysHint"),
                                },
                            ]}
                        />
                    </div>
                ) : null}

                {wayFields.map(renderField)}

                {protocolText ? (
                    <div className="flex flex-col gap-1">
                        <span className="font-medium text-colorText">{protocolText.label}</span>
                        <Segmented
                            size="sm"
                            disabled={readOnly}
                            options={protocolText.options}
                            // An undeclared record shows the default without having declared it;
                            // pressing an option is what makes the statement.
                            value={protocol ?? DEFAULT_ENDPOINT_PROTOCOL}
                            onChange={(next) => changeProtocol(next as LlmEndpointProtocol)}
                        />
                    </div>
                ) : null}

                {statusNode}
            </section>

            {ownerChoice ? (
                <div className="flex shrink-0 flex-col gap-1.5">
                    <span className="font-medium text-colorText">
                        {t("entityUi.providerConnection.whoCanUseIt")}
                    </span>
                    <OwnerRadioGroup<ProviderOwner>
                        value={owner}
                        onChange={setOwner}
                        options={[
                            {
                                value: "project",
                                label: t("entityUi.providerConnection.everyoneIn", {
                                    project: ownerChoice.projectName,
                                }),
                                note: t("entityUi.providerConnection.storedInProject"),
                            },
                            {
                                value: "organization",
                                label: t("entityUi.providerConnection.theOrganization", {
                                    organization: organizationLabel(ownerChoice.organization.name),
                                }),
                                note: t("entityUi.providerConnection.storedOnce"),
                            },
                        ]}
                    />
                </div>
            ) : null}

            {showModels ? (
                <ActiveModelsSection
                    readOnly={readOnly}
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
                    onRefresh={() => runCheck(chosenCredential, true)}
                    refreshing={checking && checkMode === "refresh"}
                    unreachableNote={unreachableNote}
                />
            ) : isStandard ? (
                // The models come after the key works; one line says so.
                <p className="m-0 text-colorTextTertiary">
                    {t("entityUi.providerKeyForm.nextModels")}
                </p>
            ) : (
                // Says where the model list comes from instead of leaving the card blank.
                <section className="flex shrink-0 flex-col gap-2">
                    <span className="font-medium text-colorText">
                        {t("entityUi.providerConnection.activeModels")}
                    </span>
                    <p className="m-0 rounded-md border border-dashed border-colorBorderSecondary px-3 py-4 text-center text-colorTextTertiary">
                        {t("entityUi.providerConnection.enterCredential", {provider: displayTitle})}
                    </p>
                </section>
            )}

            {showHarnesses ? (
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
            ) : null}

            {organization && !readOnly ? (
                <OrganizationProjectsSection
                    scope={organization}
                    value={projects}
                    onChange={setProjects}
                    saved={savedProjects}
                />
            ) : null}
        </div>
    )
}

export default ProviderConnectionCard
