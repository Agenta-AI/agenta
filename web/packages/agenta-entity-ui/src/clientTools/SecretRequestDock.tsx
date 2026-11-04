import {useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent} from "react"

import {userItemKey} from "@agenta/entities/accountChoice"
import {
    isUserSecretBinding,
    personalAccountsAccessAtom,
    personalNamedSecretsAtom,
    useVaultSecret,
    type AgentSecretBinding,
} from "@agenta/entities/secret"
import {commitAgentCredentialsAtom, workflowMolecule} from "@agenta/entities/workflow"
import type {ClientToolMeta} from "@agenta/shared/clientTools"
import {message} from "@agenta/ui/app-message"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    Input,
    LoadingButton,
    Textarea,
} from "@agenta/ui/ui"
import {DotsThree, PencilSimple} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {ACCOUNT_COPY} from "../accounts/copy"
import {useAccountChoice} from "../accounts/useAccountChoice"
import {useItemAccount} from "../accounts/useItemAccount"
import {
    AgentSecretAttachmentModal,
    ENV_NAME,
    newSecretOwners,
    PASSWORD_MANAGER_OPT_OUT,
    useSecretForm,
    type SavedSecret,
} from "../secret"

import {
    parseSecretRequest,
    replaceableRow,
    resolveSecretDockSubject,
    type VaultRead,
} from "./secretRequestDockState"

interface SecretRequestDockProps {
    meta: ClientToolMeta
    revisionId: string
    canEditSecrets?: boolean
    onAdoptRevision: (revisionId: string) => void
    /** Settle channel. Resolving `false` means the write did not land and the gate is still open
     *  (see `SettleClientTool`), so the buttons come back. */
    onOutput: (args: {
        toolName: string
        toolCallId: string
        output: Record<string, unknown>
    }) => void | boolean | Promise<void | boolean>
}

const VALUE_FIELD_LABEL = "Secret value"
const VAULT_READ_TIMEOUT_MS = 3000

/** Text already typed in the focused field, which a new card must not take the keys from. */
const typingElsewhere = () => {
    const active = document.activeElement
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        return active.value.trim().length > 0
    }
    return active instanceof HTMLElement && active.isContentEditable
        ? (active.textContent ?? "").trim().length > 0
        : false
}

