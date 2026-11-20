import {useState} from "react"

import {useT} from "@agenta/i18n"
import agentChannelsCatalog from "@agenta/i18n/catalogs/agentPages.channels"
import channelsPageCatalog from "@agenta/i18n/catalogs/channels.page"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {PhoneScreenHeader, useIsPhone} from "@agenta/ui/phone"
import {Button, Sheet, SheetContent, SheetTitle, SkeletonBlock} from "@agenta/ui/ui"
import {ArrowLeft, CaretRight} from "@phosphor-icons/react"

import {
    CHANNEL_PLATFORMS,
    EMPTY_CONNECTIONS,
    agentConnectionsOf,
    connectionLabel,
    platformLabel,
    summarizeConnection,
} from "./helpers"
import {platformLogo} from "./icons"
import type {ChannelPlatform} from "./types"
import {
    useChannelPanel,
    type ChannelsPanelRenderProps,
    type UseChannelPanelOptions,
} from "./useChannelPanel"

export interface AgentChannelsViewProps extends Pick<
    UseChannelPanelOptions,
    | "agentName"
    | "agentDescription"
    | "workspaceName"
    | "connections"
    | "loading"
    | "loadError"
    | "actions"
    | "hostedHandle"
> {
    agentId: string
}

/**
 * The Channels page of an agent, and the Channels tab of the agent's right panel. The
 * connected channels first, then the ones to add. "Manage" and "Connect" open the production
 * manage view and connect steps in place, under the breadcrumb "Channels › Slack". Changes apply
 * at once.
 */
export const AgentChannelsView = (props: AgentChannelsViewProps) => {
    const {
        agentId,
        connections = EMPTY_CONNECTIONS,
        loading = false,
        loadError = null,
        actions,
        hostedHandle,
    } = props
    const t = useT(agentChannelsCatalog, channelsPageCatalog, commonCatalog)
    const agentName = props.agentName ?? t("channels.page.yourAgent")
    const [retrying, setRetrying] = useState(false)
    const phone = useIsPhone()
    const {open, openRoute, panel} = useChannelPanel({
        ...props,
        renderPanel: (view) => (view.open ? <InlineChannelView {...view} /> : null),
    })
    // A manage view or connect steps are open: they take the place of the list.
    if (panel) return <>{panel}</>

    const summaries = CHANNEL_PLATFORMS.map((platform) => ({
        platform,
        summary: summarizeConnection(platform, connections[platform], agentId),
    }))
    // A platform is connected when the agent has a connection there that is not a pending link,
    // even when the platform's summary is about a pending one.
    const isConnected = ({platform, summary}: (typeof summaries)[number]) =>
        summary.action === "manage" || agentConnectionsOf(connections, platform).length > 0
    const connected = summaries.filter(isConnected)
    const toAdd = summaries.filter((entry) => !isConnected(entry))
    // A connected row opens what the agent has there, not the setup of a pending link.
    const manage = (platform: ChannelPlatform) => {
        const mine = agentConnectionsOf(connections, platform)
        if (mine.length > 1) openRoute({view: "platform", platform})
        else if (mine[0])
            openRoute({view: "manage", platform, connectionId: mine[0].connectionId ?? null})
        else open(platform)
    }

    const retry = async () => {
        if (!actions) return
        setRetrying(true)
        try {
            await actions.reload()
        } catch {
            // The host keeps the error until a reload succeeds.
        } finally {
            setRetrying(false)
        }
    }

    return (
        <div
            className={phone ? "flex flex-col" : "flex flex-col gap-5"}
            data-testid="agent-channels"
        >
            <p
                className={`m-0 text-[13px] leading-5 text-muted-foreground ${phone ? "px-4 pb-1 pt-3.5" : ""}`}
            >
                {t("agentPages.channels.intro", {agent: agentName})}
            </p>

            {loadError ? (
                <div
                    role="alert"
                    className={`flex items-center justify-between gap-3 rounded-lg border border-solid border-border px-3 py-2.5 text-[13px] text-error ${phone ? "mx-4 mt-3" : ""}`}
                >
                    <span className="min-w-0">{loadError}</span>
                    <Button variant="outline" size="sm" disabled={retrying} onClick={retry}>
                        {retrying ? t("common.retrying") : t("common.tryAgain")}
                    </Button>
                </div>
            ) : loading ? (
                <ChannelRowsSkeleton phone={phone} />
            ) : (
                <>
                    {connected.length ? (
                        <ChannelGroup title={t("agentPages.channels.connected")} phone={phone}>
                            {connected.map(({platform, summary}) => {
                                const mine = agentConnectionsOf(connections, platform)
                                // Any of the agent's connections can need attention, not only
                                // the one the platform summary is about. With several, the line
                                // names the one that does.
                                const brokenConnection = mine.find(
                                    (c) => summarizeConnection(platform, c, agentId).needsAttention,
                                )
                                const broken = brokenConnection
                                    ? summarizeConnection(platform, brokenConnection, agentId)
                                    : null
                                // "Reconnect" only when a connection lost its access; other
                                // problems are fixed in the manage view.
                                const revoked = mine.some((c) => c.status === "revoked")
                                const sub =
                                    broken && brokenConnection
                                        ? mine.length > 1
                                            ? `${connectionLabel(brokenConnection, hostedHandle)} · ${broken.sub}`
                                            : broken.sub
                                        : mine.length > 1
                                          ? mine
                                                .map((c) => connectionLabel(c, hostedHandle))
                                                .join(", ")
                                          : summary.sub
                                return (
                                    <ChannelRow
                                        key={platform}
                                        platform={platform}
                                        sub={sub}
                                        subClass={
                                            broken ? broken.subClass : "text-muted-foreground"
                                        }
                                        tag={
                                            broken ? (
                                                <span className="rounded bg-colorErrorBg px-1.5 py-0.5 text-xs text-colorError">
                                                    {t("common.needsAttention")}
                                                </span>
                                            ) : null
                                        }
                                        action={
                                            revoked ? t("common.reconnect") : t("common.manage")
                                        }
                                        connected
                                        phone={phone}
                                        onClick={() => manage(platform)}
                                    />
                                )
                            })}
                        </ChannelGroup>
                    ) : null}
                    <ChannelGroup title={t("agentPages.channels.addChannel")} phone={phone}>
                        {toAdd.map(({platform, summary}) => (
                            <ChannelRow
                                key={platform}
                                platform={platform}
                                sub={summary.sub}
                                subClass={
                                    summary.dotClass ? summary.subClass : "text-muted-foreground"
                                }
                                action={
                                    summary.action === "connect-here"
                                        ? t("channels.page.connectHere")
                                        : t("common.connect")
                                }
                                phone={phone}
                                onClick={() => open(platform)}
                            />
                        ))}
                    </ChannelGroup>
                </>
            )}
        </div>
    )
}

