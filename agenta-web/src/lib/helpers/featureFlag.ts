export type FEATURE = "API_KEYS"

export const isFeatureEnabled = (feature: FEATURE) => {
    return process.env[`NEXT_PUBLIC_FEATURE_${feature}`] === "true"
}
