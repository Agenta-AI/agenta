import {existsSync, readFileSync} from "fs"

import {expect, Locator, Page} from "@playwright/test"

import {getProjectMetadataPath} from "../../../../playwright/config/runtime.ts"
import {UseFn} from "../../types"
import {FixtureContext} from "../types"
import type {UIHelpers} from "../uiHelpers/types"

import type {
    EnsureTestProviderOptions,
    TestProviderHelpers,
    TestProviderMode,
    TestProviderProfileInfo,
} from "./types"

const MOCK_PROVIDER_NAME = "mock"
const MOCK_PROVIDER_KIND = "custom"
const MOCK_MODEL_NAME = "gpt-6"
const MOCK_API_KEY = "mock"
const MOCK_API_BASE_URL = "https://mockgpt.wiremockapi.cloud/v1"

interface VaultSecretRecord {
    id: string
    kind: string
    header?: {
        name?: string
    }
    data?: {
        kind?: string
        provider?: {
            url?: string
            extras?: {
                api_key?: string
            }
        }
        models?: {
            slug?: string
        }[]
    }
}

interface ProviderProfile {
    info: TestProviderProfileInfo
    ensure: (page: Page, uiHelpers: UIHelpers, options?: EnsureTestProviderOptions) => Promise<void>
    selectModel: (page: Page) => Promise<void>
}

interface TestProjectMetadata {
    project_id?: string
    workspace_id?: string
}

function getActiveProviderMode(): TestProviderMode {
    const mode = (process.env.AGENTA_TEST_LLM_PROVIDER || "mock").toLowerCase()

    if (mode === "mock" || mode === "openai") {
        return mode
    }

    throw new Error(
        `Unsupported AGENTA_TEST_LLM_PROVIDER='${mode}'. Supported values are 'mock' and 'openai'.`,
    )
}

function getApiURL(page: Page): string {
    if (process.env.AGENTA_API_URL) {
        return process.env.AGENTA_API_URL
    }

    const currentUrl = page.url() || process.env.AGENTA_WEB_URL || "http://localhost:3000"
    const parsed = new URL(currentUrl)
    return `${parsed.origin}/api`
}

function getProjectId(page: Page): string | null {
    const currentUrl = page.url()
    if (!currentUrl) {
        return null
    }

    const pathname = new URL(currentUrl).pathname
    const match = pathname.match(/\/p\/([^/]+)/)
    return match?.[1] ?? null
}

function getProjectScopedBasePath(page: Page): string | null {
    const currentUrl = page.url()

    if (currentUrl) {
        const pathname = new URL(currentUrl).pathname
        const match = pathname.match(/(\/w\/[^/]+\/p\/[^/]+)/)
        if (match?.[1]) {
            return match[1]
        }
    }

    const configuredUrl = process.env.AGENTA_WEB_URL
    if (configuredUrl) {
        const pathname = new URL(configuredUrl).pathname
        const match = pathname.match(/(\/w\/[^/]+\/p\/[^/]+)/)
        if (match?.[1]) {
            return match[1]
        }
    }

    const testProject = readTestProjectMetadata()
    if (testProject?.workspace_id && testProject?.project_id) {
        return `/w/${testProject.workspace_id}/p/${testProject.project_id}`
    }

    return null
}

function readTestProjectMetadata(): TestProjectMetadata | null {
    const metadataPath = getProjectMetadataPath()

    if (!existsSync(metadataPath)) {
        return null
    }

    try {
        return JSON.parse(readFileSync(metadataPath, "utf8")) as TestProjectMetadata
    } catch {
        return null
    }
}