/**
 * A group of channels. On a desktop each channel is its own bordered card (A07); on a phone the
 * rows run edge to edge with a line under each (M13).
 */
const ChannelGroup = ({
    title,
    phone,
    children,
}: {
    title: string
    phone: boolean
    children: React.ReactNode
}) =>
    phone ? (
        <section className="flex flex-col">
            <h3 className="m-0 px-4 pb-1.5 pt-4 text-xs font-medium leading-5 text-colorTextTertiary">
                {title}
            </h3>
            <div className="flex flex-col">{children}</div>
        </section>
    ) : (
        <section className="flex flex-col gap-2">
            <h3 className="m-0 text-xs font-medium leading-4 text-muted-foreground">{title}</h3>
            {children}
        </section>
    )

const ROW_DESKTOP =
    "box-border flex w-full items-center gap-2.5 rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer p-3 text-left text-sm leading-5"
const ROW_PHONE =
    "box-border flex min-h-14 w-full items-center gap-3 border-0 border-b border-solid border-colorBorderSecondary bg-colorBgContainer py-1.5 pl-4 pr-2 text-left text-[15px] leading-5"

/**
 * One channel. A connected channel is one button that opens its manage view, with the action
 * and a caret at the right; a channel to add has a "Connect" button.
 */
const ChannelRow = ({
    platform,
    sub,
    subClass,
    tag,
    action,
    connected = false,
    phone,
    onClick,
}: {
    platform: ChannelPlatform
    sub: string
    subClass: string
    tag?: React.ReactNode
    action: string
    connected?: boolean
    phone: boolean
    onClick: () => void
}) => {
    const body = (
        <>
            <span className="flex flex-none items-center" aria-hidden>
                {platformLogo(platform, phone ? 22 : 32)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                    {platformLabel(platform)}
                    {tag}
                </span>
                <span className={`text-xs leading-4 ${phone ? "" : "truncate"} ${subClass}`}>
                    {sub}
                </span>
            </span>
        </>
    )
    if (connected) {
        return (
            <button
                type="button"
                className={`${phone ? ROW_PHONE : ROW_DESKTOP} cursor-pointer font-[inherit] hover:bg-muted/40`}
                data-testid={`agent-channels-${platform}`}
                onClick={onClick}
            >
                {body}
                {phone ? (
                    <span className="sr-only">{action}</span>
                ) : (
                    <span className="flex-none text-[13px] text-muted-foreground">{action}</span>
                )}
                <CaretRight
                    size={phone ? 16 : 10}
                    weight={phone ? "regular" : "fill"}
                    aria-hidden
                    className={`flex-none text-muted-foreground ${phone ? "mr-2" : "mx-1"}`}
                />
            </button>
        )
    }
    return (
        <div className={phone ? ROW_PHONE : ROW_DESKTOP} data-testid={`agent-channels-${platform}`}>
            {body}
            <Button
                variant="outline"
                size="compact"
                // On a phone 36 px high with a 44 px hit area, as drawn (M13).
                className={
                    phone
                        ? "relative mr-2 h-9 rounded-lg text-sm after:absolute after:-inset-1 after:content-['']"
                        : undefined
                }
                onClick={onClick}
            >
                {action}
            </Button>
        </div>
    )
}

const ChannelRowsSkeleton = ({phone}: {phone: boolean}) => (
    <div className={`flex flex-col ${phone ? "" : "gap-2"}`}>
        {CHANNEL_PLATFORMS.slice(0, 3).map((platform) => (
            <div key={platform} className={phone ? ROW_PHONE : ROW_DESKTOP}>
                <SkeletonBlock
                    active
                    className={phone ? "size-[22px] rounded" : "size-8 rounded-md"}
                />
                <div className="flex flex-1 flex-col gap-1.5">
                    <SkeletonBlock active className="h-3.5 w-20" />
                    <SkeletonBlock active className="h-3 w-36" />
                </div>
            </div>
        ))}
    </div>
)

/** A manage view or connect steps, in place of the list, under "Channels › {title}". */
const InlineChannelView = ({title, icon, onClose, onBack, children}: ChannelsPanelRenderProps) => {
    const t = useT(channelsPageCatalog, commonCatalog)
    // On a phone the manage view and the connect steps cover the screen, with a back arrow to the
    // step before or to Channels (M13). The sheet keeps focus inside; Escape goes back too.
    const phone = useIsPhone()
    if (phone) {
        const back = onBack ?? onClose
        return (
            <Sheet open onOpenChange={(open) => (open ? undefined : back())}>
                <SheetContent
                    side="right"
                    aria-describedby={undefined}
                    className="inset-0 w-full max-w-none rounded-none bg-colorBgContainer pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-none sm:max-w-none"
                    data-testid="agent-channels-open-view-phone"
                >
                    <SheetTitle className="sr-only">{title}</SheetTitle>
                    <PhoneScreenHeader
                        title={title}
                        backTitle={onBack ? undefined : t("channels.page.title")}
                        onBack={back}
                    />
                    <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
                </SheetContent>
            </Sheet>
        )
    }
    return (
        <div className="flex flex-col gap-4" data-testid="agent-channels-open-view">
            <nav className="flex min-w-0 items-center gap-1.5 text-sm">
                {onBack ? (
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("common.back")}
                        onClick={onBack}
                    >
                        <ArrowLeft size={14} />
                    </Button>
                ) : null}
                <button
                    type="button"
                    onClick={onClose}
                    className="cursor-pointer border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
                >
                    {t("channels.page.title")}
                </button>
                <CaretRight size={12} aria-hidden className="text-muted-foreground" />
                <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
                    {icon}
                    <span className="truncate">{title}</span>
                </span>
            </nav>
            <div>{children}</div>
        </div>
    )
}
