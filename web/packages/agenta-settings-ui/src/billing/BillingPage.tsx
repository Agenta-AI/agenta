/**
 * Usage & Billing — Settings Page
 *
 * What the organization is on, what it has used, and where to change either. Splits in two:
 * with Stripe wired up (`billingEnabled`) it is a subscription page; without it, the same
 * quota report minus the plan card and the portal.
 */

import type {ReactNode} from "react"

import {dayjs} from "@agenta/shared/utils"
import {Button, Spinner} from "@agenta/ui/ui"

import {SettingsRow, SettingsSection} from "../shared/SettingsSection"

import type {BillingSubscription, BillingUsage} from "./types"
import UsageProgressBar from "./UsageProgressBar"

/** Quotas with a section of their own; the Limits grid lists everything else. */
const OWN_SECTION_METRICS = new Set(["users", "applications"])

const CONTACT_URL = "https://cal.com/mahmoud-mabrouk-ogzgey/demo"

/** The padded body of a section card that is not a list of setting rows. */
const CardBody = ({children}: {children: ReactNode}) => (
    <div className="flex flex-col items-start gap-3 px-[18px] py-4">{children}</div>
)

const METRIC_GRID = "grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"

/**
 * The tier out of a plan slug. Slugs are namespaced (`cloud_v0_hobby`) but need not be — a
 * deployment setting `AGENTA_ACCESS_PLANS` can name a plan anything. Taking the last segment
 * reads both; indexing a fixed one rendered an empty name for every unnamespaced slug.
 */
const planName = (plan?: string | null) => (plan ? (plan.split("_").pop() ?? plan) : null)

/** A period boundary the backend actually sent, as a date. Absent on plans that never renew. */
const periodEnd = (subscription?: BillingSubscription | null) => {
    if (!subscription?.period_end) return null
    const end = dayjs.unix(subscription.period_end)
    return end.isValid() ? end : null
}

/** The plan's name, plus how long a free trial has left (or how long ago it ran out). */
const PlanSummary = ({subscription}: {subscription?: BillingSubscription | null}) => {
    const name = planName(subscription?.plan)
    if (!name) return <span className="text-colorTextTertiary">—</span>

    const end = periodEnd(subscription)
    const trialText =
        subscription?.free_trial && end
            ? end.isAfter(dayjs())
                ? `trial ends in ${end.fromNow(true)}`
                : `trial ended ${end.fromNow(true)} ago`
            : ""

    return (
        <>
            {name} <span className="lowercase">{trialText}</span>
        </>
    )
}

export interface BillingPageProps {
    /**
     * Stripe is wired up. Without it there is no plan to change and no portal to open, so the
     * page is a usage report — which is why the tab is called "Usage" there.
     */
    billingEnabled?: boolean
    loading?: boolean
    subscription?: BillingSubscription | null
    usage?: BillingUsage | null
    isOnFreePlan?: boolean
    /** A contact-sales plan: no self-serve switching, so it gets a contact link instead. */
    isCustomPlan?: boolean
    /** Opens the host's pricing dialog. */
    onUpgrade?: () => void
    /** Opens the host's cancel-auto-renewal dialog. */
    onCancelSubscription?: () => void
    /** Sends the owner to Stripe's own portal — the host holds the session. */
    onOpenBillingPortal?: () => void
    openingBillingPortal?: boolean
    onViewMembers?: () => void
    /** The pricing and cancellation dialogs — the host's. */
    children?: ReactNode
}

/**
 * A view only — the subscription, the usage and every verb come from the host, so a surface
 * with no dialogs still reports what the plan is and what it has spent.
 */
