import {useEffect, useMemo, useState} from "react"

import {
    CustomSecretFormat,
    useVaultSecret,
    type AgentSecretBinding,
    type NamedSecretRow,
} from "@agenta/entities/secret"
import {toEnvVarName} from "@agenta/shared/utils"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {
    Button,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@agenta/ui/ui"
import {ArrowLeft} from "@phosphor-icons/react"

import {DrawerFooter} from "../drawers/shared/DrawerFooter"

import {SecretForm, useSecretForm, type SavedSecret} from "./SecretForm"

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

export interface AgentSecretAttachmentDrawerProps {
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

type Mode = "existing" | "create"
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const FOOTER_STYLE = {padding: 0, border: 0, display: "block"} as const

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

export function AgentSecretAttachmentDrawer({
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
}: AgentSecretAttachmentDrawerProps) {
    const {namedSecrets, loading} = useVaultSecret()
    const textSecrets = useMemo(
        () => namedSecrets.filter((secret) => secret.format === CustomSecretFormat.Text),
        [namedSecrets],
    )
    const [mode, setMode] = useState<Mode>("existing")
    const [selectedSlug, setSelectedSlug] = useState("")
    const [createdSecret, setCreatedSecret] = useState<SavedSecret | null>(null)
    const [envVar, setEnvVar] = useState("")
    const [envTouched, setEnvTouched] = useState(false)
    const [attaching, setAttaching] = useState(false)
    const [error, setError] = useState<string | null>(null)

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
        const original = editingBinding?.value
        const initialSlug = original?.secret.slug ?? ""
        const initialSecret = textSecrets.find((secret) => secret.slug === initialSlug)
        setMode(canCreateSecret ? initialMode : "existing")
        setSelectedSlug(initialSlug)
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

    const handleCreated = (secret: SavedSecret) => {
        setCreatedSecret(secret)
        setSelectedSlug(secret.slug)
        setMode("existing")
        setError(null)
        if (!envTouched) setEnvVar(suggestion(secret as NamedSecretRow))
    }

    const createController = useSecretForm({
        open: open && mode === "create",
        initialName: request?.name,
        initialDefaultEnvVar: request?.envVar,
        onSaved: handleCreated,
    })

    const duplicate = bindings.some(
        (candidate, index) =>
            index !== editingBinding?.index && candidate.binding.name === envVar.trim(),
    )
    const envError = envVar.length > 0 && !ENV_NAME.test(envVar)
    const canAttach =
        !disabled && !dirty && !!selectedSlug && !!envVar.trim() && !envError && !duplicate

    const attach = async () => {
        if (!canAttach || attaching) return
        setAttaching(true)
        setError(null)
        try {
            const result = await commitBinding({
                baseRevisionId,
                secretSlug: selectedSlug,
                envVar: envVar.trim(),
                editIndex: editingBinding?.index,
            })
            onAttached?.({
                secretSlug: selectedSlug,
                envVar: envVar.trim(),
                revisionId: result.revisionId,
            })
            onClose()
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "The secret could not be attached.")
        } finally {
            setAttaching(false)
        }
    }

    const createMode = mode === "create"
    const title = editingBinding ? "Edit secret attachment" : "Attach a secret"

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={onClose}
            placement="right"
            width={600}
            zIndex={zIndex}
            closable={false}
            destroyOnClose
            title={
                <div className="flex min-w-0 items-center gap-2">
                    <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={onClose}>
                        <ArrowLeft size={14} />
                    </Button>
                    <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{title}</div>
                        <div className="truncate text-xs font-normal text-colorTextSecondary">
                            {target.label}
                        </div>
                    </div>
                </div>
            }
            footer={
                <DrawerFooter
                    left={
                        <span className="text-xs text-colorTextSecondary">
                            Stored in the project vault.
                        </span>
                    }
                    onCancel={onClose}
                    isMutating={createMode ? createController.saving : attaching}
                    canSave={createMode ? !createController.okDisabled : canAttach}
                    submitLabel={createMode ? "Save secret" : editingBinding ? "Save" : "Attach"}
                    onSubmit={createMode ? createController.submit : attach}
                />
            }
            styles={{body: {padding: 16}, footer: FOOTER_STYLE}}
        >
            <div className="flex flex-col gap-4">
                {request ? (
                    <div className="rounded-lg border border-colorBorderSecondary bg-colorFillQuaternary p-3">
                        <div className="text-sm font-medium">{request.name}</div>
                        {request.reason ? (
                            <div className="mt-1 text-xs text-colorTextSecondary">
                                {request.reason}
                            </div>
                        ) : null}
                    </div>
                ) : null}

                <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
                    <TabsList className="w-full">
                        <TabsTrigger value="existing" className="flex-1">
                            Existing secret
                        </TabsTrigger>
                        {canCreateSecret ? (
                            <TabsTrigger value="create" className="flex-1">
                                Create new
                            </TabsTrigger>
                        ) : null}
                    </TabsList>
                    <TabsContent value="existing" className="mt-4 flex flex-col gap-4">
                        <div className="flex flex-col gap-1">
                            <span className="text-sm font-medium text-colorText">Secret</span>
                            <Select
                                value={selectedSlug}
                                onValueChange={selectSecret}
                                disabled={loading}
                            >
                                <SelectTrigger aria-label="Secret">
                                    <SelectValue
                                        placeholder={
                                            loading ? "Loading secrets..." : "Select a secret"
                                        }
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    {allSecrets.map((secret) => (
                                        <SelectItem key={secret.slug} value={secret.slug ?? ""}>
                                            {secret.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {!loading && allSecrets.length === 0 ? (
                                <span className="text-xs text-colorTextSecondary">
                                    No text secrets yet. Create one to continue.
                                </span>
                            ) : null}
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-sm font-medium text-colorText">
                                Environment variable
                            </span>
                            <Input
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
                    </TabsContent>
                    <TabsContent value="create" className="mt-4">
                        <SecretForm controller={createController} textOnly />
                    </TabsContent>
                </Tabs>

                {dirty ? (
                    <div className="rounded-lg border border-[var(--ag-colorWarningBorder)] bg-[var(--ag-colorWarningBg)] p-3 text-xs text-colorText">
                        Save or discard the current agent changes before attaching a secret.
                    </div>
                ) : null}
                {error ? (
                    <div className="rounded-lg border border-[var(--ag-colorErrorBorder)] bg-[var(--ag-colorErrorBg)] p-3 text-xs text-error">
                        {createdSecret ? "Saved in vault; not attached. " : ""}
                        {error}
                    </div>
                ) : null}
            </div>
        </EnhancedDrawer>
    )
}
