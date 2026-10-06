import type {TabRunBadge} from "./tabRunBadge"

type Badge = NonNullable<TabRunBadge>

const SIZE = 64
const CENTER = 46
const RADIUS = 17
const GAP = 4

const BADGE_COLOR_TOKEN: Record<Badge, string> = {
    running: "--ag-run-status-processing",
    awaiting: "--ag-run-status-warning",
    completed: "--ag-run-status-success",
    error: "--ag-run-status-error",
}

interface LinkOriginal {
    href: string | null
    type: string | null
}

/** The icon links as the page declared them, held only while a badge replaces them. */
const originals = new Map<HTMLLinkElement, LinkOriginal>()
const drawn = new Map<Badge, Promise<string | null>>()
let wanted: TabRunBadge = null

const iconLinks = () => Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'))

const originalOf = (link: HTMLLinkElement): LinkOriginal =>
    originals.get(link) ?? {href: link.getAttribute("href"), type: link.getAttribute("type")}

const baseIconHref = (): string | null => {
    const links = iconLinks().map(originalOf)
    return (links.find((link) => link.type === "image/svg+xml") ?? links[0])?.href ?? null
}

const restoreAttribute = (link: HTMLLinkElement, name: string, value: string | null) => {
    if (value === null) link.removeAttribute(name)
    else link.setAttribute(name, value)
}

const draw = async (badge: Badge): Promise<string | null> => {
    try {
        const href = baseIconHref()
        const color = getComputedStyle(document.documentElement)
            .getPropertyValue(BADGE_COLOR_TOKEN[badge])
            .trim()
        const canvas = document.createElement("canvas")
        canvas.width = SIZE
        canvas.height = SIZE
        const ctx = canvas.getContext("2d")
        if (!href || !color || !ctx) return null

        const icon = new Image()
        icon.src = href
        await icon.decode()
        const scale = SIZE / Math.max(icon.naturalWidth, icon.naturalHeight)
        const width = icon.naturalWidth * scale
        const height = icon.naturalHeight * scale
        ctx.drawImage(icon, (SIZE - width) / 2, (SIZE - height) / 2, width, height)

        ctx.globalCompositeOperation = "destination-out"
        ctx.beginPath()
        ctx.arc(CENTER, CENTER, RADIUS + GAP, 0, Math.PI * 2)
        ctx.fill()

        ctx.globalCompositeOperation = "source-over"
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(CENTER, CENTER, RADIUS, 0, Math.PI * 2)
        ctx.fill()
        return canvas.toDataURL("image/png")
    } catch {
        return null
    }
}

const apply = (dataUrl: string) => {
    for (const link of iconLinks()) {
        if (!originals.has(link)) originals.set(link, originalOf(link))
        link.setAttribute("type", "image/png")
        link.setAttribute("href", dataUrl)
    }
}

const restore = () => {
    for (const [link, {href, type}] of originals) {
        restoreAttribute(link, "href", href)
        restoreAttribute(link, "type", type)
    }
    originals.clear()
}

/** Swap every icon link to the badged icon, or put the declared icons back for `null`. */
export const showTabRunBadge = (badge: TabRunBadge): void => {
    wanted = badge
    if (!badge) {
        restore()
        return
    }
    let dataUrl = drawn.get(badge)
    if (!dataUrl) {
        dataUrl = draw(badge)
        drawn.set(badge, dataUrl)
    }
    void dataUrl.then((url) => {
        if (!url) drawn.delete(badge)
        else if (wanted === badge) apply(url)
    })
}
