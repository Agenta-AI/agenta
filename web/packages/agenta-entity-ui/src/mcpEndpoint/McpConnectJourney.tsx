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
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    connectionNameProblem,
    detectedAuthMode,
    isBusy,
    mcpChallengeScheme,
    mcpDefaultCredentialBinding,
    readMcpProbeResponse,
    toolPrefixFromName,
    useMcpConnectJourney,
    type MCPAuthMode,
    type MCPCredentialBinding,
    type McpConnectJourney as McpConnectJourneyApi,
    type McpJourneyState,
} from "@agenta/entities/mcpEndpoint"
import {customNamedSecretsAtom} from "@agenta/entities/secret"
import {EnhancedModal, ModalContent} from "@agenta/ui"
import {
    Alert,
    Button,
    cn,
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
    touchTargetExpansion,
} from "@agenta/ui/ui"
import {ArrowSquareOut, CircleNotch, Plus, WarningCircle} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {CreateSecretDrawer} from "../secret"
import {consentPopupFeatures} from "../shared/consentPopupFeatures"

import {
    AuthModeSelector,
    BasicCredentialHelper,
    CredentialBindingFields,
    headerSchemeHint,
    HintedField,
    NoticeBox,
    ProbeResultCard,
    ShowResponsePanel,
} from "./components"

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
        /** Where its credential is already sent, which a repair keeps. */
        credentialBinding?: MCPCredentialBinding | null
    } | null
    /** The connection, once it is real. Agents reference it by `slug`. */
    onConnected?: (endpoint: {id: string; slug: string; name: string}) => void
    /** A drawer panel to open inside, masking only that drawer. Absent = the page. */
    container?: HTMLElement | null
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

const SECRET_HELP_TARGET: Record<MCPCredentialBinding["kind"], string> = {
    header: "header",
    query: "query parameter",
}
const secretHelpFor = (kind: MCPCredentialBinding["kind"]): string =>
    `Pick a project secret or create one. The value is sent as this ${SECRET_HELP_TARGET[kind]} when the agent runs and is never shown again.`

/** What a failed check is told, by what the probe found rather than by what it returned. */
const UNREACHABLE_HEADLINE = "Couldn't reach this server."
const NOT_AN_MCP_SERVER_HEADLINE = "Reached the address, but it isn't an MCP server."
const FAILURE_HEADLINES: Record<string, string> = {
    not_an_mcp_server: NOT_AN_MCP_SERVER_HEADLINE,
    unsupported_transport:
        "This address uses the older SSE transport, which Agenta does not support.",
}
/**
 * Where to look instead of a computed address. A rewrite of the path was right for some
 * providers and wrong for others, and only the provider knows its newer address.
 */
const NEWER_TRANSPORT_ADVICE =
    "Many providers serve the newer transport at an address ending in /mcp. Check the provider's docs."
const LEGACY_TRANSPORT_WARNING = `This address may use the older SSE transport, which Agenta does not support. ${NEWER_TRANSPORT_ADVICE}`
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
 * The number is the credentialed request's own: the specification's transition is one
 * authenticated call whose 401 or 403 lands here, and this sentence is about that call. It
 * was taken from the anonymous probe's challenge instead, which is a real number about a
 * different request, so an anonymous 401 followed by a 403 read "(401)" and a timeout read
 * "(401)" as well (round 4, D133 reopened). Only a status that answered about the credential
 * reaches this screen now, so the clause is never a guess and never absent when it is owed.
 */
const keyRejectedHeadlineFor = (status: number | null): string =>
    status ? `The server rejected this key (${status}).` : KEY_REJECTED_HEADLINE
const KEY_REJECTED_ADVICE = "Check the header the server expects, or pick another secret."
/**
 * The same advice, preceded by what the server asked for where it said so.
 *
 * The spec's sentence had this clause and the implementation dropped it, because the probe
 * returned nothing to put in it. It returns the challenge now. Decision 27 asks for the
 * spec's em dashes to become a period or a colon, not for the clause to go.
 *
 * What the challenge names is a scheme, not a header: `Bearer` means `Authorization: Bearer
 * <token>`. Reading it into "the header the server expects" told the reader to type `Bearer`
 * into the Header field, which is the one thing that cannot be right. The sentence the Prefix
 * field's own hint already uses says the same fact correctly, so it says it here too.
 */
