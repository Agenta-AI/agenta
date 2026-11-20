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

import {useViewTitle, type ViewProps} from "@agenta/ui/view-stack"

import {useOrganizationProjectsDraft} from "../useOrganizationProjectsDraft"
import {useSubscriptionSignIn} from "../useSubscriptionSignIn"

import {SubscriptionProjectsBlock} from "./SubscriptionProjectsBlock"
import {SubscriptionSignInCard} from "./SubscriptionSignInCard"
import type {SubscriptionViewParams} from "./subscriptionViews"
import {useSubscriptionViewConnection} from "./useSubscriptionViewConnection"

const SubscriptionSignInViewBody = ({params, nav}: ViewProps<SubscriptionViewParams>) => {
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
            void nav.back()
        },
    })
    const {name, isReady, pending, starting, finishing, error, lostPoll, now, connect} = signIn
    useViewTitle(name)
    const [copied, setCopied] = useState(false)
    useEffect(() => setCopied(false), [pending])

    const editProjects = !!organization && !organization.readOnly && !!connection
    const draft = useOrganizationProjectsDraft({
        open: true,
        connection,
        enabled: editProjects,
        organizationName: organization?.name,
    })
    // Each choice is saved once; one made while a save ran is saved when that save ends.
    const savedChoice = useRef(draft.projects)
    useEffect(() => {
        if (!draft.changed || draft.saving || savedChoice.current === draft.projects) return
        savedChoice.current = draft.projects
        void draft.apply()
    }, [draft.projects, draft.saving])

    // Opening is the Connect click; a ready connection opens to its status instead. Once per
    // mount. The timer keeps a mount that React runs twice in development from starting two
    // sign-ins.
    const readyOnOpen = useRef(isReady)
    useEffect(() => {
        if (readyOnOpen.current) return
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
            onCopy={(code) => void navigator.clipboard?.writeText(code).then(() => setCopied(true))}
            // The sign-in ends with the view (above), so Cancel only leaves.
            onCancel={() => nav.cancel()}
            onConnect={() => void connect()}
            footer={
                editProjects && organization ? (
                    <SubscriptionProjectsBlock organization={organization} draft={draft} />
                ) : null
            }
        />
    )
}

export default SubscriptionSignInViewBody
