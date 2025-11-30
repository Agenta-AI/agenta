// Shared chart utility functions for both histogram and frequency charts

export function getYTicks(yMax: number, nTicks = 3): number[] {
    // Returns evenly spaced ticks from 0 to yMax
    if (yMax === 0) return [0]
    const step = yMax / (nTicks - 1)
    return Array.from(
        {length: nTicks},
        (_, i) => Math.round((i * step + Number.EPSILON) * 1000) / 1000,
    )
}
