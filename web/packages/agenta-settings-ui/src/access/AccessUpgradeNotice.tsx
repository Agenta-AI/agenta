import type {ReactNode} from "react"

import {UpgradeNotice} from "./UpgradeNotice"

/** The three separately-sold halves of Access & Security. */
export type AccessFeature = "access" | "domains" | "sso"

const FEATURES: Record<AccessFeature, {name: string; blurb: string}> = {
    access: {
        name: "Access Controls",
        blurb: "control how members sign in and who can join this organization",
    },
    domains: {
        name: "Verified Domains",
        blurb: "verify the domains your organization owns and use them for access rules and auto-join",
    },
    sso: {
        name: "SSO Providers",
        blurb: "connect an OIDC identity provider so members sign in through single sign-on",
    },
}

const ORDER: AccessFeature[] = ["access", "domains", "sso"]

/** "a", "a and b", "a, b and c" — the last separator is "and", not a comma. */
const list = (parts: string[]) =>
    parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`

const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

export interface AccessUpgradeNoticeProps {
    /** Which features the plan does not include. Renders nothing when empty. */
    locked: AccessFeature[]
    /** The upgrade link — routing and billing availability are the host's to decide. */
    action?: ReactNode
}

/**
 * ONE locked panel for however many Access & Security features the plan excludes.
 *
 * Three identical lock cards stacked down the page said nothing three times; a plan that
 * includes none of this has one thing to say, so it says it once and names what is missing.
 */
export const AccessUpgradeNotice = ({locked, action}: AccessUpgradeNoticeProps) => {
    if (locked.length === 0) return null

    const present = ORDER.filter((feature) => locked.includes(feature))
    const isEverything = present.length === ORDER.length

    return (
        <UpgradeNotice
            title={
                isEverything
                    ? "Access & Security is not available on your plan"
                    : `${list(present.map((feature) => FEATURES[feature].name))} ${present.length > 1 ? "are" : "is"} not available on your plan`
            }
            description={`${sentenceCase(list(present.map((feature) => FEATURES[feature].blurb)))}.`}
            action={action}
        />
    )
}

export default AccessUpgradeNotice
