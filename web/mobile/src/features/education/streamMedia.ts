import type {GuideVideo} from "./featureGuides"

/** The Cloudflare Stream account the docs embeds use. */
const STREAM_HOST = "https://customer-8r37tdgzpxskd9f1.cloudflarestream.com"

/** A still from a clip, shown before any player loads. */
export const streamThumbnailUrl = (videoId: string, atSeconds = 0): string =>
    `${STREAM_HOST}/${videoId}/thumbnails/thumbnail.jpg?time=${atSeconds}s&height=720`

/** Autoplays: it only mounts after a click, which lets the browser start it with sound. */
export const streamPlayerUrl = (videoId: string): string =>
    `${STREAM_HOST}/${videoId}/iframe?autoplay=true&startTime=0s`

/** A guide's still: YouTube's own poster, or a Stream frame at `stillSeconds`. */
export const guideThumbnailUrl = (video: GuideVideo): string =>
    video.source === "youtube"
        ? `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`
        : streamThumbnailUrl(video.id, video.stillSeconds)

/** A guide's autoplaying player, on YouTube's no-cookie host for YouTube clips. */
export const guidePlayerUrl = (video: GuideVideo): string =>
    video.source === "youtube"
        ? `https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0`
        : streamPlayerUrl(video.id)
