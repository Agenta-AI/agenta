import {useRef, useState} from "react"

import {
    archiveBrowserProfileAtom,
    browserProfilesQueryAtom,
    createBrowserProfileAtom,
} from "@agenta/entities/browserProfile"
import type {ClientToolWidgetProps} from "@agenta/shared/clientTools"
import {Button} from "@agenta/ui/ui"
import {Globe} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {BrowserLoginDialog} from "../browser/BrowserLoginDialog"
import {messageOf, useBrowserLogin} from "../browser/useBrowserLogin"

const NOT_ADDED = "The user did not add the login."
// With no login at run start the run has no browser tools yet; they come with the next message.
const NEXT_MESSAGE = "The browser is ready from the person's next message."

/** The bare host the login will allow, or "" when the agent's `site` is not one. */
const hostOf = (site: string): string => {
    try {
        return new URL(site.includes("://") ? site : `https://${site}`).hostname
    } catch {
        return ""
    }
}

/** `browser_request_login`: the person adds a login for a site and signs in; the dock carries it. */
export const BrowserLoginRequestWidget = ({meta, settle, bare = false}: ClientToolWidgetProps) => {
    const input = (meta.input ?? {}) as {site?: unknown; message?: unknown}
    // The agent chose these: the card leads with the real host and quotes the agent's words.
    const site = hostOf(typeof input.site === "string" ? input.site.trim() : "")
    const message = typeof input.message === "string" ? input.message : ""
    const profiles = useAtomValue(browserProfilesQueryAtom)
    const createProfile = useSetAtom(createBrowserProfileAtom)
    const archiveProfile = useSetAtom(archiveBrowserProfileAtom)
    const login = useBrowserLogin()
    const [adding, setAdding] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const added = useRef<{profileId: string; hadLogins: boolean} | null>(null)
    const heading = site ? `Sign in to ${site}?` : "The agent asked for a sign-in"

    if (meta.settled) {
        const done = (meta.output as {added?: unknown} | undefined)?.added === true
        return (
            <span className="text-sm text-muted-foreground">
                {done ? `You added a login for ${site}` : `You did not add a login for ${site}`}
            </span>
        )
    }

    if (bare) {
        return <span className="text-sm text-muted-foreground">{heading} below</span>
    }

    const add = async () => {
        setAdding(true)
        setError(null)
        try {
            const hadLogins = (profiles.data ?? []).some((p) => p.state === "ready")
            const profile = await createProfile({name: site, allowed_hosts: [site]})
            added.current = {profileId: profile.id, hadLogins}
            void login.open(profile)
        } catch (cause) {
            setError(messageOf(cause, "Could not add the login."))
        } finally {
            setAdding(false)
        }
    }

    const done = async () => {
        if (!(await login.finish())) return
        const next = added.current?.hadLogins ? {} : {note: NEXT_MESSAGE}
        void settle({output: {added: true, site, ...next}})
    }

    const cancel = () => {
        login.cancel()
        // The login was never signed in, so it does not stay in the person's list.
        if (added.current) void archiveProfile(added.current.profileId).catch(() => undefined)
        void settle({errorText: NOT_ADDED})
    }

    return (
        <div className="flex flex-col gap-2 rounded-lg border border-solid border-border bg-background p-3">
            <div className="flex items-start gap-2">
                <Globe size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="break-all text-sm font-medium text-foreground">{heading}</span>
                    {message ? (
                        <span className="text-sm text-muted-foreground">
                            The agent says: “{message}”
                        </span>
                    ) : null}
                    {site ? (
                        <span className="text-xs text-muted-foreground">
                            Sign in only if you trust {site}, and check the address in the browser
                            before you type a password.
                        </span>
                    ) : null}
                    {error ? (
                        <span role="alert" className="text-sm text-destructive">
                            {error}
                        </span>
                    ) : null}
                </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" size="sm" onClick={cancel}>
                    Cancel
                </Button>
                <Button size="sm" disabled={!site || adding} onClick={() => void add()}>
                    {adding ? "Adding…" : "Add and sign in"}
                </Button>
            </div>
            <BrowserLoginDialog state={login.state} onDone={() => void done()} onCancel={cancel} />
        </div>
    )
}
