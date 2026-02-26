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
    const sendgridEnabled = getEnv("NEXT_PUBLIC_AGENTA_SENDGRID_ENABLED")
    return sendgridEnabled === "true"
}

export const isToolsEnabled = () => {
    return getEnv("NEXT_PUBLIC_AGENTA_TOOLS_ENABLED") === "true"
}
