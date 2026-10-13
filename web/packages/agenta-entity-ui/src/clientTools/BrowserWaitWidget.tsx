import {useState} from "react"

import type {ClientToolWidgetProps} from "@agenta/shared/clientTools"
import {Button} from "@agenta/ui/ui"
import {Globe} from "@phosphor-icons/react"

import {BrowserLiveDialog} from "../browser/BrowserLiveDialog"
import {useDriveSessionId} from "../drive/driveSessionContext"

const REASONS: Record<string, string> = {
    login: "The agent needs you to sign in",
    two_factor: "The agent needs a verification code",
    captcha: "The agent needs you to solve a check",
    other: "The agent needs your help in the browser",
}

/** `browser_wait_for_user`: the timeline row (`bare`) marks the wait; the dock carries the card. */
export const BrowserWaitWidget = ({meta, settle, bare = false}: ClientToolWidgetProps) => {
    const sessionId = useDriveSessionId()
    const [open, setOpen] = useState(false)
    const input = (meta.input ?? {}) as {reason?: unknown; message?: unknown}
    const heading =
        REASONS[typeof input.reason === "string" ? input.reason : "other"] ?? REASONS.other
    const message = typeof input.message === "string" ? input.message : ""

    if (meta.settled) {
        const done = (meta.output as {done?: unknown} | undefined)?.done === true
        return (
            <span className="text-sm text-muted-foreground">
                {done ? "You finished in the browser" : "You cancelled the browser step"}
            </span>
        )
    }

    if (bare) {
        return <span className="text-sm text-muted-foreground">{heading} below</span>
    }

    const finish = () => {
        setOpen(false)
        void settle({output: {done: true}})
    }
    const cancel = () => {
        setOpen(false)
        void settle({errorText: "The user cancelled the browser step."})
    }
    const actions = (
        <>
            <Button variant="outline" size="sm" onClick={cancel}>
                Cancel
            </Button>
            <Button size="sm" onClick={finish}>
                {"I'm done"}
            </Button>
        </>
    )

    return (
        <div className="flex flex-col gap-2 rounded-lg border border-solid border-border bg-background p-3">
            <div className="flex items-start gap-2">
                <Globe size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground">{heading}</span>
                    {message ? (
                        <span className="text-sm text-muted-foreground">{message}</span>
                    ) : null}
                </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    disabled={!sessionId}
                    onClick={() => setOpen(true)}
                >
                    Open browser
                </Button>
                {actions}
            </div>
            <BrowserLiveDialog
                open={open}
                onOpenChange={setOpen}
                title={heading}
                description={message || undefined}
                target={sessionId ? {kind: "session", sessionId} : null}
                autoTakeControl
                footer={actions}
            />
        </div>
    )
}
