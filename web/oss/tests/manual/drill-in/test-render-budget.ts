import {
    getRenderStats,
    getPreviewItems,
    shouldUsePreview,
    truncateText,
} from "../../../src/components/DrillInView/renderBudget"

function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(message)
    }
}

const longText = "x".repeat(10_000)
const longStats = getRenderStats(longText)

assert(longStats.type === "string", "long text should be detected as a string")
assert(shouldUsePreview(longStats, "beautified-json"), "long text should use preview")
assert(truncateText(longText, 100).text.length <= 101, "truncated text should stay bounded")
assert(truncateText(longText, 100).isTruncated, "long text should be marked truncated")

const manyItems = Array.from({length: 100}, (_, index) => ({index}))
const itemPreview = getPreviewItems(manyItems)

assert(itemPreview.items.length < manyItems.length, "large arrays should render a bounded subset")
assert(itemPreview.hiddenCount > 0, "large arrays should report hidden items")

const manyKeys = Object.fromEntries(
    Array.from({length: 100}, (_, index) => [`key_${index}`, index]),
)
const keyPreview = getPreviewItems(manyKeys)

assert(
    keyPreview.items.length < Object.keys(manyKeys).length,
    "large objects should render a bounded subset",
)
assert(keyPreview.hiddenCount > 0, "large objects should report hidden keys")
