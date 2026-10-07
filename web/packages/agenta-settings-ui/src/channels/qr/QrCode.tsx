import {useMemo} from "react"

import {encodeQr, type QrEcc} from "./encode"

/** Quiet zone around the symbol, in modules. The spec asks for at least 4. */
const QUIET_ZONE = 4

export interface QrCodeProps {
    /** The text to encode, for example a Telegram deep link. */
    value: string
    /** Rendered width and height in pixels. */
    size?: number
    className?: string
    /** Accessible name of the image. */
    label?: string
    /** Error correction level. */
    ecc?: QrEcc
}

/**
 * A QR code drawn as one inline SVG path.
 *
 * The dark modules use `fill="currentColor"`, so the host controls the colour with CSS.
 * The background stays transparent.
 */
export const QrCode = ({value, size = 180, className, label, ecc = "M"}: QrCodeProps) => {
    const {side, path} = useMemo(() => {
        const matrix = encodeQr(value, ecc)
        const parts: string[] = []
        for (let y = 0; y < matrix.size; y++) {
            for (let x = 0; x < matrix.size; x++) {
                if (matrix.modules[y][x]) {
                    parts.push(`M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`)
                }
            }
        }
        return {side: matrix.size + QUIET_ZONE * 2, path: parts.join("")}
    }, [value, ecc])

    return (
        <svg
            className={className}
            width={size}
            height={size}
            viewBox={`0 0 ${side} ${side}`}
            shapeRendering="crispEdges"
            role="img"
            aria-label={label ?? "QR code"}
        >
            <path d={path} fill="currentColor" />
        </svg>
    )
}

export default QrCode
