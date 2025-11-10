import {memo} from "react"

import {Area} from "recharts"

function UpperBand({id, color}: {id: string; color: string}) {
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
        // For hex colors like "#2196f3"
        const hex = color.replace("#", "")
        const r = parseInt(hex.substring(0, 2), 16)
        const g = parseInt(hex.substring(2, 4), 16)
        const b = parseInt(hex.substring(4, 6), 16)
        return `rgba(${r}, ${g}, ${b}, ${opacity})`
    }

    return (
        <>
            {/* Baseline at main line */}
            <Area
                type="monotone"
                dataKey={`${id}__upperBase`}
                stackId={`${id}__upper`}
                stroke="none"
                fill="transparent"
                dot={false}
                activeDot={false}
                connectNulls
                isAnimationActive={false}
                legendType="none"
            />

            {/* Generate gradient strips from main line to boundary */}
            {Array.from({length: numStrips}).map((_, i) => {
                // Calculate opacity: starts strong at main line (i=0),
                // fades toward boundary (i=numStrips-1)
                const ratio = i / (numStrips - 1)
                const opacity = Math.pow(1 - ratio, gradientFalloff) * maxOpacity

                return (
                    <Area
                        key={`${id}__upperSeg${i}`}
                        type="monotone"
                        dataKey={`${id}__upperSeg${i}`}
                        stackId={`${id}__upper`}
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

export default memo(UpperBand)
