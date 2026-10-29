/**
 * Channels — brand marks and a decorative QR placeholder.
 *
 * The brand logos keep their real multi-colour fills (they are recognisable icons, not themed
 * chrome). The Agenta mark and the QR use `currentColor` / theme tokens so they flip with the
 * theme. The QR is a deterministic placeholder — it encodes nothing.
 */

export const SlackLogo = ({size = 20}: {size?: number}) => (
    <svg width={size} height={size} viewBox="0 0 127 127" aria-hidden="true">
        <path
            d="M27.2 80c0 7.3-5.9 13.2-13.2 13.2C6.7 93.2.8 87.3.8 80c0-7.3 5.9-13.2 13.2-13.2h13.2V80zm6.6 0c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2v33c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V80z"
            fill="#E01E5A"
        />
        <path
            d="M47 27c-7.3 0-13.2-5.9-13.2-13.2C33.8 6.5 39.7.6 47 .6c7.3 0 13.2 5.9 13.2 13.2V27H47zm0 6.7c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H13.9C6.6 60.1.7 54.2.7 46.9c0-7.3 5.9-13.2 13.2-13.2H47z"
            fill="#36C5F0"
        />
        <path
            d="M99.9 46.9c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H99.9V46.9zm-6.6 0c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V13.8C66.9 6.5 72.8.6 80.1.6c7.3 0 13.2 5.9 13.2 13.2v33.1z"
            fill="#2EB67D"
        />
        <path
            d="M80.1 99.8c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V99.8h13.2zm0-6.6c-7.3 0-13.2-5.9-13.2-13.2 0-7.3 5.9-13.2 13.2-13.2h33.1c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H80.1z"
            fill="#ECB22E"
        />
    </svg>
)

export const TelegramLogo = ({size = 20}: {size?: number}) => (
    <svg width={size} height={size} viewBox="0 0 240 240" aria-hidden="true">
        <circle cx="120" cy="120" r="120" fill="#2AABEE" />
        <path
            d="M54 118c35-15 58-25 70-30 33-14 40-16 45-16 1 0 3 0 5 2 1 1 1 3 2 4v4c-2 19-10 65-14 86-2 9-5 12-8 12-7 1-12-4-19-9l-27-18c-12-8-4-12 3-19 2-2 33-30 33-33 0 0 0-2-1-2s-2 0-3 0c-1 0-23 14-64 41-6 4-12 6-17 6-5 0-16-3-24-6-10-3-17-5-16-10 0-3 4-6 11-9z"
            fill="#fff"
        />
    </svg>
)

export const platformLogo = (platform: "slack" | "telegram", size = 20) =>
    platform === "slack" ? <SlackLogo size={size} /> : <TelegramLogo size={size} />

export const AgentaMark = ({size = 20}: {size?: number}) => (
    <svg width={size} height={size} viewBox="0 0 171 140" fill="none" aria-hidden="true">
        <path
            fill="currentColor"
            d="M115.504 95.9335C115.221 98.4384 116.607 99.1695 118.671 98.2233C124.787 95.4184 149.253 82.6572 162.347 82.6572C166.663 82.6572 184.04 84.7181 149.838 117.918C121.062 145.85 113.265 139.835 111.236 137.807C105.889 132.459 108.817 117.798 109.715 110.453C110.039 107.807 109.134 106.985 106.571 108.131C83.5096 118.441 40.4169 140 16.5021 140C-29.3433 140 33.8427 64.9164 43.6743 52.9651C76.3083 13.2951 97.3726 0 109.234 0C130.713 0 121.893 39.2078 115.504 95.9335Z"
        />
    </svg>
)

/**
 * A deterministic, decorative QR block. It does NOT encode a real link — the connect flow shows
 * it beside the "Continue in Telegram" button as a visual placeholder until the backend mints a
 * real deep link.
 */
export const QrPlaceholder = () => {
    const cells: React.ReactNode[] = []
    let seed = 7
    const rnd = () => {
        seed = (seed * 9301 + 49297) % 233280
        return seed / 233280
    }
    for (let i = 0; i < 21 * 21; i++) {
        const x = i % 21
        const y = Math.floor(i / 21)
        const inFinder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13)
        let on: boolean
        if (inFinder) {
            const lx = x < 7 ? x : x - 14
            const ly = y < 7 ? y : y - 14
            on =
                lx === 0 ||
                ly === 0 ||
                lx === 6 ||
                ly === 6 ||
                (lx > 1 && lx < 5 && ly > 1 && ly < 5)
        } else {
            on = rnd() > 0.55
        }
        cells.push(
            <span
                key={i}
                style={{background: on ? "currentColor" : "transparent", borderRadius: 1}}
            />,
        )
    }
    return (
        <div
            aria-hidden="true"
            className="text-colorText"
            style={{
                display: "grid",
                gridTemplateColumns: "repeat(21,1fr)",
                gap: 1,
                width: "100%",
                height: "100%",
            }}
        >
            {cells}
        </div>
    )
}
