export const formatMetricName = (name: string) => {
    const formattedName = name
        .replace(/([A-Z])/g, " $1")
        .trim()
        .toLocaleLowerCase()

    if (formattedName === "duration") return "Latency"
    if (formattedName.includes("cost")) return "Cost"
    return formattedName
}
