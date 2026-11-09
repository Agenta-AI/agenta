import {formatDate} from "../wallet/walletFormat"

import type {InstanceLicense} from "./licenseApi"

const PLAN_NAMES: Record<string, string> = {
    self_hosted_community: "Community",
    self_hosted_registered: "Registered",
    self_hosted_enterprise: "Enterprise",
}

const planName = (slug: string) => PLAN_NAMES[slug] ?? slug

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
    const expired = Boolean(key?.expires_at && new Date(key.expires_at) <= new Date())

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
        </section>
    )
}
