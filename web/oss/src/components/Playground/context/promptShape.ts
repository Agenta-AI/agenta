export function getPromptById(prompts: any[], id: string) {
    const list = Array.isArray(prompts) ? prompts : []
    return list.find((p: any) => p?.__id === id) || list.find((p: any) => p?.__name === id) || null
}

export function getArrayVal(v: any): any[] {
    if (!v) return []
    const val = (v as any)?.value ?? v
    return Array.isArray(val) ? val : []
}

export function getScalarVal<T = any>(v: any, fallback: T | null = "" as any): T | any {
    if (v == null) return fallback
    const val = (v as any)?.value ?? v
    return val ?? fallback
}

export function getLLMConfig(prompt: any): any {
    return prompt?.llmConfig ?? prompt?.llm_config ?? {}
}
