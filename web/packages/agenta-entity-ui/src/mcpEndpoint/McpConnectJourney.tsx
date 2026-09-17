/**
 * One Connect journey for an MCP server: the address, then a name, then whatever
 * authorization the server turned out to want.
 *
 * It replaces a register-then-connect sequence that took seven actions across two dialogs
 * and a row menu, and that asked a person for a slug and an authentication mode before
 * anything had looked at the server. Here the server is asked first and the answers are
 * filled in from what it said.
 *
 * Every entry point mounts this same component — settings, agent configuration, and the
 * in-chat connect request — so the flow cannot drift between them.
 *
 * The journey's statuses render as six screens. The mapping is `screenFor` below and
 * nothing else in here branches on a status where a screen would do, because the statuses
 * are about what is in flight and the screens are about what a person is looking at.
 *
 * There is no screen for success. The sheet closes the moment the connection is real, and
 * what says so is the row it left behind, or the permission drawer the agent surface opens
 * on it (decision 26).
 *
 * Two mechanics are load-bearing:
 *
 * The consent window is opened blank and synchronously inside the tap that asks for it, and
 * pointed at the provider two round trips later. WebKit refuses `window.open` once a promise
 * has resolved, so there is no second chance to open one after the row exists. Everything
 * that can lead to consent — Connect on the OAuth screen, Try again on a refusal — opens it
 * first and then starts the work.
 *
 * The scope step is gone from the screens and kept in the machine. The server still tells us
 * what it offers and the authorize call still takes a list; what has gone is asking a person
 * to narrow it, because the scopes are the server's business and nobody could answer.
 */
import {
    cloneElement,
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    type ReactElement,
    type ReactNode,
} from "react"