async function waitForModelsPageReady(page: Page): Promise<void> {
    const customProvidersSection = getCustomProvidersSection(page)

    await page.waitForLoadState("networkidle", {timeout: 10000}).catch(() => {})

    await expect
        .poll(
            async () => {
                const pathname = new URL(page.url()).pathname
                const hasScopedSettingsPath = /\/w\/[^/]+\/p\/[^/]+\/settings$/.test(pathname)
                const headingVisible = await page
                    .getByRole("heading", {name: "Models"})
                    .isVisible()
                    .catch(() => false)
                const sectionVisible = await customProvidersSection.isVisible().catch(() => false)
                const hasVisibleSpinner = await customProvidersSection
                    .locator(".ant-spin-spinning")
                    .isVisible()
                    .catch(() => false)
                const createButtonEnabled = await customProvidersSection
                    .getByRole("button", {name: "Create"})
                    .isEnabled()
                    .catch(() => false)

                return (
                    hasScopedSettingsPath &&
                    headingVisible &&
                    sectionVisible &&
                    !hasVisibleSpinner &&
                    createButtonEnabled
                )
            },
            {
                timeout: 15000,
                message: "Models page never reached a stable ready state",
            },
        )
        .toBe(true)
}

async function navigateToModels(page: Page, uiHelpers: UIHelpers): Promise<void> {
    if (!getProjectScopedBasePath(page)) {
        await page.goto("/apps", {waitUntil: "domcontentloaded"})
        await uiHelpers.expectPath("/apps")
    }

    const projectBasePath = getProjectScopedBasePath(page)

    if (!projectBasePath) {
        throw new Error(`Could not derive project scoped path from current URL: ${page.url()}`)
    }

    await page.goto(`${projectBasePath}/settings?tab=secrets`, {waitUntil: "domcontentloaded"})

    await uiHelpers.expectPath("/settings")
    await expect(page.getByRole("heading", {name: "Models"})).toBeVisible({
        timeout: 15000,
    })
    await expect(getCustomProvidersSection(page)).toBeVisible({timeout: 15000})
    await waitForModelsPageReady(page)
}

function getCustomProvidersSection(page: Page): Locator {
    return page
        .getByText("Custom providers", {exact: true})
        .locator("xpath=ancestor::section[1]")
        .first()
}

async function getCustomProviderRow(page: Page, providerName: string): Promise<Locator | null> {
    const customProvidersSection = getCustomProvidersSection(page)
    const table = customProvidersSection.getByRole("table").first()

    const row = table
        .getByRole("row")
        .filter({has: page.getByRole("cell", {name: providerName, exact: true})})
        .first()

    return (await row.count()) > 0 ? row : null
}

async function fetchVaultSecrets(page: Page): Promise<VaultSecretRecord[]> {
    const projectId = getProjectId(page)
    const secretsUrl = new URL(`${getApiURL(page)}/secrets/`)

    if (projectId) {
        secretsUrl.searchParams.set("project_id", projectId)
    }

    const response = await page.request.get(secretsUrl.toString())
    expect(response.ok()).toBe(true)
    return (await response.json()) as VaultSecretRecord[]
}

async function fetchMockProviderSecret(page: Page): Promise<VaultSecretRecord | null> {
    const secrets = await fetchVaultSecrets(page)

    return (
        secrets.find(
            (secret) =>
                secret.kind === "custom_provider" && secret.header?.name === MOCK_PROVIDER_NAME,
        ) || null
    )
}

async function fetchMockProviderSecrets(page: Page): Promise<VaultSecretRecord[]> {
    const secrets = await fetchVaultSecrets(page)

    return secrets.filter(
        (secret) => secret.kind === "custom_provider" && secret.header?.name === MOCK_PROVIDER_NAME,
    )
}

function assertMockProviderSecret(secret: VaultSecretRecord): void {
    expect(secret.header?.name).toBe(MOCK_PROVIDER_NAME)
    expect(secret.data?.kind).toBe(MOCK_PROVIDER_KIND)
    expect(secret.data?.provider?.url).toBe(MOCK_API_BASE_URL)
    expect(secret.data?.provider?.extras?.api_key).toBe(MOCK_API_KEY)
    expect(secret.data?.models?.some((model) => model.slug === MOCK_MODEL_NAME)).toBe(true)
}

