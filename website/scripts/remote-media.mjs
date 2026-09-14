const MEDIA_TAG = /<(?:img|video|source)\b[^>]*>/gi;
const MEDIA_ATTRIBUTE =
  /\b(src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*["']([^"']*)["']\s*\}|([^\s>]+))/gi;

const isRemote = (url) => /^https?:\/\//i.test(url);

/** Return every third-party URL used by an img, video, or source element. */
export function remoteMediaUrls(document) {
  const urls = [];

  for (const tag of document.match(MEDIA_TAG) ?? []) {
    for (const match of tag.matchAll(MEDIA_ATTRIBUTE)) {
      const [, name, ...values] = match;
      const value = values.find((candidate) => candidate !== undefined) ?? "";
      const candidates =
        name.toLowerCase() === "srcset"
          ? value
              .split(",")
              .map((candidate) => candidate.trim().split(/\s+/)[0])
          : [value.trim()];

      for (const candidate of candidates) {
        if (isRemote(candidate)) urls.push(candidate);
      }
    }
  }

  return urls;
}
