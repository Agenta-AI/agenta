import {Fragment, useEffect, useId, useState} from "react"

import {Button, Input} from "@agenta/ui/ui"
import {Check, Copy, WarningCircle} from "@phosphor-icons/react"

import {SignInStep} from "./SignInStep"
import type {SubscriptionTokenState} from "./useSubscriptionToken"

const SETUP_COMMAND = "claude setup-token"
const CLAUDE_CODE_SETUP_URL = "https://docs.anthropic.com/en/docs/claude-code/setup"

const CopyCommand = () => {
    const [copied, setCopied] = useState(false)
    useEffect(() => {
        if (!copied) return
        const timer = window.setTimeout(() => setCopied(false), 2000)
        return () => window.clearTimeout(timer)
    }, [copied])
    return (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-solid border-border bg-muted/40 py-1 pl-3 pr-1">
            <code className="select-all font-mono text-[13px] text-foreground">
                {SETUP_COMMAND}
            </code>
            <Button
                size="sm"
                variant="ghost"
                aria-label="Copy the command"
                onClick={() =>
                    void navigator.clipboard?.writeText(SETUP_COMMAND).then(() => setCopied(true))
                }
            >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy"}
            </Button>
        </div>
    )
}

/** The API's sentences quote commands in backticks; show those as code. */
const WithCode = ({text}: {text: string}) => (
    <>
        {text.split("`").map((part, index) =>
            index % 2 ? (
                <code key={index} className="font-mono">
                    {part}
                </code>
            ) : (
                <Fragment key={index}>{part}</Fragment>
            ),
        )}
    </>
)

/** The three steps that turn `claude setup-token` into a stored token. The host draws the verbs. */
export const SubscriptionTokenSteps = ({token}: {token: SubscriptionTokenState}) => {
    const fieldId = useId()
    return (
        <ol className="m-0 flex list-none flex-col p-0">
            <SignInStep index={1} title="Run this command on your computer">
                <CopyCommand />
                <span className="text-xs text-muted-foreground">
                    You need{" "}
                    <a
                        href={CLAUDE_CODE_SETUP_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="text-btn-link no-underline hover:text-btn-link-hover"
                    >
                        Claude Code
                    </a>{" "}
                    installed.
                </span>
            </SignInStep>
            <SignInStep index={2} title="Sign in to Claude">
                <span className="text-xs text-muted-foreground">
                    A browser window opens. Sign in with your Pro or Max account and approve access.
                </span>
            </SignInStep>
            <SignInStep
                index={3}
                last
                title={<label htmlFor={fieldId}>Paste the token the command prints</label>}
            >
                <Input
                    id={fieldId}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="sk-ant-oat01-…"
                    value={token.value}
                    disabled={token.checking}
                    aria-invalid={token.error ? true : undefined}
                    onChange={(event) => token.onChange(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") void token.submit()
                    }}
                />
                {token.error ? (
                    <span
                        role="alert"
                        className="flex items-start gap-1.5 text-xs text-destructive"
                    >
                        <WarningCircle size={14} className="mt-px shrink-0" />
                        <span>
                            <WithCode text={token.error} />
                        </span>
                    </span>
                ) : (
                    <span className="text-xs text-muted-foreground">
                        The token works for one year. Agenta stores it encrypted and never shows it
                        again.
                    </span>
                )}
            </SignInStep>
        </ol>
    )
}

export default SubscriptionTokenSteps
