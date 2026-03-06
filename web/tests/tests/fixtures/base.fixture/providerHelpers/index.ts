import {expect, Locator, Page} from "@playwright/test"

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
        models?: Array<{
            slug?: string
        }>
    }
}

interface ProviderProfile {
    info: TestProviderProfileInfo
    ensure: (page: Page, uiHelpers: UIHelpers, options?: EnsureTestProviderOptions) => Promise<void>
    selectModel: (page: Page) => Promise<void>
}

function getActiveProviderMode(): TestProviderMode {
    const mode = (process.env.AGENTA_TEST_PROVIDER || "mock").toLowerCase()

    if (mode === "mock" || mode === "openai") {
        return mode
    }

    throw new Error(
        `Unsupported AGENTA_TEST_PROVIDER='${mode}'. Supported values are 'mock' and 'openai'.`,
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

async function navigateToModels(page: Page, uiHelpers: UIHelpers): Promise<void> {
    await page.goto("/apps", {waitUntil: "domcontentloaded"})

    const settingsLink = page.getByRole("link", {name: "Settings"}).first()
    await expect(settingsLink).toBeVisible({timeout: 15000})
    await settingsLink.click()

    await uiHelpers.expectPath("/settings")

    const modelsMenuItem = page.getByRole("menuitem", {name: "Models"}).first()
    await expect(modelsMenuItem).toBeVisible({timeout: 15000})
    await modelsMenuItem.click()

    await uiHelpers.expectPath("/settings")
    await expect(page.getByRole("heading", {name: "Models"})).toBeVisible({timeout: 15000})
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
    const secretsUrl = new URL(`${getApiURL(page)}/vault/v1/secrets/`)

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
                secret.kind === "custom_provider" &&
                secret.header?.name === MOCK_PROVIDER_NAME,
        ) || null
    )
}

function assertMockProviderSecret(secret: VaultSecretRecord): void {
    expect(secret.header?.name).toBe(MOCK_PROVIDER_NAME)
    expect(secret.data?.kind).toBe(MOCK_PROVIDER_KIND)
    expect(secret.data?.provider?.url).toBe(MOCK_API_BASE_URL)
    expect(secret.data?.provider?.extras?.api_key).toBe(MOCK_API_KEY)
    expect(secret.data?.models?.some((model) => model.slug === MOCK_MODEL_NAME)).toBe(true)
}

async function openMockProviderDrawer(page: Page): Promise<Locator> {
    const customProvidersSection = getCustomProvidersSection(page)
    const createButton = customProvidersSection.getByRole("button", {name: "Create"})
    await expect(createButton).toBeVisible({timeout: 15000})
    await createButton.click()

    const drawer = page.locator(".ant-drawer-content-wrapper").last()
    await expect(drawer).toBeVisible({timeout: 15000})
    await expect(drawer.getByText("Configure provider")).toBeVisible({timeout: 15000})
    return drawer
}

async function chooseCustomProvider(drawer: Locator, page: Page): Promise<void> {
    const providerSelect = drawer.locator(".ant-select").first()
    await expect(providerSelect).toBeVisible({timeout: 15000})
    await providerSelect.click()

    const options = page.locator(".ant-select-item-option")
    await expect(options.first()).toBeVisible({timeout: 15000})

    const optionTexts = (await options.allTextContents()).map((value) => value.trim())
    const customProviderIndex = optionTexts.findIndex((value) => value === "Custom Provider")

    if (customProviderIndex === -1) {
        throw new Error(
            `Could not find 'Custom Provider' in provider options: ${optionTexts.join(", ")}`,
        )
    }

    const providerInput = providerSelect.locator("input.ant-select-input").first()
    await expect(providerInput).toBeVisible({timeout: 15000})
    await providerInput.focus()

    for (let index = 0; index < customProviderIndex; index += 1) {
        await providerInput.press("ArrowDown")
    }

    await providerInput.press("Enter")

    await expect(drawer.getByPlaceholder("Enter unique name")).toBeVisible({timeout: 15000})
}

async function fillMockProviderForm(drawer: Locator): Promise<void> {
    await drawer.getByPlaceholder("Enter unique name").fill(MOCK_PROVIDER_NAME)
    await drawer.getByPlaceholder("Enter API key").fill(MOCK_API_KEY)
    await drawer.getByPlaceholder("Enter API base URL").fill(MOCK_API_BASE_URL)
    await drawer.getByPlaceholder("Enter model name").fill(MOCK_MODEL_NAME)
}

