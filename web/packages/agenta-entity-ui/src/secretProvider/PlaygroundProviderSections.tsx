/**
 * The two sections the AI-providers drawer grows when it is opened from the playground.
 *
 * From Settings the drawer shows the catalog only — the table beside it already lists every
 * connection and every subscription note. The playground has no such table, so the drawer is the
 * only place those can be seen: Connected above the catalog, Subscriptions below it.
 *
 * A subscription is configuration, never a form: it is set up by mounting the provider's folder in
 * the deployment. The rows here say whether the runner can see one, and link to the guide when it
 * cannot.
 *
 * Design: docs/design/provider-connections-models/experience.md ("Provider drawer", "Subscriptions").
 */
import {useMemo} from "react"

import {credentialSummary, type ProviderConnection} from "@agenta/entities/secret"
import {
    resolveSubscriptionStatus,
    subscriptionStatusQueryAtomFamily,
} from "@agenta/entities/workflow"
import {cn} from "@agenta/ui/styles"
import {useAtomValue} from "jotai"

import {SUBSCRIPTION_HARNESSES} from "../DrillInView/SchemaControls/connectionPicker"
import {harnessMetaFor} from "../DrillInView/SchemaControls/harnessMeta"

import {providerIconFor} from "./providerIcon"

// One source of truth with the picker: the same harnesses that get a subscription ROW there get a
// row here, so the drawer cannot offer a subscription the menu will never list.
const SUBSCRIPTIONS = Object.entries(SUBSCRIPTION_HARNESSES).map(([harness, meta]) => ({
    harness,
    ...meta,
}))

/** The provider mark, resolved at call time (the icon set is a lookup, not a component prop). */
const providerLogo = (kind: string) => {
    const Icon = providerIconFor(kind)
    return <Icon className="h-4 w-4 shrink-0" />
}

const SectionTitle = ({children}: {children: string}) => (
    <h4 className="m-0 px-6 pb-1 pt-4 text-field-sm uppercase tracking-wide text-colorTextTertiary">
        {children}
    </h4>
)

/** A connected provider: name, masked credential, harness policy, and a status dot. */
const ConnectedRow = ({
    connection,
    onSelect,
}: {
    connection: ProviderConnection
    onSelect: (connection: ProviderConnection) => void
}) => {
    // A connection with no credential cannot run; the dot is the only place that shows it here,
    // because the card behind the row is where it gets fixed.
    const connected = credentialSummary(connection) !== "—"
    const harnesses = connection.harnesses?.length ? connection.harnesses : null

    return (
        <button
            type="button"
            onClick={() => onSelect(connection)}
            className="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-6 py-2 text-left hover:bg-muted"
        >
            {providerLogo(connection.kind)}
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-field-md text-colorText">{connection.name}</span>
                <span className="truncate text-field-sm text-colorTextTertiary">
                    {credentialSummary(connection)}
                </span>
            </span>
            {harnesses ? (
                <span className="flex shrink-0 items-center gap-1">
                    {harnesses.map((harness) => (
                        <span
                            key={harness}
                            className="rounded-full bg-colorFillTertiary px-2 py-0.5 text-field-sm text-colorTextSecondary"
                        >
                            {harnessMetaFor(harness).label}
                        </span>
                    ))}
                </span>
            ) : null}
            <span
                aria-hidden
                className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    connected ? "bg-colorSuccess" : "bg-colorWarning",
                )}
            />
        </button>
    )
}

/** One subscription: detected by the runner, or a link to the guide that sets it up. */
const SubscriptionRow = ({
    harness,
    name,
    family,
    mount,
    docsUrl,
}: {
    harness: string
    name: string
    family: string
    mount: string
    docsUrl: string
}) => {
    const query = useAtomValue(useMemo(() => subscriptionStatusQueryAtomFamily(harness), [harness]))
    const status = resolveSubscriptionStatus({
        harness,
        isLoading: query.isLoading,
        isError: query.isError,
        data: query.data,
    })
    const detected = status.tone === "success"

    const body = (
        <>
            {providerLogo(family)}
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-field-md text-colorText">{name}</span>
                <span className="truncate text-field-sm text-colorTextTertiary">
                    {status.message ?? `Set up in your deployment (${mount})`}
                </span>
            </span>
        </>
    )

    if (detected) {
        return <div className="flex w-full items-center gap-3 px-6 py-2">{body}</div>
    }

    // Not detected: the whole row leads to the guide, because there is nothing to configure here.
    return (
        <a
            href={docsUrl}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center gap-3 px-6 py-2 no-underline opacity-70 hover:bg-muted hover:opacity-100"
        >
            {body}
        </a>
    )
}

export interface PlaygroundConnectedSectionProps {
    connections: ProviderConnection[]
    onSelect: (connection: ProviderConnection) => void
}

/** What the project already has. Above the catalog: connected before connectable. */
export const PlaygroundConnectedSection = ({
    connections,
    onSelect,
}: PlaygroundConnectedSectionProps) =>
    connections.length ? (
        <>
            <SectionTitle>Connected</SectionTitle>
            {connections.map((connection) => (
                <ConnectedRow key={connection.id} connection={connection} onSelect={onSelect} />
            ))}
        </>
    ) : null

export interface PlaygroundSubscriptionsSectionProps {
    subscriptionDocsUrl: string
}

/** Below the catalog: nothing here is added from the drawer, so it closes the list. */
export const PlaygroundSubscriptionsSection = ({
    subscriptionDocsUrl,
}: PlaygroundSubscriptionsSectionProps) => (
    <>
        <SectionTitle>Subscriptions</SectionTitle>
        {SUBSCRIPTIONS.map((subscription) => (
            <SubscriptionRow
                key={subscription.harness}
                {...subscription}
                docsUrl={subscriptionDocsUrl}
            />
        ))}
    </>
)