const keyRejectedAdviceFor = (scheme: string | null): string =>
    scheme ? `${headerSchemeHint(scheme)} ${KEY_REJECTED_ADVICE}` : KEY_REJECTED_ADVICE

/** None was chosen over what the server or the saved row suggested, and the server refused. */
const keyRefusedWithoutKeyFor = (status: number | null): string =>
    status
        ? `The server refused a connection without a key (${status}).`
        : "The server refused a connection without a key."
const NO_KEY_REFUSED_ADVICE = "Pick another authentication mode above."

const WAITING_BODY =
    "Finish in the window that opened. Sign in to the provider if it asks, then approve Agenta. This closes on its own when you're done."

/** The existing sentence for the window between a granted consent and a refreshed list. */
const SAVING_BODY = "Setting up the connection…"

/** The six screens the statuses render as. */
type Screen = "url" | "url_failed" | "oauth" | "api_key" | "no_auth" | "waiting"

const SCREEN_FOR_AUTH_PATH: Record<MCPAuthMode, Screen> = {
    oauth: "oauth",
    api_key: "api_key",
    none: "no_auth",
}

const screenFor = (
    state: McpJourneyState,
    path: MCPAuthMode,
    consentRequested: boolean,
): Screen => {
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
    container = null,
}: McpConnectSheetProps) {
    const {state} = journey
    const namedSecrets = useAtomValue(customNamedSecretsAtom)

    /**
     * Where the key goes, as the person set it, or null while they have changed nothing.
     *
     * Null rather than a seeded binding, because the probe answers after this mounts and the
     * prefill depends on what it found. Seeding at mount would have to be corrected later,
     * which means deciding whether a correction is allowed to overwrite a typed value; not
     * seeding at all makes that question disappear.
     */
    const [bindingDraft, setBindingDraft] = useState<MCPCredentialBinding | null>(null)
    /**
     * The binding the screen shows: what was set, or the spec's C5 prefill.
     *
     * The scheme the challenge named picks `Authorization` with `Bearer`, because a scheme
     * travels in that header; a challenge that named none picks a bare `x-api-key`. Editable
     * either way.
     *
     * A reconnect starts from the binding the connection is already saved with, because it
     * repairs a credential and changes nothing else (decisions 10 and 34). Offering the
     * probe's default there put `Authorization` over a saved `X-Api-Key`, so accepting what
     * was on screen broke a working connection.
     */
    const binding =
        bindingDraft ?? reconnect?.credentialBinding ?? mcpDefaultCredentialBinding(state.probe)
    const [secretSlug, setSecretSlug] = useState("")
    const [creatingSecret, setCreatingSecret] = useState(false)
    /** The Basic helper's encoded value, which the create drawer opens with. */
    const [secretSeed, setSecretSeed] = useState<string | undefined>(undefined)
    const openSecretDrawer = useCallback((seed?: string) => {
        setSecretSeed(seed)
        setSecretDrawerMounted(true)
        setCreatingSecret(true)
    }, [])
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
     * Which steps of the consent chain this press has already started.
     *
     * Reset by `requestConsent`, which is the one thing every press and every retry calls.
     */
    const consentSteps = useRef({discovery: false, scopes: false})
    /**
     * What the key screen's press asked for, to be done once the row exists.
     *
     * The row has to be created before a credential can be attached to it, so one press is
     * two steps. A reconnect opens ON this screen with nothing pressed and nothing typed,
     * which is why the screen submits nothing until this says someone asked.
     */
    const [afterCreate, setAfterCreate] = useState<"credential" | null>(null)

    /** How the connection authenticates: the person's choice, which the probe only suggested. */
    const path = state.authMode
    /**
     * What the probe found, which the card reports and the selector marks. A reconnect reads
     * its check of the saved address, so a server that answers without a key says so; until
     * that check answers, its card reports how the connection was saved.
     */
    const serverProbe = state.probe ?? state.savedUrlProbe
    const detected = serverProbe ? detectedAuthMode(serverProbe) : null
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
        const popup = window.open("", journey.popupName, consentPopupFeatures(window))
        try {
            const body = popup?.document.body
            if (body) body.textContent = `Opening ${state.name}…`
        } catch {
            // A window reused from an earlier attempt can already be on the provider's
            // origin, and reading a cross-origin document throws.
        }
        consentPopupRef.current = popup
        consentSteps.current = {discovery: false, scopes: false}
        setConsentRequested(true)
    }, [journey.popupName, state.name])

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
    //
    // Each runs ONCE per press. These effects depend on `journey`, whose identity changes
    // with every state change, so while a step was in flight any re-render re-entered it: a
    // single press was seen minting three authorization round trips against a real provider,
    // each with its own `state`, where the person asked for one (round 6d, live). A latch is
    // the smallest guard that survives a re-render, and every press and every retry goes
    // through `requestConsent`, which clears it.
    useEffect(() => {
        if (state.status !== "discovering_scopes" || !consentRequested) return
        if (consentSteps.current.discovery) return
        consentSteps.current.discovery = true
        void journey.startScopeDiscovery()
    }, [consentRequested, journey, state.status])

    useEffect(() => {
        if (state.status !== "choosing_scopes" || !consentRequested) return
        if (consentSteps.current.scopes) return
        consentSteps.current.scopes = true
        void journey.submitScopes(consentPopupRef.current)
    }, [consentRequested, journey, state.status])

    // The second half of the key screen's one press, once the row it needs exists.
    useEffect(() => {
        if (state.status !== "manual_auth" || !afterCreate) return
        const secretId = namedSecrets.find((secret) => secret.slug === secretSlug)?.id
        if (!secretId) return
        void journey.submitManualCredential({binding, secretId})
    }, [afterCreate, binding, journey, namedSecrets, secretSlug, state.status])

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
        void journey.submitManualCredential({binding, secretId})
    }, [binding, journey, selectedSecretId])

    const confirm = useCallback(() => {
        const keyBinding = path === "api_key" ? binding : undefined
        switch (state.status) {
            case "url_entry":
            case "check_failed":
                void journey.submitUrl(state.url.trim())
                return
            case "naming":
                if (nameProblem) return
                if (path === "oauth") requestConsent()
                if (path === "api_key") setAfterCreate("credential")
                void journey.submitName(keyBinding)
                return
            case "create_failed":
                // The window opened for the first attempt was closed when this screen
                // replaced the wait, so the retry needs one of its own, opened in this tap.
                if (path === "oauth") requestConsent()
                void journey.submitName(keyBinding)
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
                // A refusal took its row with it, so trying again makes one, and the
                // credential follows as soon as it exists — the same two steps this
                // screen's first press takes.
                if (!state.endpointId) {
                    if (path === "api_key") setAfterCreate("credential")
                    void journey.submitName(keyBinding)
                    return
                }
                // A connection that authorizes with nothing is repaired by saying so; there
                // is no credential on this screen to submit.
                if (path === "none") {
                    void journey.skipAuthentication()
                    return
                }
                submitCredential()
                return
            default:
                // A finished journey has nothing left to confirm but its own closing, which
                // the effect above has already asked for.
                onClose()
        }
    }, [
        binding,
        journey,
        nameProblem,
        onClose,
        path,
        requestConsent,
        retryConsent,
        state.endpointId,
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
    const failureCause = state.probe?.problem?.cause
    const failureHeadline =
        (failureCause && FAILURE_HEADLINES[failureCause]) || UNREACHABLE_HEADLINE
    // The probe's sentence repeats the SSE headline, so only the advice goes under it.
    // Reachability advice is wrong wherever the address answered.
    const failureBody =
        failureCause === "unsupported_transport" ? (
            NEWER_TRANSPORT_ADVICE
        ) : (
            <>
                {state.error ? withMonoHost(state.error, host) : null}{" "}
                {failureCause === "not_an_mcp_server" ? null : UNREACHABLE_ADVICE}
            </>
        )
    // What the server named when it refused the anonymous handshake. Named on a refusal even
    // when it is Bearer, because the key it was sent is the thing in question.
    const challengeScheme = mcpChallengeScheme(state.probe)
    // The status of the request that carried the key, not the one that carried nothing.
    const refusedStatus = state.failureStatus

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
            getContainer={container ?? false}
            contained={!!container}
        >
            <ModalContent>
                <div className="flex flex-col gap-4" data-testid="mcp-connect-journey">
                    {screen === "url" || screen === "url_failed" ? (
                        <HintedField
                            label="Server URL"
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
                        <InlineError id={URL_PROBLEM_ID} headline={failureHeadline}>
                            {failureBody}{" "}
                            {/* Only where the check carried an answer to show. See
                                `readMcpProbeResponse`. */}
                            {probeResponse ? (
                                <ShowResponsePanel
                                    statusLine={probeResponse.status}
                                    body={probeResponse.body}
                                />
                            ) : null}
                        </InlineError>
                    ) : null}

                    {screen === "oauth" || screen === "api_key" || screen === "no_auth" ? (
                        <>
                            <ProbeResultCard
                                url={reconnect?.url ?? state.url}
                                mode={detected ?? reconnect?.authMode ?? path}
                                // A reconnect is repairing one address. Offering to change it
                                // would offer to point a saved connection somewhere else.
                                onChange={reconnect ? undefined : () => journey.setUrl(state.url)}
                            />
                            <AuthModeSelector
                                value={path}
                                detected={detected}
                                oauthSelectable={state.oauthOffered}
                                disabled={busy || sealed}
                                onChange={journey.selectAuthMode}
                            />
                        </>
                    ) : null}

                    {(screen === "oauth" || screen === "api_key") &&
                    state.probe?.legacy_transport_suspected ? (
                        <Alert
                            type="warning"
                            showIcon
                            icon={<WarningCircle size={15} weight="regular" />}
                            className="items-start border-colorWarningBorder bg-colorWarningBg px-3 py-2.5"
                            message={
                                <span className="text-xs font-normal leading-normal text-colorText">
                                    {LEGACY_TRANSPORT_WARNING}
                                </span>
                            }
                        />
                    ) : null}

                    {screen === "oauth" || screen === "api_key" || screen === "no_auth" ? (
                        <HintedField
                            label="Name"
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
                            <div className="flex flex-col gap-3">
                                <CredentialBindingFields
                                    value={binding}
                                    onChange={setBindingDraft}
                                    probe={state.probe}
                                    disabled={busy}
                                    invalid={state.status === "verify_failed"}
                                    aria-describedby={
                                        state.status === "verify_failed"
                                            ? KEY_PROBLEM_ID
                                            : undefined
                                    }
                                />
                                {binding.prefix === "Basic" ? (
                                    <BasicCredentialHelper
                                        disabled={busy}
                                        onCreateSecret={openSecretDrawer}
                                    />
                                ) : null}
                                <Field
                                    label="Project secret"
                                    invalid={state.status === "verify_failed"}
                                >
                                    <SecretSelect
                                        value={secretSlug}
                                        onChange={setSecretSlug}
                                        secrets={namedSecrets}
                                        disabled={busy}
                                        invalid={state.status === "verify_failed"}
                                        aria-describedby={
                                            state.status === "verify_failed"
                                                ? KEY_PROBLEM_ID
                                                : undefined
                                        }
                                        canCreate={!!binding.name.trim()}
                                        onCreate={() => openSecretDrawer()}
                                    />
                                </Field>
                            </div>
                            <span className="-mt-2 block text-xs leading-normal text-colorTextTertiary">
                                {secretHelpFor(binding.kind)}
                            </span>
                        </>
                    ) : null}

                    {screen === "api_key" && state.status === "verify_failed" ? (
                        <InlineError
                            id={KEY_PROBLEM_ID}
                            headline={keyRejectedHeadlineFor(refusedStatus)}
                            className="-mt-2"
                        >
                            {/* The server's own words, where it wrote any. Deleting them left
                                static copy around a number, which on a typed gateway refusal
                                threw away the only account of what went wrong; the sentence
                                that made deleting them look right was our own client's "did
                                not answer initialize", and that failure no longer reaches
                                this screen at all (round 4, D133 reopened). */}
                            {state.error} {keyRejectedAdviceFor(challengeScheme)}
                        </InlineError>
                    ) : null}

                    {screen === "no_auth" && state.status === "verify_failed" ? (
                        <InlineError headline={keyRefusedWithoutKeyFor(refusedStatus)}>
                            {state.error} {NO_KEY_REFUSED_ADVICE}
                        </InlineError>
                    ) : null}

                    {screen === "waiting" ? (
                        <WaitingCard
                            title={sealed ? null : `Waiting for ${state.name}…`}
                            body={sealed ? SAVING_BODY : WAITING_BODY}
                        >
                            {sealed ? null : (
                                <div className="flex items-center gap-4 text-xs">
                                    {/* Both links are the control scale's 24px, under the 44px
                                        touch minimum, so each grows an invisible box to reach it.
                                        The row's gap is 16px, wider than the 10px either box
                                        reaches sideways, so they do not overlap each other. */}
                                    <Button
                                        variant="link"
                                        size="xs"
                                        className={cn("px-0 text-xs", touchTargetExpansion(24))}
                                        onClick={() => consentPopupRef.current?.focus()}
                                    >
                                        Open the window again
                                    </Button>
                                    <Button
                                        variant="link"
                                        size="xs"
                                        className={cn(
                                            "px-0 text-xs text-colorTextTertiary",
                                            touchTargetExpansion(24),
                                        )}
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
                            onClose={() => {
                                setCreatingSecret(false)
                                setSecretSeed(undefined)
                            }}
                            headerName={binding.name}
                            serverName={state.name}
                            initialValue={secretSeed}
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
                                        bindingNamed: !!binding.name.trim(),
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
    bindingNamed,
    busy,
}: {
    screen: Screen
    state: McpJourneyState
    nameProblem: string | null
    secretChosen: boolean
    bindingNamed: boolean
    busy: boolean
}): boolean => {
    if (busy && screen !== "waiting") return false
    if (screen === "url" || screen === "url_failed") return isProbeableUrl(state.url)
    if (nameProblem) return false
    if (screen === "api_key") return !!state.name.trim() && secretChosen && bindingNamed
    return !!state.name.trim()
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
}) => {
    // A browser leaves a text node that holds only a space out of the accessible description,
    // which then read the headline and the body as one word ("(401).This server"). So the
    // body's leading text is written as one string that carries the spaces around it.
    const nodes = Array.isArray(children) ? children : [children]
    const textEnd = nodes.findIndex((node) => typeof node !== "string")
    const leading = nodes
        .slice(0, textEnd === -1 ? undefined : textEnd)
        .join("")
        .replace(/\s+/g, " ")
        .trim()
    const rest = textEnd === -1 ? [] : nodes.slice(textEnd)
    const text = `${headline ? " " : ""}${leading}${rest.length ? " " : ""}`
    return (
        <Alert
            id={id}
            type="error"
            showIcon
            icon={<WarningCircle size={15} weight="regular" />}
            className={`items-start border-colorErrorBorder bg-colorErrorBg px-3 py-2.5 ${className ?? ""}`}
            message={
                <span className="text-xs font-normal leading-normal text-colorTextSecondary">
                    {headline ? (
                        <span className="font-medium text-colorText">{headline}</span>
                    ) : null}
                    {text}
                    {rest}
                </span>
            }
        />
    )
}

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
    disabled,
    canCreate,
    onCreate,
    id,
    "aria-describedby": describedBy,
}: {
    value: string
    onChange: (slug: string) => void
    secrets: {id?: string | null; slug?: string | null; name?: string | null}[]
    invalid?: boolean
    /** Held while a check is in flight, like every other control on this screen. */
    disabled?: boolean
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
                disabled={disabled}
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
                    disabled={!canCreate || disabled}
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
