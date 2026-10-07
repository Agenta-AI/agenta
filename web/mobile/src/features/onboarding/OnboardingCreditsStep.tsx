import {ProviderDrawer, SubscriptionConnectionCard} from "@agenta/entity-ui/secretProvider"
import {LoadError} from "@agenta/ui/components/presentational"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@agenta/ui/ui"
import {ArrowRight, Check, Coins, Key, OpenAiLogo} from "@phosphor-icons/react"

import {WalletCard} from "../wallet/WalletCard"
import {formatUsd, MUSD_PER_CREDIT} from "../wallet/walletFormat"

import {ONBOARDING_COPY} from "./onboardingCopy"
import {onboardingHeadingId} from "./onboardingRoute"
import {OnboardingWayRow} from "./OnboardingWayRow"
import {OnboardingCreditsSkeleton} from "./states/OnboardingCreditsSkeleton"
import type {OnboardingModel} from "./useOnboardingModel"

import {cn} from "@/lib/utils"

const copy = ONBOARDING_COPY.model
const PILL =
    "bg-success-bg text-success inline-flex h-[22px] items-center gap-1 rounded-md px-2 text-xs font-medium leading-4"
const ACTION = "h-7 rounded-md px-2.5 text-xs font-medium"

/** The wallet step: the organization's real credits, and the other ways to pay for runs. */
export const OnboardingCreditsStep = ({
    model,
    onContinue,
}: {
    model: OnboardingModel
    onContinue: () => void
}) => {
    const {credits, chatgpt, keys} = model
    const balance = credits?.balanceMusd ?? null
    const heading = credits
        ? balance !== null
            ? {
                  kicker: copy.kicker,
                  title: copy.title(Math.round(balance / MUSD_PER_CREDIT).toLocaleString()),
                  subtitle: copy.subtitle(formatUsd(balance)),
              }
            : {
                  kicker: copy.kicker,
                  title: copy.creditsOnlyTitle,
                  subtitle: copy.creditsOnlySubtitle,
              }
        : {
              kicker: copy.noCreditsKicker,
              title: copy.noCreditsTitle,
              subtitle: copy.noCreditsSubtitle,
          }

    const ways = (
        <div className="bg-muted flex flex-1 flex-col rounded-xl px-3">
            {credits ? (
                <OnboardingWayRow
                    delay={0.2}
                    highlight
                    icon={<Coins size={15} />}
                    title={copy.creditsTitle}
                    hint={copy.creditsHint}
                    action={
                        credits.inUse ? (
                            <span className={PILL}>
                                <Check size={11} weight="bold" />
                                {copy.inUse}
                            </span>
                        ) : null
                    }
                />
            ) : null}
            {chatgpt.available ? (
                <OnboardingWayRow
                    delay={0.32}
                    icon={<OpenAiLogo size={15} />}
                    title={copy.chatgpt}
                    hint={chatgpt.ready ? copy.chatgptReadyHint : copy.chatgptHint}
                    action={
                        chatgpt.ready ? (
                            <span className={PILL}>
                                <Check size={11} weight="bold" />
                                {chatgpt.inUse ? copy.inUse : copy.connected}
                            </span>
                        ) : (
                            <Button
                                variant="outline"
                                className={ACTION}
                                onClick={() => chatgpt.setDialogOpen(true)}
                            >
                                {copy.connect}
                            </Button>
                        )
                    }
                />
            ) : null}
            <OnboardingWayRow
                delay={0.44}
                icon={<Key size={15} />}
                title={copy.key}
                hint={
                    keys.connections.length > 0
                        ? copy.keyUsing(keys.connections[0].name, keys.connections.length - 1)
                        : copy.keyHint
                }
                action={
                    <Button variant="outline" className={ACTION} onClick={keys.openDrawer}>
                        {copy.addKey}
                    </Button>
                }
            />
        </div>
    )

    return (
        <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-1.5">
                <span className={ONBOARDING_COPY.kickerClass}>{heading.kicker}</span>
                <h1
                    id={onboardingHeadingId("credits")}
                    tabIndex={-1}
                    className="m-0 text-[32px] font-semibold leading-[38px] tracking-[-0.02em] text-balance outline-none"
                >
                    {heading.title}
                </h1>
                <p className="text-muted-foreground m-0 text-sm leading-[21px] text-pretty">
                    {heading.subtitle}
                </p>
            </div>
            {model.status === "loading" ? (
                <OnboardingCreditsSkeleton />
            ) : model.status === "error" ? (
                <LoadError title={copy.loadError} onRetry={model.retry} />
            ) : (
                <div className="flex flex-col gap-2">
                    <div
                        className={cn(
                            "grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-2",
                            credits && "sm:grid-cols-[minmax(0,304px)_minmax(0,1fr)]",
                        )}
                    >
                        {credits ? (
                            <div className="flex flex-col gap-2 max-sm:mb-6">
                                <span className={ONBOARDING_COPY.kickerClass}>{copy.wallet}</span>
                                <WalletCard
                                    balanceMusd={balance}
                                    emptyHint={copy.creditsHint}
                                    countUp
                                    entrance
                                    interactive
                                    glow
                                />
                            </div>
                        ) : null}
                        <div className="flex flex-col gap-2">
                            {credits ? (
                                <span className={ONBOARDING_COPY.kickerClass}>{copy.ways}</span>
                            ) : null}
                            {ways}
                        </div>
                    </div>
                    {!model.ready ? (
                        <p role="status" className="text-muted-foreground m-0 pt-2 text-sm">
                            {copy.noneRunnable}
                        </p>
                    ) : null}
                </div>
            )}
            <div className="flex justify-end">
                <Button
                    onClick={onContinue}
                    disabled={model.status === "loading"}
                    className="max-sm:h-11 max-sm:w-full"
                >
                    {ONBOARDING_COPY.continue}
                    <ArrowRight data-icon="inline-end" />
                </Button>
            </div>
            <Dialog open={chatgpt.dialogOpen} onOpenChange={chatgpt.setDialogOpen}>
                <DialogContent className="sm:max-w-[480px]">
                    <DialogHeader>
                        <DialogTitle>{copy.chatgptDialogTitle}</DialogTitle>
                        <DialogDescription>{copy.chatgptDialogBody}</DialogDescription>
                    </DialogHeader>
                    {chatgpt.dialogOpen ? (
                        <SubscriptionConnectionCard
                            provider="chatgpt"
                            connection={chatgpt.connection}
                            autoStart
                        />
                    ) : null}
                </DialogContent>
            </Dialog>
            <ProviderDrawer
                open={keys.drawerOpen}
                onClose={keys.closeDrawer}
                context="playground"
                connections={keys.all}
                onSaved={keys.onSaved}
            />
        </div>
    )
}
