/**
 * The device code sign-in as a view (F11 f8, f9): the code, "Copy", "Open ChatGPT" and the
 * countdown. After "Copy" the button reads "Copied" and a block says Agenta waits for ChatGPT.
 * The view goes back to the list by itself when the sign-in arrives. Leaving it, by Cancel, Back
 * or a closed container, cancels the sign-in and stops the poll.
 */
import {useEffect, useRef, useState} from "react"

import {providerConnectionsAtom, subscriptionConnectionFor} from "@agenta/entities/secret"
import {useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"

import {useSubscriptionSignIn} from "../useSubscriptionSignIn"

import {DeviceCodeCard} from "./DeviceCodeCard"
import {providerAddView} from "./providerViews"
import type {SubscriptionViewParams} from "./subscriptionViews"

const SubscriptionSignInViewBody = ({params, target, nav}: ViewProps<SubscriptionViewParams>) => {
    const connections = useAtomValue(providerConnectionsAtom)
    const connection =
        (params.connectionId
            ? connections.find((candidate) => candidate.id === params.connectionId)
            : subscriptionConnectionFor(connections, params.provider)) ?? null
    const signIn = useSubscriptionSignIn({provider: params.provider, connection})
    const {name, isReady, pending, starting, error, lostPoll, now, connect} = signIn
    useViewTitle(name)

    const [copied, setCopied] = useState(false)
    // Set when this view started a sign-in; its arrival then takes the view back to the list.
    const [awaiting, setAwaiting] = useState(false)

    // Opening is the Connect click; a ready connection opens to its status instead. Once per
    // mount, since `connect` changes when a new connection reaches the vault. The timer keeps a
    // mount that React runs twice in development from starting two sign-ins.
    const readyOnOpen = useRef(isReady)
    useEffect(() => {
        if (readyOnOpen.current) return
        const timer = window.setTimeout(() => void connect(), 0)
        return () => window.clearTimeout(timer)
    }, [])

    // Leaving the view ends a sign-in that is still running, so its poll stops with it.
    const cancelRef = useRef(signIn.cancel)
    cancelRef.current = signIn.cancel
    useEffect(() => () => cancelRef.current(), [])

    useEffect(() => {
        if (pending) {
            setAwaiting(true)
            setCopied(false)
        }
    }, [pending])
    useEffect(() => {
        if (error || lostPoll) setAwaiting(false)
    }, [error, lostPoll])
    const leftRef = useRef(false)
    useEffect(() => {
        if (leftRef.current || !awaiting || !isReady || pending || starting) return
        leftRef.current = true
        void nav.back()
    }, [awaiting, isReady, nav, pending, starting])

    // The sign-in ends with the view (above), so Cancel only leaves.
    const cancel = () => {
        if (params.fromAdd) void nav.replace(providerAddView, {}, target)
        else nav.cancel()
    }

    // A finished sign-in waits on the vault refresh before the connection reads ready.
    const settling = awaiting && !pending && !starting && !error && !lostPoll
    const phase = pending
        ? "pending"
        : starting || settling
          ? "busy"
          : isReady && !awaiting
            ? "connected"
            : "idle"

    return (
        <DeviceCodeCard
            name={name}
            phase={phase}
            pending={pending}
            now={now}
            copied={copied}
            statusLine={signIn.statusLine}
            error={error}
            lostTrack={lostPoll && !isReady}
            onCopy={(code) => void navigator.clipboard?.writeText(code).then(() => setCopied(true))}
            onCancel={cancel}
            onConnect={() => void connect()}
        />
    )
}

export default SubscriptionSignInViewBody
