/**
 * The two pinned sections the model-providers drawer grows outside Settings.
 *
 * Settings has a table beside the drawer that already lists every connection, so there the drawer
 * is the catalog and nothing else. A playground has no such table: Connected sits above the
 * catalog and subscription cards below it, and both stay pinned while the catalog scrolls between
 * them.
 *
 * Connected is one row per stored connection, folded into a single subtitle. The lower section
 * holds the project's hosted ChatGPT sign-in, a Claude self-hosting link, then one row per
 * DEPLOYMENT-mounted subscription and harness pair.
 *
 * Design: providers-drawer-final/README.md §3 ("Connected"), §5 ("Subscriptions").
 */
import {useMemo, type ReactNode} from "react"

import {
    connectedRowSubtitle,
    connectionModelCount,
    credentialSummary,
    subscriptionPairsFrom,
    type ProviderConnection,
    type SubscriptionPair,
} from "@agenta/entities/secret"
import {
    harnessCapabilitiesAtomFamily,
    SUBSCRIPTION_STATUS_QUERY_HARNESS,
    subscriptionStatusQueryAtomFamily,
} from "@agenta/entities/workflow"
import {Button} from "@agenta/ui/ui"
import {CaretRight} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {harnessMetaFor} from "../DrillInView/SchemaControls/harnessMeta"

import {harnessMarkNode} from "./harnessMark"
import {providerIconFor} from "./providerIcon"

/** The capability map is global; the key only records which surface asked for it. */
const HARNESS_CATALOG_KEY = "agenta:providers-drawer:connected"

/** The provider mark, resolved at call time (the icon set is a lookup, not a component prop). */
const providerLogo = (kind: string, className = "size-4 shrink-0") => {
    const Icon = providerIconFor(kind)
    return <Icon className={className} />
}

/** Sentence case, 12px, tertiary — never a shouted header. */
const SectionLabel = ({children, hint}: {children: string; hint?: string}) => (
    <div className="flex shrink-0 items-baseline justify-between gap-3 px-6 pb-1 pt-4">
        <h4 className="m-0 text-field-sm font-medium text-colorTextTertiary">{children}</h4>
        {hint ? <span className="text-field-sm text-colorTextTertiary">{hint}</span> : null}
    </div>
)

/** The green dot and chevron every openable row on this surface ends with. */
const RowAffordance = () => (
    <>
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-colorSuccess" />
        <CaretRight size={14} className="shrink-0 text-colorTextTertiary" />
    </>
)

/** A connected provider: logo, name, and everything else folded into one subtitle. */
const ConnectedRow = ({
    connection,
    subtitle,
    onSelect,
}: {
    connection: ProviderConnection
    subtitle: string
    onSelect: (connection: ProviderConnection) => void
}) => (
    <button
        type="button"
        onClick={() => onSelect(connection)}
        className="box-border flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-6 py-2 text-left hover:bg-colorFillQuaternary"
    >
        {providerLogo(connection.kind, "size-5 shrink-0")}
        <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-xs text-colorText">{connection.name}</span>
            <span className="truncate font-mono text-[11px] text-colorTextTertiary">
                {subtitle}
            </span>
        </span>
        <RowAffordance />
    </button>
)

/** One subscription × harness pair. The harness tag carries its own mark — it is a product. */
const SubscriptionRow = ({pair, onSelect}: {pair: SubscriptionPair; onSelect: () => void}) => (
    <button
        type="button"
        onClick={onSelect}
        className="box-border flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-6 py-2 text-left hover:bg-colorFillQuaternary"
    >
        {providerLogo(pair.provider, "size-5 shrink-0")}
        <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-xs text-colorText">{pair.name}</span>
            <span className="flex shrink-0 items-center gap-1 rounded-control-sm bg-colorFillTertiary px-1.5 py-0.5 text-[11px] text-colorTextSecondary">
                {harnessMarkNode(pair.harness)}
                {harnessMetaFor(pair.harness).label}
            </span>
        </span>
        <RowAffordance />
    </button>
)

