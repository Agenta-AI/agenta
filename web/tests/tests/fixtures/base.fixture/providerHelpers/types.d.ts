export type TestProviderMode = "mock" | "openai"

export interface EnsureTestProviderOptions {
    recreate?: boolean
}

export interface TestProviderProfileInfo {
    mode: TestProviderMode
    providerName: string
    modelName: string
}

export interface TestProviderHelpers {
    ensureTestProvider(options?: EnsureTestProviderOptions): Promise<void>
    selectTestModel(): Promise<void>
    getActiveProfile(): TestProviderProfileInfo
}
