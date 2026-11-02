/**
 * The app-injected seam. Env access and API-host resolution differ per app (mobile resolves
 * env at runtime, desktop inlines NEXT_PUBLIC_* at build), so the package never reads either
 * directly — the app hands both in once at bootstrap.
 */
export type EnvReader = (key: string) => string

export interface AuthRuntime {
    getEnv: EnvReader
    /** Base API url, WITHOUT the /api/auth suffix — the package appends its own basePath. */
    getApiUrl: () => string
}

let runtime: AuthRuntime | null = null

export function configureAuth(config: AuthRuntime): void {
    runtime = config
}

const unconfigured = (): never => {
    throw new Error("@agenta/auth is unconfigured — call configureAuth() at app bootstrap.")
}

export const authEnv: EnvReader = (key) => (runtime ?? unconfigured()).getEnv(key)

export const authApiUrl = (): string => (runtime ?? unconfigured()).getApiUrl()
