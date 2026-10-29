/**
 * The integration's brand mark, at whatever size the surface needs — the connect dock's stack
 * cards and the transcript's inline connect rows both identify a connection by this tile.
 *
 * A plain `<img>` rather than `next/image`: the tile renders from @agenta/chat too, and the logo
 * is a remote catalog URL at an unknown host, so there is nothing for the optimizer to do. The
 * initials fallback covers both "catalog still loading" and "toolkit has no logo", so the tile
 * never changes size when the lookup lands.
 */
import {useState} from "react"

/** `GitHub` → `GH`, `Google Calendar` → `GC`, `telegram` → `TE`. */
const initialsOf = (label: string): string => {
    const words = label.trim().split(/\s+/).filter(Boolean)
    if (words.length > 1)
        return words
            .slice(0, 2)
            .map((w) => w[0].toUpperCase())
            .join("")
    const word = words[0] ?? ""
    const capitals = word.match(/[A-Z]/g)
    if (capitals && capitals.length > 1) return capitals.slice(0, 2).join("")
    return word.slice(0, 2).toUpperCase()
}

export interface IntegrationTileProps {
    /** Readable integration name — the initials fallback and the alt text come from it. */
    label: string
    /** Catalog logo URL; falls back to initials when absent or broken. */
    logo?: string | null
    /** Edge length in px. The radius and type scale follow it. */
    size?: number
    className?: string
}

export const IntegrationTile = ({label, logo, size = 20, className = ""}: IntegrationTileProps) => {
    const [broken, setBroken] = useState(false)
    const showLogo = !!logo && !broken

    return (
        <span
            className={`inline-flex shrink-0 items-center justify-center overflow-hidden font-semibold ${
                // Brand marks are drawn for a light ground — GitHub's is a black glyph, invisible on
                // a themed dark fill. Logos get a fixed light plate; initials follow the theme.
                showLogo
                    ? "bg-white p-px ring-1 ring-inset ring-colorBorderSecondary"
                    : "bg-colorFillTertiary text-colorTextSecondary"
            } ${className}`}
            style={{
                width: size,
                height: size,
                borderRadius: Math.max(4, Math.round(size / 4)),
                fontSize: size <= 16 ? 8 : size <= 22 ? 9 : 11,
            }}
            aria-hidden
        >
            {showLogo ? (
                <img
                    src={logo}
                    alt=""
                    className="size-full object-contain"
                    onError={() => setBroken(true)}
                />
            ) : (
                initialsOf(label)
            )}
        </span>
    )
}

export default IntegrationTile
