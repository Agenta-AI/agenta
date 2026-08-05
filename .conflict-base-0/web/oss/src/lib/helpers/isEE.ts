import {getEffectiveAuthConfig, getEnv} from "./dynamicEnv"

export const isEE = () => {
    const license = getEnv("NEXT_PUBLIC_AGENTA_LICENSE")?.toLowerCase()

    if (!license) return false

    return license === "ee" || license.startsWith("cloud")
}

export const isEmailAuthEnabled = () => {
    const {authEmailEnabled} = getEffectiveAuthConfig()
    return authEmailEnabled
}

export const isEmailInvitationsEnabled = () => {
    return getEnv("NEXT_PUBLIC_AGENTA_EMAIL_DELIVERY_ENABLED") === "true"
}

export const isToolsEnabled = () => {
    return getEnv("NEXT_PUBLIC_AGENTA_TOOLS_ENABLED") === "true"
}

export const isBillingEnabled = () => {
    return getEnv("NEXT_PUBLIC_AGENTA_BILLING_ENABLED") === "true"
}
