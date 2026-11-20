/**
 * The state of "Attach a secret", shared by the attach view of the Agent tab and the modal of the
 * chat's secret request dock. The chrome (view or modal) owns the buttons and calls `submit`.
 *
 * The list holds the project secrets (tag "Everyone") and the person's own secrets (tag "Only
 * me"), then "Create new secret". An own secret is attached as `{account_source: "user"}`: each
 * person who runs the agent gives their own value, and this person's account choice for the
 * variable points at the picked secret.
 */
import {useEffect, useMemo, useRef, useState} from "react"

import {userItemKey} from "@agenta/entities/accountChoice"
import {
    CustomSecretFormat,
    isUserSecretBinding,
    personalAccountsAccessAtom,
    personalNamedSecretsAtom,
    useVaultSecret,
    type AgentSecretBinding,
    type NamedSecretRow,
} from "@agenta/entities/secret"
import {workflowMolecule} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import secretAttachmentCatalog from "@agenta/i18n/catalogs/entityUi.secretAttachment"
import {useAtomValue} from "jotai"

import {ACCOUNT_COPY} from "../../accounts/copy"
import {personalTextSecrets} from "../../accounts/personalAccounts"
import {useAccountChoice} from "../../accounts/useAccountChoice"
import {useItemAccount} from "../../accounts/useItemAccount"
import {
    ENV_NAME,
    matchRequestedSecret,
    newSecretOwners,
    preserveAgentSecretEnvOverride,
    type SecretOwner,
    suggestedAgentSecretEnv,
    type AgentSecretRequestSeed,
} from "../agentSecretRules"
import {useSecretForm, type SavedSecret, type SecretFormController} from "../SecretForm"

import {
    NEW_SECRET,
    userSecretValue,
    sharedSecretValue,
    readSecretChoice,
    type SecretChoice,
} from "./secretChoice"

/** One entry of the "Secret" select: its value, its name, and whose it is (the tag). */
export interface SecretListEntry {
    value: string
    name: string
    /** "shared": every run uses it ("Everyone"). "user": the person's own ("Only me"). */
    owner: "shared" | "user"
}

export interface SecretAttachFormOptions {
    /** The form is on screen. Each opening starts from the attachment, or empty. */
    open: boolean
    /** The revision the attach builds on. */
    revisionId: string
    request?: AgentSecretRequestSeed
    bindings: AgentSecretBinding[]
    editingBinding?: {index: number; value: AgentSecretBinding}
    initialMode?: "existing" | "create"
    /** The agent has a change that is not saved yet: the production rule blocks the attach. */
    dirty?: boolean
    disabled?: boolean
    canCreateSecret?: boolean
    /** Saves the agent with the attachment (a new version), and resolves its revision. */
    commitBinding: (input: {
        baseRevisionId: string
        credential: AgentSecretBinding
        editIndex?: number
    }) => Promise<{revisionId: string}>
    onAttached?: (result: {credential: AgentSecretBinding; revisionId: string}) => void
}

export interface SecretAttachForm {
    entries: SecretListEntry[]
    loading: boolean
    selected: string
    choice: SecretChoice
    select: (value: string) => void
    canCreate: boolean
    envVar: string
    setEnvVar: (next: string) => void
    /** The line under the variable, or null for the production hint. */
    envError: "invalid" | "duplicate" | null
    /** "Who can use it" for a new secret, when the person has two choices. */
    owners: SecretOwner[] | undefined
    owner: SecretOwner
    setOwner: (next: SecretOwner) => void
    createController: SecretFormController
    /** Called when the new secret's name changes, to suggest the variable. */
    onNewSecretName: (name: string) => void
    error: string | null
    /** The person changed something since the form opened. */
    dirty: boolean
    canSubmit: boolean
    submitting: boolean
    submitLabel: string
    /** Attach (after saving a new secret first). Resolves true when the agent saved the version. */
    submit: () => Promise<boolean>
}