async function createMockProvider(page: Page, uiHelpers: UIHelpers): Promise<void> {
    const projectId = getProjectId(page)
    const secretsUrl = new URL(`${getApiURL(page)}/secrets/`)

    if (projectId) {
        secretsUrl.searchParams.set("project_id", projectId)
    }

    const response = await page.request.post(secretsUrl.toString(), {
        data: {
            header: {
                name: MOCK_PROVIDER_NAME,
                description: MOCK_PROVIDER_NAME,
            },
            secret: {
                kind: "custom_provider",
                data: {
                    kind: MOCK_PROVIDER_KIND,
                    provider: {
                        url: MOCK_API_BASE_URL,
                        extras: {
                            api_key: MOCK_API_KEY,
                        },
                    },
                    models: [{slug: MOCK_MODEL_NAME}],
                },
            },
        },
    })

    expect(response.ok()).toBe(true)

    await expect
        .poll(async () => {
            return await fetchMockProviderSecret(page)
        })
        .not.toBeNull()

    const providerSecret = await fetchMockProviderSecret(page)
    if (providerSecret) {
        assertMockProviderSecret(providerSecret)
    }

    await navigateToModels(page, uiHelpers)
    await page.reload({waitUntil: "domcontentloaded"})
    await waitForModelsPageReady(page)

    const providerNameCell = getCustomProvidersSection(page).getByRole("cell", {
        name: MOCK_PROVIDER_NAME,
        exact: true,
    })

    const providerVisible = await providerNameCell.isVisible({timeout: 5000}).catch(() => false)
    if (providerVisible) {
        await expect(providerNameCell).toBeVisible({timeout: 15000})
    }
}

async function deleteMockProviderSecrets(page: Page): Promise<void> {
    const projectId = getProjectId(page)
    const secrets = await fetchMockProviderSecrets(page)

    for (const secret of secrets) {
        const deleteUrl = new URL(`${getApiURL(page)}/secrets/${secret.id}`)
        if (projectId) {
            deleteUrl.searchParams.set("project_id", projectId)
        }

        const response = await page.request.delete(deleteUrl.toString())
        expect(response.ok()).toBe(true)
    }
}

async function waitForMockProviderSecretDeletion(page: Page): Promise<void> {
    await expect
        .poll(
            async () => {
                return (await fetchMockProviderSecrets(page)).length
            },
            {timeout: 30000},
        )
        .toBe(0)
}

async function deleteMockProvider(page: Page, uiHelpers: UIHelpers): Promise<void> {
    await navigateToModels(page, uiHelpers)
    await deleteMockProviderSecrets(page)
    await waitForMockProviderSecretDeletion(page)
    await page.reload({waitUntil: "domcontentloaded"})
    await waitForModelsPageReady(page)
}

async function ensureMockProvider(
    page: Page,
    uiHelpers: UIHelpers,
    options?: EnsureTestProviderOptions,
): Promise<void> {
    await navigateToModels(page, uiHelpers)

    const existingSecrets = await fetchMockProviderSecrets(page)
    const existingSecret = existingSecrets[0] ?? null
    const hasDuplicateSecrets = existingSecrets.length > 1
    const hasMatchingSecret =
        !!existingSecret &&
        existingSecret.data?.kind === MOCK_PROVIDER_KIND &&
        existingSecret.data?.provider?.url === MOCK_API_BASE_URL &&
        existingSecret.data?.provider?.extras?.api_key === MOCK_API_KEY &&
        existingSecret.data?.models?.some((model) => model.slug === MOCK_MODEL_NAME)

    if (!options?.recreate && hasMatchingSecret && !hasDuplicateSecrets) {
        assertMockProviderSecret(existingSecret)

        const providerRow = await getCustomProviderRow(page, MOCK_PROVIDER_NAME)
        if (providerRow) {
            await expect(providerRow).toBeVisible({timeout: 15000})
            return
        }
    }

    if (existingSecrets.length || options?.recreate) {
        await deleteMockProvider(page, uiHelpers)
    }

    await createMockProvider(page, uiHelpers)
}

