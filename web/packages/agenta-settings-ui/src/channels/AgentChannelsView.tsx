import {useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import agentChannelsCatalog from "@agenta/i18n/catalogs/agentPages.channels"
import channelsHubCatalog from "@agenta/i18n/catalogs/channels.hub"
import channelsPageCatalog from "@agenta/i18n/catalogs/channels.page"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {SimpleTooltip} from "@agenta/ui/composed"
import {PhoneScreenHeader, useIsPhone} from "@agenta/ui/phone"
import {Alert, Button, Sheet, SheetContent, SheetTitle, SkeletonBlock} from "@agenta/ui/ui"
import {ArrowLeft, CaretRight, ChatCircleText, Code} from "@phosphor-icons/react"

import {SettingsCatalogSection, type SettingsCatalogItem} from "../shared/SettingsCatalog"

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
    | "api"
    | "embed"
> {
    /** Draws an open view in the host's chrome, not under the "Channels › title" breadcrumb. */
    renderOpenView?: (view: ChannelsPanelRenderProps) => ReactNode
    agentId: string
    /** The agent's Channels page: the page says the intro; a desktop shows a grid. */
    page?: boolean
}

/**
 * The Channels page of an agent, and the Channels tab of the agent's right panel. The
 * connected channels first, then the ones to add, then API and Embed when the host gives them.
 * "Manage" and "Connect" open the production manage view and connect steps in place, under the
 * breadcrumb "Channels › Slack". Changes apply at once.
 */
export const AgentChannelsView = (props: AgentChannelsViewProps) => {
    const {
        agentId,
        connections = EMPTY_CONNECTIONS,
        loading = false,
        loadError = null,
        actions,
        hostedHandle,
        api,
        embed,
    } = props
    const t = useT(agentChannelsCatalog, channelsHubCatalog, channelsPageCatalog, commonCatalog)
    const agentName = props.agentName ?? t("channels.page.yourAgent")
    const [retrying, setRetrying] = useState(false)
    const phone = useIsPhone()
    const {open, openRoute, panel} = useChannelPanel({
        ...props,
        renderPanel: (view) =>
            view.open ? (
                props.renderOpenView ? (
                    props.renderOpenView(view)
                ) : (
                    <InlineChannelView {...view} />
                )
            ) : null,
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
    const ready = !loading && !loadError
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

    // A desktop pane lists channels as Settings > Channels does: one catalog row per line.
    if (!phone) {
        const brokenOf = (platform: ChannelPlatform) => {
            const mine = agentConnectionsOf(connections, platform)
            const broken = mine.find(
                (c) => summarizeConnection(platform, c, agentId).needsAttention,
            )
            return broken ? summarizeConnection(platform, broken, agentId).sub : null
        }
        const connectedItems: SettingsCatalogItem[] = connected.map(({platform, summary}) => {
            const mine = agentConnectionsOf(connections, platform)
            const problem = brokenOf(platform)
            return {
                key: platform,
                logo: platformLogo(platform, 18),
                name: platformLabel(platform),
                description:
                    mine.length > 1
                        ? mine.map((c) => connectionLabel(c, hostedHandle)).join(", ")
                        : summary.sub,
                status: problem ? "attention" : "connected",
                statusLabel: problem ?? t("common.manage"),
                onOpen: () => manage(platform),
                testId: `agent-channels-${platform}`,
            }
        })
        const addItems: SettingsCatalogItem[] = [
            ...(ready
                ? toAdd.map(
                      ({platform, summary}): SettingsCatalogItem => ({
                          key: platform,
                          logo: platformLogo(platform, 18),
                          name: platformLabel(platform),
                          description: summary.sub,
                          status: "available",
                          statusLabel:
                              summary.action === "connect-here"
                                  ? t("channels.page.connectHere")
                                  : t("common.connect"),
                          onOpen: () => open(platform),
                          testId: `agent-channels-${platform}`,
                      }),
                  )
                : []),
            // API and Embed need no channel read: they stay while it loads or fails.
            ...(api
                ? [
                      {
                          key: "api",
                          logo: <Code />,
                          name: "API",
                          description: t("channels.hub.apiAlwaysOn"),
                          status: "connected" as const,
                          statusLabel: "API",
                          onOpen: () => openRoute({view: "api"}),
                          testId: "agent-channels-api",
                      },
                  ]
                : []),
            ...(embed
                ? [
                      {
                          key: "embed",
                          logo: <ChatCircleText />,
                          name: t("channels.hub.embed"),
                          description: t("channels.hub.embedDescription"),
                          status: "connected" as const,
                          statusLabel: t("channels.hub.embed"),
                          onOpen: () => openRoute({view: "embed", connectionId: null}),
                          testId: "agent-channels-embed",
                      },
                  ]
                : []),
        ]
        return (
            <div className="flex flex-col gap-5" data-testid="agent-channels">
                {/* What failed and the fix (STATE-03); API and Embed below still work. */}
                {loadError ? (
                    <Alert
                        type="error"
                        showIcon
                        message={loadError}
                        action={
                            <Button variant="outline" size="sm" disabled={retrying} onClick={retry}>
                                {retrying ? t("common.retrying") : t("common.tryAgain")}
                            </Button>
                        }
                    />
                ) : null}
                {connectedItems.length ? (
                    <SettingsCatalogSection
                        group={{
                            label: t("agentPages.channels.connected"),
                            items: connectedItems,
                            list: !props.page,
                            count: null,
                        }}
                    />
                ) : null}
                {loading || addItems.length ? (
                    <SettingsCatalogSection
                        group={{
                            label: t("agentPages.channels.addChannel"),
                            description: props.page
                                ? undefined
                                : t("agentPages.channels.intro", {agent: agentName}),
                            // While loading, API and Embed stay and the platforms are skeletons (STATE-02).
                            items: addItems,
                            pendingRows: loading ? CHANNEL_PLATFORMS.length : 0,
                            list: !props.page,
                            count: null,
                        }}
                    />
                ) : null}
            </div>
        )
    }

    return (
        <div
            className={phone ? "flex flex-col" : "flex flex-col gap-5"}
            data-testid="agent-channels"
        >
            {props.page ? null : (
                <p
                    className={`m-0 text-body-sm text-muted-foreground ${phone ? "px-4 pb-1 pt-3.5" : ""}`}
                >
                    {t("agentPages.channels.intro", {agent: agentName})}
                </p>
            )}

            {loadError ? (
                <div className={phone ? "mx-4 mt-3" : undefined}>
                    <Alert
                        type="error"
                        showIcon
                        message={loadError}
                        action={
                            <Button variant="outline" size="sm" disabled={retrying} onClick={retry}>
                                {retrying ? t("common.retrying") : t("common.tryAgain")}
                            </Button>
                        }
                    />
                </div>
            ) : loading ? (
                <ChannelRowsSkeleton phone={phone} />
            ) : connected.length ? (
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
                                  ? mine.map((c) => connectionLabel(c, hostedHandle)).join(", ")
                                  : summary.sub
                        return (
                            <ChannelRow
                                key={platform}
                                testId={`agent-channels-${platform}`}
                                icon={platformLogo(platform, 24)}
                                label={platformLabel(platform)}
                                sub={sub}
                                subClass={broken ? broken.subClass : "text-muted-foreground"}
                                tag={
                                    broken ? (
                                        <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-meta text-destructive">
                                            {t("common.needsAttention")}
                                        </span>
                                    ) : null
                                }
                                action={revoked ? t("common.reconnect") : t("common.manage")}
                                whole
                                phone={phone}
                                onClick={() => manage(platform)}
                            />
                        )
                    })}
                </ChannelGroup>
            ) : null}
            {/* API and Embed need no channel read: they stay while it loads or fails. */}
            {ready || api || embed ? (
                <ChannelGroup title={t("agentPages.channels.addChannel")} phone={phone}>
                    {ready
                        ? toAdd.map(({platform, summary}) => (
                              <ChannelRow
                                  key={platform}
                                  testId={`agent-channels-${platform}`}
                                  icon={platformLogo(platform, 24)}
                                  label={platformLabel(platform)}
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
                          ))
                        : null}
                    {/* API and Embed, as the production Publish panel lists them. */}
                    {api ? (
                        <ChannelRow
                            testId="agent-channels-api"
                            icon={<PublishMark icon={<Code />} phone={phone} />}
                            label="API"
                            sub={t("channels.hub.apiAlwaysOn")}
                            subClass="text-muted-foreground"
                            whole
                            phone={phone}
                            onClick={() => openRoute({view: "api"})}
                        />
                    ) : null}
                    {embed ? (
                        <ChannelRow
                            testId="agent-channels-embed"
                            icon={<PublishMark icon={<ChatCircleText />} phone={phone} />}
                            label={t("channels.hub.embed")}
                            sub={t("channels.hub.embedDescription")}
                            subClass="text-muted-foreground"
                            whole
                            phone={phone}
                            onClick={() => openRoute({view: "embed", connectionId: null})}
                        />
                    ) : null}
                </ChannelGroup>
            ) : null}
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
            <h3 className="m-0 px-4 pb-1.5 pt-4 text-meta font-medium leading-5 text-muted-foreground">
                {title}
            </h3>
            <div className="flex flex-col">{children}</div>
        </section>
    ) : (
        <section className="flex flex-col gap-2">
            <h3 className="m-0 text-subtitle text-foreground">{title}</h3>
            {children}
        </section>
    )

const ROW_DESKTOP =
    "box-border flex min-h-row-double w-full items-center gap-3 rounded-md border border-solid border-border-muted bg-background px-3 py-1.5 text-left text-label leading-5"
const ROW_PHONE =
    "box-border flex min-h-row-double w-full items-center gap-3 border-0 border-b border-solid border-border-muted bg-background py-1.5 pl-4 pr-2 text-left text-label leading-5"

/** The mark of API and Embed: their production icon on a muted square, a platform logo's size. */
const PublishMark = ({icon}: {icon: React.ReactElement; phone: boolean}) => (
    <span className="flex size-6 items-center justify-center rounded-md bg-secondary text-body text-foreground">
        {icon}
    </span>
)

/**
 * One channel. A connected channel is one button (`whole`) that opens its manage view, with the
 * action and a caret at the right; a channel to add has a "Connect" button. API and Embed are one
 * button with only a caret, as in the production Publish panel.
 */
const ChannelRow = ({
    testId,
    icon,
    label,
    sub,
    subClass,
    tag,
    action,
    whole = false,
    phone,
    onClick,
}: {
    testId: string
    icon: React.ReactNode
    label: string
    sub: string
    subClass: string
    tag?: React.ReactNode
    /** The action's words; API and Embed have none. */
    action?: string
    /** The whole row is one button. */
    whole?: boolean
    phone: boolean
    onClick: () => void
}) => {
    const body = (
        <>
            <span className="flex flex-none items-center" aria-hidden>
                {icon}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                    {label}
                    {tag}
                </span>
                <span className={`text-meta ${phone ? "" : "truncate"} ${subClass}`}>{sub}</span>
            </span>
        </>
    )
    if (whole) {
        return (
            <button
                type="button"
                className={`${phone ? ROW_PHONE : ROW_DESKTOP} cursor-pointer font-[inherit] hover:bg-accent`}
                data-testid={testId}
                onClick={onClick}
            >
                {body}
                {!action ? null : phone ? (
                    <span className="sr-only">{action}</span>
                ) : (
                    <span className="flex-none text-label text-muted-foreground">{action}</span>
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
        <div className={phone ? ROW_PHONE : ROW_DESKTOP} data-testid={testId}>
            {body}
            <Button
                variant="outline"
                size="compact"
                // On a phone 36 px high with a 44 px hit area, as drawn (M13).
                className={
                    phone
                        ? "relative mr-2 h-control rounded-md text-body after:absolute after:-inset-1 after:content-['']"
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
                <SkeletonBlock active className="size-6 rounded-md" />
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
                    className="inset-0 w-full max-w-none rounded-none bg-background pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-none sm:max-w-none"
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
            <nav className="flex min-w-0 items-center gap-1.5 text-body">
                {onBack ? (
                    <SimpleTooltip title={t("common.back")}>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("common.back")}
                            onClick={onBack}
                        >
                            <ArrowLeft size={14} />
                        </Button>
                    </SimpleTooltip>
                ) : null}
                <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={onClose}
                    className="-mx-1.5 px-1.5 text-muted-foreground"
                >
                    {t("channels.page.title")}
                </Button>
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
