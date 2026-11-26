// Prism reads this flag when it first loads. Without it, a Prism that arrives in a lazy chunk runs
// its page-wide highlighter over code blocks it does not own, and rewrites the chat's fences.
const scope = globalThis as {Prism?: {manual?: boolean}}
scope.Prism = {...scope.Prism, manual: true}

export {}
