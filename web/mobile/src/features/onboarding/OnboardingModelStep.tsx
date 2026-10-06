import type {ReactNode} from "react"

import {
    ProviderDrawer,
    SubscriptionConnectionCard,
    providerIconFor,
} from "@agenta/entity-ui/secretProvider"
import {LoadError} from "@agenta/ui/components/presentational"
import {
    Badge,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@agenta/ui/ui"
import {ArrowSquareOut, Check, Coins} from "@phosphor-icons/react"

import {ONBOARDING_COPY} from "./onboardingCopy"
import {OnboardingModelSkeleton} from "./states/OnboardingModelSkeleton"
import type {OnboardingModel} from "./useOnboardingModel"

const copy = ONBOARDING_COPY.model
const OpenAIIcon = providerIconFor("openai")
const AnthropicIcon = providerIconFor("anthropic")
const BYOM_ICONS = ["openai", "anthropic", "gemini", "openrouter"].map((key) => ({
    key,
    Icon: providerIconFor(key),
}))
const SELF_HOST_DOCS = "https://docs.agenta.ai/self-host/quick-start"

const OptionRow = ({
    icon,
    title,
    hint,
    action,
    muted = false,
}: {
    icon: ReactNode
    title: ReactNode
    hint: string
    action: ReactNode
    muted?: boolean
}) => (
    <div className="border-border bg-background flex items-center justify-between gap-4 rounded-xl border border-solid p-4">
        <span className={`flex min-w-0 items-center gap-3 ${muted ? "text-muted-foreground" : ""}`}>
            {icon}
            <span className="min-w-0">
                <span className="block text-sm font-semibold">{title}</span>
                <span className="text-muted-foreground block text-xs">{hint}</span>
            </span>
        </span>
        <span className="shrink-0">{action}</span>
    </div>
)

/** How the first agent runs: credits when the deployment has them, else a subscription or key. */
export const OnboardingModelStep = ({model}: {model: OnboardingModel}) => {
    const {chatgpt, keys} = model
    return (
        <div className="flex flex-col">
            <h1 className="m-0 text-center text-2xl font-semibold leading-tight lg:text-[30px]">
                {model.managed ? copy.creditsTitle : copy.title}
            </h1>
            <p className="text-muted-foreground mb-8 mt-2 text-center text-[15px]">
                {model.managed ? copy.creditsSubtitle : copy.subtitle}
            </p>
            {model.status === "loading" ? (
                <OnboardingModelSkeleton />
            ) : model.status === "error" ? (
                <LoadError title={copy.loadError} onRetry={model.retry} />
            ) : (
                <>
                    {model.managed ? (
                        <div className="bg-muted flex items-center gap-4 rounded-xl p-4">
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--ag-preset-orange-bg)] text-[var(--ag-preset-orange-text)]">
                                <Coins size={20} weight="fill" />
                            </span>
                            <span>
                                <strong className="block text-sm">{copy.creditsCard}</strong>
                                <span className="text-muted-foreground text-sm">
                                    {copy.creditsCardHint}
                                </span>
                            </span>
                        </div>
                    ) : null}
                    {model.noneAvailable ? (
                        <p className="text-muted-foreground m-0 text-center text-sm">
                            {copy.noneAvailable}
                        </p>
                    ) : null}
                    <p className="mb-3 mt-8 text-sm font-medium">
                        {model.managed ? (
                            <>
                                {copy.alternativesWithCredits}{" "}
                                <span className="text-muted-foreground font-normal">
                                    {copy.optional}
                                </span>
                            </>
                        ) : (
                            copy.alternatives
                        )}
                    </p>
                    <div className="flex flex-col gap-3">
                        {chatgpt.available ? (
                            <OptionRow
                                icon={<OpenAIIcon className="size-7 shrink-0" />}
                                title={copy.chatgpt}
                                hint={copy.chatgptHint}
                                action={
                                    chatgpt.ready ? (
                                        <span className="text-success flex items-center gap-1.5 text-sm">
                                            <Check size={14} /> {copy.connected}
                                        </span>
                                    ) : (
                                        <Button
                                            variant="outline"
                                            onClick={() => chatgpt.setDialogOpen(true)}
                                        >
                                            {copy.connect}
                                        </Button>
                                    )
                                }
                            />
                        ) : null}
                        <OptionRow
                            muted
                            icon={<AnthropicIcon className="size-7 shrink-0" />}
                            title={
                                <span className="flex items-center gap-2">
                                    {copy.claude}
                                    <Badge>{copy.claudeBadge}</Badge>
                                </span>
                            }
                            hint={copy.claudeHint}
                            action={
                                <a
                                    className="text-foreground flex items-center gap-1 text-sm"
                                    href={SELF_HOST_DOCS}
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    {copy.docs} <ArrowSquareOut size={12} />
                                </a>
                            }
                        />
                        <OptionRow
                            icon={
                                <span className="flex shrink-0 items-center">
                                    {BYOM_ICONS.map(({key, Icon}) => (
                                        <span
                                            key={key}
                                            className="border-border bg-background -ml-1.5 flex size-6 items-center justify-center rounded-full border border-solid first:ml-0"
                                        >
                                            <Icon className="size-3.5" />
                                        </span>
                                    ))}
                                </span>
                            }
                            title={copy.byom}
                            hint={
                                keys.connections.length > 0
                                    ? copy.byomUsing(
                                          keys.connections[0].name,
                                          keys.connections.length - 1,
                                      )
                                    : copy.byomHint
                            }
                            action={
                                <Button variant="outline" onClick={keys.openDrawer}>
                                    {copy.addKey}
                                </Button>
                            }
                        />
                    </div>
                </>
            )}
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