async function createMockProvider(page: Page, uiHelpers: UIHelpers): Promise<void> {
    const drawer = await openMockProviderDrawer(page)
    await chooseCustomProvider(drawer, page)
    await fillMockProviderForm(drawer)

    const submitButton = drawer.getByRole("button", {name: "Submit"})
    await expect(submitButton).toBeVisible({timeout: 15000})
    await submitButton.click()

    await expect(drawer).not.toBeVisible({timeout: 30000})

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

    const providerNameCell = getCustomProvidersSection(page).getByRole("cell", {
        name: MOCK_PROVIDER_NAME,
        exact: true,
    })
    await expect(providerNameCell).toBeVisible({timeout: 15000})
}

async function deleteMockProvider(page: Page): Promise<void> {
    const providerRow = await getCustomProviderRow(page, MOCK_PROVIDER_NAME)
    if (!providerRow) {
        return
    }

    await providerRow.locator("button").first().click()

    const deleteModal = page.locator(".ant-modal").last()
    await expect(deleteModal).toBeVisible({timeout: 15000})
    await deleteModal.getByRole("button", {name: "Delete"}).click()
    await expect(deleteModal).not.toBeVisible({timeout: 30000})

    await expect(
        getCustomProvidersSection(page)
            .getByRole("table")
            .first()
            .getByRole("row")
            .filter({has: page.getByRole("cell", {name: MOCK_PROVIDER_NAME, exact: true})}),
    ).toHaveCount(0, {timeout: 30000})
}

async function ensureMockProvider(
    page: Page,
    uiHelpers: UIHelpers,
    options?: EnsureTestProviderOptions,
): Promise<void> {
    await navigateToModels(page, uiHelpers)

    const existingSecret = await fetchMockProviderSecret(page)
    if (existingSecret && !options?.recreate) {
        assertMockProviderSecret(existingSecret)

        const providerRow = await getCustomProviderRow(page, MOCK_PROVIDER_NAME)
        if (providerRow) {
            await expect(providerRow).toBeVisible({timeout: 15000})
            return
        }
    }

    if (existingSecret || options?.recreate) {
        await deleteMockProvider(page)
    }

    await createMockProvider(page, uiHelpers)
}

async function selectMockModel(page: Page): Promise<void> {
    const refinePromptButton = page.getByRole("button", {name: "Refine prompt with AI"}).first()
    await expect(refinePromptButton).toBeVisible({timeout: 30000})

    const modelButton = refinePromptButton.locator("xpath=following-sibling::button[1]")
    await expect(modelButton).toBeVisible({timeout: 15000})

    const currentModel = (await modelButton.textContent())?.trim()
    if (currentModel?.includes(MOCK_MODEL_NAME)) {
        return
    }

    await modelButton.click()

    const modelParametersPopover = page.locator(".ant-popover").filter({
        has: page.getByText("Model Parameters", {exact: true}),
    })
    await expect(modelParametersPopover).toBeVisible({timeout: 15000})

    const modelSelect = modelParametersPopover.locator(".ant-select").first()
    await expect(modelSelect).toBeVisible({timeout: 15000})
    await modelSelect.click()

    const options = page.locator(".ant-select-item-option")
    await expect(options.first()).toBeVisible({timeout: 15000})

    const optionTexts = (await options.allTextContents()).map((value) => value.trim())
    const mockModelIndex = optionTexts.findIndex((value) => value === MOCK_MODEL_NAME)

    if (mockModelIndex === -1) {
        throw new Error(`Could not find '${MOCK_MODEL_NAME}' in model options: ${optionTexts.join(", ")}`)
    }

    const modelInput = modelSelect.locator("input.ant-select-input").first()
    await expect(modelInput).toBeVisible({timeout: 15000})
    await modelInput.focus()

    for (let index = 0; index < mockModelIndex; index += 1) {
        await modelInput.press("ArrowDown")
    }

    await modelInput.press("Enter")

    await expect(modelButton).toContainText(MOCK_MODEL_NAME, {timeout: 15000})
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
