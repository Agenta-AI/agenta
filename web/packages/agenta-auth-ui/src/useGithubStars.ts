/** The repo's live star count for the sign-in badge, cached so a shared network stays under GitHub's rate limit. */
import {useEffect, useState} from "react"

export const REPO = "Agenta-AI/agenta"
/** The last known count, shown until the live one arrives or when GitHub is unreachable. */
const FALLBACK_STARS = 4900

/** 4906 -> "4.9K", 950 -> "950", as the website's hero badge shows it. */
const formatStars = (n: number) =>
    n < 1000 ? String(n) : `${(Math.floor(n / 100) / 10).toFixed(1)}K`

const STARS_CACHE_KEY = "agenta:github-stars"
/** GitHub allows 60 unauthenticated calls an hour per IP; a shared office would burn that fast. */
const STARS_TTL_MS = 6 * 60 * 60 * 1000

const readCachedStars = (): number | null => {
    try {
        const cached = JSON.parse(localStorage.getItem(STARS_CACHE_KEY) ?? "null") as {
            count?: unknown
            at?: unknown
        } | null
        if (typeof cached?.count !== "number" || typeof cached.at !== "number") return null
        return Date.now() - cached.at < STARS_TTL_MS ? cached.count : null
    } catch {
        return null
    }
}

const writeCachedStars = (count: number) => {
    try {
        localStorage.setItem(STARS_CACHE_KEY, JSON.stringify({count, at: Date.now()}))
    } catch {
        // Storage can be full or blocked; the next load just asks GitHub again.
    }
}

let starsRequest: Promise<number | null> | undefined

/** One request per page load, shared by every mount; the sign-in steps remount the shell. */
const fetchStars = () =>
    (starsRequest ??= Promise.resolve(readCachedStars()).then(
        (cached) =>
            cached ??
            fetch(`https://api.github.com/repos/${REPO}`)
                .then((res) => (res.ok ? res.json() : null))
                .then((data: {stargazers_count?: unknown} | null) => {
                    const count = data?.stargazers_count
                    if (typeof count !== "number") return null
                    writeCachedStars(count)
                    return count
                })
                .catch(() => null),
    ))

/** The live star count, fetched only while the panel is on screen. */
export const useGithubStars = (enabled: boolean) => {
    const [stars, setStars] = useState(FALLBACK_STARS)
    useEffect(() => {
        if (!enabled) return
        let live = true
        fetchStars().then((count) => {
            if (live && count !== null) setStars(count)
        })
        return () => {
            live = false
        }
    }, [enabled])
    return formatStars(stars)
}
