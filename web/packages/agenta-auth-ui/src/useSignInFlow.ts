/**
 * The sign-in state machine: entry → methods → code.
 *
 * The screen asks for an address first, asks the backend what that address can sign in with,
 * and only then shows a password box, a code box, or the org's SSO button. That sequence, the
 * cancellation around it and the returning-visitor promotion were 250 lines inside the desktop
 * page; this is the shared version both it and /m drive, so a change to the flow lands in one
 * place. The rules it applies are pure and live in `@agenta/auth` (signInPolicy).
 *
 * Everything app-shaped arrives as a seam: the OIDC redirect transport differs per app (the
 * desktop registers its own callback URI, /m routes through a cookie), invites are persisted by
 * the host, and only the desktop knows how to recognise its own backend being down.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from "react"
import type {Dispatch, SetStateAction} from "react"

import {
    deriveEntry,
    deriveMethods,
    discoverAuthMethods,
    mapAuthError,
    parseSsoOrgSlug,
    readAuthConfig,
    readInviteParams,
    readLastAuthMethod,
    soleSsoRedirect,
    LAST_SSO_ORG_SLUG_KEY,
    type DiscoveredMethods,
    type DiscoveredSsoProvider,
    type EntryPresentation,
    type InviteParams,
    type MethodPresentation,
    type AuthConfig,
    type QueryBag,
    firstQueryValue,
} from "@agenta/auth"

import type {AuthMessage} from "./types"

/** Which step the screen is on. */
export type SignInStage = "entry" | "methods" | "code"

export interface UseSignInFlowOptions {
    /** The route's query params: invite token, prefilled email, auth_message / auth_error. */
    query?: QueryBag
    /** Start an OIDC / SSO redirect. Resolves only on failure — success navigates away. */
    startThirdParty: (thirdPartyId: string) => Promise<void>
    /** Persist an invite so it survives the round trip through the provider. */
    onInvite?: (invite: InviteParams) => void
    /** Recognise "the API is unreachable" so the error says so. */
    isBackendDown?: (error: unknown) => boolean
    /**
     * Reopen an interrupted code attempt on mount (the desktop's passwordless resume). Resolving
     * with an email lands the screen straight on the code step.
     */
    resumeCodeAttempt?: () => Promise<{email: string} | null>
}

export interface SignInFlow {
    stage: SignInStage
    email: string
    /** Plain state setters, so the package's forms can drive them directly. */
    setEmail: Dispatch<SetStateAction<string>>
    /** What to offer before an address is submitted. */
    entry: EntryPresentation
    /** What the submitted address can actually use. */
    methods: MethodPresentation
    /** The raw discovery result, for hosts that need more than the presentation. */
    discovered: DiscoveredMethods | null
    message: AuthMessage
    /** A plain state setter, so the package's forms can report into the same slot. */
    setMessage: Dispatch<SetStateAction<AuthMessage>>
    /** Turn a thrown auth error into screen copy. */
    reportError: (error: unknown) => void
    /** True while discovery is in flight; blocks the forms. */
    discovering: boolean
    /** True from the moment a redirect starts until it fails. */
    redirecting: boolean
    /** True while an interrupted code attempt is being restored — nothing should render yet. */
    restoring: boolean
    /**
     * False until the deployment's config has been read on the client. Render a skeleton until
     * then: /m resolves env at runtime, so anything derived from it would differ from the SSR
     * markup and fail hydration.
     */
    ready: boolean
    /** Submit the address and discover its methods. */
    continueWithEmail: (email: string) => Promise<void>
    /** Back to the entry screen, discovery discarded. */
    useDifferentEmail: () => void
    /** Redirect into an org's SSO connection. */
    startSso: (provider: DiscoveredSsoProvider) => Promise<void>
    /** Move to / away from the code step (the request form owns when the code was sent). */
    setCodeSent: Dispatch<SetStateAction<boolean>>
}

// The slot is empty until something reports into it; `message: ""` never renders.
const EMPTY_MESSAGE = {} as AuthMessage

/** Offers nothing — what the screen renders on the server and on the first client paint. */
const NO_METHODS_YET: AuthConfig = {
    authnEmail: "",
    emailEnabled: false,
    oidcEnabled: false,
    providers: [],
}

