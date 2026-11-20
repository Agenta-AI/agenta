import {Fragment, useEffect, useId, useState} from "react"

import {richText, useT} from "@agenta/i18n"
import subscriptionSignInCatalog from "@agenta/i18n/catalogs/entityUi.subscriptionSignIn"
import {Button, Input} from "@agenta/ui/ui"
import {Check, Copy, WarningCircle} from "@phosphor-icons/react"

import {SignInStep} from "./SignInStep"
import type {SubscriptionTokenState} from "./useSubscriptionToken"

const SETUP_COMMAND = "claude setup-token"
const CLAUDE_CODE_SETUP_URL = "https://docs.anthropic.com/en/docs/claude-code/setup"

const CopyCommand = () => {
    const t = useT(subscriptionSignInCatalog)
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
                aria-label={t("entityUi.subscriptionSignIn.copyCommand")}
                onClick={() =>
                    void navigator.clipboard?.writeText(SETUP_COMMAND).then(() => setCopied(true))
                }
            >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied
                    ? t("entityUi.subscriptionSignIn.copied")
                    : t("entityUi.subscriptionSignIn.copy")}
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
export const SubscriptionTokenSteps = ({
    token,
    submitOnEnter = true,
}: {
    token: SubscriptionTokenState
    /** Off in a view, whose Save is the stack's: Enter there would store outside it. */
    submitOnEnter?: boolean
}) => {
    const t = useT(subscriptionSignInCatalog)
    const fieldId = useId()
    return (
        <ol className="m-0 flex list-none flex-col p-0">
            <SignInStep index={1} title={t("entityUi.subscriptionSignIn.runCommand")}>
                <CopyCommand />
                <span className="text-xs text-muted-foreground">
                    {richText(t("entityUi.subscriptionSignIn.youNeedInstalled"), {
                        link: (text) => (
                            <a
                                href={CLAUDE_CODE_SETUP_URL}
                                target="_blank"
                                rel="noreferrer"
                                className="text-btn-link no-underline hover:text-btn-link-hover"
                            >
                                {text}
                            </a>
                        ),
                    })}
                </span>
            </SignInStep>
            <SignInStep index={2} title={t("entityUi.subscriptionSignIn.signInToClaude")}>
                <span className="text-xs text-muted-foreground">
                    {t("entityUi.subscriptionSignIn.browserOpens")}
                </span>
            </SignInStep>
            <SignInStep
                index={3}
                last
                title={
                    <label htmlFor={fieldId}>
                        {t("entityUi.subscriptionSignIn.pasteTokenPrints")}
                    </label>
                }
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
                        if (submitOnEnter && event.key === "Enter") void token.submit()
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
                        {t("entityUi.subscriptionSignIn.tokenWorksOneYear")}
                    </span>
                )}
            </SignInStep>
        </ol>
    )
}

export default SubscriptionTokenSteps
