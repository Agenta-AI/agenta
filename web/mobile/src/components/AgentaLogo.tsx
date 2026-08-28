/**
 * Agenta wordmark.
 *
 * The paths live in @agenta/auth-ui (this app already imports its stylesheet): a bare
 * `<img src="/assets/...">` would miss the `/m` basePath, so the SVG has to be inline, and
 * inlining it in one place keeps the desktop and mobile marks from drifting.
 */
export {AgentaWordmark as AgentaLogo} from "@agenta/auth-ui"
