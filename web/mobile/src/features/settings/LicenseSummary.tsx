import {formatDate} from "../wallet/walletFormat"

import type {InstanceLicense} from "./licenseApi"

const PLAN_NAMES: Record<string, string> = {
    self_hosted_community: "Community",
    self_hosted_registered: "Registered",
    self_hosted_enterprise: "Enterprise",
}

const planName = (slug: string) => PLAN_NAMES[slug] ?? slug

const EXPIRY_NOTICE_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

const Row = ({label, value}: {label: string; value: string}) => (
    <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground truncate text-right">{value}</span>
    </div>
)

/** The instance plan, and the key behind it: customer, seats, expiry. */
export const LicenseSummary = ({license}: {license: InstanceLicense}) => {
    const key = license.license
    const users = license.usage.users
    const expiresAt = key?.expires_at ? new Date(key.expires_at).getTime() : null
    const now = Date.now()
    const expired = expiresAt !== null && expiresAt <= now
    const expiresSoon =
        expiresAt !== null && !expired && expiresAt - now <= EXPIRY_NOTICE_DAYS * DAY_MS
    const overSeats = !expired && key?.seats != null && users > key.seats

    return (
        <section className="bg-card ring-border flex flex-col gap-2.5 rounded-2xl px-5 py-[18px] ring-1 ring-inset">
            <span className="text-muted-foreground text-[13px]">Plan</span>
            <span className="text-[26px] font-semibold leading-8 tracking-[-0.02em]">
                {planName(license.plan)}
            </span>
            {key ? (
                <div className="flex flex-col gap-1.5 pt-1">
                    <Row label="Licensed to" value={key.customer} />
                    <Row
                        label="Seats"
                        value={
                            key.seats === null ? `${users} used` : `${users} of ${key.seats} used`
                        }
                    />
                    <Row
                        label={expired ? "Expired" : "Expires"}
                        value={key.expires_at ? formatDate(key.expires_at) : "Never"}
                    />
                </div>
            ) : (
                <Row label="Users" value={String(users)} />
            )}
            {key && expiresSoon ? (
                <p className="text-warning m-0 pt-1 text-[13px]">
                    This license expires on {formatDate(key.expires_at as string)}.
                </p>
            ) : null}
            {key && overSeats ? (
                <p className="text-warning m-0 pt-1 text-[13px]">
                    This instance has {users} users, more than the {key.seats} seats of the license.
                </p>
            ) : null}
        </section>
    )
}
