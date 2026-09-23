import {useEffect, useMemo, useRef, useState} from "react"

import {
    CustomSecretFormat,
    useVaultSecret,
    type AgentSecretBinding,
    type NamedSecretRow,
} from "@agenta/entities/secret"
import {slugifyBase, toEnvVarName} from "@agenta/shared/utils"
import {EnhancedModal} from "@agenta/ui/components/modal"
import {
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
    Textarea,
} from "@agenta/ui/ui"

import {useSecretForm, type SavedSecret} from "./SecretForm"

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
    secretSlug: string
    envVar: string
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
        secretSlug: string
        envVar: string
        editIndex?: number
    }) => Promise<{revisionId: string}>
    onAttached?: (result: AgentSecretAttachmentResult) => void
    zIndex?: number
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const SECRET_FIELD_ID = "agent-secret-attach-secret"
const ENV_FIELD_ID = "agent-secret-attach-env"
const NAME_FIELD_ID = "agent-secret-attach-name"
const VALUE_FIELD_ID = "agent-secret-attach-value"
/** The picker option that swaps in the inline create fields. */
const NEW_SECRET = "__new__"

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
    const [selectedSlug, setSelectedSlug] = useState("")
    const [createdSecret, setCreatedSecret] = useState<SavedSecret | null>(null)
    const [envVar, setEnvVar] = useState("")
    const [envTouched, setEnvTouched] = useState(false)
    const [attaching, setAttaching] = useState(false)
    const [error, setError] = useState<string | null>(null)
    // Set once the modal has picked its opening choice, or the user has picked one.
    const choiceMade = useRef(false)
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
        if (!open) return
        // The vault query keeps a live subscriber for the whole page, so nothing refetches it on
        // its own; a secret created in Settings or another tab stays invisible until a reload.
        // `refetchVault` is keyed on the query result and changes identity on every fetch, so
        // it must stay out of the deps or this effect refetches forever.
        refetchVault()
    }, [open])

    useEffect(() => {
        if (!open) return
        const original = editingBinding?.value
        const initialSlug = original?.secret.slug ?? ""
        const initialSecret = textSecrets.find((secret) => secret.slug === initialSlug)
        const startNew = canCreateSecret && !original && initialMode === "create"
        choiceMade.current = Boolean(original) || startNew
        setSelectedSlug(startNew ? NEW_SECRET : initialSlug)
        setCreatedSecret(null)
        setEnvVar(original?.binding.name ?? suggestion(initialSecret))
        setEnvTouched(Boolean(original))
        setAttaching(false)
        setError(null)
        // The target/base identify one opening transaction. Query refreshes must not clear typing.
    }, [
        open,
        target.revisionId,
        baseRevisionId,
        editingBinding?.index,
        initialMode,
        canCreateSecret,
    ])

    const selectSecret = (slug: string) => {
        choiceMade.current = true
        setSelectedSlug(slug)
        setError(null)
        if (!envTouched) {
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
        if (!open || loading || choiceMade.current) return
        const match = matchRequestedSecret(textSecrets, request)
        if (match?.slug) selectSecret(match.slug)
        else if (canCreateSecret && textSecrets.length === 0) selectSecret(NEW_SECRET)
        else choiceMade.current = true
    }, [open, loading, textSecrets])

    const creating = selectedSlug === NEW_SECRET

    const duplicate = bindings.some(
        (candidate, index) =>
            index !== editingBinding?.index && candidate.binding.name === envVar.trim(),
    )
    const envError = envVar.length > 0 && !ENV_NAME.test(envVar)
    const envOk = !!envVar.trim() && !envError && !duplicate

    const attach = async (slug: string, saved?: SavedSecret) => {
        if (disabled || dirty || !slug || !envOk || attaching) return
        setAttaching(true)
        setError(null)
        try {
            const result = await commitBinding({
                baseRevisionId,
                secretSlug: slug,
                envVar: envVar.trim(),
                editIndex: editingBinding?.index,
            })
            onAttached?.({secretSlug: slug, envVar: envVar.trim(), revisionId: result.revisionId})
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
    const handleCreated = (secret: SavedSecret) => {
        setCreatedSecret(secret)
        setSelectedSlug(secret.slug)
        void attach(secret.slug, secret)
    }

    const createController = useSecretForm({
        open: open && creating,
        initialName: request?.name,
        initialDefaultEnvVar: request?.envVar,
        onSaved: handleCreated,
    })

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
                        Secret
                    </label>
                    <Select value={selectedSlug} onValueChange={selectSecret} disabled={loading}>
                        <SelectTrigger id={SECRET_FIELD_ID}>
                            <SelectValue
                                placeholder={loading ? "Loading secrets..." : "Select a secret"}
                            />
                        </SelectTrigger>
                        <SelectContent
                            style={{zIndex: popupZIndex}}
                            // Radix hands focus back to the trigger on close; send it to the new fields.
                            onCloseAutoFocus={(event) => {
                                if (selectedSlug !== NEW_SECRET) return
                                event.preventDefault()
                                focusNewSecretField()
                            }}
                        >
                            {allSecrets.map((secret) => (
                                <SelectItem key={secret.slug} value={secret.slug ?? ""}>
                                    {secret.name}
                                </SelectItem>
                            ))}
                            {canCreateSecret ? (
                                <>
                                    {allSecrets.length > 0 ? <SelectSeparator /> : null}
                                    <SelectItem value={NEW_SECRET}>+ New secret</SelectItem>
                                </>
                            ) : null}
                        </SelectContent>
                    </Select>
                </div>

                {creating ? (
                    <>
                        <div className="flex flex-col gap-1">
                            <label htmlFor={NAME_FIELD_ID} className="font-medium text-colorText">
                                Name
                            </label>
                            <Input
                                id={NAME_FIELD_ID}
                                ref={nameRef}
                                autoFocus={!request?.name?.trim()}
                                placeholder="For example, GITHUB_TOKEN"
                                value={createController.name}
                                onChange={(event) => {
                                    createController.onChangeName(event.target.value)
                                    if (!envTouched) {
                                        setEnvVar(suggestion({name: event.target.value}))
                                    }
                                }}
                            />
                        </div>
                        <div className="flex flex-col gap-1 ph-no-capture">
                            <label htmlFor={VALUE_FIELD_ID} className="font-medium text-colorText">
                                Value
                            </label>
                            <Textarea
                                id={VALUE_FIELD_ID}
                                ref={valueRef}
                                rows={3}
                                className="font-mono"
                                autoFocus={!!request?.name?.trim()}
                                value={createController.textValue}
                                onChange={(event) =>
                                    createController.setTextValue(event.target.value)
                                }
                                autoComplete="off"
                                spellCheck={false}
                            />
                            <span className="text-xs text-colorTextSecondary">
                                Stored in the project vault.
                            </span>
                        </div>
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