/** Claude uses the same card treatment as ChatGPT, but setup still happens on the deployment. */
const ClaudeSubscriptionCard = ({docsUrl}: {docsUrl: string}) => (
    <section className="flex flex-col gap-3 rounded-md border border-solid border-colorBorderSecondary p-4 text-xs">
        <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium text-colorText">Claude</span>
                <span className="text-colorTextSecondary">Self-hosted deployments only.</span>
            </div>
            <Button size="sm" asChild>
                <a href={docsUrl} target="_blank" rel="noreferrer" className="no-underline">
                    Connect Claude
                </a>
            </Button>
        </div>
    </section>
)

export interface PlaygroundConnectedSectionProps {
    connections: ProviderConnection[]
    onSelect: (connection: ProviderConnection) => void
}

/** What the project already has. Above the catalog: connected before connectable. */
export const PlaygroundConnectedSection = ({
    connections,
    onSelect,
}: PlaygroundConnectedSectionProps) => {
    const capabilities = useAtomValue(harnessCapabilitiesAtomFamily(HARNESS_CATALOG_KEY))

    const subtitles = useMemo(
        () =>
            new Map(
                connections.map((connection) => [
                    connection.id,
                    connectedRowSubtitle({
                        credential: credentialSummary(connection),
                        modelCount: connectionModelCount(connection, capabilities),
                        harnessLabels: (connection.harnesses ?? []).map(
                            (harness) => harnessMetaFor(harness).label,
                        ),
                    }),
                ]),
            ),
        [connections, capabilities],
    )

    if (!connections.length) return null

    return (
        <div className="shrink-0">
            <SectionLabel>Connected</SectionLabel>
            {connections.map((connection) => (
                <ConnectedRow
                    key={connection.id}
                    connection={connection}
                    subtitle={subtitles.get(connection.id) ?? ""}
                    onSelect={onSelect}
                />
            ))}
        </div>
    )
}

/**
 * The logins this DEPLOYMENT mounts, as one row per subscription and harness pair.
 *
 * Its own component so its poll only runs on a deployment that can mount a login at all. No status
 * prose in the rows: a pair that is not `ready` produces no row, and a green dot means it works.
 */
const MountedSubscriptionRows = ({
    onSelectPair,
}: {
    onSelectPair: (pair: SubscriptionPair) => void
}) => {
    // One poll for the whole deployment: the runner answers for EVERY harness in a single call, and
    // the shared key keeps this surface and the pickers on one TanStack query rather than three.
    const query = useAtomValue(subscriptionStatusQueryAtomFamily(SUBSCRIPTION_STATUS_QUERY_HARNESS))
    const pairs = useMemo(
        () => subscriptionPairsFrom(query.data?.harnesses),
        [query.data?.harnesses],
    )

    if (!pairs?.length) return null

    return pairs.map((pair) => (
        <SubscriptionRow key={pair.key} pair={pair} onSelect={() => onSelectPair(pair)} />
    ))
}

export interface PlaygroundSubscriptionsSectionProps {
    subscriptionDocsUrl: string
    onSelectPair: (pair: SubscriptionPair) => void
    /**
     * The hosted sign-in card. Both sources are subscriptions, so they share one section and one
     * label; only this one is connected from the drawer, so it comes first. Required: it is what
     * keeps the section from rendering a border and a label over nothing when nothing is mounted.
     */
    hostedCard: ReactNode
    /** Whether this deployment can mount an operator login at all. */
    showMounted?: boolean
}

/** Below the catalog: nothing here is added from the drawer, so it closes the list. */
export const PlaygroundSubscriptionsSection = ({
    subscriptionDocsUrl,
    onSelectPair,
    hostedCard,
    showMounted = true,
}: PlaygroundSubscriptionsSectionProps) => (
    <div className="shrink-0 border-0 border-t border-solid border-colorSplit">
        <div className="flex flex-col gap-3 px-6 py-4">
            {hostedCard}
            <ClaudeSubscriptionCard docsUrl={subscriptionDocsUrl} />
        </div>
        {showMounted ? <MountedSubscriptionRows onSelectPair={onSelectPair} /> : null}
    </div>
)
