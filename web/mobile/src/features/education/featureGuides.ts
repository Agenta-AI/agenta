/**
 * The feature-guide catalog: one entry per feature the guide dialog can explain.
 *
 * Iteration 1 pulls the demo clips the docs already host on Cloudflare Stream (the
 * changelog entries under `docs/blog/entries/`). Those clips are silent announcement
 * demos, so every guide pairs its video with a written line and the docs link — the
 * video shows the flow, the text explains it.
 */

/** The Stream account the docs embeds use. */
const STREAM_CUSTOMER = "customer-8r37tdgzpxskd9f1"

export interface FeatureGuide {
    /** Dialog heading. */
    title: string
    /** Two or three written lines — the video is silent and cannot carry these. */
    blurb: string
    /** Cloudflare Stream video id, from the docs changelog entry for the feature. */
    streamVideoId: string
    /** Where "Read the guide" goes; also the fallback when Stream is unreachable. */
    docsUrl: string
    /** What a user could type in chat instead of doing it by hand. */
    askAgentExample: string
}

export type FeatureGuideKey = "automations"

export const FEATURE_GUIDES: Record<FeatureGuideKey, FeatureGuide> = {
    automations: {
        title: "How automations work",
        blurb:
            "An automation runs one of your agents without you asking — on a schedule, or when " +
            "something happens in a connected app. Create one here, or just describe it to your " +
            "agent in chat and it sets the automation up for you.",
        // docs/blog/entries/automation-runs.mdx
        streamVideoId: "676408fc495006b18b9854fbafe321a8",
        docsUrl: "https://agenta.ai/docs/changelog/automation-runs",
        askAgentExample: "Create an automation that runs every weekday at 09:00.",
    },
}

/** The iframe src for a guide's clip. Controls on, no autoplay: this is a how-to, not
 * a background demo — the docs' `muted&loop&autoplay` params are deliberately absent. */
export const streamIframeSrc = (guide: FeatureGuide): string =>
    `https://${STREAM_CUSTOMER}.cloudflarestream.com/${guide.streamVideoId}/iframe?preload=metadata`
