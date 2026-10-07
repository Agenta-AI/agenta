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

import {cn} from "@/lib/utils"

import {ONBOARDING_COPY} from "./onboardingCopy"
import {onboardingHeadingId} from "./onboardingDraft"
import {OnboardingWayRow} from "./OnboardingWayRow"
import {OnboardingCreditsSkeleton} from "./states/OnboardingCreditsSkeleton"
import type {OnboardingModel} from "./useOnboardingModel"

const copy = ONBOARDING_COPY.model

const TILE = "flex size-10 shrink-0 items-center justify-center rounded-[10px]"
const STATUS = "text-success flex items-center gap-1.5 text-xs font-medium"

/** How the first agent's runs are paid: the seeded Agenta credits, a ChatGPT plan, or a key. */
export const OnboardingCreditsStep = ({
    model,
    onContinue,
}: {
    model: OnboardingModel
    onContinue: () => void
}) => {
    const {credits, chatgpt, keys} = model
    return (
        <div className="flex flex-col gap-7">
            <div className="flex flex-col gap-1.5">
                <h1
                    id={onboardingHeadingId("credits")}
                    tabIndex={-1}
                    className={ONBOARDING_COPY.headingClass}
                >
                    {copy.title}
                </h1>
                <p className="text-muted-foreground m-0 text-[15px]">{copy.subtitle}</p>
            </div>
            {model.status === "loading" ? (
                <OnboardingCreditsSkeleton />
            ) : model.status === "error" ? (
                <LoadError title={copy.loadError} onRetry={model.retry} />
            ) : (
                <div className="flex flex-col gap-2">
                    {credits ? (
                        <OnboardingWayRow
                            delay={0.2}
                            active={credits.inUse}
                            icon={
                                <span
                                    className={cn(
                                        TILE,
                                        "bg-[var(--ag-preset-yellow-bg)] text-[var(--ag-preset-yellow-text)]",
                                    )}
                                >
                                    <Coins size={20} weight="fill" />
                                </span>
                            }
                            title={copy.creditsTitle}
                            hint={[
                                credits.balance ? copy.creditsBalance(credits.balance) : "",
                                credits.runnable ? copy.creditsHint : "",
                            ]
                                .filter(Boolean)
                                .join(" ")}
                            action={
                                credits.runnable ? (
                                    <span className={STATUS}>
                                        <Check size={13} weight="bold" />
                                        {credits.inUse ? copy.inUse : copy.added}
                                    </span>
                                ) : null
                            }
                        />
                    ) : (
                        <p className="text-muted-foreground m-0 pb-1 text-sm">
                            {copy.creditsNone}
                        </p>
                    )}
                    {chatgpt.available ? (
                        <OnboardingWayRow
                            delay={0.32}
                            active={chatgpt.inUse}
                            icon={
                                <span className={cn(TILE, "bg-muted text-foreground")}>
                                    <OpenAiLogo size={20} />
                                </span>
                            }
                            title={copy.chatgpt}
                            hint={chatgpt.ready ? copy.chatgptReadyHint : copy.chatgptHint}
                            action={
                                chatgpt.ready ? (
                                    <span className={STATUS}>
                                        <Check size={13} weight="bold" />
                                        {chatgpt.inUse ? copy.inUse : copy.connected}
                                    </span>
                                ) : (
                                    <Button
                                        variant="outline"
                                        size="sm"
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
                        active={keys.inUse}
                        icon={
                            <span className={cn(TILE, "bg-muted text-foreground")}>
                                <Key size={20} />
                            </span>
                        }
                        title={copy.key}
                        hint={
                            keys.connections.length > 0
                                ? copy.keyUsing(
                                      keys.connections[0].name,
                                      keys.connections.length - 1,
                                  )
                                : copy.keyHint
                        }
                        action={
                            <Button variant="outline" size="sm" onClick={keys.openDrawer}>
                                {copy.addKey}
                            </Button>
                        }
                    />
                    {!model.ready ? (
                        <p role="status" className="text-muted-foreground m-0 pt-2 text-sm">
                            {copy.noneRunnable}
                        </p>
                    ) : null}
                </div>
            )}
            <div className="flex justify-end">
                <Button size="lg" onClick={onContinue} disabled={model.status === "loading"}>
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
