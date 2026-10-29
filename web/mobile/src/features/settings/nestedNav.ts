import {getEnv} from "@/lib/env"

/**
 * Nested settings rail (a second rail beside the main one). OFF: settings takes over the main
 * sidebar, matching oss/ee — one nav, no in-page top bar.
 */
export const isNestedSettingsNavEnabled = (): boolean =>
    (getEnv("NEXT_PUBLIC_SETTINGS_NESTED_NAV") || "").toLowerCase() === "true"
