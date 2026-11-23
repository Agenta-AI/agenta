/**
 * The ChatGPT sign-in card (F11 f8, f9), drawn from the sign-in's state. The view feeds it; a
 * story can draw each state without a running sign-in.
 */
import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import subscriptionSignInCatalog from "@agenta/i18n/catalogs/entityUi.subscriptionSignIn"
import subscriptionViewsCatalog from "@agenta/i18n/catalogs/entityUi.subscriptionViews"
import {Button, SkeletonBlock, Spinner} from "@agenta/ui/ui"
import {ArrowSquareOut, Check, CheckCircle, WarningCircle} from "@phosphor-icons/react"

import {countdownLabel, type PendingAttempt} from "../useSubscriptionSignIn"

export type SubscriptionSignInPhase =
    /** The code is shown and the poll runs. */
    | "waiting"
    /** The sign-in is starting, or it arrived and the vault refresh is still on its way. */
    | "busy"
    /** The connection is signed in. */
    | "connected"
    /** No sign-in runs: before the first one, or after one failed. */
    | "idle"

export interface SubscriptionSignInCardProps {
    name: string
    phase: SubscriptionSignInPhase
    /** The running attempt; read in the `waiting` phase. */
    attempt: Pick<PendingAttempt, "userCode" | "verificationUri" | "expiresAt"> | null
    /** The countdown's clock. */
    now: number
    /** The code was copied: the button reads "Copied" and the waiting block shows. */
    copied: boolean
    /** The connected line: the production status line of the connection. */
    statusLine?: string
    error?: string | null
    /** The poll lost the attempt and the connection is not ready. */
    lostPoll?: boolean
    onCopy: (code: string) => void
    onCancel: () => void
    onConnect: () => void
    /** Under the card (the organization's "Projects that can use it"). */
    footer?: ReactNode
}

export const SubscriptionSignInCard = ({
    name,
    phase,
    attempt,
    now,
    copied,
    statusLine,
    error,
    lostPoll,
    onCopy,
    onCancel,
    onConnect,
    footer,
}: SubscriptionSignInCardProps) => {
    const t = useT(subscriptionSignInCatalog, subscriptionViewsCatalog)
    const waiting = phase === "waiting" && attempt
    return (
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 py-3.5">
            <section className="flex flex-col gap-2.5 rounded-lg border border-solid border-border-muted p-3 text-label">
                <div className="flex flex-col gap-0.5">
                    <span className="text-label font-medium text-foreground">{name}</span>
                    {waiting ? (
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                            <Spinner aria-hidden className="size-3" />
                            {t("entityUi.subscriptionSignIn.waitingForSignIn")}
                        </span>
                    ) : phase === "connected" ? (
                        <span className="text-muted-foreground">
                            {statusLine || t("entityUi.subscriptionSignIn.agentsCanRun")}
                        </span>
                    ) : phase === "busy" ? null : (
                        <span className="text-muted-foreground">
                            {t("entityUi.subscriptionSignIn.signInChatgpt")}
                        </span>
                    )}
                </div>

                {waiting ? (
                    <div className="flex flex-col gap-2.5 rounded-lg bg-secondary p-3">
                        <span className="text-foreground">
                            {t("entityUi.subscriptionSignIn.openChatgptEnterCode")}
                        </span>
                        <div className="flex items-center gap-2">
                            <span className="select-all font-mono text-title tracking-[0.2em] text-foreground">
                                {attempt.userCode}
                            </span>
                            {copied ? (
                                <span className="flex items-center gap-1 text-meta text-success">
                                    <Check size={12} />
                                    {t("entityUi.subscriptionSignIn.copied")}
                                </span>
                            ) : (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={t("entityUi.subscriptionSignIn.copySignInCode")}
                                    onClick={() => onCopy(attempt.userCode)}
                                >
                                    {t("entityUi.subscriptionSignIn.copy")}
                                </Button>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <a
                                href={attempt.verificationUri}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 text-foreground underline underline-offset-2"
                            >
                                {t("entityUi.subscriptionSignIn.openName", {name})}
                                <ArrowSquareOut size={12} />
                            </a>
                            {attempt.expiresAt ? (
                                <span className="tabular-nums text-muted-foreground">
                                    {t("entityUi.subscriptionSignIn.expiresIn", {
                                        time: countdownLabel(attempt.expiresAt, now),
                                    })}
                                </span>
                            ) : null}
                            <span className="flex-1" />
                            <Button variant="outline" size="sm" onClick={onCancel}>
                                {t("entityUi.subscriptionSignIn.cancel")}
                            </Button>
                        </div>
                        {copied ? (
                            <div
                                role="status"
                                className="flex items-start gap-2.5 border-0 border-t border-solid border-border-muted pt-2.5"
                            >
                                <span className="mt-0.5">
                                    <Spinner aria-hidden size="small" />
                                </span>
                                <span className="flex flex-col gap-0.5">
                                    <span className="font-medium text-foreground">
                                        {t("entityUi.subscriptionViews.waitingToConfirm", {name})}
                                    </span>
                                    <span className="text-meta leading-4 text-muted-foreground">
                                        {t("entityUi.subscriptionViews.waitingToConfirmBody", {
                                            name,
                                        })}
                                    </span>
                                </span>
                            </div>
                        ) : null}
                    </div>
                ) : phase === "busy" ? (
                    <div className="flex flex-col gap-2.5" aria-busy>
                        <SkeletonBlock active className="h-4 w-2/3 rounded" />
                        <SkeletonBlock active className="h-[74px] w-full rounded-lg" />
                    </div>
                ) : phase === "connected" ? (
                    <>
                        <span className="flex items-center gap-2 text-success">
                            <CheckCircle size={16} weight="fill" />
                            {t("entityUi.subscriptionSignIn.readyPickModel", {name})}
                        </span>
                        <Button variant="outline" className="w-fit" onClick={onConnect}>
                            {t("entityUi.subscriptionSignIn.signInAgain")}
                        </Button>
                    </>
                ) : (
                    <Button className="w-fit" onClick={onConnect}>
                        {t("entityUi.subscriptionSignIn.connectName", {name})}
                    </Button>
                )}

                {lostPoll ? (
                    <p className="m-0 flex items-center gap-1.5 text-meta text-warning">
                        <WarningCircle size={14} />
                        {t("entityUi.subscriptionSignIn.lostTrack", {name})}
                    </p>
                ) : null}
                {error ? (
                    <p
                        role="alert"
                        className="m-0 flex items-center gap-1.5 text-meta text-destructive"
                    >
                        <WarningCircle size={14} />
                        {error}
                    </p>
                ) : null}
            </section>
            {footer}
        </div>
    )
}