export const BillingPage = ({
    billingEnabled = false,
    loading = false,
    subscription,
    usage,
    isOnFreePlan = false,
    isCustomPlan = false,
    onUpgrade,
    onCancelSubscription,
    onOpenBillingPortal,
    openingBillingPortal = false,
    onViewMembers,
    children,
}: BillingPageProps) => {
    if (loading) {
        return (
            <div className="flex w-full items-center justify-center py-24">
                <Spinner />
            </div>
        )
    }

    const limits = Object.entries(usage ?? {}).filter(([key]) => !OWN_SECTION_METRICS.has(key))
    const users = usage?.users

    const upgradeButton = onUpgrade ? (
        <Button size="sm" onClick={onUpgrade}>
            Upgrade plan
        </Button>
    ) : null

    const renewsAt = periodEnd(subscription)
    // A subscription is worth showing even where nothing can be changed about it, so a host
    // that only reads (the mobile app) still names the plan. Billing being on keeps the card
    // up while the subscription is still resolving, so its buttons don't pop in late.
    const showPlanCard = billingEnabled || Boolean(subscription)

    return (
        <div className="flex flex-col gap-8">
            {showPlanCard ? (
                <SettingsSection title="Current plan">
                    <CardBody>
                        <span className="text-base font-semibold capitalize text-colorText">
                            <PlanSummary subscription={subscription} />
                        </span>
                        {/* Only with a real boundary: plans that never renew leave `period_end` unset. */}
                        {!isOnFreePlan && renewsAt ? (
                            <span className="text-colorTextSecondary">
                                {subscription?.free_trial
                                    ? "Trial period will end on "
                                    : "Auto renews on "}
                                <span className="font-medium text-colorText">
                                    {renewsAt.format("MMM D, YYYY")}
                                </span>
                            </span>
                        ) : null}

                        {isCustomPlan ? (
                            <span className="text-colorTextSecondary">
                                For queries regarding your plan,{" "}
                                <a href={CONTACT_URL} target="_blank" rel="noreferrer">
                                    click here to contact us
                                </a>
                            </span>
                        ) : !isOnFreePlan ? (
                            upgradeButton || onCancelSubscription ? (
                                <div className="flex flex-wrap items-center gap-2">
                                    {upgradeButton}
                                    {onCancelSubscription ? (
                                        <Button
                                            variant="link"
                                            size="sm"
                                            onClick={onCancelSubscription}
                                        >
                                            Cancel subscription
                                        </Button>
                                    ) : null}
                                </div>
                            ) : null
                        ) : (
                            upgradeButton
                        )}
                    </CardBody>
                </SettingsSection>
            ) : null}

            <SettingsSection title="Limits">
                <CardBody>
                    <div className={METRIC_GRID}>
                        {limits.map(([key, metric]) =>
                            metric ? (
                                <UsageProgressBar
                                    key={`billing-${key}`}
                                    label={key}
                                    used={metric.value}
                                    limit={metric.limit as number}
                                    strict={metric.strict}
                                    isUnlimited={metric.limit == null}
                                    free={metric.free}
                                    period={metric.period}
                                    scope={metric.scope}
                                />
                            ) : null,
                        )}
                    </div>
                </CardBody>
            </SettingsSection>

            <SettingsSection title="Members">
                <CardBody>
                    <div className={METRIC_GRID}>
                        {/* Free seats only mean something against a paid tier. */}
                        {billingEnabled ? (
                            <UsageProgressBar
                                label="Free"
                                used={users?.value ?? 0}
                                limit={users?.free ?? 0}
                                strict={users?.strict}
                                isUnlimited={users?.limit == null}
                                free={users?.free ?? 0}
                            />
                        ) : null}

                        <UsageProgressBar
                            label="Total"
                            used={users?.value ?? 0}
                            limit={users?.limit as number}
                            strict={users?.strict}
                            isUnlimited={users?.limit == null}
                            free={users?.free ?? 0}
                        />
                    </div>
                    {onViewMembers ? (
                        <Button variant="outline" size="sm" onClick={onViewMembers}>
                            View members
                        </Button>
                    ) : null}
                </CardBody>
            </SettingsSection>

            {billingEnabled && onOpenBillingPortal ? (
                <SettingsSection title="Billing">
                    <SettingsRow
                        title="Payment method, invoices and address"
                        description="Managed in the Stripe billing portal."
                        control={
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={onOpenBillingPortal}
                                disabled={openingBillingPortal}
                            >
                                {openingBillingPortal ? "Opening…" : "Open billing portal"}
                            </Button>
                        }
                    />
                </SettingsSection>
            ) : null}

            {children}
        </div>
    )
}

export default BillingPage
