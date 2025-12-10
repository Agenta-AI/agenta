import {getEnv} from "./dynamicEnv"

export const isEE = () => {
    const license = getEnv("NEXT_PUBLIC_AGENTA_LICENSE")?.toLowerCase()

    if (!license) return false

    return license === "ee" || license.startsWith("cloud")
}

export const isEmailAuthEnabled = () => {
    const authnEmail = getEnv("NEXT_PUBLIC_AGENTA_AUTHN_EMAIL") || "password"
    return authnEmail === "password" || authnEmail === "otp"
}

export const isEmailInvitationsEnabled = () => {
    const sendgridEnabled = getEnv("NEXT_PUBLIC_AGENTA_SENDGRID_ENABLED")
    return sendgridEnabled === "true"
}
