export const PERCENTILE_STOPS = [
    0.05, 0.1, 0.5, 1, 2.5, 5, 10, 12.5, 20, 25, 30, 37.5, 40, 50, 60, 62.5, 70, 75, 80, 87.5, 90,
    95, 97.5, 99, 99.5, 99.9, 99.95,
]

// Inter-quartile ranges aligned with backend mapping
export const iqrsLevels: Record<string, [string, string]> = {
    iqr25: ["p37.5", "p62.5"],
    iqr50: ["p25", "p75"],
    iqr60: ["p20", "p80"],
    iqr75: ["p12.5", "p87.5"],
    iqr80: ["p10", "p90"],
    iqr90: ["p5", "p95"],
    iqr95: ["p2.5", "p97.5"],
    iqr98: ["p1", "p99"],
    iqr99: ["p0.5", "p99.5"],
    "iqr99.9": ["p0.05", "p99.95"],
}
