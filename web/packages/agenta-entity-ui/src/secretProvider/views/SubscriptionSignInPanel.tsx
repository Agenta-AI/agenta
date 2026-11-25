/**
 * The device sign-in as a view (F11 f8, f9): the code, "Copy", "Open ChatGPT" and the countdown.
 * After "Copy" the button reads "Copied" and a block says Agenta waits for ChatGPT. The view goes
 * back by itself when the sign-in arrives. Leaving it, by Cancel, Back or a closed container,
 * cancels the sign-in and stops the poll.
 *
 * For an organization subscription the view also offers "Projects that can use it". The view
 * applies at once ("immediate"), so a changed choice is saved when it changes.
 */
import {useEffect, useRef, useState} from "react"

import {copyToClipboard} from "@agenta/ui"

import {useOrganizationProjectsDraft} from "../useOrganizationProjectsDraft"
import {useSubscriptionSignIn} from "../useSubscriptionSignIn"

import {SubscriptionProjectsBlock} from "./SubscriptionProjectsBlock"
import {SubscriptionSignInCard} from "./SubscriptionSignInCard"
import type {SubscriptionViewParams} from "./subscriptionViews"
import {useSubscriptionViewConnection} from "./useSubscriptionViewConnection"

export interface SubscriptionSignInPanelProps {
    params: SubscriptionViewParams
    /** The sign-in arrived. */
    onDone: () => void
    onCancel: () => void
    /** A host that titles itself from the name (the view stack). */
    useTitle?: (name: string) => void
    /** Where the idle Connect sits; "footer" for a dialog. */
    actionsPlacement?: "inline" | "footer"
}

const noTitle = (_name: string) => undefined

/** The device sign-in: code, copy, countdown; leaving it cancels the sign-in and its poll. */
export const SubscriptionSignInPanel = ({
    params,
    onDone,
    onCancel,
    useTitle = noTitle,
    actionsPlacement,
}: SubscriptionSignInPanelProps) => {
    const {connection, organization} = useSubscriptionViewConnection(params)
    // Set on unmount and on the first leave, so a late sign-in never moves the stack again.
    const leftRef = useRef(false)
    const signIn = useSubscriptionSignIn({
        provider: params.provider,
        connection,
        scope: organization ? "organization" : "project",
        organizationName: organization?.name,
        onSignedIn: () => {
            if (leftRef.current) return
            leftRef.current = true
            onDone()
        },
    })
    const {name, isReady, pending, starting, finishing, error, lostPoll, now, connect} = signIn
    useTitle(name)
    const [copied, setCopied] = useState(false)
    useEffect(() => setCopied(false), [pending])

    const editProjects = !!organization && !organization.readOnly && !!connection
    const draft = useOrganizationProjectsDraft({
        connection,
        enabled: editProjects,
        organizationName: organization?.name,
    })
    // Each choice is saved once; the draft queues one made while a save runs.
    useEffect(() => {
        if (draft.changed) void draft.apply()
    }, [draft.projects])

    // Only a Connect click starts the sign-in; the timer stops a dev double mount starting two.
    const readyOnOpen = useRef(isReady)
    const startOnOpen = useRef(Boolean(params.start))
    useEffect(() => {
        if (readyOnOpen.current || !startOnOpen.current) return
        const timer = window.setTimeout(() => void connect(), 0)
        return () => window.clearTimeout(timer)
    }, [])

    // Leaving the view ends a sign-in that is still running, so its poll stops with it.
    const cancelRef = useRef(signIn.cancel)
    cancelRef.current = signIn.cancel
    useEffect(() => {
        // Reset on mount: React runs a development mount twice and keeps refs.
        leftRef.current = false
        return () => {
            leftRef.current = true
            cancelRef.current()
        }
    }, [])

    return (
        <SubscriptionSignInCard
            name={name}
            phase={
                pending
                    ? "waiting"
                    : starting || finishing
                      ? "busy"
                      : isReady
                        ? "connected"
                        : "idle"
            }
            attempt={pending}
            now={now}
            copied={copied}
            statusLine={signIn.statusLine}
            error={error}
            lostPoll={lostPoll && !isReady}
            // A refused clipboard falls back to a selection copy; "Copied" shows only on success.
            onCopy={(code) => void copyToClipboard(code).then(setCopied)}
            // The sign-in ends with the view (above), so Cancel only leaves.
            onCancel={onCancel}
            onConnect={() => void connect()}
            actionsPlacement={actionsPlacement}
            footer={
                editProjects && organization ? (
                    <SubscriptionProjectsBlock organization={organization} draft={draft} />
                ) : null
            }
        />
    )
}

