import {getEnv} from "./dynamicEnv"

export const isEE = () => {
    if (getEnv("NEXT_PUBLIC_AGENTA_LICENSE")) {
        return ["cloud", "ee", "cloud-dev"].includes(getEnv("NEXT_PUBLIC_AGENTA_LICENSE"))
    }
}
