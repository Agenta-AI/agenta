/**
 * One Connect journey for an MCP server: URL, then a name, then whatever authorization the
 * server turned out to want, then connected.
 *
 * It replaces a register-then-connect sequence that took seven actions across two dialogs
 * and a row menu, and that asked a person for a slug and an authentication mode before
 * anything had looked at the server. Here the server is asked first and the answers are
 * filled in from what it said.
 *
 * Every entry point mounts this same component — settings, agent configuration, and the
 * in-chat connect request — so the flow cannot drift between them.
 */
import {useCallback, useEffect, useState} from "react"

import {
    connectionNameProblem,
    isBusy,
    useMcpConnectJourney,
    type McpJourneyState,
} from "@agenta/entities/mcpEndpoint"
import {customNamedSecretsAtom} from "@agenta/entities/secret"
import {EnhancedModal, ModalContent, ModalFooter} from "@agenta/ui"
import {
    Button,
    Checkbox,
    Field,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {CreateSecretDrawer} from "../secret"

export interface McpConnectJourneyProps {
    open: boolean
    onClose: () => void
    /** Existing display names in the project, for the suggestion and the collision check. */
    existingNames?: (string | null | undefined)[]
    /** Reconnect an endpoint that already exists instead of adding one. */
    reconnect?: {id: string; slug: string; name: string; url: string} | null
    /** The connection, once it is real. Agents reference it by `slug`. */
    onConnected?: (endpoint: {id: string; slug: string; name: string}) => void
}

const TITLE: Partial<Record<McpJourneyState["status"], string>> = {
    connected: "Connected",
    tools_ready: "Connected",
    no_tools: "Connected",
    tools_failed: "Connected",
}

/** What the primary action says, per state. */
const CONFIRM_LABEL: Partial<Record<McpJourneyState["status"], string>> = {
    url_entry: "Continue",
    checking_url: "Checking",
    check_failed: "Try again",
    naming: "Continue",
    creating: "Connecting",
    create_failed: "Try again",
    discovering_scopes: "Reading permissions",
    choosing_scopes: "Authorize",
    scopes_failed: "Try again",
    awaiting_consent: "Waiting for consent",
    consent_cancelled: "Try again",
    consent_failed: "Try again",
    verifying: "Connecting",
    verify_failed: "Try again",
    saving: "Connecting",
    connected: "Done",
    discovering_tools: "Done",
    tools_ready: "Done",
    no_tools: "Done",
    tools_failed: "Done",
}

export default function McpConnectJourney({
    open,
    onClose,
    existingNames = [],
    reconnect = null,
    onConnected,
}: McpConnectJourneyProps) {
    const journey = useMcpConnectJourney({existingNames, reconnect, onConnected})
    const {state} = journey
    const namedSecrets = useAtomValue(customNamedSecretsAtom)

    const [headerName, setHeaderName] = useState("")
    const [secretSlug, setSecretSlug] = useState("")
    const [creatingSecret, setCreatingSecret] = useState(false)
    // Latches on first open so the create drawer's hooks stay unmounted until needed.
    const [secretDrawerMounted, setSecretDrawerMounted] = useState(false)

    // The consent popup reports back through the journey's watch, which outlives this
    // component's render; unmounting with the popup still open has to release it.
    useEffect(() => journey.stopWatch, [journey.stopWatch])

    // `saving` means credentials are persisted and only the local bookkeeping is left.
    useEffect(() => {
        if (state.status === "saving") void journey.finish()
    }, [journey, state.status])

    // A reconnect starts here rather than at a URL, so nothing else kicks discovery off.
    useEffect(() => {
        if (state.status === "discovering_scopes") void journey.startScopeDiscovery()
    }, [journey, state.status])

    // Credentials are persisted; the last step is reading what the server exposes. Without
    // this the journey sits in a busy state with no enabled action and cannot be closed.
    useEffect(() => {
        if (state.status === "discovering_tools") void journey.loadTools()
    }, [journey, state.status])

    const nameProblem =
        state.status === "naming"
            ? connectionNameProblem({
                  name: state.name,
                  existingNames,
                  currentName: reconnect?.name,
              })
            : null

    const handleClose = useCallback(() => {
        void journey.cancel()
        onClose()
    }, [journey, onClose])

    const handleConfirm = useCallback(() => {
        switch (state.status) {
            case "url_entry":
                void journey.submitUrl(state.url)
                return
            case "naming":
                if (nameProblem) return
                void journey.submitName()
                return
            case "choosing_scopes": {
                // Opened blank, synchronously, before any await: WebKit refuses a popup
                // once a promise has resolved.
                const popup = window.open("", journey.popupName, "width=600,height=700,popup=yes")
                void journey.submitScopes(popup)
                return
            }
            case "check_failed":
                void journey.submitUrl(state.url)
                return
            case "connected":
            case "discovering_tools":
            case "tools_ready":
            case "no_tools":
            case "tools_failed":
                // Nothing is cancelled by closing a connection that succeeded.
                onClose()
                return
            case "create_failed":
            case "scopes_failed":
            case "consent_cancelled":
            case "consent_failed":
            case "verify_failed":
                journey.retry()
                return
            default:
        }
    }, [journey, nameProblem, state.status, state.url])

    const confirmLabel = CONFIRM_LABEL[state.status]
    const canConfirm = !!confirmLabel && !isBusy(state) && !nameProblem

    return (
        <EnhancedModal
            open={open}
            onCancel={handleClose}
            title={TITLE[state.status] ?? (reconnect ? "Reconnect MCP server" : "Connect MCP")}
            footer={null}
            width={460}
            destroyOnClose
        >
            <ModalContent>
                <div className="flex flex-col gap-4" data-testid="mcp-connect-journey">
                    {state.status === "url_entry" || state.status === "checking_url" ? (
                        <Field label="MCP server URL" required>
                            <Input
                                autoFocus
                                placeholder="https://mcp.example.com"
                                value={state.url}
                                disabled={isBusy(state)}
                                aria-label="MCP server URL"
                                onChange={(event) => journey.setUrl(event.target.value)}
                            />
                        </Field>
                    ) : null}

                    {state.status === "checking_url" ? (
                        <Progress>Checking the server…</Progress>
                    ) : null}

                    {state.status === "naming" ? (
                        <>
                            <Field
                                label="Name"
                                required
                                error={nameProblem ?? state.error ?? undefined}
                            >
                                <Input
                                    autoFocus
                                    value={state.name}
                                    aria-label="Connection name"
                                    onChange={(event) => journey.setName(event.target.value)}
                                />
                            </Field>
                            <AuthSummary state={state} />
                        </>
                    ) : null}

                    {state.status === "creating" || state.status === "saving" ? (
                        <Progress>Setting up the connection…</Progress>
                    ) : null}

                    {state.status === "discovering_scopes" ? (
                        <Progress>Reading what this server can be asked for…</Progress>
                    ) : null}

                    {state.status === "choosing_scopes" ? (
                        <div className="flex flex-col gap-2">
                            <span className="text-sm text-colorTextDescription">
                                Choose which permissions to grant.
                            </span>
                            {state.scopesOffered.length === 0 ? (
                                <span className="text-sm text-colorTextDescription">
                                    This server offers no scoped permissions.
                                </span>
                            ) : (
                                state.scopesOffered.map((scope) => (
                                    <label key={scope} className="flex items-center gap-2 text-sm">
                                        <Checkbox
                                            checked={state.scopesSelected.includes(scope)}
                                            onCheckedChange={() => journey.toggleScope(scope)}
                                        />
                                        {scope}
                                    </label>
                                ))
                            )}
                        </div>
                    ) : null}

                    {state.status === "awaiting_consent" ? (
                        <Progress>
                            Waiting for you to authorize Agenta in the window that opened.
                        </Progress>
                    ) : null}

                    {state.status === "verifying" ? <Progress>Verifying…</Progress> : null}

                    {state.status === "manual_auth" ? (
                        <ManualAuth
                            headerName={headerName}
                            onHeaderName={setHeaderName}
                            secretSlug={secretSlug}
                            onSecretSlug={setSecretSlug}
                            secrets={namedSecrets}
                            onCreateSecret={() => {
                                setSecretDrawerMounted(true)
                                setCreatingSecret(true)
                            }}
                            onSkip={journey.skipAuthentication}
                            onSubmit={() => {
                                const secret = namedSecrets.find((row) => row.slug === secretSlug)
                                if (!secret?.id) return
                                void journey.submitManualCredential({
                                    headerName,
                                    secretId: secret.id,
                                })
                            }}
                        />
                    ) : null}

                    {state.status === "discovering_tools" ? (
                        <Progress>Connected. Looking for tools…</Progress>
                    ) : null}

                    {state.status === "tools_ready" ? (
                        <Connected name={state.name}>
                            <p className="text-sm text-colorTextDescription">
                                {state.tools.length} tool
                                {state.tools.length === 1 ? "" : "s"} available. Set what this
                                server may do in an agent&apos;s configuration.
                            </p>
                        </Connected>
                    ) : null}

                    {state.status === "no_tools" ? (
                        <Connected name={state.name}>
                            {/* An empty list, not a transport failure. */}
                            <p className="text-sm text-colorTextDescription">
                                This server exposes no tools yet.
                            </p>
                        </Connected>
                    ) : null}

                    {state.status === "tools_failed" ? (
                        <Connected name={state.name}>
                            <p className="text-sm text-colorTextDescription">
                                {state.error} Your credentials were saved, so there is no need to
                                authorize again.
                            </p>
                            <Button variant="ghost" onClick={journey.retryTools}>
                                Retry tools
                            </Button>
                        </Connected>
                    ) : null}

                    {secretDrawerMounted ? (
                        <CreateSecretDrawer
                            open={creatingSecret}
                            onClose={() => setCreatingSecret(false)}
                            headerName={headerName}
                            serverName={state.name}
                            onCreated={(row) => setSecretSlug(row.slug)}
                        />
                    ) : null}

                    {state.error && !isConnectedStatus(state.status) ? (
                        <p className="text-sm text-colorErrorText">{state.error}</p>
                    ) : null}
                </div>

                <ModalFooter
                    onCancel={handleClose}
                    onConfirm={handleConfirm}
                    confirmLabel={confirmLabel ?? "Done"}
                    // A finished journey has one action left, so it shows one button.
                    hideCancel={isConnectedStatus(state.status)}
                    isLoading={isBusy(state)}
                    canConfirm={canConfirm}
                />
            </ModalContent>
        </EnhancedModal>
    )
}

const isConnectedStatus = (status: McpJourneyState["status"]) =>
    status === "connected" ||
    status === "discovering_tools" ||
    status === "tools_ready" ||
    status === "no_tools" ||
    status === "tools_failed"

const Progress = ({children}: {children: React.ReactNode}) => (
    <p className="text-sm text-colorTextDescription" role="status">
        {children}
    </p>
)

const Connected = ({name, children}: {name: string; children: React.ReactNode}) => (
    <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-colorText">{name} is connected.</p>
        {children}
    </div>
)

/** What the probe established, said plainly before the person commits to it. */
const AuthSummary = ({state}: {state: McpJourneyState}) => {
    const mode = state.probe?.auth.mode
    if (mode === "oauth") {
        return (
            <p className="text-sm text-colorTextDescription">
                This server uses OAuth. Continuing opens its authorization page.
            </p>
        )
    }
    if (mode === "none") {
        return (
            <p className="text-sm text-colorTextDescription">
                This server needs no authentication.
            </p>
        )
    }
    return (
        <p className="text-sm text-colorTextDescription">
            {state.probe?.problem?.message ?? "This server did not say how it authenticates."} You
            can add a credential on the next step.
        </p>
    )
}

interface ManualAuthProps {
    headerName: string
    onHeaderName: (value: string) => void
    secretSlug: string
    onSecretSlug: (value: string) => void
    secrets: {id?: string | null; slug?: string | null; name?: string | null}[]
    onCreateSecret: () => void
    onSkip: () => void
    onSubmit: () => void
}

/**
 * The explicit fallback for a server whose authentication could not be discovered.
 *
 * It offers both answers, because neither is known: a credential, or none. A key field on
 * its own would tell a person that a key is required when all that happened is that
 * discovery came back inconclusive.
 */
const ManualAuth = ({
    headerName,
    onHeaderName,
    secretSlug,
    onSecretSlug,
    secrets,
    onCreateSecret,
    onSkip,
    onSubmit,
}: ManualAuthProps) => {
    const [selectOpen, setSelectOpen] = useState(false)
    const options = secrets.filter((secret) => !!secret.slug)

    return (
        <div className="flex flex-col gap-3">
            <Field
                label="Header name"
                tooltip="The HTTP header this server expects, for example x-api-key"
            >
                <Input
                    placeholder="x-api-key"
                    value={headerName}
                    aria-label="Header name"
                    onChange={(event) => onHeaderName(event.target.value.trim())}
                />
            </Field>
            <Field label="Project secret" tooltip="Resolved securely when the agent runs">
                <Select
                    value={secretSlug || undefined}
                    onValueChange={onSecretSlug}
                    open={selectOpen}
                    onOpenChange={setSelectOpen}
                >
                    <SelectTrigger className="w-full" aria-label="Project secret">
                        <SelectValue placeholder="Select a project secret" />
                    </SelectTrigger>
                    <SelectContent>
                        {options.length === 0 ? (
                            <div className="px-3 py-input-y-ghost text-field-md text-colorTextSecondary">
                                No project secrets found
                            </div>
                        ) : (
                            options.map((secret) => (
                                <SelectItem key={secret.slug} value={secret.slug as string}>
                                    {secret.name || "Unnamed secret"}
                                </SelectItem>
                            ))
                        )}
                        <SelectSeparator />
                        {/* Not a SelectItem: it is an action, not a value. Without this a
                            project with no secret yet is a dead end here. */}
                        <Button
                            variant="ghost"
                            disabled={!headerName}
                            onClick={() => {
                                setSelectOpen(false)
                                onCreateSecret()
                            }}
                            className="min-h-control w-full justify-start gap-2 rounded-control-sm px-3 py-1 text-field-md font-normal"
                        >
                            <Plus size={13} className="shrink-0" />
                            Create secret
                        </Button>
                    </SelectContent>
                </Select>
            </Field>
            <div className="flex items-center gap-2">
                <Button onClick={onSubmit} disabled={!headerName || !secretSlug}>
                    Save credential
                </Button>
                <Button variant="ghost" onClick={onSkip}>
                    Connect without authentication
                </Button>
            </div>
        </div>
    )
}