export function useSignInFlow({
    query = {},
    startThirdParty,
    onInvite,
    isBackendDown,
    resumeCodeAttempt,
}: UseSignInFlowOptions): SignInFlow {
    const emailFromQuery = firstQueryValue(query.email)
    const authMessage = firstQueryValue(query.auth_message)
    const authError = firstQueryValue(query.auth_error)

    const [email, setEmail] = useState(emailFromQuery ?? "")
    const [discovered, setDiscovered] = useState<DiscoveredMethods | null>(null)
    const [codeSent, setCodeSent] = useState(false)
    const [message, setMessage] = useState<AuthMessage>(EMPTY_MESSAGE)
    const [discovering, setDiscovering] = useState(false)
    const [redirecting, setRedirecting] = useState(false)
    const [restoring, setRestoring] = useState(Boolean(resumeCodeAttempt))
    const [lastMethod, setLastMethod] = useState<string | null>(null)
    const [config, setConfig] = useState<AuthConfig | null>(null)

    const abortRef = useRef<AbortController | null>(null)
    const redirectRef = useRef(false)
    // StrictMode double-invokes mount effects; restoring an attempt twice clears it.
    const restoredRef = useRef(false)

    const resolved = config ?? NO_METHODS_YET
    const entry = useMemo(() => deriveEntry(resolved, lastMethod), [resolved, lastMethod])
    const methods = useMemo(() => deriveMethods(resolved, discovered), [resolved, discovered])

    const reportError = useCallback(
        (error: unknown) => setMessage(mapAuthError(error, {isBackendDown})),
        [isBackendDown],
    )

    // Both read client-only sources (runtime env, localStorage), so both wait for mount.
    useEffect(() => {
        setConfig(readAuthConfig())
        setLastMethod(readLastAuthMethod())
    }, [])

    // Stash the invite before any redirect: the provider round trip drops the query string.
    useEffect(() => {
        const invite = readInviteParams(query)
        if (invite) onInvite?.(invite)
        // The invite is a property of the URL, so the query is the only dependency that matters.
    }, [emailFromQuery, firstQueryValue(query.token), firstQueryValue(query.organization_id)])

    // A redirect back from a provider can carry its own verdict.
    useEffect(() => {
        if (!authMessage) return
        setMessage({message: authMessage, type: authError === "sso_denied" ? "info" : "error"})
    }, [authMessage, authError])

    useEffect(() => () => abortRef.current?.abort(), [])

    const startSso = useCallback(
        async (provider: DiscoveredSsoProvider) => {
            if (redirectRef.current) return
            redirectRef.current = true
            setRedirecting(true)
            // Remembered so the post-auth redirect lands in the SSO org rather than Personal.
            const orgSlug = parseSsoOrgSlug(provider.thirdPartyId)
            if (orgSlug && typeof window !== "undefined") {
                window.localStorage.setItem(LAST_SSO_ORG_SLUG_KEY, orgSlug)
            }
            try {
                await startThirdParty(provider.thirdPartyId)
            } catch (error) {
                reportError(error)
            }
            // Reached only when the redirect never happened.
            redirectRef.current = false
            setRedirecting(false)
        },
        [reportError, startThirdParty],
    )

    const continueWithEmail = useCallback(
        async (value: string) => {
            setEmail(value)
            setMessage(EMPTY_MESSAGE)
            if (!resolved.emailEnabled && !resolved.oidcEnabled) {
                setMessage({message: "No authentication methods are configured", type: "error"})
                return
            }

            // A second submit supersedes the first; the stale probe must not land after it.
            abortRef.current?.abort()
            const controller = new AbortController()
            abortRef.current = controller
            setDiscovering(true)

            const result = await discoverAuthMethods(value, controller.signal)
            if (result.kind === "aborted") return
            setDiscovering(false)

            if (result.kind === "failed") {
                // Still advance: the deployment's own email method works without discovery.
                setDiscovered({emailPassword: false, emailOtp: false, social: [], sso: []})
                reportError(result.error)
                return
            }

            setDiscovered(result.methods)
            const sole = soleSsoRedirect(result.methods)
            if (sole) await startSso(sole)
        },
        [resolved.emailEnabled, resolved.oidcEnabled, reportError, startSso],
    )

    // An address in the link is the same as one typed in.
    useEffect(() => {
        if (!emailFromQuery || discovered || restoring) return
        void continueWithEmail(emailFromQuery)
    }, [emailFromQuery, restoring])

    useEffect(() => {
        if (!resumeCodeAttempt || restoredRef.current) return
        restoredRef.current = true
        void (async () => {
            try {
                const attempt = await resumeCodeAttempt()
                if (attempt) {
                    setEmail(attempt.email)
                    setDiscovered({emailPassword: false, emailOtp: true, social: [], sso: []})
                    setCodeSent(true)
                }
            } finally {
                setRestoring(false)
            }
        })()
    }, [])

    // Anything but an error is transient: it describes a step, not a blocker.
    useEffect(() => {
        if (!message.message || message.type === "error") return
        const timer = setTimeout(() => setMessage(EMPTY_MESSAGE), 5000)
        return () => clearTimeout(timer)
    }, [message])

    const useDifferentEmail = useCallback(() => {
        abortRef.current?.abort()
        setDiscovered(null)
        setCodeSent(false)
        setMessage(EMPTY_MESSAGE)
    }, [])

    const stage: SignInStage = codeSent ? "code" : discovered ? "methods" : "entry"

    return {
        stage,
        email,
        setEmail,
        entry,
        methods,
        discovered,
        message,
        setMessage,
        reportError,
        discovering,
        redirecting,
        restoring,
        ready: config !== null,
        continueWithEmail,
        useDifferentEmail,
        startSso,
        setCodeSent,
    }
}