async function selectMockModel(page: Page): Promise<void> {
    const refinePromptButton = page.getByRole("button", {name: "Refine prompt with AI"}).first()
    await expect(refinePromptButton).toBeVisible({timeout: 30000})

    // The model selector sits immediately after the "Refine prompt with AI" button in
    // the toolbar. Use a data-tour attribute if available, otherwise fall back to the
    // positional sibling. We use getByText on a known model string as a quick-exit
    // guard before touching the DOM.
    const modelButton = page
        .locator('[data-tour="model-selector"], [data-testid="model-selector"]')
        .or(refinePromptButton.locator("xpath=following-sibling::button[1]"))
        .first()

    await expect(modelButton).toBeVisible({timeout: 15000})
    // Stable text read: wait until the button has non-empty text (it may still be
    // mounting when first visible).
    let currentModel = ""
    await expect
        .poll(
            async () => {
                currentModel = (await modelButton.textContent().catch(() => ""))?.trim() ?? ""
                return currentModel
            },
            {timeout: 10000},
        )
        .toBeTruthy()

    if (currentModel.includes(MOCK_MODEL_NAME)) {
        return
    }

    await modelButton.click()

    // The configure popover contains "Configure" somewhere in its header area.
    // Use a partial-text match so "Configure model" and "Configure" both match.
    const configurePopover = page
        .locator(".ant-popover")
        .filter({has: page.getByText(/Configure/i)})
        .last()
    await expect(configurePopover).toBeVisible({timeout: 15000})

    // Find the model selector inside the popover. When currentModel is known, narrow
    // to the select that displays it; otherwise fall back to the first select.
    const modelSelect =
        currentModel.length > 0
            ? configurePopover.locator(".ant-select").filter({hasText: currentModel}).first()
            : configurePopover.locator(".ant-select").first()
    await expect(modelSelect).toBeVisible({timeout: 15000})
    await modelSelect.click()

    const dropdown = page.locator(".ant-select-dropdown").last()
    await expect(dropdown).toBeVisible({timeout: 15000})

    const searchInput = dropdown.locator("input").first()
    await expect(searchInput).toBeVisible({timeout: 15000})
    await searchInput.fill(MOCK_MODEL_NAME)

    const mockModelOption = dropdown.getByText(new RegExp(`(^|/)${MOCK_MODEL_NAME}$`)).last()
    await expect(mockModelOption).toBeVisible({timeout: 15000})
    await mockModelOption.click()

    // The dropdown closes after selection; verify the model button now shows the mock model.
    // The configure popover itself is persistent — it does NOT auto-close on model selection,
    // so we must not assert it closes. Dismiss it by pressing Escape so it does not overlay
    // the playground inputs the test needs to interact with next.
    await expect(modelButton).toContainText(MOCK_MODEL_NAME, {timeout: 15000})
    await page.keyboard.press("Escape")
    // Give the popover a moment to animate out; if it stays open that is also fine
    // (subsequent interactions use force:true).
    await page.waitForTimeout(300)
}

const PROFILES: Record<TestProviderMode, ProviderProfile> = {
    mock: {
        info: {
            mode: "mock",
            providerName: MOCK_PROVIDER_NAME,
            modelName: MOCK_MODEL_NAME,
        },
        ensure: ensureMockProvider,
        selectModel: selectMockModel,
    },
    openai: {
        info: {
            mode: "openai",
            providerName: "openai",
            modelName: "gpt-4o-mini",
        },
        ensure: async () => {
            throw new Error("The openai test provider profile is not implemented yet.")
        },
        selectModel: async () => {
            throw new Error("The openai test provider profile is not implemented yet.")
        },
    },
}

export const testProviderHelpers = () => {
    return async (
        {page, uiHelpers}: FixtureContext & {uiHelpers: UIHelpers},
        use: UseFn<TestProviderHelpers>,
    ) => {
        const activeProfile = PROFILES[getActiveProviderMode()]

        await use({
            ensureTestProvider: async (options?: EnsureTestProviderOptions) => {
                await activeProfile.ensure(page, uiHelpers, options)
            },
            selectTestModel: async () => {
                await activeProfile.selectModel(page)
            },
            getActiveProfile: () => {
                return activeProfile.info
            },
        })
    }
}
