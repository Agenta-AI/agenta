/**
 * The device code card (F11 f8, f9), drawn from the sign-in's state. The view feeds it; a story
 * can draw each state without a running sign-in.
 */
import {useT} from "@agenta/i18n"
import subscriptionFormsCatalog from "@agenta/i18n/catalogs/entityUi.subscriptionForms"
import subscriptionSignInCatalog from "@agenta/i18n/catalogs/entityUi.subscriptionSignIn"
import {Button, SkeletonBlock} from "@agenta/ui/ui"
import {
    ArrowSquareOut,
    Check,
    CheckCircle,
    CircleNotch,
    Copy,
    WarningCircle,
} from "@phosphor-icons/react"

import {countdownLabel, type PendingAttempt} from "../useSubscriptionSignIn"

export type DeviceCodePhase =
    /** The code is shown and the poll runs. */
    | "pending"
    /** The sign-in is starting, or it arrived and the vault refresh is still on its way. */
    | "busy"
    /** The connection is signed in. */
    | "connected"
    /** No sign-in runs: before the first one, or after one failed. */
    | "idle"

export interface DeviceCodeCardProps {
    name: string
    phase: DeviceCodePhase
    /** The running attempt; read in the `pending` phase. */
    pending: Pick<PendingAttempt, "userCode" | "verificationUri" | "expiresAt"> | null
    /** The countdown's clock. */
    now: number
    /** The code was copied: the button reads "Copied" and the waiting block shows. */
    copied: boolean
    /** The connected line; the production status line of the connection. */
    statusLine?: string
    error?: string | null
    /** The poll lost the attempt and the connection is not ready. */
    lostTrack?: boolean
    onCopy: (code: string) => void
    onCancel: () => void
    onConnect: () => void
}

const Loader = ({size}: {size: number}) => (
    <CircleNotch size={size} className="shrink-0 motion-safe:animate-spin" aria-hidden />
)

export const DeviceCodeCard = ({
    name,
    phase,
    pending,
    now,
    copied,
    statusLine,
    error,
    lostTrack,
    onCopy,
    onCancel,
    onConnect,
}: DeviceCodeCardProps) => {
    const t = useT(subscriptionSignInCatalog, subscriptionFormsCatalog)
    return (
        <div className="flex min-h-0 flex-1 flex-col px-4 py-3.5">
            <section className="flex flex-col gap-2.5 rounded-lg border border-solid border-colorBorderSecondary p-3 text-[13px]">
                <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-colorText">{name}</span>
                    {phase === "pending" && pending ? (
                        <span className="flex items-center gap-1.5 text-colorTextSecondary">
                            <Loader size={12} />
                            {t("entityUi.subscriptionSignIn.waitingForSignIn")}
                        </span>
                    ) : phase === "connected" ? (
                        <span className="text-colorTextSecondary">
                            {statusLine || t("entityUi.subscriptionSignIn.agentsCanRun")}
                        </span>
                    ) : phase === "busy" ? null : (
                        <span className="text-colorTextSecondary">
                            {t("entityUi.subscriptionSignIn.signInChatgpt")}
                        </span>
                    )}
                </div>

                {phase === "pending" && pending ? (
                    <div className="flex flex-col gap-2.5 rounded-lg bg-colorFillQuaternary p-3">
                        <span className="text-colorText">
                            {t("entityUi.subscriptionSignIn.openChatgptEnterCode")}
                        </span>
                        <div className="flex items-center gap-2">
                            <span className="select-all font-mono text-lg tracking-[0.2em] text-colorText">
                                {pending.userCode}
                            </span>
                            {copied ? (
                                <span className="flex items-center gap-1 text-xs text-colorSuccess">
                                    <Check size={12} />
                                    {t("entityUi.subscriptionSignIn.copied")}
                                </span>
                            ) : (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={t("entityUi.subscriptionSignIn.copySignInCode")}
                                    onClick={() => onCopy(pending.userCode)}
                                >
                                    <Copy size={12} />
                                    {t("entityUi.subscriptionSignIn.copy")}
                                </Button>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <a
                                href={pending.verificationUri}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 text-colorText underline underline-offset-2"
                            >
                                {t("entityUi.subscriptionSignIn.openName", {name})}
                                <ArrowSquareOut size={12} />
                            </a>
                            {pending.expiresAt ? (
                                <span className="tabular-nums text-colorTextTertiary">
                                    {t("entityUi.subscriptionSignIn.expiresIn", {
                                        time: countdownLabel(pending.expiresAt, now),
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
                                className="flex items-start gap-2.5 border-0 border-t border-solid border-colorBorderSecondary pt-2.5"
                            >
                                <span className="mt-0.5">
                                    <Loader size={14} />
                                </span>
                                <span className="flex flex-col gap-0.5">
                                    <span className="font-medium text-colorText">
                                        {t("entityUi.subscriptionForms.waitingToConfirm", {name})}
                                    </span>
                                    <span className="text-xs leading-4 text-colorTextSecondary">
                                        {t("entityUi.subscriptionForms.waitingToConfirmBody", {
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
                        <span className="flex items-center gap-2 text-colorSuccess">
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

                {lostTrack ? (
                    <p className="m-0 flex items-center gap-1.5 text-xs text-colorWarning">
                        <WarningCircle size={14} />
                        {t("entityUi.subscriptionSignIn.lostTrack", {name})}
                    </p>
                ) : null}
                {error ? (
                    <p
                        role="alert"
                        className="m-0 flex items-center gap-1.5 text-xs text-colorError"
                    >
                        <WarningCircle size={14} />
                        {error}
                    </p>
                ) : null}
            </section>
        </div>
    )
}