export const useSecretAttachForm = ({
    open,
    revisionId,
    request,
    bindings,
    editingBinding,
    initialMode = "existing",
    dirty: agentDirty = false,
    disabled = false,
    canCreateSecret = true,
    commitBinding,
    onAttached,
}: SecretAttachFormOptions): SecretAttachForm => {
    const t = useT(secretAttachmentCatalog)
    const {namedSecrets, loading, mutate: refetchVault} = useVaultSecret()
    const access = useAtomValue(personalAccountsAccessAtom)
    const ownRows = useAtomValue(personalNamedSecretsAtom)
    // The vault list holds the project's and the organization's secrets: both are "Everyone".
    const projectSecrets = useMemo(
        () =>
            namedSecrets.filter(
                (secret) =>
                    secret.format === CustomSecretFormat.Text && secret.ownerKind !== "user",
            ),
        [namedSecrets],
    )
    const ownSecrets = useMemo(
        () => (access === "on" ? personalTextSecrets(ownRows) : []),
        [access, ownRows],
    )
    const [selected, setSelected] = useState("")
    // A secret saved by "Save & attach" whose attach failed: it stays picked so Attach retries.
    const [createdSecret, setCreatedSecret] = useState<SavedSecret | null>(null)
    const [envVar, setEnvVarState] = useState("")
    const [envTouched, setEnvTouched] = useState(false)
    // The variable the form opened with: a change from it is an edit.
    const [initialEnv, setInitialEnv] = useState("")
    const [picked, setPicked] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const owners = newSecretOwners(access === "on", canCreateSecret)
    const canCreate = canCreateSecret || access === "on"
    const [chosenOwner, setOwner] = useState<SecretOwner>("user")
    const owner = owners?.includes(chosenOwner) ? chosenOwner : (owners?.[0] ?? "project")
    // Set once the form has its opening choice, or the person picked one.
    const choiceMade = useRef(false)
    // Cached rows can predate a secret made elsewhere; the opening choice waits for the refetch.
    const [vaultFresh, setVaultFresh] = useState(false)

    const allProjectSecrets = useMemo(() => {
        if (!createdSecret || createdSecret.id === undefined) return projectSecrets
        if (projectSecrets.some((secret) => secret.slug === createdSecret.slug))
            return projectSecrets
        return [...projectSecrets, {...createdSecret, type: "custom_secret"} as NamedSecretRow]
    }, [createdSecret, projectSecrets])

    const entries = useMemo<SecretListEntry[]>(
        () => [
            ...allProjectSecrets.map((secret) => ({
                value: sharedSecretValue(secret.slug ?? ""),
                name: secret.name ?? secret.slug ?? "",
                owner: "shared" as const,
            })),
            ...ownSecrets.map((secret) => ({
                value: userSecretValue(secret.id as string),
                name: secret.name ?? "",
                owner: "user" as const,
            })),
        ],
        [allProjectSecrets, ownSecrets],
    )

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
        // `refetchVault` changes identity on every fetch, so it stays out of the deps.
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
        const initialValue =
            original && !isUserSecretBinding(original)
                ? sharedSecretValue(original.secret.slug ?? "")
                : ""
        const initialSecret = projectSecrets.find(
            (secret) => sharedSecretValue(secret.slug ?? "") === initialValue,
        )
        const startNew = canCreate && !original && initialMode === "create"
        choiceMade.current = Boolean(original && !isUserSecretBinding(original)) || startNew
        setSelected(startNew ? NEW_SECRET : initialValue)
        setCreatedSecret(null)
        setOwner("user")
        const openingEnv = original?.binding.name ?? suggestion(initialSecret)
        setEnvVarState(openingEnv)
        setInitialEnv(openingEnv)
        setEnvTouched(Boolean(original))
        setPicked(false)
        setSubmitting(false)
        setError(null)
        // An opening is the open flag and the edited attachment. A new revision under the open
        // form (auto-save, a builder save) and query refreshes keep what the person typed.
    }, [open, editingBinding?.index, initialMode, canCreate])

    const selectValue = (value: string, byPerson: boolean, keepEnv = envTouched) => {
        choiceMade.current = true
        if (byPerson) setPicked(true)
        setSelected(value)
        setError(null)
        const next = readSecretChoice(value)
        if (keepEnv || (next.kind !== "shared" && next.kind !== "user")) return
        // The variable follows the picked secret, a shared one or the person's own.
        const secret =
            next.kind === "shared"
                ? allProjectSecrets.find((candidate) => candidate.slug === next.slug)
                : next.kind === "user"
                  ? ownSecrets.find((candidate) => candidate.id === next.secretId)
                  : undefined
        setEnvVarState(
            preserveAgentSecretEnvOverride({
                current: envVar,
                touched: envTouched,
                requestEnv: request?.envVar,
                defaultEnvVar: secret?.defaultEnvVar,
                name: secret?.name || request?.name || "",
            }),
        )
    }

    // An attachment that takes each person's own value opens on this person's chosen secret.
    const editingOwn = Boolean(editingBinding && isUserSecretBinding(editingBinding.value))
    // Read only for such an attachment while the form is open: with no "user" item the read
    // sends nothing.
    const accountContext = useMemo(
        () => ({
            revisionId,
            agent: open && editingOwn ? {sandbox: {credentials: bindings}} : {},
        }),
        [bindings, revisionId, open, editingOwn],
    )
    const ownAccount = useItemAccount(
        accountContext,
        userItemKey("secret", editingOwn ? (editingBinding?.value.binding.name ?? "") : ""),
    )
    const ownChoiceId = editingOwn && ownAccount.account?.match ? ownAccount.account.secret_id : ""
    useEffect(() => {
        if (!open || !ownChoiceId || choiceMade.current) return
        if (ownSecrets.some((secret) => secret.id === ownChoiceId))
            selectValue(userSecretValue(ownChoiceId), false)
    }, [open, ownChoiceId, ownSecrets])

    // Opening choice, once the vault has loaded: the matching secret, else a new one when there
    // is nothing to pick from.
    useEffect(() => {
        if (!open || loading || !vaultFresh || choiceMade.current || editingOwn) return
        const match = matchRequestedSecret(projectSecrets, request)
        if (match?.slug) selectValue(sharedSecretValue(match.slug), false)
        else if (canCreate && projectSecrets.length === 0 && ownSecrets.length === 0)
            selectValue(NEW_SECRET, false)
        else choiceMade.current = true
    }, [open, loading, vaultFresh, projectSecrets, ownSecrets])

    const choice = readSecretChoice(selected)
    const creating = choice.kind === "new"

    const trimmedEnv = envVar.trim()
    const duplicate = bindings.some(
        (candidate, index) =>
            index !== editingBinding?.index && candidate.binding.name === trimmedEnv,
    )
    const envInvalid = envVar.length > 0 && !ENV_NAME.test(envVar)
    const envError = envInvalid ? "invalid" : duplicate ? "duplicate" : null
    const envOk = !!trimmedEnv && !envError

    const workflowId = useAtomValue(workflowMolecule.selectors.workflowId(revisionId)) ?? ""
    const {choose: storeChoice} = useAccountChoice(workflowId, userItemKey("secret", trimmedEnv))

    /** Saves the agent with one attachment. `saved` is a secret this submit just made. */
    const attach = async (
        secret: AgentSecretBinding["secret"],
        saved?: SavedSecret,
    ): Promise<boolean> => {
        const credential: AgentSecretBinding = {secret, binding: {type: "env", name: trimmedEnv}}
        try {
            const result = await commitBinding({
                baseRevisionId: revisionId,
                credential,
                editIndex: editingBinding?.index,
            })
            onAttached?.({credential, revisionId: result.revisionId})
            return true
        } catch (cause) {
            const reason =
                cause instanceof Error
                    ? cause.message
                    : t("entityUi.secretAttachment.couldNotAttach")
            setError(saved ? t("entityUi.secretAttachment.savedNotAttached", {reason}) : reason)
            return false
        }
    }

    /** "Only me": the run reads the value through the choice, so the choice is stored first. */
    const attachOwn = async (secretId: string | undefined, saved?: SavedSecret) => {
        const stored = secretId ? await storeChoice({secretId}) : false
        if (stored !== true) {
            setError(ACCOUNT_COPY.choiceFailed)
            return false
        }
        return attach({account_source: "user"}, saved)
    }

    const createController = useSecretForm({
        open: open && creating,
        initialName: request?.name,
        initialDefaultEnvVar: request?.envVar,
        ownerKind: owner === "user" ? "user" : undefined,
    })

    const canSubmit =
        !disabled &&
        !agentDirty &&
        envOk &&
        !submitting &&
        (creating
            ? !!createController.name.trim() &&
              !!createController.textValue.trim() &&
              !createController.okDisabled
            : choice.kind !== "none")

    const submit = async (): Promise<boolean> => {
        if (!canSubmit) return false
        setSubmitting(true)
        setError(null)
        try {
            if (choice.kind === "shared") return await attach({slug: choice.slug})
            if (choice.kind === "user") return await attachOwn(choice.secretId)
            if (choice.kind !== "new") return false
            const saved = await createController.submit()
            if (!saved) return false
            // From here a retry attaches the saved secret: it stays picked, and the form stays
            // dirty so its Save can retry.
            setPicked(true)
            // The variable was chosen with the new secret; the pick below must not replace it.
            setEnvTouched(true)
            if (owner === "user") {
                if (saved.id) selectValue(userSecretValue(saved.id), false, true)
                return await attachOwn(saved.id, saved)
            }
            setCreatedSecret(saved)
            selectValue(sharedSecretValue(saved.slug), false, true)
            return await attach({slug: saved.slug}, saved)
        } finally {
            setSubmitting(false)
        }
    }

    const formDirty =
        picked ||
        (envTouched && envVar !== initialEnv) ||
        (creating && Boolean(createController.name.trim() || createController.textValue.trim()))

    return {
        entries,
        loading,
        selected,
        choice,
        select: (value) => selectValue(value, true),
        canCreate,
        envVar,
        setEnvVar: (next) => {
            setEnvTouched(true)
            setEnvVarState(next)
            setError(null)
        },
        envError,
        owners: creating && (owners?.length ?? 0) > 1 ? owners : undefined,
        owner,
        setOwner,
        createController,
        onNewSecretName: (name) => {
            if (!envTouched) setEnvVarState(suggestion({name}))
        },
        error,
        dirty: formDirty,
        canSubmit,
        submitting: submitting || createController.saving,
        submitLabel: creating
            ? t("entityUi.secretAttachment.saveAndAttach")
            : editingBinding
              ? t("entityUi.secretAttachment.save")
              : t("entityUi.secretAttachment.attach"),
        submit,
    }
}