import {
    connectionNameProblem,
    isBusy,
    mcpChallengeSchemeToShow,
    mcpChallengeStatus,
    readMcpProbeResponse,
    toolPrefixFromName,
    useMcpConnectJourney,
    type McpConnectJourney as McpConnectJourneyApi,
    type McpJourneyState,
} from "@agenta/entities/mcpEndpoint"
import {customNamedSecretsAtom} from "@agenta/entities/secret"
import {EnhancedModal, ModalContent} from "@agenta/ui"
import {
    Alert,
    Button,
    Divider,
    Field,
    Input,
    LoadingButton,
    Select,
    SelectContent,
    SelectItem,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"
import {ArrowSquareOut, CircleNotch, Plus, WarningCircle} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {CreateSecretDrawer} from "../secret"

import {NoticeBox, ProbeResultCard, ShowResponsePanel, type ProbeResultMode} from "./components"

export interface McpConnectJourneyProps {
    open: boolean
    onClose: () => void
    /** Existing display names in the project, for the suggestion and the collision check. */
    existingNames?: (string | null | undefined)[]
    /** Reconnect an endpoint that already exists instead of adding one. */
    reconnect?: {
        id: string
        slug: string
        name: string
        url: string
        /** How the connection authorizes, so a reconnect repairs the right thing. */
        authMode?: "oauth" | "api_key" | "none"
    } | null
    /** The connection, once it is real. Agents reference it by `slug`. */
    onConnected?: (endpoint: {id: string; slug: string; name: string}) => void
}

/** The header, which says what is being done rather than where in it we are. */
const CONNECT_TITLE = "Connect MCP server"
const RECONNECT_TITLE = "Reconnect MCP server"

const URL_HELP =
    "The server's HTTP endpoint. Agenta checks it and detects whether it needs OAuth, an API key, or nothing."

/** The box the address field is described by once the check has failed. */
const URL_PROBLEM_ID = "mcp-url-problem"

/**
 * The box that says why a key was refused, which both refused fields point at.
 *
 * `Field` announces an error it was given, and this one is given to neither field: it is a box
 * below them, because one refusal covers the pair. So the pairing has to be made by hand, and
 * it was not — both controls said they were invalid and neither said why (round 4, D106).
 */
const KEY_PROBLEM_ID = "mcp-key-problem"

/**
 * The prefix help text the server form already carries, reused rather than rewritten: it is
 * the same rule being explained, and two wordings for one rule is how they drift.
 */
const NAME_HELP =
    "What the model sees on this server's tools. Frozen when the connection was chosen, so renaming the connection does not rename tools here."

const HEADER_HELP = "The HTTP header this server expects, for example x-api-key"

/**
 * What this particular server asked for, under the Header field.
 *
 * A help line rather than a change of value, because a scheme is not a header name: `Bearer`
 * means `Authorization: Bearer <token>`, which is what an endpoint with no registered header
 * already sends. So the challenge cannot fill the field, and the reader is the only one who
 * can say which header this server wants the scheme's value in. Rendered only where there is
 * something to say (`mcpChallengeSchemeToShow`), so the pair of fields keeps its shape on
 * every other server.
 */
const headerSchemeHint = (scheme: string): string => `This server asked for the ${scheme} scheme.`

const SECRET_HELP =
    "Pick a project secret or create one. The value is sent as this header when the agent runs and is never shown again."

/** What a failed check is told, by what the probe found rather than by what it returned. */
const UNREACHABLE_HEADLINE = "Couldn't reach this server."
const NOT_AN_MCP_SERVER_HEADLINE = "Reached the address, but it isn't an MCP server."
const UNREACHABLE_ADVICE =
    "Check the address and that the server speaks HTTP transport. Private-network servers must be reachable from Agenta."

const KEY_REJECTED_HEADLINE = "The server rejected this key."

/**
 * The same sentence, naming the status the spec's C6 copy names.
 *
 * The spec writes "The server rejected this key (401)." and the status code is the one part
 * of that screen a person can act on or paste to a provider's support desk. It was dropped
 * for want of a number to put there, and what stood in its place was the relayed sentence
 * our own MCP client writes when it cannot read an answer, which says less (round 6c,
 * D-R6C-1).
 *
 * The number is the challenge's, which is how this server answers a request it will not
 * authorize. Where nothing challenged, the clause goes rather than a guess.
 */
const keyRejectedHeadlineFor = (status: number | null): string =>
    status ? `The server rejected this key (${status}).` : KEY_REJECTED_HEADLINE
const KEY_REJECTED_ADVICE = "Check the header the server expects, or pick another secret."
/**
 * The same advice, naming what the server expects where it said so.
 *
 * The spec's sentence had this clause and the implementation dropped it, because the probe
 * returned nothing to put in it. It returns the challenge now. Decision 27 asks for the
 * spec's em dashes to become a period or a colon, not for the clause to go.
 */
const keyRejectedAdviceFor = (scheme: string | null): string =>
    scheme
        ? `Check the header the server expects: ${scheme} or pick another secret.`
        : KEY_REJECTED_ADVICE

const WAITING_BODY =
    "Finish signing in in the window that opened. This closes on its own when you're done."

/** The existing sentence for the window between a granted consent and a refreshed list. */
const SAVING_BODY = "Setting up the connection…"

const CONSENT_POPUP_FEATURES = "width=600,height=700,popup=yes"

/** The six screens the statuses render as. */
type Screen = "url" | "url_failed" | "oauth" | "api_key" | "no_auth" | "waiting"

/**
 * How the server authorizes, from whichever of the two sources knows.
 *
 * A first connect learns it from the probe. A reconnect never probes — the address and the
 * identity are already the connection's — and carries it on the row instead.
 */
type AuthPath = ProbeResultMode

const authPathFor = (
    state: McpJourneyState,
    reconnect: McpConnectJourneyProps["reconnect"],
): AuthPath => {
    if (reconnect)
        return reconnect.authMode === "oauth" ? "oauth" : (reconnect.authMode ?? "api_key")
    const mode = state.probe?.auth.mode
    if (mode === "oauth") return "oauth"
    if (mode === "none") return "none"
    // Discovery was inconclusive, which in practice is a server holding its tools behind a
    // key it would not describe. The person is asked for one; the screen still offers the
    // other answer, because "we could not tell" is not "a key is required".
    return "api_key"
}

const SCREEN_FOR_AUTH_PATH: Record<AuthPath, Screen> = {
    oauth: "oauth",
    api_key: "api_key",
    none: "no_auth",
}

const screenFor = (state: McpJourneyState, path: AuthPath, consentRequested: boolean): Screen => {
    switch (state.status) {
        case "url_entry":
        case "checking_url":
            return "url"
        case "check_failed":
            return "url_failed"
        case "naming":
        case "create_failed":
            return SCREEN_FOR_AUTH_PATH[path]
        case "creating":
            // On the OAuth path the window is already open and waiting on us, so the screen
            // that explains an open window is the honest one from here.
            return path === "oauth" ? "waiting" : SCREEN_FOR_AUTH_PATH[path]
        case "discovering_scopes":
            // A reconnect enters HERE, with nobody having pressed anything. It shows what
            // it is about to do and waits for the press, because the window it ends at can
            // only be opened inside one.
            return consentRequested ? "waiting" : "oauth"
        case "choosing_scopes":
        case "awaiting_consent":
            return "waiting"
        case "scopes_failed":
        case "consent_cancelled":
        case "consent_failed":
            return "oauth"
        case "manual_auth":
        case "verifying":
        case "verify_failed":
            return path === "none" ? "no_auth" : "api_key"
        default:
            // `saving`, and `connected`, which draws nothing: success is the new row and
            // the sheet closes on it (decision 26). The wait is what is on screen for the
            // frame in between.
            return "waiting"
    }
}

/** The statuses in which a pre-opened consent window is still wanted. */
const CONSENT_FLOW: ReadonlySet<McpJourneyState["status"]> = new Set([
    "creating",
    "discovering_scopes",
    "choosing_scopes",
    "awaiting_consent",
    "saving",
])

/**
 * Whether the address is one the check can be pointed at.
 *
 * Parsed rather than pattern-matched, and http is allowed beside https: a server on a
 * private network is exactly what the failure copy tells people to make reachable, and the
 * product's own mock and acceptance stack are served over http. The check refuses what a
 * URL parser refuses, and nothing else.
 */
const isProbeableUrl = (value: string): boolean => {
    const trimmed = value.trim()
    if (!trimmed) return false
    try {
        const {protocol} = new URL(trimmed)
        return protocol === "https:" || protocol === "http:"
    } catch {
        return false
    }
}

const hostOf = (url: string): string => {
    try {
        return new URL(url.trim()).hostname
    } catch {
        return ""
    }
}

/**
 * The server's own sentence, with the host set in mono where the sentence names it.
 *
 * The address is the one thing in a failure worth reading character by character, and a
 * proportional font is where a transposed digit hides.
 */
const withMonoHost = (message: string, host: string) => {
    const at = host ? message.indexOf(host) : -1
    if (at === -1) return message
    return (
        <>
            {message.slice(0, at)}
            <span className="font-mono">{host}</span>
            {message.slice(at + host.length)}
        </>
    )
}

/**
 * Mounts the journey only while it is open, so each opening starts a new one.
 *
 * The state lives in a hook inside the body. A host that keeps this rendered and toggles
 * `open` would otherwise reopen onto the previous journey's final screen, with no URL field
 * in sight — which is exactly what happened before this wrapper existed.
 */
export default function McpConnectJourney(props: McpConnectJourneyProps) {
    if (!props.open) return null
    return <McpConnectJourneyBody {...props} />
}

function McpConnectJourneyBody({
    existingNames = [],
    reconnect = null,
    onConnected,
    ...rest
}: McpConnectJourneyProps) {
    const journey = useMcpConnectJourney({existingNames, reconnect, onConnected})
    return (
        <McpConnectSheet
            {...rest}
            journey={journey}
            existingNames={existingNames}
            reconnect={reconnect}
        />
    )
}

export interface McpConnectSheetProps extends Omit<
    McpConnectJourneyProps,
    "existingNames" | "reconnect" | "onConnected"
> {
    /** The journey this sheet is a rendering of. */
    journey: McpConnectJourneyApi
    existingNames?: (string | null | undefined)[]
    reconnect?: McpConnectJourneyProps["reconnect"]
}

/**
 * The six screens, given a journey.
 *
 * Separated from the hook so that every state can be held still: a story and a rendered
 * test both need to look at `consent_cancelled` without a provider refusing anything.
 */
export function McpConnectSheet({
    open,
    onClose,
    journey,
    existingNames = [],
    reconnect = null,
}: McpConnectSheetProps) {
    const {state} = journey
    const namedSecrets = useAtomValue(customNamedSecretsAtom)

    const [headerName, setHeaderName] = useState("Authorization")
    const [secretSlug, setSecretSlug] = useState("")
    const [creatingSecret, setCreatingSecret] = useState(false)
    // Latches on first open so the create drawer's hooks stay unmounted until needed.
    const [secretDrawerMounted, setSecretDrawerMounted] = useState(false)

    /**
     * Whether someone has asked for the provider's window on this attempt.
     *
     * State rather than a ref because two effects wait on it: the chain from the press to
     * the provider runs across three statuses and has to restart from whichever one the
     * press happened on.
     */
    const [consentRequested, setConsentRequested] = useState(false)
    const consentPopupRef = useRef<Window | null>(null)
    /**
     * What the key screen's press asked for, to be done once the row exists.
     *
     * The row has to be created before a credential can be attached to it, so one press is
     * two steps. A reconnect opens ON this screen with nothing pressed and nothing typed,
     * which is why the screen submits nothing until this says someone asked.
     */
    const [afterCreate, setAfterCreate] = useState<"credential" | null>(null)

    const path = authPathFor(state, reconnect)
    const screen = screenFor(state, path, consentRequested)
    /**
     * Whether something is in flight: the machine's answer, corrected for the one status that
     * covers two situations.
     *
     * `discovering_scopes` is both "discovery is running" and, on a reconnect, "this screen is
     * waiting for the press that starts it" — a reconnect opens there because the window
     * discovery ends at can only be opened inside a gesture. `screenFor` knows that and draws
     * the OAuth screen; `isBusy` did not, so a reconnect opened with Connect AND Cancel
     * disabled and the only thing that could enable them was the press it had disabled. It
     * never resolved, and the close X was the only way out (round 6c, D-R6C-4). Two buttons
     * dead together is the shape: a validation rule would not disable Cancel.
     *
     * The same deadlock as D30, which `RETRY_TARGET` closed for `creating` and `verifying`.
     */
    const awaitingConsentPress = state.status === "discovering_scopes" && !consentRequested
    const busy = isBusy(state) && !awaitingConsentPress
    // The window in which the connection is real but this dialog has not caught up.
    const sealed = state.status === "saving"

    const closeConsentPopup = useCallback(() => {
        consentPopupRef.current?.close()
        consentPopupRef.current = null
        setConsentRequested(false)
    }, [])

    /**
     * Open the window inside the gesture that asked for it, before any await.
     *
     * A blocked popup is not an error here: `driveConsent` falls back to a same-tab redirect,
     * which is the only path a mobile browser leaves open. The request is recorded either
     * way, because it is the request and not the window that the chain below waits on.
     */
    const requestConsent = useCallback(() => {
        consentPopupRef.current = window.open("", journey.popupName, CONSENT_POPUP_FEATURES)
        setConsentRequested(true)
    }, [journey.popupName])

    // The consent popup reports back through the journey's watch, which outlives this
    // component's render; unmounting with the popup still open has to release it.
    // Not just the watch: work already in flight has to be disowned too, or a create or a
    // begin that resolves after this unmount installs itself on an attempt nobody is waiting
    // for (D34).
    useEffect(() => journey.abandonAttempt, [journey.abandonAttempt])

    // `saving` means credentials are persisted and only the local bookkeeping is left.
    useEffect(() => {
        if (state.status === "saving") void journey.finish()
    }, [journey, state.status])

    // And `connected` means that bookkeeping is done: the grant is stored, the list has been
    // refreshed and the caller has been told. There is nothing left to show, so the sheet
    // goes (decision 26). Latched, because a host that passes a fresh `onClose` on every
    // render would otherwise be asked to close on every render after this.
    const closedOnConnect = useRef(false)
    useEffect(() => {
        if (state.status !== "connected" || closedOnConnect.current) return
        closedOnConnect.current = true
        onClose()
    }, [onClose, state.status])

    // A window opened for an attempt that is no longer going to the provider is a blank
    // popup nobody closes. The statuses that still want it are the ones between the press
    // and the callback.
    useEffect(() => {
        if (!consentRequested || CONSENT_FLOW.has(state.status)) return
        closeConsentPopup()
    }, [closeConsentPopup, consentRequested, state.status])

    // The chain from one press to the provider: read what the server offers, then ask for
    // all of it. Both steps are the component's because the window they end at was opened by
    // a gesture the component owns, and neither runs until that gesture has happened.
    useEffect(() => {
        if (state.status === "discovering_scopes" && consentRequested) {
            void journey.startScopeDiscovery()
        }
    }, [consentRequested, journey, state.status])

    useEffect(() => {
        if (state.status === "choosing_scopes" && consentRequested) {
            void journey.submitScopes(consentPopupRef.current)
        }
    }, [consentRequested, journey, state.status])

    // The second half of the key screen's one press, once the row it needs exists.
    useEffect(() => {
        if (state.status !== "manual_auth" || !afterCreate) return
        const secretId = namedSecrets.find((secret) => secret.slug === secretSlug)?.id
        if (!secretId) return
        void journey.submitManualCredential({headerName, secretId})
    }, [afterCreate, headerName, journey, namedSecrets, secretSlug, state.status])

    const nameProblem =
        state.status === "naming"
            ? connectionNameProblem({
                  name: state.name,
                  existingNames,
                  currentName: reconnect?.name,
              })
            : null

    const handleClose = useCallback(() => {
        // Belt and braces with the modal props below: whatever route a close arrives by, it
        // must not cancel an attempt whose credential the provider has already issued.
        if (state.status === "saving") return
        consentPopupRef.current?.close()
        consentPopupRef.current = null
        void journey.cancel()
        onClose()
    }, [journey, onClose, state.status])

    const selectedSecretId = useCallback(
        () => namedSecrets.find((secret) => secret.slug === secretSlug)?.id ?? "",
        [namedSecrets, secretSlug],
    )

    /** Everything a retry has to do, whichever refusal it is retrying. */
    const retryConsent = useCallback(() => {
        requestConsent()
        journey.retry()
    }, [journey, requestConsent])

    const submitCredential = useCallback(() => {
        const secretId = selectedSecretId()
        if (!secretId) return
        void journey.submitManualCredential({headerName, secretId})
    }, [headerName, journey, selectedSecretId])

    const confirm = useCallback(() => {
        switch (state.status) {
            case "url_entry":
            case "check_failed":
                void journey.submitUrl(state.url.trim())
                return
            case "naming":
                if (nameProblem) return
                if (path === "oauth") requestConsent()
                if (path === "api_key") setAfterCreate("credential")
                void journey.submitName()
                return
            case "create_failed":
                // The window opened for the first attempt was closed when this screen
                // replaced the wait, so the retry needs one of its own, opened in this tap.
                if (path === "oauth") requestConsent()
                void journey.submitName()
                return
            case "scopes_failed":
            case "consent_cancelled":
            case "consent_failed":
                retryConsent()
                return
            case "discovering_scopes":
                // A reconnect waiting for the press that opens the window.
                requestConsent()
                return
            case "manual_auth":
            case "verify_failed":
                // A connection that authorizes with nothing is repaired by saying so; there
                // is no credential on this screen to submit.
                if (path === "none") journey.skipAuthentication()
                else submitCredential()
                return
            default:
                // A finished journey has nothing left to confirm but its own closing, which
                // the effect above has already asked for.
                onClose()
        }
    }, [
        journey,
        nameProblem,
        onClose,
        path,
        requestConsent,
        retryConsent,
        state.status,
        state.url,
        submitCredential,
    ])

    const prefix = useMemo(() => toolPrefixFromName(state.name), [state.name])
    // Only the key screen has a secret to have chosen, and only it should be reading the
    // project's vault: every other screen would be asking a question it has no field for.
    const secretChosen = screen === "api_key" && !!selectedSecretId()
    const host = hostOf(state.url)
    const probeResponse = readMcpProbeResponse(state.probe?.problem)
    // What the server named when it refused the anonymous handshake, where that is anything
    // the Authorization default does not already cover.
    const challengeScheme = mcpChallengeSchemeToShow(state.probe)
    const challengeStatus = mcpChallengeStatus(state.probe)

    /** The one error that belongs to a field rather than to the screen. */
    const nameError = state.status === "naming" ? (nameProblem ?? state.error) : null

    const title = reconnect ? RECONNECT_TITLE : CONNECT_TITLE

    return (
        <EnhancedModal
            open={open}
            onCancel={handleClose}
            // Escape and a mask click reach `onCancel` even while the footer's buttons are
            // disabled. Between consent and the refetch the grant already exists server-side,
            // so a close here would delete a row whose credential the provider is still
            // holding (D29). The journey moves on by itself; there is nothing to abandon.
            maskClosable={!sealed}
            keyboard={!sealed}
            closable={!sealed}
            title={title}
            footer={null}
            width={480}
            destroyOnClose
        >
            <ModalContent>
                <div className="flex flex-col gap-4" data-testid="mcp-connect-journey">
                    {screen === "url" || screen === "url_failed" ? (
                        <HintedField
                            label="Server URL"
                            required
                            // Dropped once the check has failed: the box below says what is
                            // wrong with this address, and the line explaining what the
                            // field is for is no longer the thing to read.
                            hint={screen === "url" ? URL_HELP : null}
                        >
                            <Input
                                autoFocus
                                className="font-mono text-[13px]"
                                placeholder="https://mcp.example.com/mcp"
                                value={state.url}
                                disabled={busy}
                                aria-label="Server URL"
                                // The failure box, when the check has failed. The help line
                                // is `HintedField`'s to name, and it names it only while it
                                // is rendered, so the refused field describes the box that
                                // replaced it rather than a line that is gone (round 4, P2).
                                aria-describedby={
                                    screen === "url_failed" ? URL_PROBLEM_ID : undefined
                                }
                                aria-invalid={screen === "url_failed" || undefined}
                                onChange={(event) => journey.setUrl(event.target.value)}
                            />
                        </HintedField>
                    ) : null}

                    {screen === "url_failed" ? (
                        <InlineError
                            id={URL_PROBLEM_ID}
                            headline={
                                state.probe?.problem?.cause === "not_an_mcp_server"
                                    ? NOT_AN_MCP_SERVER_HEADLINE
                                    : UNREACHABLE_HEADLINE
                            }
                        >
                            {state.error ? withMonoHost(state.error, host) : null}{" "}
                            {state.probe?.problem?.cause === "not_an_mcp_server"
                                ? null
                                : UNREACHABLE_ADVICE}{" "}
                            {/* Only where the check carried an answer to show, which the
                                probe does not do today. See `readMcpProbeResponse`. */}
                            {probeResponse ? (
                                <ShowResponsePanel
                                    statusLine={probeResponse.status}
                                    body={probeResponse.body}
                                />
                            ) : null}
                        </InlineError>
                    ) : null}

                    {screen === "oauth" || screen === "api_key" || screen === "no_auth" ? (
                        <ProbeResultCard
                            url={reconnect?.url ?? state.url}
                            mode={path}
                            // A reconnect is repairing one address. Offering to change it
                            // would offer to point a saved connection somewhere else.
                            onChange={reconnect ? undefined : () => journey.setUrl(state.url)}
                        />
                    ) : null}

                    {screen === "oauth" || screen === "api_key" || screen === "no_auth" ? (
                        <HintedField
                            label="Name"
                            required
                            tooltip={screen === "oauth" ? NAME_HELP : undefined}
                            error={nameError ?? undefined}
                            hint={
                                screen === "oauth" && prefix ? (
                                    <>
                                        Shown across this project. Tools are prefixed{" "}
                                        <span className="font-mono">{prefix}_</span>
                                    </>
                                ) : null
                            }
                        >
                            <Input
                                autoFocus={!reconnect}
                                value={state.name}
                                // A reconnect repairs a credential. The label is what agents
                                // and people already call this connection.
                                disabled={!!reconnect || busy}
                                aria-label="Name"
                                onChange={(event) => journey.setName(event.target.value)}
                            />
                        </HintedField>
                    ) : null}

                    {screen === "oauth" ? (
                        <NoticeBox>
                            Connect opens {state.name || "the server"}&apos;s authorization page in
                            a new window; {state.name || "the server"} asks which permissions to
                            grant (usually read and write). The login is stored for this project
                            only.
                        </NoticeBox>
                    ) : null}

                    {screen === "api_key" ? (
                        <>
                            <div className="grid grid-cols-[1fr_1.4fr] gap-3">
                                <HintedField
                                    label="Header"
                                    // Dropped once the server has refused a key: the glyph
                                    // explains what a header is, and by now the question is
                                    // which one this server wants.
                                    tooltip={
                                        state.status === "verify_failed" ? undefined : HEADER_HELP
                                    }
                                    invalid={state.status === "verify_failed"}
                                    hint={
                                        challengeScheme ? headerSchemeHint(challengeScheme) : null
                                    }
                                >
                                    <Input
                                        className="font-mono text-[13px]"
                                        placeholder="Authorization"
                                        value={headerName}
                                        aria-label="Header"
                                        aria-describedby={
                                            state.status === "verify_failed"
                                                ? KEY_PROBLEM_ID
                                                : undefined
                                        }
                                        onChange={(event) =>
                                            setHeaderName(event.target.value.trim())
                                        }
                                    />
                                </HintedField>
                                <Field
                                    label="Project secret"
                                    required
                                    invalid={state.status === "verify_failed"}
                                >
                                    <SecretSelect
                                        value={secretSlug}
                                        onChange={setSecretSlug}
                                        secrets={namedSecrets}
                                        invalid={state.status === "verify_failed"}
                                        aria-describedby={
                                            state.status === "verify_failed"
                                                ? KEY_PROBLEM_ID
                                                : undefined
                                        }
                                        canCreate={!!headerName}
                                        onCreate={() => {
                                            setSecretDrawerMounted(true)
                                            setCreatingSecret(true)
                                        }}
                                    />
                                </Field>
                            </div>
                            <span className="-mt-2 block text-xs leading-normal text-colorTextTertiary">
                                {SECRET_HELP}
                            </span>
                        </>
                    ) : null}

                    {screen === "api_key" && state.status === "verify_failed" ? (
                        <InlineError
                            id={KEY_PROBLEM_ID}
                            headline={keyRejectedHeadlineFor(challengeStatus)}
                            className="-mt-2"
                        >
                            {/* The spec's sentence, and only it. The relayed sentence that
                                used to sit here was our own client's "did not answer
                                initialize", which names a protocol call where the status code
                                and the header advice are what a reader can act on. */}
                            {keyRejectedAdviceFor(challengeScheme)}
                        </InlineError>
                    ) : null}

                    {screen === "waiting" ? (
                        <WaitingCard
                            title={sealed ? null : `Waiting for ${state.name}…`}
                            body={sealed ? SAVING_BODY : WAITING_BODY}
                        >
                            {sealed ? null : (
                                <div className="flex items-center gap-4 text-xs">
                                    <Button
                                        variant="link"
                                        size="xs"
                                        className="px-0 text-xs"
                                        onClick={() => consentPopupRef.current?.focus()}
                                    >
                                        Open the window again
                                    </Button>
                                    <Button
                                        variant="link"
                                        size="xs"
                                        className="px-0 text-xs text-colorTextTertiary"
                                        onClick={() => {
                                            closeConsentPopup()
                                            // A reconnect has no screen behind this one, so
                                            // for one the only way back is out.
                                            if (state.probe) journey.cancelConsent()
                                            else handleClose()
                                        }}
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            )}
                        </WaitingCard>
                    ) : null}

                    {screen === "oauth" && isConsentRefusal(state.status) ? (
                        <InlineError headline={null}>
                            {state.status === "consent_cancelled"
                                ? `${state.name} didn't authorize Agenta. The sign-in was cancelled or denied. Nothing was saved.`
                                : state.error}
                        </InlineError>
                    ) : null}

                    {state.status === "create_failed" ? (
                        <InlineError headline={null}>{state.error}</InlineError>
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
                </div>

                {screen === "waiting" ? null : (
                    <>
                        <Divider className="my-0 border-colorBorderSecondary" />
                        <div className="flex items-center justify-end gap-2">
                            <Button variant="outline" onClick={handleClose} disabled={busy}>
                                Cancel
                            </Button>
                            <LoadingButton
                                loading={busy}
                                disabled={
                                    !canConfirm({
                                        screen,
                                        state,
                                        nameProblem,
                                        secretChosen,
                                        busy,
                                    })
                                }
                                onClick={confirm}
                            >
                                {confirmLabel(screen, state)}
                                {screen === "oauth" && !isConsentRefusal(state.status) ? (
                                    <ArrowSquareOut size={14} data-icon="inline-end" />
                                ) : null}
                            </LoadingButton>
                        </div>
                    </>
                )}
            </ModalContent>
        </EnhancedModal>
    )
}

const isConsentRefusal = (status: McpJourneyState["status"]) =>
    status === "consent_cancelled" || status === "consent_failed" || status === "scopes_failed"

/** What the trailing button says, by screen and by whether it is a second attempt. */
const confirmLabel = (screen: Screen, state: McpJourneyState): string => {
    if (screen === "url") return "Continue"
    if (screen === "url_failed") return "Try again"
    if (isConsentRefusal(state.status)) return "Try again"
    if (state.status === "verify_failed" || state.status === "create_failed") return "Try again"
    return "Connect"
}

const canConfirm = ({
    screen,
    state,
    nameProblem,
    secretChosen,
    busy,
}: {
    screen: Screen
    state: McpJourneyState
    nameProblem: string | null
    secretChosen: boolean
    busy: boolean
}): boolean => {
    if (busy && screen !== "waiting") return false
    if (screen === "url" || screen === "url_failed") return isProbeableUrl(state.url)
    if (nameProblem) return false
    if (screen === "api_key") return !!state.name.trim() && secretChosen
    return !!state.name.trim()
}

/**
 * A label, a control, and a line of help under the control.
 *
 * `Field` puts its description above the control and its error below it, which is right for
 * a form row and wrong for these: the help here describes what the value does once it is
 * saved, and it is read after the value, not before it. The control keeps `Field`'s
 * announcement wiring by naming the help line itself.
 */
const HintedField = ({
    hint,
    children,
    ...field
}: {
    label: string
    required?: boolean
    tooltip?: string
    error?: string
    invalid?: boolean
    hint?: ReactNode
    children: ReactElement<{"aria-describedby"?: string}>
}) => {
    // Generated here, and named only while the line it names is on screen. The ids used to be
    // written by hand at each call site and set on the control unconditionally, so every
    // screen that drew no hint left the control pointing at an element that was not in the
    // document: four of them on the name field alone (round 4, D127). A field cannot forget
    // an id it never writes.
    const hintId = useId()
    const own = children.props["aria-describedby"]
    const describedBy = [own, hint ? hintId : null].filter(Boolean).join(" ") || undefined

    return (
        <div className="flex flex-col gap-1.5">
            <Field {...field} className="gap-1.5">
                {cloneElement(children, {"aria-describedby": describedBy})}
            </Field>
            {hint ? (
                <p id={hintId} className="m-0 text-xs leading-normal text-colorTextTertiary">
                    {hint}
                </p>
            ) : null}
        </div>
    )
}

/**
 * The failure box: a sentence in the error fill, with the first clause carrying the weight.
 *
 * It is the kit's Alert with the spec's fill, rather than a box of its own, so a change to
 * how this product draws a refusal reaches it.
 */
const InlineError = ({
    headline,
    children,
    className,
    id,
}: {
    headline: string | null
    children: React.ReactNode
    className?: string
    /** Set where a field points `aria-describedby` at this box. */
    id?: string
}) => (
    <Alert
        id={id}
        type="error"
        showIcon
        icon={<WarningCircle size={15} weight="regular" />}
        className={`items-start border-colorErrorBorder bg-colorErrorBg px-3 py-2.5 ${className ?? ""}`}
        message={
            <span className="text-xs font-normal leading-normal text-colorTextSecondary">
                {headline ? <span className="font-medium text-colorText">{headline} </span> : null}
                {children}
            </span>
        }
    />
)

const WaitingCard = ({
    title,
    body,
    children,
}: {
    title: string | null
    body: string
    children?: React.ReactNode
}) => (
    <div
        className="flex flex-col items-center gap-3 px-0 py-6 text-center"
        role="status"
        data-testid="mcp-connect-waiting"
    >
        <CircleNotch size={24} className="animate-spin text-colorTextSecondary" />
        {title ? <p className="m-0 text-sm font-medium text-colorText">{title}</p> : null}
        <p className="m-0 max-w-[300px] text-xs leading-normal text-colorTextSecondary">{body}</p>
        {children}
    </div>
)

/**
 * The project-secret picker.
 *
 * The create action is a Button and not a SelectItem, because it is an action rather than a
 * value. Without it a project with no secret yet is a dead end on the only field that can
 * finish this screen.
 */
const SecretSelect = ({
    value,
    onChange,
    secrets,
    invalid,
    canCreate,
    onCreate,
    id,
    "aria-describedby": describedBy,
}: {
    value: string
    onChange: (slug: string) => void
    secrets: {id?: string | null; slug?: string | null; name?: string | null}[]
    invalid?: boolean
    canCreate: boolean
    onCreate: () => void
    /**
     * Injected by `Field`, which generates one when the child has none and points its
     * label's `htmlFor` at it. A child that drops it leaves the label associated with
     * nothing, which is the association `Field` exists to guarantee (round 4, D104).
     */
    id?: string
    /** Injected the same way, and by the screens that name an error box of their own. */
    "aria-describedby"?: string
}) => {
    const [selectOpen, setSelectOpen] = useState(false)
    const options = secrets.filter((secret) => !!secret.slug)

    return (
        <Select
            value={value || undefined}
            onValueChange={onChange}
            open={selectOpen}
            onOpenChange={setSelectOpen}
        >
            <SelectTrigger
                id={id}
                className="w-full"
                aria-label="Project secret"
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
            >
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
                <Button
                    variant="ghost"
                    disabled={!canCreate}
                    onClick={() => {
                        setSelectOpen(false)
                        onCreate()
                    }}
                    className="min-h-control w-full justify-start gap-2 rounded-control-sm px-3 py-1 text-field-md font-normal"
                >
                    <Plus size={13} className="shrink-0" />
                    Create secret
                </Button>
            </SelectContent>
        </Select>
    )
}
