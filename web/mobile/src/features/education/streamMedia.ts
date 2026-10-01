/** The Cloudflare Stream account the docs embeds use. */
const STREAM_HOST = "https://customer-8r37tdgzpxskd9f1.cloudflarestream.com"

/** A still from a clip, shown before any player loads. */
export const streamThumbnailUrl = (videoId: string, atSeconds = 0): string =>
    `${STREAM_HOST}/${videoId}/thumbnails/thumbnail.jpg?time=${atSeconds}s&height=720`

/** Autoplays: it only mounts after a click, which lets the browser start it with sound. */
export const streamPlayerUrl = (videoId: string): string =>
    `${STREAM_HOST}/${videoId}/iframe?autoplay=true&startTime=0s`
