import {canonicalizeMetricKey, getMetricDisplayName} from "@/oss/lib/metricUtils"

export const formatMetricName = (name: string) => {
    const canonical = canonicalizeMetricKey(name)

    // Prefer rich labels for well-known invocation metrics
    if (canonical.startsWith("attributes.ag.metrics.")) {
        return getMetricDisplayName(canonical)
    }

    if (canonical.startsWith("attributes.ag.")) {
        const tail = canonical.split(".").pop() ?? canonical
        return tail
            .replace(/[_.-]/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .replace(/\b\w/g, (c) => c.toUpperCase())
    }

    const formattedName = canonical
        .replace(/[_.]/g, " ")
        .replace(/([A-Z])/g, " $1")
        .trim()
        .toLocaleLowerCase()

    if (formattedName === "duration") return "Latency"
    if (formattedName.includes("cost")) return "Cost"
    return formattedName
}

export const EVAL_TAG_COLOR = {
    1: "blue",
    2: "orange",
    3: "purple",
    4: "cyan",
    5: "lime",
}
export const EVAL_BG_COLOR = {
    1: "rgba(230, 244, 255, 0.5)",
    2: "rgba(255, 242, 232, 0.5)",
    3: "rgba(249, 240, 255, 0.5)",
    4: "rgba(230, 255, 251, 0.5)",
    5: "rgba(255, 255, 230, 0.5)",
}

export const EVAL_COLOR = {
    1: "rgba(145, 202, 255, 1)",
    2: "rgba(255, 187, 150, 1)",
    3: "rgba(211, 173, 247, 1)",
    4: "rgba(135, 232, 222, 1)",
    5: "rgba(200, 240, 150, 1)",
}
