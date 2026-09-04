import {getEffectiveAuthConfig} from "./dynamicEnv"

/**
 * Edition and feature gates now live in `@agenta/shared/api` so /m reads the same ones.
 * Only this stays: it depends on the app's resolved auth config, not on a bare env read.
 */
export const isEmailAuthEnabled = () => {
    const {authEmailEnabled} = getEffectiveAuthConfig()
    return authEmailEnabled
}
