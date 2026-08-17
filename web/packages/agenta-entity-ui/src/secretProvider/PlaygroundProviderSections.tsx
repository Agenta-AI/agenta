/**
 * The two pinned sections the model-providers drawer grows outside Settings.
 *
 * Settings has a table beside the drawer that already lists every connection, so there the drawer
 * is the catalog and nothing else. A playground has no such table: Connected sits above the
 * catalog and Subscriptions below it, and both stay pinned while the catalog scrolls between them.
 *
 * Connected is one row per stored connection, folded into a single subtitle. Subscriptions is one
 * row per subscription × HARNESS pair — the unit models are configured for — because the same
 * ChatGPT plan read by Codex and by Pi runs two different model lists.
 *
 * Design: providers-drawer-final/README.md §3 ("Connected"), §5 ("Subscriptions").
 */
import {useMemo} from "react"

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
import {ArrowSquareOut, CaretRight} from "@phosphor-icons/react"
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

/**
 * The row that closes the section: how a subscription gets set up at all.
 *
 * Overlapped Anthropic and OpenAI marks, because it stands for both. The whole row is the target —
 * there is nothing to configure here, only a guide to follow.
 */
const SetupRow = ({docsUrl}: {docsUrl: string}) => (
    <a
        href={docsUrl}
        target="_blank"
        rel="noreferrer"
        // box-border is load-bearing: preflight is off, and an <a> gets no UA border-box the way a
        // <button> does, so `w-full` + `px-6` would measure 100% PLUS 48px and push docs off the edge.
        className="box-border flex w-full items-center gap-3 px-6 py-2 no-underline hover:bg-colorFillQuaternary"
    >
        <span className="flex shrink-0 items-center">
            {providerLogo("anthropic", "size-5 shrink-0 opacity-60")}
            {providerLogo("openai", "-ml-2 size-5 shrink-0")}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-xs text-colorText">
                Set up a Claude or ChatGPT subscription
            </span>
            <span className="truncate text-[11px] text-colorTextTertiary">
                Self-hosted deployments only, for now
            </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-field-sm text-btn-link hover:text-btn-link-hover">
            docs
            <ArrowSquareOut size={12} />
        </span>
    </a>
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

export interface PlaygroundSubscriptionsSectionProps {
    subscriptionDocsUrl: string
    onSelectPair: (pair: SubscriptionPair) => void
}

/**
 * Below the catalog: nothing here is added from the drawer, so it closes the list.
 *
 * No status prose in the rows. A pair that is not `ready` produces no row at all — a green dot on
 * an openable row means it works, and everything short of that is what the setup row is for.
 */
export const PlaygroundSubscriptionsSection = ({
    subscriptionDocsUrl,
    onSelectPair,
}: PlaygroundSubscriptionsSectionProps) => {
    // One poll for the whole deployment: the runner answers for EVERY harness in a single call, and
    // the shared key keeps this surface and the pickers on one TanStack query rather than three.
    const query = useAtomValue(subscriptionStatusQueryAtomFamily(SUBSCRIPTION_STATUS_QUERY_HARNESS))
    const pairs = useMemo(
        () => subscriptionPairsFrom(query.data?.harnesses),
        [query.data?.harnesses],
    )

    return (
        <div className="shrink-0 border-0 border-t border-solid border-colorSplit">
            <SectionLabel>Subscriptions</SectionLabel>
            {pairs?.length ? (
                pairs.map((pair) => (
                    <SubscriptionRow
                        key={pair.key}
                        pair={pair}
                        onSelect={() => onSelectPair(pair)}
                    />
                ))
            ) : (
                <p className="m-0 px-6 pb-1 text-field-sm text-colorTextSecondary">
                    Use your Claude or ChatGPT plan in the playground — no API key needed.
                </p>
            )}
            <SetupRow docsUrl={subscriptionDocsUrl} />
        </div>
    )
}
