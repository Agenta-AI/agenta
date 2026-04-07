import type {BaseFixture} from "@agenta/web-tests/tests/fixtures/base.fixture/types"

export interface CreateAppResponse {
    count: number
    workflow: {
        id: string
        name: string
        created_at: string
    }
}

export enum AppType {
    COMPLETION_PROMPT = "agenta:builtin:completion:v0",
    CHAT_PROMPT = "agenta:builtin:chat:v0",
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
