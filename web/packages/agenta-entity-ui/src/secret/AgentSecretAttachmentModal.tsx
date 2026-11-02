import {useEffect, useMemo, useRef, useState} from "react"

import {userItemKey} from "@agenta/entities/accountChoice"
import {
    CustomSecretFormat,
    isUserSecretBinding,
    personalAccountsAccessAtom,
    useVaultSecret,
    type AgentSecretBinding,
    type NamedSecretRow,
} from "@agenta/entities/secret"
import {workflowMolecule} from "@agenta/entities/workflow"
import type {OwnerKind} from "@agenta/shared/types"
import {isValidUUID, slugifyBase, toEnvVarName} from "@agenta/shared/utils"
import {message} from "@agenta/ui/app-message"
import {EnhancedModal} from "@agenta/ui/components/modal"
import {
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {ACCOUNT_COPY} from "../accounts/copy"
import {useAccountChoice} from "../accounts/useAccountChoice"
import {useProjectName} from "../accounts/useProjectName"

import {OwnerRadioGroup} from "./OwnerRadioGroup"
import {SecretCreateFields} from "./SecretCreateFields"
import {useSecretForm, type SavedSecret} from "./SecretForm"
import {YourSecretLine} from "./YourSecretLine"

export interface AgentSecretAttachmentTarget {
    revisionId: string
    label: string
}

export interface AgentSecretRequestSeed {
    name: string
    envVar?: string
    reason?: string
}

export interface AgentSecretAttachmentResult {
    /** The `sandbox.credentials[]` entry the attach wrote. */
    credential: AgentSecretBinding
    revisionId: string
}

export interface AgentSecretAttachmentModalProps {
    open: boolean
    onClose: () => void
    target: AgentSecretAttachmentTarget
    request?: AgentSecretRequestSeed
    bindings: AgentSecretBinding[]
    baseRevisionId: string
    editingBinding?: {index: number; value: AgentSecretBinding}
    initialMode?: "existing" | "create"
    dirty?: boolean
    disabled?: boolean
    canCreateSecret?: boolean
    commitBinding: (input: {
        baseRevisionId: string
        /** The `sandbox.credentials[]` entry to add, or to put at `editIndex`. */
        credential: AgentSecretBinding
        editIndex?: number
    }) => Promise<{revisionId: string}>
    onAttached?: (result: AgentSecretAttachmentResult) => void
    zIndex?: number
    /** A host panel (e.g. a drawer) to mask and centre within instead of the page. */
    container?: HTMLElement | null
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const SECRET_FIELD_ID = "agent-secret-attach-secret"
const ENV_FIELD_ID = "agent-secret-attach-env"
/** The picker option that swaps in the inline create fields. */
const NEW_SECRET = "__new__"
/** The picker option "Each person's own secret". */
const PERSONAL_SECRET = "__personal__"

type SecretOwner = Exclude<OwnerKind, "organization">

/** Who may own a new secret, as on Settings; the first is the default. Absent: the project's. */
export const newSecretOwners = (
    personalAccountsOn: boolean,
    canCreateProjectSecret: boolean,
): SecretOwner[] | undefined => {
    if (!personalAccountsOn) return undefined
    return canCreateProjectSecret ? ["user", "project"] : ["user"]
}

/** The saved secret the agent most likely means: same env var, name, or slug as the request. */
export const matchRequestedSecret = <
    T extends Pick<NamedSecretRow, "name" | "slug" | "defaultEnvVar">,
>(
    secrets: T[],
    request?: AgentSecretRequestSeed,
): T | undefined => {
    if (!request) return undefined
    const name = request.name.trim().toLowerCase()
    const slug = slugifyBase(request.name)
    return (
        (request.envVar ? secrets.find((s) => s.defaultEnvVar === request.envVar) : undefined) ??
        secrets.find((s) => s.name?.trim().toLowerCase() === name) ??
        secrets.find((s) => !!slug && s.slug === slug)
    )
}

export const suggestedAgentSecretEnv = ({
    requestEnv,
    defaultEnvVar,
    name,
}: {
    requestEnv?: string
    defaultEnvVar?: string
    name: string
}): string => requestEnv || defaultEnvVar || toEnvVarName(name)

export const preserveAgentSecretEnvOverride = ({
    current,
    touched,
    requestEnv,
    defaultEnvVar,
    name,
}: {
    current: string
    touched: boolean
    requestEnv?: string
    defaultEnvVar?: string
    name: string
}): string => (touched ? current : suggestedAgentSecretEnv({requestEnv, defaultEnvVar, name}))

/** The variable as typed, a beat behind, so typing it asks the server once and not per letter. */
const useDebouncedEnv = (envVar: string, active: boolean): string => {
    const [settled, setSettled] = useState(envVar)
    useEffect(() => {
        if (!active) return
        const timer = setTimeout(() => setSettled(envVar), 400)
        return () => clearTimeout(timer)
    }, [active, envVar])
    return settled
}

export function AgentSecretAttachmentModal({
    open,
    onClose,
    target,
    request,
    bindings,
    baseRevisionId,
    editingBinding,
    initialMode = "existing",
    dirty = false,
    disabled = false,
    canCreateSecret = true,
    commitBinding,
    onAttached,
    zIndex = 1000,
    container,
}: AgentSecretAttachmentModalProps) {
    const {namedSecrets, loading, mutate: refetchVault} = useVaultSecret()
    // The modal stacks above the Advanced dialog, and the shared Select portals its list to
    // <body> at z-50. Without this the options paint UNDER the modal and the picker looks
    // empty (#6733). One layer above the modal is enough; nothing else sits between them.
    const popupZIndex = zIndex + 1
    const textSecrets = useMemo(
        () => namedSecrets.filter((secret) => secret.format === CustomSecretFormat.Text),
        [namedSecrets],
    )
    const access = useAtomValue(personalAccountsAccessAtom)
    const [selectedSlug, setSelectedSlug] = useState("")
    const [createdSecret, setCreatedSecret] = useState<SavedSecret | null>(null)
    const [envVar, setEnvVar] = useState("")
    const [envTouched, setEnvTouched] = useState(false)
    const [attaching, setAttaching] = useState(false)
    const owners = newSecretOwners(access === "on", canCreateSecret)
    const canCreate = canCreateSecret || access === "on"
    const [chosenOwner, setOwner] = useState<SecretOwner>("user")
    const owner = owners?.includes(chosenOwner) ? chosenOwner : (owners?.[0] ?? "project")
    const [error, setError] = useState<string | null>(null)
    // Set once the modal has picked its opening choice, or the user has picked one.
    const choiceMade = useRef(false)
    // Cached rows can predate a secret made elsewhere; the opening choice waits for the refetch.
    const [vaultFresh, setVaultFresh] = useState(false)
    const nameRef = useRef<HTMLInputElement>(null)
    const valueRef = useRef<HTMLTextAreaElement>(null)
    // A seeded name means the value is the only thing left to type.
    const focusNewSecretField = () =>
        (request?.name?.trim() ? valueRef.current : nameRef.current)?.focus()

    const allSecrets = useMemo(() => {
        if (!createdSecret || textSecrets.some((secret) => secret.slug === createdSecret.slug)) {
            return textSecrets
        }
        return [...textSecrets, {...createdSecret, type: "custom_secret"} as NamedSecretRow]
    }, [createdSecret, textSecrets])

    const suggestion = (secret?: Pick<NamedSecretRow, "name" | "defaultEnvVar">) =>
        suggestedAgentSecretEnv({
            requestEnv: request?.envVar,
            defaultEnvVar: secret?.defaultEnvVar,
            name: secret?.name || request?.name || "",
        })

    useEffect(() => {
        // Reset on close too, so a reopen never reads the last cycle's freshness.
        setVaultFresh(false)
        if (!open) return
        // The vault query keeps a live subscriber for the whole page, so nothing refetches it on
        // its own; a secret created in Settings or another tab stays invisible until a reload.
        // `refetchVault` is keyed on the query result and changes identity on every fetch, so
        // it must stay out of the deps or this effect refetches forever.
        let current = true
        void Promise.resolve(refetchVault()).finally(() => {
            if (current) setVaultFresh(true)
        })
        return () => {
            current = false
        }
    }, [open])

    useEffect(() => {
        if (!open) return
        const original = editingBinding?.value
        const initialSlug = original
            ? isUserSecretBinding(original)
                ? PERSONAL_SECRET
                : (original.secret.slug ?? "")
            : ""
        const initialSecret = textSecrets.find((secret) => secret.slug === initialSlug)
        const startNew = canCreate && !original && initialMode === "create"
        choiceMade.current = Boolean(original) || startNew
        setSelectedSlug(startNew ? NEW_SECRET : initialSlug)
        setCreatedSecret(null)
        setOwner("user")
        setEnvVar(original?.binding.name ?? suggestion(initialSecret))
        setEnvTouched(Boolean(original))
        setAttaching(false)
        setError(null)
        // The target/base identify one opening transaction. Query refreshes must not clear typing.
    }, [open, target.revisionId, baseRevisionId, editingBinding?.index, initialMode, canCreate])

    const selectSecret = (slug: string) => {
        choiceMade.current = true
        setSelectedSlug(slug)
        setError(null)
        if (!envTouched && slug !== PERSONAL_SECRET) {
            const secret = allSecrets.find((candidate) => candidate.slug === slug)
            setEnvVar(
                preserveAgentSecretEnvOverride({
                    current: envVar,
                    touched: envTouched,
                    requestEnv: request?.envVar,
                    defaultEnvVar: secret?.defaultEnvVar,
                    name: secret?.name || request?.name || "",
                }),
            )
        }
    }

    // Opening choice, once the vault has loaded: the matching secret, else a new one when
    // there is nothing to pick from.
    useEffect(() => {
        if (!open || loading || !vaultFresh || choiceMade.current) return
        const match = matchRequestedSecret(textSecrets, request)
        if (match?.slug) selectSecret(match.slug)
        else if (canCreate && textSecrets.length === 0) selectSecret(NEW_SECRET)
        else choiceMade.current = true
    }, [open, loading, vaultFresh, textSecrets])

    const personal = selectedSlug === PERSONAL_SECRET
    const creating = selectedSlug === NEW_SECRET
    const personalOption = access === "on" || personal

    const duplicate = bindings.some(
        (candidate, index) =>
            index !== editingBinding?.index && candidate.binding.name === envVar.trim(),
    )
    const envError = envVar.length > 0 && !ENV_NAME.test(envVar)
    const envOk = !!envVar.trim() && !envError && !duplicate

    const workflowId = useAtomValue(workflowMolecule.selectors.workflowId(target.revisionId)) ?? ""
    const {choose: storeChoice} = useAccountChoice(workflowId, userItemKey("secret", envVar.trim()))

    const attach = async (slug: string, saved?: SavedSecret) => {
        const asPersonal = slug === PERSONAL_SECRET
        if (disabled || dirty || !slug || !envOk || attaching) return
        setAttaching(true)
        setError(null)
        // A "user" secret names no slug: each person who runs the agent gives their own value
        // (contract section 5.1).
        const credential: AgentSecretBinding = {
            secret: asPersonal ? {account_source: "user"} : {slug},
            binding: {type: "env", name: envVar.trim()},
        }
        try {
            const result = await commitBinding({
                baseRevisionId,
                credential,
                editIndex: editingBinding?.index,
            })
            onAttached?.({credential, revisionId: result.revisionId})
            onClose()
        } catch (cause) {
            setError(
                `${saved ? "Saved in vault; not attached. " : ""}${
                    cause instanceof Error ? cause.message : "The secret could not be attached."
                }`,
            )
        } finally {
            setAttaching(false)
        }
    }

    // Save & attach: the new secret is saved, then attached in the same step. If the attach
    // fails, the saved secret stays selected so Attach can retry it.
    const handleCreated = async (secret: SavedSecret) => {
        if (owner === "user") {
            // "Only me": the item takes each person's own secret, and this one is the choice.
            // Stored first: a failed attach retries from the line, which then shows this choice.
            setSelectedSlug(PERSONAL_SECRET)
            const stored = secret.id ? await storeChoice({secretId: secret.id}) : false
            if (stored !== true) message.error(ACCOUNT_COPY.choiceFailed)
            await attach(PERSONAL_SECRET, secret)
            return
        }
        setCreatedSecret(secret)
        setSelectedSlug(secret.slug)
        void attach(secret.slug, secret)
    }

    const createController = useSecretForm({
        open: open && creating,
        initialName: request?.name,
        initialDefaultEnvVar: request?.envVar,
        ownerKind: owner === "user" ? "user" : undefined,
        onSaved: (secret) => void handleCreated(secret),
    })
    const askOwner = creating && (owners?.length ?? 0) > 1
    const projectName = useProjectName(askOwner)

    // The line needs a saved agent to store a choice against, and a variable to store it for.
    const lineEnv = useDebouncedEnv(envVar.trim(), open && personal)
    const showLine = personal && isValidUUID(target.revisionId) && ENV_NAME.test(lineEnv)
    const lineBindings = useMemo<AgentSecretBinding[]>(
        () => [
            ...bindings.filter((_, index) => index !== editingBinding?.index),
            {secret: {account_source: "user"}, binding: {type: "env", name: lineEnv}},
        ],
        [bindings, editingBinding, lineEnv],
    )

    const canSubmit =
        !disabled &&
        !dirty &&
        envOk &&
        (creating
            ? !!createController.name.trim() &&
              !!createController.textValue.trim() &&
              !createController.okDisabled
            : !!selectedSlug)

    const submit = () => (creating ? createController.submit() : attach(selectedSlug))

    const title = editingBinding ? "Edit secret attachment" : "Attach a secret"

    return (
        <EnhancedModal
            open={open}
            onCancel={onClose}
            zIndex={zIndex}
            getContainer={container ?? undefined}
            contained={!!container}
            width={480}
            destroyOnClose
            title={
                <span className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0">{title}</span>
                    <span className="min-w-0 truncate text-xs font-normal text-colorTextSecondary">
                        · {target.label}
                    </span>
                </span>
            }
            okText={creating ? "Save & attach" : editingBinding ? "Save" : "Attach"}
            onOk={() => void submit()}
            confirmLoading={createController.saving || attaching}
            okButtonProps={{disabled: !canSubmit}}
        >
            <div className="flex flex-col gap-4">
                {request ? (
                    <p className="m-0 text-xs text-colorTextSecondary">
                        The agent asked for{" "}
                        <span className="font-medium text-colorText">{request.name}</span>
                        {request.reason ? ` · ${request.reason}` : ""}
                    </p>
                ) : null}

                <div className="flex flex-col gap-1">
                    <label htmlFor={SECRET_FIELD_ID} className="font-medium text-colorText">
                        {personalOption ? ACCOUNT_COPY.label : "Secret"}
                    </label>
                    <Select value={selectedSlug} onValueChange={selectSecret} disabled={loading}>
                        <SelectTrigger id={SECRET_FIELD_ID}>
                            <SelectValue
                                placeholder={loading ? "Loading secrets..." : "Select a secret"}
                            />
                        </SelectTrigger>
                        <SelectContent
                            container={container}
                            style={{zIndex: popupZIndex}}
                            // Radix hands focus back to the trigger on close; send it to the new fields.
                            onCloseAutoFocus={(event) => {
                                if (selectedSlug !== NEW_SECRET) return
                                event.preventDefault()
                                focusNewSecretField()
                            }}
                        >
                            {personalOption ? (
                                <>
                                    <SelectItem value={PERSONAL_SECRET}>
                                        {ACCOUNT_COPY.eachPersonSecret}
                                    </SelectItem>
                                    {allSecrets.length > 0 ? <SelectSeparator /> : null}
                                </>
                            ) : null}
                            {allSecrets.map((secret) => (
                                <SelectItem key={secret.slug} value={secret.slug ?? ""}>
                                    {secret.name}
                                </SelectItem>
                            ))}
                            {canCreate ? (
                                <>
                                    {allSecrets.length > 0 || personalOption ? (
                                        <SelectSeparator />
                                    ) : null}
                                    <SelectItem value={NEW_SECRET}>
                                        {ACCOUNT_COPY.createNewSecret}
                                    </SelectItem>
                                </>
                            ) : null}
                        </SelectContent>
                    </Select>
                    {personal ? (
                        showLine ? (
                            <YourSecretLine
                                revisionId={target.revisionId}
                                bindings={lineBindings}
                                envVar={lineEnv}
                                container={container}
                                zIndex={popupZIndex}
                            />
                        ) : (
                            <span className="text-xs text-colorTextSecondary">
                                {ACCOUNT_COPY.secretValueLine}
                            </span>
                        )
                    ) : null}
                </div>

                {creating ? (
                    <>
                        <SecretCreateFields
                            controller={createController}
                            focusValue={!!request?.name?.trim()}
                            hint={owner === "user" ? undefined : "Stored in the project vault."}
                            nameRef={nameRef}
                            valueRef={valueRef}
                            onNameChange={(name) => {
                                if (!envTouched) setEnvVar(suggestion({name}))
                            }}
                        />
                        {askOwner ? (
                            <div className="flex flex-col gap-1">
                                <span className="font-medium text-colorText">
                                    {ACCOUNT_COPY.whoCanUseIt}
                                </span>
                                <OwnerRadioGroup<SecretOwner>
                                    value={owner}
                                    onChange={setOwner}
                                    options={[
                                        {
                                            value: "user",
                                            label: ACCOUNT_COPY.onlyMe,
                                            note: ACCOUNT_COPY.onlyMeSecretNote,
                                        },
                                        {
                                            value: "project",
                                            label: ACCOUNT_COPY.everyoneIn(projectName),
                                            note: ACCOUNT_COPY.everyoneSecretNote,
                                        },
                                    ]}
                                />
                            </div>
                        ) : null}
                    </>
                ) : null}

                <div className="flex flex-col gap-1">
                    <label htmlFor={ENV_FIELD_ID} className="font-medium text-colorText">
                        Environment variable
                    </label>
                    <Input
                        id={ENV_FIELD_ID}
                        className="font-mono"
                        value={envVar}
                        placeholder="For example, GITHUB_TOKEN"
                        onChange={(event) => {
                            setEnvTouched(true)
                            setEnvVar(event.target.value)
                            setError(null)
                        }}
                        autoComplete="off"
                        spellCheck={false}
                        aria-invalid={envError || duplicate || undefined}
                    />
                    <span
                        className={`text-xs ${envError || duplicate ? "text-error" : "text-colorTextSecondary"}`}
                    >
                        {envError
                            ? "Use letters, digits, and underscores; do not start with a digit."
                            : duplicate
                              ? "This secret or environment variable is already attached."
                              : "The agent receives this secret through the named variable."}
                    </span>
                </div>

                {dirty ? (
                    <div className="rounded-lg border border-[var(--ag-colorWarningBorder)] bg-[var(--ag-colorWarningBg)] p-3 text-xs text-colorText">
                        Save or discard the current agent changes before attaching a secret.
                    </div>
                ) : null}
                {error ? (
                    <div className="rounded-lg border border-[var(--ag-colorErrorBorder)] bg-[var(--ag-colorErrorBg)] p-3 text-xs text-error">
                        {error}
                    </div>
                ) : null}
            </div>
        </EnhancedModal>
    )
}
