import type {BaseFixture} from "@agenta/web-tests/tests/fixtures/base.fixture/types"

export interface CreateAppResponse {
    app_id: string
    app_name: string
    created_at: string
}

export enum AppType {
    COMPLETION_PROMPT = "Completion Prompt",
    CHAT_PROMPT = "Chat Prompt",
}

export interface AppActions {
    navigateToApps: () => Promise<void>
    createNewApp: (appName: string, appType: AppType) => Promise<CreateAppResponse>
    verifyAppCreation: (appName: string) => Promise<void>
}

export interface AppFixtures extends BaseFixture {
    navigateToApps: AppActions["navigateToApps"]
    createNewApp: AppActions["createNewApp"]
    verifyAppCreation: AppActions["verifyAppCreation"]
}
