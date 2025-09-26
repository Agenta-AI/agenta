import {getEnv} from "./dynamicEnv"

export const isEE = () => {
    const license = getEnv("NEXT_PUBLIC_AGENTA_LICENSE")?.toLowerCase()

    if (!license) return false

    return license === "ee" || license.startsWith("cloud")
}
