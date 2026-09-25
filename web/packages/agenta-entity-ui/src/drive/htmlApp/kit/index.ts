/**
 * Agent HTML apps — design kit (lane E). The host injects `tokensToCss(resolveKitTokens(root))`
 * and then `KIT_CSS` into the app document when the manifest's `kit !== false`.
 */
export {KIT_CSS} from "./kitCss"
export {
    KIT_TOKEN_SOURCES,
    resolveKitScheme,
    resolveKitTokens,
    tokensToCss,
    type KitScheme,
    type KitTokens,
} from "./tokens"
