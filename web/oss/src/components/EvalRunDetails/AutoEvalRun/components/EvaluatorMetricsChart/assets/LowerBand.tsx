import {memo} from "react"

import {Area} from "recharts"

function LowerBand({id, color}: {id: string; color: string}) {
    // Generate gradient strips - more strips = smoother gradient
    const numStrips = 30
    const gradientFalloff = 1.8 // Controls how quickly the gradient fades
    const maxOpacity = 0.5 // Maximum opacity at the main line

    // Parse color if it's in hex format, otherwise use rgba
    const getColorWithOpacity = (opacity: number) => {
        // If color is already rgba, extract RGB values
        // Otherwise assume it's hex and convert
        if (color.startsWith("rgba")) {
            const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
            if (match) {
                return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${opacity})`
            }
        }
        // For hex colors like "#f44336"
        const hex = color.replace("#", "")
        const r = parseInt(hex.substring(0, 2), 16)
        const g = parseInt(hex.substring(2, 4), 16)
        const b = parseInt(hex.substring(4, 6), 16)
        return `rgba(${r}, ${g}, ${b}, ${opacity})`
    }

    return (
        <>
            {/* Baseline at lower boundary */}
            <Area
                type="monotone"
                dataKey={`${id}__lowerBase`}
                stackId={`${id}__lower`}
                stroke="none"
                fill="transparent"
                dot={false}
                activeDot={false}
                connectNulls
                isAnimationActive={false}
                legendType="none"
            />

            {/* Generate gradient strips from boundary to main line */}
            {Array.from({length: numStrips}).map((_, i) => {
                // Calculate opacity: starts transparent at boundary (i=0),
                // increases toward main line (i=numStrips-1)
                const ratio = i / (numStrips - 1)
                const opacity = Math.pow(ratio, gradientFalloff) * maxOpacity

                return (
                    <Area
                        key={`${id}__lowerSeg${i}`}
                        type="monotone"
                        dataKey={`${id}__lowerSeg${i}`}
                        stackId={`${id}__lower`}
                        stroke="none"
                        fill={getColorWithOpacity(opacity)}
                        connectNulls
                        isAnimationActive={false}
                        legendType="none"
                    />
                )
            })}
        </>
    )
}

export default memo(LowerBand)