export const SecretRequestDock = ({
    meta,
    revisionId,
    canEditSecrets = false,
    onAdoptRevision,
    onOutput,
}: SecretRequestDockProps) => {
    const [targetId, setTargetId] = useState(revisionId)
    // The dock outlives a revision switch on both hosts, so it follows the prop when it moves.
    const [seenRevisionId, setSeenRevisionId] = useState(revisionId)
    if (seenRevisionId !== revisionId) {
        setSeenRevisionId(revisionId)
        setTargetId(revisionId)
    }
    const [modalOpen, setModalOpen] = useState(false)
    const [settling, setSettling] = useState(false)
    const [committing, setCommitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    // Saved in the vault but not attached: Continue retries the attachment, not the save.
    const [unattached, setUnattached] = useState<AgentSecretBinding["secret"] | null>(null)
    // Null follows the request; a person's "Change value" or "Keep saved value" overrides it.
    const [entryChoice, setEntryChoice] = useState<boolean | null>(null)
    const [editingEnv, setEditingEnv] = useState(false)
    const [vault, setVault] = useState<VaultRead>("checking")
    const [typing, setTyping] = useState(false)
    const valueRef = useRef<HTMLTextAreaElement>(null)

    const commit = useSetAtom(commitAgentCredentialsAtom)
    const configuration = useAtomValue(workflowMolecule.selectors.configuration(targetId))
    const dirty = useAtomValue(workflowMolecule.selectors.isDirty(targetId))
    const artifactName = useAtomValue(workflowMolecule.selectors.artifactName(targetId))
    const entity = useAtomValue(workflowMolecule.selectors.data(targetId))
    const workflowId = useAtomValue(workflowMolecule.selectors.workflowId(targetId)) ?? ""
    const access = useAtomValue(personalAccountsAccessAtom)
    const personalSecrets = useAtomValue(personalNamedSecretsAtom)
    const {namedSecrets, mutate: refetchVault} = useVaultSecret()

    const agent = configuration?.agent as
        | {sandbox?: {credentials?: AgentSecretBinding[]}}
        | undefined
    const bindings = agent?.sandbox?.credentials ?? []
    const request = parseSecretRequest(meta.input)
    const label = artifactName || "This agent"

    // The vault query never refetches itself; `refetchVault` changes identity, so it is not a dep.
    useEffect(() => {
        let current = true
        const finish = (read: VaultRead) => {
            if (!current) return
            current = false
            setVault(read)
        }
        // A failing vault retries for a long time, and the card must not sit without an action.
        const timer = setTimeout(() => finish("failed"), VAULT_READ_TIMEOUT_MS)
        Promise.resolve(refetchVault()).then(
            (result) => finish((result as {isError?: boolean})?.isError ? "failed" : "fresh"),
            () => finish("failed"),
        )
        return () => {
            current = false
            clearTimeout(timer)
        }
    }, [])

    const resolved = request
        ? resolveSecretDockSubject({
              request,
              bindings,
              secrets: [...namedSecrets, ...personalSecrets],
              // Until the revision loads, no binding reads the same as an unattached secret.
              vault: entity ? vault : "checking",
          })
        : undefined
    // A late vault answer must not swap the card, and clear the value, under a person typing.
    const heldSubject = useRef(resolved)
    if (!typing) heldSubject.current = resolved
    const subject = heldSubject.current
    const attachment =
        subject?.kind === "attached" || subject?.kind === "missing" ? subject : undefined
    const replaceable = subject ? replaceableRow(subject) : undefined
    const hasSaved = subject?.kind === "vault" || subject?.kind === "attached"
    const inlineValue =
        canEditSecrets && !!subject && subject.kind !== "checking" && (!hasSaved || !!replaceable)
    const entry =
        inlineValue && !unattached && (entryChoice ?? (!hasSaved || request?.rejected === true))

    const [envVar, setEnvVar] = useState(request?.envVar ?? "")
    const envName = envVar.trim()
    const envInvalid = !ENV_NAME.test(envName)
    const envTaken = bindings.some(
        (item, index) => index !== attachment?.index && item.binding.name === envName,
    )
    const envError = envInvalid
        ? "Use letters, digits, and underscores; do not start with a digit."
        : envTaken
          ? "This environment variable is already attached."
          : null
    const envChanged = envName !== attachment?.binding.binding.name

    const owners = newSecretOwners(access === "on", canEditSecrets)
    const owner = owners?.[0] ?? "project"
    const replacing = entry && !!replaceable
    const personalRow = replaceable?.ownerKind === "user"
    const savesPersonal = replacing ? personalRow : owner === "user"
    const {choose: storeChoice} = useAccountChoice(workflowId, userItemKey("secret", envName))
    const {account: ownAccount} = useItemAccount(
        {revisionId: targetId, agent: agent ?? {}},
        userItemKey("secret", attachment?.binding.binding.name ?? envName),
    )

    const settle = (output: Record<string, unknown>) => {
        if (settling || meta.settled) return
        setSettling(true)
        // A host that reports the failure itself still resolves, with `false` (see
        // `ClientToolOutputHandler`). Give the buttons back rather than spinning over a gate that
        // is still open.
        void Promise.resolve(
            onOutput({toolName: meta.toolName, toolCallId: meta.toolCallId, output}),
        ).then(
            (landed) => {
                if (landed === false) setSettling(false)
            },
            () => setSettling(false),
        )
    }
    /** A "user" secret reports `{account_source: "user"}` in place of a slug. */
    const configured = (
        secret: AgentSecretBinding["secret"],
        name: string,
        nextRevisionId: string,
    ) => {
        onAdoptRevision(nextRevisionId)
        settle({status: "configured", secret, env_var: name, revision_id: nextRevisionId})
    }

    const commitBinding = async ({
        baseRevisionId,
        credential,
        editIndex,
    }: {
        baseRevisionId: string
        credential: AgentSecretBinding
        editIndex?: number
    }) => {
        const nextBindings =
            editIndex === undefined
                ? [...bindings, credential]
                : bindings.map((item, index) => (index === editIndex ? credential : item))
        const result = await commit({revisionId: baseRevisionId, bindings: nextBindings})
        setTargetId(result.revisionId)
        return result
    }

    const attach = async (secret: AgentSecretBinding["secret"], justSaved: boolean) => {
        setCommitting(true)
        setError(null)
        try {
            const result = await commitBinding({
                baseRevisionId: targetId,
                credential: {secret, binding: {type: "env", name: envName}},
                editIndex: attachment?.index,
            })
            setUnattached(null)
            configured(secret, envName, result.revisionId)
        } catch (cause) {
            setUnattached(secret)
            setError(
                `${justSaved ? "Saved in the vault, not attached. " : ""}${
                    cause instanceof Error ? cause.message : "The secret could not be attached."
                }`,
            )
        } finally {
            setCommitting(false)
        }
    }

    // "Only me": the item takes each person's own secret, and this one is the choice.
    const attachPersonal = async (secretId: string | undefined, justSaved: boolean) => {
        const stored = secretId ? await storeChoice({secretId}) : false
        if (stored !== true) message.error(ACCOUNT_COPY.choiceFailed)
        await attach({account_source: "user"}, justSaved)
    }

    const handleSaved = async (saved: SavedSecret) => {
        // A failed settle must come back to Continue: the field is already cleared.
        setEntryChoice(false)
        setTyping(false)
        if (subject?.kind === "attached" && !envChanged) {
            configured(subject.binding.secret, envName, targetId)
            return
        }
        if (savesPersonal) {
            await attachPersonal(saved.id, true)
            return
        }
        await attach({slug: saved.slug}, true)
    }

    const form = useSecretForm({
        open: entry,
        // The vault returns the stored value on some records. A replacement never shows it.
        initialSecret: replaceable ? {...replaceable, content: undefined, writeOnly: true} : null,
        initialName: request?.name,
        initialDefaultEnvVar: request?.envVar,
        ownerKind: savesPersonal ? "user" : undefined,
        onSaved: (saved) => void handleSaved(saved),
    })

    // A phone keyboard would cover the card as it arrives, so there the field waits for a tap.
    useEffect(() => {
        if (!entry || typingElsewhere()) return
        if (window.matchMedia?.("(pointer: coarse)").matches) return
        valueRef.current?.focus()
    }, [entry])

    const busy = settling || committing || form.saving
    const blocked = busy || dirty || !entity || !!envError
    const canSubmit = !blocked && !!form.textValue.trim()

    const continueWithSaved = () => {
        if (unattached) {
            void attach(unattached, false)
            return
        }
        if (subject?.kind === "vault") {
            if (subject.row.ownerKind === "user") void attachPersonal(subject.row.id, false)
            else void attach({slug: subject.row.slug ?? ""}, false)
            return
        }
        if (subject?.kind !== "attached") return
        if (!envChanged) configured(subject.binding.secret, envName, targetId)
        // A person's choice is stored per variable, so a rename carries it to the new name.
        else if (isUserSecretBinding(subject.binding) && ownAccount?.match) {
            void attachPersonal(ownAccount.secret_id ?? undefined, false)
        } else void attach(subject.binding.secret, false)
    }

    const submitOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
        event.preventDefault()
        if (canSubmit) void form.submit()
    }

    // A copied value often carries the terminal's newline, which would become part of the secret.
    const pasteTrimmed = (event: ClipboardEvent<HTMLTextAreaElement>) => {
        if (form.textValue) return
        event.preventDefault()
        changeValue(event.clipboardData.getData("text").trim())
    }

    const changeValue = (next: string) => {
        form.setTextValue(next)
        setTyping(!!next.trim())
    }

    const changeEnv = (next: string) => {
        setEnvVar(next)
        form.setDefaultEnvVar(next.trim())
        setError(null)
    }

    const canContinue =
        !!unattached ||
        subject?.kind === "attached" ||
        (subject?.kind === "vault" && canEditSecrets)
    const ready = subject && subject.kind !== "checking"
    const showContinue = ready && !entry && canContinue
    const canRename = canEditSecrets && !!entity
    // The dialog keeps what the card leaves out: another saved secret, the owner, a personal value.
    const hasOptions =
        canEditSecrets &&
        !!ready &&
        (namedSecrets.length > 0 || (owners?.length ?? 0) > 1 || (hasSaved && !replaceable))
    const canToggleEntry = inlineValue && hasSaved && !unattached
    const notice = !request
        ? "This request is missing its setup details."
        : dirty
          ? "Save or discard your agent changes first."
          : ready && !canEditSecrets
            ? canContinue
                ? "You do not have permission to change this secret."
                : "You do not have permission to add this secret. Ask a project admin."
            : subject?.kind === "missing"
              ? "The saved secret was deleted. Add its value again."
              : replacing && !personalRow && !request.rejected
                ? "This replaces the saved value for every agent that uses it."
                : null
    const alert = error ?? (request ? envError : null)
    const detail = alert ?? notice ?? request?.reason
    const title = request
        ? request.rejected
            ? `${request.name} did not work`
            : request.name
        : "Secret setup unavailable"

    return (
        <>
            <div
                className="rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer p-3 text-colorText"
                role="region"
                aria-label="Secret request"
            >
                <p className="m-0 truncate text-sm font-medium">{title}</p>
                <p
                    className={`m-0 mt-0.5 line-clamp-2 text-xs ${alert ? "text-error" : "text-colorTextSecondary"}`}
                    title={detail}
                >
                    {detail}
                </p>

                {entry ? (
                    <div className="ph-no-capture mt-3 flex items-start gap-2">
                        <Textarea
                            ref={valueRef}
                            {...PASSWORD_MANAGER_OPT_OUT}
                            aria-label={VALUE_FIELD_LABEL}
                            rows={1}
                            className="max-h-24 min-h-8 flex-1 resize-none font-mono [-webkit-text-security:disc] [field-sizing:content]"
                            placeholder={replacing ? "Paste a new value" : "Paste the value"}
                            value={form.textValue}
                            onChange={(event) => changeValue(event.target.value)}
                            onKeyDown={submitOnEnter}
                            onPaste={pasteTrimmed}
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck={false}
                            disabled={busy}
                        />
                        <LoadingButton
                            loading={form.saving || committing}
                            disabled={!canSubmit}
                            onClick={() => void form.submit()}
                        >
                            Save
                        </LoadingButton>
                    </div>
                ) : null}

                <div className="mt-2 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-center">
                        {request ? (
                            editingEnv ? (
                                <Input
                                    aria-label="Environment variable"
                                    autoFocus
                                    size="sm"
                                    className="h-6 w-full max-w-72 font-mono text-xs"
                                    value={envVar}
                                    onChange={(event) => changeEnv(event.target.value)}
                                    onBlur={() => {
                                        if (!envError) setEditingEnv(false)
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key !== "Enter" && event.key !== "Escape") return
                                        event.preventDefault()
                                        if (event.key === "Escape") {
                                            changeEnv(
                                                attachment?.binding.binding.name ?? request.envVar,
                                            )
                                            setEditingEnv(false)
                                        } else if (!envError) {
                                            setEditingEnv(false)
                                        }
                                    }}
                                    autoComplete="off"
                                    spellCheck={false}
                                    aria-invalid={!!envError || undefined}
                                />
                            ) : (
                                <button
                                    type="button"
                                    className="group inline-flex min-w-0 items-center gap-1.5 border-0 bg-transparent p-0 font-mono text-xs text-colorTextSecondary enabled:cursor-pointer enabled:hover:text-colorText"
                                    aria-label={`Change environment variable ${envName}`}
                                    title={envName}
                                    disabled={!canRename || busy}
                                    onClick={() => setEditingEnv(true)}
                                >
                                    <span className="truncate">{envName}</span>
                                    {canRename ? (
                                        <PencilSimple
                                            size={11}
                                            className="shrink-0 opacity-60 group-hover:opacity-100"
                                        />
                                    ) : null}
                                </button>
                            )
                        ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        {!ready && request ? (
                            <span className="px-2 text-xs text-colorTextSecondary">
                                Checking...
                            </span>
                        ) : null}
                        {canToggleEntry || hasOptions ? (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label="Secret options"
                                        disabled={busy}
                                    >
                                        <DotsThree size={16} />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    {canToggleEntry ? (
                                        <DropdownMenuItem onSelect={() => setEntryChoice(!entry)}>
                                            {entry ? "Keep saved value" : "Change value"}
                                        </DropdownMenuItem>
                                    ) : null}
                                    {hasOptions ? (
                                        <DropdownMenuItem
                                            disabled={dirty}
                                            onSelect={() => setModalOpen(true)}
                                        >
                                            {hasSaved && !replaceable
                                                ? "Change value"
                                                : "More options"}
                                        </DropdownMenuItem>
                                    ) : null}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        ) : null}
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => settle({status: "cancelled"})}
                        >
                            Not now
                        </Button>
                        {showContinue ? (
                            <LoadingButton
                                size="sm"
                                loading={committing}
                                disabled={blocked}
                                onClick={continueWithSaved}
                            >
                                Continue
                            </LoadingButton>
                        ) : null}
                    </div>
                </div>
            </div>
            <AgentSecretAttachmentModal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                target={{revisionId: targetId, label}}
                request={request ? {...request, envVar: envName} : undefined}
                bindings={bindings}
                baseRevisionId={targetId}
                editingBinding={
                    attachment ? {index: attachment.index, value: attachment.binding} : undefined
                }
                dirty={dirty}
                disabled={!entity || !canEditSecrets}
                canCreateSecret={canEditSecrets}
                commitBinding={commitBinding}
                onAttached={({credential, revisionId: next}) =>
                    configured(credential.secret, credential.binding.name, next)
                }
            />
        </>
    )
}
