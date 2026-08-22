import {beforeEach, describe, expect, it, vi} from "vitest"

import {
    buildConnectionPayload,
    buildModelOptions,
    connectionPolicyForSave,
    credentialSummary,
    credentialValuesFor,
    defaultModelsFor,
    defaultNamePreview,
    doneState,
    harnessSupportsProviderKind,
    hasRequiredCredential,
    modelDisplayOrder,
    nextConnectionName,
    probeFailureMessage,
    probeRequestFor,
    providerModelCatalog,
    storedCredentialFields,
    toProviderConnections,
    type HarnessCapabilityMap,
    type ProviderConnection,
} from "../../src/secret/core/connections"
import {activeModelsSummary, connectionModelCount} from "../../src/secret/core/connectionSummary"
import {buildConnectionModelGroups} from "../../src/secret/core/promptModelGroups"
import {
    PROVIDER_CATALOG,
    credentialFieldsForKind,
    secretKindForProviderKind,
} from "../../src/secret/core/providerCatalog"
import {SecretKind, SecretManagementPolicy, VAULT_PERSIST_REDACTED} from "../../src/secret/core/types"

const fernProbeProvider = vi.fn()

vi.mock("@agenta/sdk/resources", () => ({
    getSecretsClient: () => ({probeProvider: (...args: unknown[]) => fernProbeProvider(...args)}),
}))

// Imported after the mock so the module picks it up.
const {probeProvider} = await import("../../src/secret/api/probe")

const connection = (overrides: Partial<ProviderConnection> = {}): ProviderConnection => ({
    id: "conn-1",
    name: "OpenAI",
    kind: "openai",
    title: "OpenAI",
    secretKind: SecretKind.ProviderKey,
    hasStoredCredential: false,
    source: {},
    ...overrides,
})

describe("provider catalog", () => {
    it("offers every provider once: 12 standard keys plus the 4 credential-set kinds", () => {
        const kinds = PROVIDER_CATALOG.map((entry) => entry.kind)

        expect(kinds).toContain("openai")
        expect(kinds).toHaveLength(16)
        expect(new Set(kinds).size).toBe(kinds.length)
    })

    it("drops Aleph Alpha and ends on the OpenAI-compatible endpoint", () => {
        const kinds = PROVIDER_CATALOG.map((entry) => entry.kind)

        expect(kinds).not.toContain("alephalpha")
        expect(kinds.at(-1)).toBe("custom")
        expect(kinds).toEqual(expect.arrayContaining(["bedrock", "azure", "vertex_ai"]))
    })

    it("keeps SageMaker out of the catalog while still reading a saved record as a credential set", () => {
        expect(PROVIDER_CATALOG.map((entry) => entry.kind)).not.toContain("sagemaker")

        expect(secretKindForProviderKind("sagemaker")).toBe(SecretKind.CustomProvider)
        expect(credentialFieldsForKind("sagemaker").map((field) => field.key)).toEqual([
            "region",
            "accessKeyId",
            "accessKey",
        ])
        expect(
            toProviderConnections([
                {id: "s1", type: SecretKind.CustomProvider, provider: "sagemaker", name: "SM"},
            ])[0].title,
        ).toBe("AWS SageMaker")
    })

    it("gives a standard provider one required API key and a cloud kind its own field set", () => {
        expect(credentialFieldsForKind("openai").map((field) => field.key)).toEqual(["apiKey"])
        expect(credentialFieldsForKind("openai")[0].required).toBe(true)

        expect(credentialFieldsForKind("bedrock").map((field) => field.key)).toEqual([
            "region",
            "bearerToken",
            "accessKeyId",
            "accessKey",
        ])
        expect(credentialFieldsForKind("vertex_ai").map((field) => field.key)).toContain(
            "vertexCredentials",
        )
    })

    it("hints the base URL in each provider's own terms", () => {
        const baseUrlNote = (kind: string) =>
            credentialFieldsForKind(kind).find((field) => field.key === "apiBaseUrl")?.note

        // The `/v1` example is an OpenAI-compatible endpoint's, and nobody else's — one example,
        // not a second one repeating the first inside a full URL.
        expect(baseUrlNote("custom")).toBe("Include the version path, e.g. /v1.")
        expect(baseUrlNote("azure")).toContain("openai.azure.com")
        expect(baseUrlNote("azure")).not.toContain("/v1")
        // Vertex is addressed by project and location, so an example here would only mislead.
        expect(baseUrlNote("vertex_ai")).toBeUndefined()
    })

    it("leads the endpoint card with the URL that is the endpoint's identity", () => {
        expect(credentialFieldsForKind("custom").map((field) => field.key)).toEqual([
            "apiBaseUrl",
            "apiKey",
        ])
    })

    it("says the endpoint's key is conditional, because an open endpoint needs none", () => {
        const apiKey = credentialFieldsForKind("custom").find((field) => field.key === "apiKey")

        expect(apiKey?.label).toBe("API key — if the endpoint requires one")
        expect(credentialFieldsForKind("openai")[0].label).toBe("API key")
    })

    it("drops the per-field encryption disclaimer the card states once", () => {
        const notes = [
            ...credentialFieldsForKind("openai"),
            ...credentialFieldsForKind("bedrock"),
            ...credentialFieldsForKind("vertex_ai"),
        ].map((field) => field.note)

        expect(notes).not.toContain("This secret will be encrypted in transit and at rest.")
        // Bedrock's either/or hint is not a disclaimer and survives.
        expect(
            credentialFieldsForKind("bedrock").find((field) => field.key === "bearerToken")?.note,
        ).toContain("access key ID")
    })
})

describe("hasRequiredCredential", () => {
    it("needs the one key a standard provider takes", () => {
        expect(hasRequiredCredential("openai", {})).toBe(false)
        expect(hasRequiredCredential("openai", {apiKey: "sk-one"})).toBe(true)
        expect(hasRequiredCredential("openai", {apiKey: "   "})).toBe(false)
    })

    it("needs Azure's key, endpoint, and version together", () => {
        expect(hasRequiredCredential("azure", {apiKey: "k", apiBaseUrl: "https://x"})).toBe(false)
        expect(
            hasRequiredCredential("azure", {
                apiKey: "k",
                apiBaseUrl: "https://x",
                version: "2024-02-01",
            }),
        ).toBe(true)
    })

    it("accepts either of Bedrock's two auth sets and neither half alone", () => {
        expect(hasRequiredCredential("bedrock", {region: "us-east-1"})).toBe(false)
        expect(hasRequiredCredential("bedrock", {accessKeyId: "AKIA"})).toBe(false)
        expect(hasRequiredCredential("bedrock", {bearerToken: "token"})).toBe(true)
        expect(hasRequiredCredential("bedrock", {accessKeyId: "AKIA", accessKey: "secret"})).toBe(
            true,
        )
    })

    it("treats Vertex's service-account JSON as the credential", () => {
        expect(hasRequiredCredential("vertex_ai", {vertexProject: "acme"})).toBe(false)
        expect(hasRequiredCredential("vertex_ai", {vertexCredentials: "{}"})).toBe(true)
    })
})

describe("nextConnectionName", () => {
    it("takes the plain title first, then numbers upward", () => {
        expect(nextConnectionName("OpenAI", [])).toBe("OpenAI")
        expect(nextConnectionName("OpenAI", ["OpenAI"])).toBe("OpenAI 2")
        expect(nextConnectionName("OpenAI", ["OpenAI", "OpenAI 2"])).toBe("OpenAI 3")
    })

    it("fills the first gap rather than counting connections", () => {
        expect(nextConnectionName("OpenAI", ["OpenAI", "OpenAI 3"])).toBe("OpenAI 2")
    })

    it("previews against every connection in the project, not just this provider's", () => {
        const existing = [connection({name: "OpenAI"}), connection({id: "c2", name: "Anthropic"})]

        expect(defaultNamePreview("openai", existing)).toBe("OpenAI 2")
        expect(defaultNamePreview("groq", existing)).toBe("Groq")
    })
})

describe("toProviderConnections", () => {
    it("names a legacy record after its provider and keeps a named one", () => {
        const rows = toProviderConnections([
            {id: "a", type: SecretKind.ProviderKey, title: "openai", key: "sk-abcdef"},
            {
                id: "b",
                type: SecretKind.ProviderKey,
                title: "openai",
                displayName: "OpenAI 2",
                key: "sk-second",
            },
        ])

        expect(rows.map((row) => row.name)).toEqual(["OpenAI", "OpenAI 2"])
        expect(rows.every((row) => row.kind === "openai")).toBe(true)
    })

    it("ignores named secrets, which are not connections", () => {
        const rows = toProviderConnections([
            {id: "a", type: "custom_secret", name: "MY_TOKEN"},
            {id: "b", type: SecretKind.CustomProvider, provider: "azure", name: "Azure prod"},
        ])

        expect(rows).toHaveLength(1)
        expect(rows[0].title).toBe("Azure OpenAI")
    })
})

describe("credentialValuesFor", () => {
    it("seeds a standard card from the stored key", () => {
        expect(credentialValuesFor(connection({source: {key: "sk-stored"}}))).toEqual({
            apiKey: "sk-stored",
        })
    })

    it("reads the persister's redaction sentinel as nothing typed yet", () => {
        expect(
            credentialValuesFor(connection({source: {key: VAULT_PERSIST_REDACTED}})).apiKey,
        ).toBe("")
        expect(
            hasRequiredCredential(
                "openai",
                credentialValuesFor(connection({source: {key: VAULT_PERSIST_REDACTED}})),
            ),
        ).toBe(false)
    })

    it("carries a stored AWS session token even though no field renders it", () => {
        const values = credentialValuesFor(
            connection({
                kind: "bedrock",
                secretKind: SecretKind.CustomProvider,
                source: {region: "us-east-1", accessKeyId: "AKIA", sessionToken: "sts-token"},
            }),
        )

        expect(values.sessionToken).toBe("sts-token")
    })
})

describe("credentialSummary", () => {
    it("masks a key and falls back to the endpoint host when there is none", () => {
        expect(credentialSummary(connection({source: {key: "sk-000000000000xyz"}}))).toBe(
            "sk-••••xyz",
        )
        expect(
            credentialSummary(
                connection({source: {apiBaseUrl: "https://models.internal.test/v1"}}),
            ),
        ).toBe("models.internal.test")
    })
})

describe("providerModelCatalog", () => {
    const capabilities: HarnessCapabilityMap = {
        pi_core: {
            providers: ["openai", "anthropic"],
            models: {openai: ["openai/gpt-5.6-luna", "openai/gpt-5.5"], anthropic: []},
            default_models: {openai: ["openai/gpt-5.6-luna"]},
        },
        codex: {
            providers: ["openai"],
            models: {openai: ["gpt-5.6-luna", "gpt-5.2"]},
            default_models: {},
        },
        claude: {providers: ["anthropic"], models: {anthropic: ["sonnet"]}, default_models: {}},
    }

    it("collapses the harness spellings of one model onto its bare id", () => {
        const {models} = providerModelCatalog(capabilities, "openai")

        expect(models).toEqual(["gpt-5.6-luna", "gpt-5.5", "gpt-5.2"])
    })

    it("marks Agenta's defaults in the same spelling as the list", () => {
        expect(providerModelCatalog(capabilities, "openai").defaults).toEqual(["gpt-5.6-luna"])
    })

    it("only unions the harnesses that reach the family", () => {
        expect(providerModelCatalog(capabilities, "anthropic").models).toEqual(["sonnet"])
        expect(providerModelCatalog(capabilities, "groq").models).toEqual([])
    })
})

describe("buildModelOptions", () => {
    it("keeps a saved model the fetch no longer offers, checked and flagged unavailable", () => {
        const options = buildModelOptions({
            available: ["gpt-5.6-luna", "gpt-5.5"],
            checked: ["gpt-5.6-luna", "gpt-4o-retired"],
            defaults: ["gpt-5.6-luna"],
            discovered: true,
        })

        expect(options.find((option) => option.id === "gpt-4o-retired")).toEqual({
            id: "gpt-4o-retired",
            checked: true,
            isDefault: false,
            unavailable: true,
        })
        expect(options.find((option) => option.id === "gpt-5.6-luna")?.isDefault).toBe(true)
        expect(options.find((option) => option.id === "gpt-5.5")?.checked).toBe(false)
    })

    it("never calls a model unavailable when the list is Agenta's shipped catalog", () => {
        const options = buildModelOptions({
            available: ["gpt-5.5"],
            checked: ["gpt-4o-retired"],
            discovered: false,
        })

        expect(options.every((option) => !option.unavailable)).toBe(true)
    })

    it("treats a hand-entered id as available, because the user asserted it", () => {
        const options = buildModelOptions({
            available: ["gpt-5.5"],
            checked: ["my-fine-tune"],
            manual: ["my-fine-tune"],
            discovered: true,
        })

        expect(options.find((option) => option.id === "my-fine-tune")).toMatchObject({
            checked: true,
            unavailable: false,
        })
    })
})

describe("model list order", () => {
    // A fetch returns dozens of models with the interesting ones scattered through it.
    const available = ["gpt-4.1", "gpt-5.5", "o3", "gpt-5.4", "gpt-3.5"]

    it("leads with the saved selection and Agenta's defaults, then keeps provider order", () => {
        const order = modelDisplayOrder({available, prioritized: ["gpt-5.4", "gpt-5.5"]})

        expect(order).toEqual(["gpt-5.5", "gpt-5.4", "gpt-4.1", "o3", "gpt-3.5"])
        expect(
            buildModelOptions({
                available,
                checked: ["gpt-5.4", "gpt-5.5"],
                discovered: true,
                order,
            }).map((option) => option.id),
        ).toEqual(order)
    })

    it("does not reorder when a model is ticked or unticked", () => {
        // The order is computed once per fetch, so it cannot move a row out from under the cursor.
        const order = modelDisplayOrder({available, prioritized: ["gpt-5.5"]})
        const ids = (checked: string[]) =>
            buildModelOptions({available, checked, discovered: true, order}).map(
                (option) => option.id,
            )

        expect(ids(["gpt-5.5"])).toEqual(ids(["gpt-5.5", "gpt-3.5"]))
        expect(ids(["gpt-5.5"])).toEqual(ids([]))
    })

    it("leads with a hand-added model, above the saved selection", () => {
        // It arrives checked and the user typed it a moment ago. Sorting it below every unticked
        // catalog row (which is where it used to land) read as the add having failed.
        const order = modelDisplayOrder({
            available,
            prioritized: ["gpt-5.5"],
            manual: ["my-fine-tune"],
        })

        expect(order[0]).toBe("my-fine-tune")
        expect(order).toEqual(["my-fine-tune", "gpt-5.5", "gpt-4.1", "o3", "gpt-5.4", "gpt-3.5"])
        expect(
            buildModelOptions({
                available,
                checked: ["gpt-5.5", "my-fine-tune"],
                manual: ["my-fine-tune"],
                discovered: true,
                order,
            }).map((option) => option.id),
        ).toEqual(order)
    })

    it("keeps a hand-added id that the provider also offers in the leading block", () => {
        const order = modelDisplayOrder({available, prioritized: ["gpt-5.5"], manual: ["o3"]})

        expect(order.slice(0, 2)).toEqual(["o3", "gpt-5.5"])
    })

    it("still reorders nothing when a model is ticked, even with a hand-added one present", () => {
        // Adding is the only thing that may move a row; ticking never is.
        const order = modelDisplayOrder({
            available,
            prioritized: ["gpt-5.5"],
            manual: ["my-fine-tune"],
        })
        const ids = (checked: string[]) =>
            buildModelOptions({
                available,
                checked,
                manual: ["my-fine-tune"],
                discovered: true,
                order,
            }).map((option) => option.id)

        expect(ids(["my-fine-tune"])).toEqual(ids(["my-fine-tune", "gpt-3.5"]))
        expect(ids(["my-fine-tune"])).toEqual(ids([]))
    })

    it("keeps an id the order never saw at the end", () => {
        // A model added after the order was computed: no rank, so it falls to the end until the
        // next recompute (which the card does as soon as the manual list changes).
        const order = modelDisplayOrder({available, prioritized: ["gpt-5.5"]})

        expect(
            buildModelOptions({
                available,
                checked: ["my-fine-tune"],
                manual: ["my-fine-tune"],
                discovered: true,
                order,
            })
                .map((option) => option.id)
                .at(-1),
        ).toBe("my-fine-tune")
    })

    it("carries a saved model the fetch dropped, without disturbing the rest", () => {
        const order = modelDisplayOrder({
            available,
            prioritized: ["gpt-4o-retired", "gpt-5.5"],
        })

        expect(order.slice(0, 2)).toEqual(["gpt-5.5", "gpt-4o-retired"])
    })
})

describe("harnessSupportsProviderKind", () => {
    const capabilities: HarnessCapabilityMap = {
        pi_core: {providers: ["openai"], deployments: ["direct", "custom"]},
        claude: {providers: ["anthropic"], deployments: ["direct", "bedrock"]},
    }

    it("matches a standard key against the harness's provider families", () => {
        expect(harnessSupportsProviderKind(capabilities, "pi_core", "openai")).toBe(true)
        expect(harnessSupportsProviderKind(capabilities, "claude", "openai")).toBe(false)
    })

    it("matches a credential-set kind against the deployment surfaces instead", () => {
        expect(harnessSupportsProviderKind(capabilities, "pi_core", "custom")).toBe(true)
        expect(harnessSupportsProviderKind(capabilities, "claude", "bedrock")).toBe(true)
        expect(harnessSupportsProviderKind(capabilities, "pi_core", "bedrock")).toBe(false)
    })
})

describe("doneState", () => {
    it("blocks until a credential is there at all", () => {
        expect(doneState({credentialFilled: false, status: null}).enabled).toBe(false)
    })

    it("blocks a credential the provider rejected", () => {
        expect(doneState({credentialFilled: true, status: "invalid"}).enabled).toBe(false)
    })

    it("saves a tested credential with nothing to explain", () => {
        expect(doneState({credentialFilled: true, status: "valid"})).toEqual({
            enabled: true,
            note: "",
        })
    })

    it("saves an untestable credential and says so", () => {
        const state = doneState({credentialFilled: true, status: "unknown"})

        expect(state.enabled).toBe(true)
        expect(state.note).toMatch(/untested/)
    })

    it("asks a newly typed credential to be tested first", () => {
        const state = doneState({credentialFilled: true, status: null})

        expect(state.enabled).toBe(false)
        expect(state.note).toMatch(/Test this credential/)
    })

    it("lets a saved connection be reopened and re-saved without a fresh test", () => {
        expect(
            doneState({credentialFilled: true, status: null, storedCredentialUnchanged: true}),
        ).toEqual({enabled: true, note: ""})
    })

    it("says nothing about testing when the test itself never reached the provider", () => {
        const state = doneState({credentialFilled: true, status: null, transportFailed: true})

        expect(state.enabled).toBe(false)
        expect(state.note).toBe("")
    })
})

describe("connectionPolicyForSave", () => {
    const policy = (overrides: Partial<Parameters<typeof connectionPolicyForSave>[0]> = {}) =>
        connectionPolicyForSave({
            checkedModels: null,
            modelIds: ["gpt-5.5"],
            harnesses: null,
            defaultHarness: "pi_core",
            ...overrides,
        })

    it("omits models the user never touched, so reopening does not pin today's defaults", () => {
        expect(policy()).not.toHaveProperty("models")
    })

    it("sends the chosen list once the user touches it, including an emptied one", () => {
        expect(policy({checkedModels: ["gpt-5.5"]}).models).toEqual(["gpt-5.5"])
        expect(policy({checkedModels: [], modelIds: []}).models).toEqual([])
    })

    it("omits harnesses when no harness declares this deployment", () => {
        expect(policy({defaultHarness: null})).not.toHaveProperty("harnesses")
    })

    it("sends the default harness when one can reach the provider", () => {
        expect(policy().harnesses).toEqual(["pi_core"])
    })

    it("sends an explicit empty set only when the user cleared choices that existed", () => {
        expect(policy({harnesses: []}).harnesses).toEqual([])
        expect(policy({harnesses: ["claude"]}).harnesses).toEqual(["claude"])
    })
})

describe("activeModelsSummary", () => {
    const capabilities: HarnessCapabilityMap = {
        pi_core: {providers: ["openai"], models: {openai: ["gpt-5.5", "gpt-5.2", "gpt-4o"]}},
    }

    it("says Defaults when the connection saved no list", () => {
        expect(activeModelsSummary(connection(), capabilities)).toBe("Defaults")
    })

    it("counts a saved list against what the provider family offers", () => {
        expect(activeModelsSummary(connection({models: ["gpt-5.5"]}), capabilities)).toBe(
            "1 of 3 active",
        )
    })

    it("counts an empty saved list rather than reading it as defaults", () => {
        expect(activeModelsSummary(connection({models: []}), capabilities)).toBe("0 of 3 active")
    })
})

describe("one effective model set across all three surfaces", () => {
    // The founder's bug: for a connection with no saved list, the table said "Defaults", the
    // drawer counted 3, and the completion picker offered the family's full 40-model catalog.
    // All three now read `defaultModelsFor`, so they cannot answer differently.
    const capabilities: HarnessCapabilityMap = {
        pi_core: {
            providers: ["openai"],
            models: {openai: ["gpt-5.6-sol", "gpt-5.6-luna", "gpt-4o-mini", "gpt-4o"]},
            default_models: {openai: ["gpt-5.6-sol", "gpt-5.6-luna"]},
        },
    }
    const noSavedList = connection()

    it("agrees on the defaults: table, drawer count, and picker rows", () => {
        expect(defaultModelsFor(noSavedList, capabilities)).toEqual(["gpt-5.6-sol", "gpt-5.6-luna"])
        expect(activeModelsSummary(noSavedList, capabilities)).toBe("Defaults")
        expect(connectionModelCount(noSavedList, capabilities)).toBe(2)
        expect(
            buildConnectionModelGroups({
                connections: [noSavedList],
                // A big static catalog that must NOT win over the defaults.
                catalog: {openai: Array.from({length: 40}, (_, i) => `schema-${i}`)},
                capabilities,
            })[0].options.map((option) => option.value),
        ).toEqual(["gpt-5.6-sol", "gpt-5.6-luna"])
    })

    it("agrees on a saved list too, defaults notwithstanding", () => {
        const saved = connection({models: ["gpt-4o"]})

        expect(connectionModelCount(saved, capabilities)).toBe(1)
        expect(activeModelsSummary(saved, capabilities)).toBe("1 of 4 active")
        expect(
            buildConnectionModelGroups({connections: [saved], capabilities})[0].options.map(
                (option) => option.value,
            ),
        ).toEqual(["gpt-4o"])
    })
})

describe("buildConnectionPayload", () => {
    it("sends a provider_key header-less when the name is empty, so the API names it", () => {
        const payload = buildConnectionPayload(
            {
                kind: "openai",
                name: "",
                credential: {apiKey: "sk-one"},
                models: ["gpt-5.5"],
                harnesses: ["pi_core"],
            },
            "OpenAI 2",
        )

        expect(payload.header).toEqual({})
        expect(payload.secret.kind).toBe(SecretKind.ProviderKey)
        expect(payload.secret.data).toMatchObject({
            kind: "openai",
            provider: {key: "sk-one"},
            models: [{slug: "gpt-5.5"}],
            harnesses: ["pi_core"],
        })
    })

    it("sends an emptied list as an explicit none", () => {
        const payload = buildConnectionPayload(
            {kind: "openai", name: "", credential: {apiKey: "sk"}, models: [], harnesses: []},
            "OpenAI",
        )

        expect((payload.secret.data as {models: unknown}).models).toEqual([])
        expect((payload.secret.data as {harnesses: unknown}).harnesses).toEqual([])
    })

    it("leaves out a policy the draft does not carry, so the record keeps following defaults", () => {
        const payload = buildConnectionPayload(
            {kind: "openai", name: "", credential: {apiKey: "sk"}},
            "OpenAI",
        )

        expect(payload.secret.data).not.toHaveProperty("models")
        expect(payload.secret.data).not.toHaveProperty("harnesses")
    })

    it("round-trips Bedrock's session token, which no field renders", () => {
        const payload = buildConnectionPayload(
            {
                kind: "bedrock",
                name: "Bedrock prod",
                credential: {
                    region: "us-east-1",
                    accessKeyId: "AKIA",
                    accessKey: "secret",
                    sessionToken: "sts-token",
                },
                models: ["claude-sonnet"],
            },
            "AWS Bedrock",
        )

        expect(payload.secret.data).toMatchObject({
            kind: "bedrock",
            provider: {
                extras: {
                    aws_region_name: "us-east-1",
                    aws_access_key_id: "AKIA",
                    aws_secret_access_key: "secret",
                    aws_session_token: "sts-token",
                },
            },
            models: [{slug: "claude-sonnet"}],
        })
    })

    it("carries Vertex's project, location, and service-account JSON into extras", () => {
        const payload = buildConnectionPayload(
            {
                kind: "vertex_ai",
                name: "",
                credential: {
                    apiBaseUrl: "https://us-central1-aiplatform.googleapis.com",
                    vertexProject: "acme-prod",
                    vertexLocation: "us-central1",
                    vertexCredentials: '{"type":"service_account"}',
                },
                models: [],
            },
            "Google Vertex AI",
        )

        expect(payload.header).toEqual({name: "Google Vertex AI"})
        expect(payload.secret.data).toMatchObject({
            kind: "vertex_ai",
            provider: {
                url: "https://us-central1-aiplatform.googleapis.com",
                extras: {
                    vertex_ai_project: "acme-prod",
                    vertex_ai_location: "us-central1",
                    vertex_ai_credentials: '{"type":"service_account"}',
                },
            },
        })
    })

    it("names a custom_provider from the preview, because it is addressed by name", () => {
        const payload = buildConnectionPayload(
            {
                kind: "azure",
                name: "",
                credential: {
                    apiKey: "azure-key",
                    apiBaseUrl: "https://acme.openai.azure.com",
                    version: "2024-02-01",
                },
                models: ["gpt-4o"],
                harnesses: [],
            },
            "Azure OpenAI 2",
        )

        expect(payload.header).toEqual({name: "Azure OpenAI 2"})
        expect(payload.secret.data).toMatchObject({
            kind: "azure",
            provider: {
                url: "https://acme.openai.azure.com",
                version: "2024-02-01",
                extras: {api_key: "azure-key"},
            },
        })
    })
})

describe("probeProvider", () => {
    beforeEach(() => {
        fernProbeProvider.mockReset()
    })

    it("posts the credential and returns the two statuses", async () => {
        fernProbeProvider.mockResolvedValueOnce({
            credential: {status: "valid", message: "OpenAI accepted this key."},
            discovery: {status: "fetched", models: ["gpt-5.5"]},
            fetched_at: "2026-08-12T10:00:00Z",
        })

        const result = await probeProvider({
            projectId: "proj-1",
            kind: "openai",
            provider: {key: "sk-one"},
        })

        expect(fernProbeProvider).toHaveBeenCalledWith(
            {kind: "openai", provider: {key: "sk-one"}},
            {queryParams: {project_id: "proj-1"}},
        )
        expect(result?.credential.status).toBe("valid")
        expect(result?.discovery.models).toEqual(["gpt-5.5"])
    })

    it("puts the stored row on the wire as `secret_id`, and omits the field otherwise", async () => {
        const answer = {
            credential: {status: "valid", message: "ok"},
            discovery: {status: "fetched", models: ["m"]},
            fetched_at: "2026-08-12T10:00:00Z",
        }

        fernProbeProvider.mockResolvedValueOnce(answer)
        await probeProvider({
            projectId: "proj-1",
            provider: {url: "https://llm.example.com/v1"},
            secretId: "sec-1",
        })
        expect(fernProbeProvider).toHaveBeenLastCalledWith(
            {provider: {url: "https://llm.example.com/v1"}, secret_id: "sec-1"},
            {queryParams: {project_id: "proj-1"}},
        )
        // Absent, not empty: the stored row names its own kind, and a disagreeing one is a 422.
        expect(fernProbeProvider.mock.lastCall?.[0]).not.toHaveProperty("kind")

        // Absent, not null: the server reads a present `secret_id` as "resolve the stored row".
        fernProbeProvider.mockResolvedValueOnce(answer)
        await probeProvider({projectId: "proj-1", kind: "openai", provider: {key: "sk-one"}})
        expect(fernProbeProvider.mock.lastCall?.[0]).not.toHaveProperty("secret_id")
    })

    it("defaults a fetched-but-model-less discovery to an empty list", async () => {
        fernProbeProvider.mockResolvedValueOnce({
            credential: {status: "unknown", message: "not tested"},
            discovery: {status: "unsupported"},
            fetched_at: "2026-08-12T10:00:00Z",
        })

        const result = await probeProvider({projectId: "p", kind: "minimax", provider: {key: "k"}})

        expect(result?.discovery.models).toEqual([])
    })

    it("returns null rather than a half-read answer when the payload does not fit", async () => {
        fernProbeProvider.mockResolvedValueOnce({credential: {status: "maybe"}})

        const result = await probeProvider({projectId: "p", kind: "openai", provider: {key: "k"}})

        expect(result).toBeNull()
    })
})

describe("write-only records", () => {
    const writeOnlyRow = {
        id: "sec-1",
        type: SecretKind.ProviderKey,
        title: "openai",
        name: "OPENAI_API_KEY",
        writeOnly: true,
        hasKey: true,
        keyPreview: "sk-****9Qa",
    }

    it("reports a stored credential from `hasKey`, with no value to read", () => {
        const [connected] = toProviderConnections([writeOnlyRow])

        expect(connected.hasStoredCredential).toBe(true)
        expect(connected.keyPreview).toBe("sk-****9Qa")
        expect(credentialValuesFor(connected).apiKey).toBe("")
    })

    it("falls back to the value itself for a readable record", () => {
        const [readable] = toProviderConnections([
            {id: "sec-2", type: SecretKind.ProviderKey, title: "openai", key: "sk-live"},
        ])

        expect(readable.hasStoredCredential).toBe(true)
    })

    it("calls a record with neither value nor `hasKey` unconfigured", () => {
        const [empty] = toProviderConnections([
            {id: "sec-3", type: SecretKind.ProviderKey, title: "openai"},
        ])

        expect(empty.hasStoredCredential).toBe(false)
    })

    it("carries the managed marker through, so a surface can choose not to list the row", () => {
        const [managed] = toProviderConnections([
            {...writeOnlyRow, managementPolicy: SecretManagementPolicy.ManagerOnly},
        ])

        expect(managed.managementPolicy).toBe(SecretManagementPolicy.ManagerOnly)
    })

    it("shows the server's preview as the credential summary", () => {
        const [connected] = toProviderConnections([writeOnlyRow])

        expect(credentialSummary(connected)).toBe("sk-****9Qa")
    })

    it("says a value exists when the record has one but no preview to show", () => {
        const [connected] = toProviderConnections([{...writeOnlyRow, keyPreview: undefined}])

        expect(credentialSummary(connected)).toBe("Key configured")
    })

    it("exempts only the SECRET fields of a record that holds a credential", () => {
        const [connected] = toProviderConnections([writeOnlyRow])

        expect(storedCredentialFields(connected)).toContain("apiKey")
        expect(storedCredentialFields(connected)).not.toContain("apiBaseUrl")
        expect(storedCredentialFields(connection())).toEqual([])
    })

    it("lets an untouched card save: the stored key counts as filled", () => {
        const [connected] = toProviderConnections([writeOnlyRow])

        expect(hasRequiredCredential("openai", {apiKey: ""})).toBe(false)
        expect(
            hasRequiredCredential("openai", {apiKey: ""}, storedCredentialFields(connected)),
        ).toBe(true)
    })

    it("omits the key entirely when nothing was typed, rather than blanking the stored one", () => {
        const payload = buildConnectionPayload(
            {kind: "openai", name: "", credential: {apiKey: "  "}},
            "OpenAI",
        )

        expect((payload.secret.data as {provider: {key?: string}}).provider).toEqual({})
    })

    it("still sends a key the user did type", () => {
        const payload = buildConnectionPayload(
            {kind: "openai", name: "", credential: {apiKey: " sk-new "}},
            "OpenAI",
        )

        expect((payload.secret.data as {provider: {key?: string}}).provider).toEqual({
            key: "sk-new",
        })
    })
})

describe("Test on a write-only connection: the enable rule and the request shape", () => {
    // A write-only record hands its secret back to nobody, so the card's key box is empty on every
    // edit. Test used to demand typed material and was therefore unreachable for exactly the
    // connections most likely to need a model refresh.
    const stored = (overrides: Partial<ProviderConnection> = {}): ProviderConnection =>
        connection({id: "sec-1", hasStoredCredential: true, ...overrides})

    describe("the enable rule", () => {
        it("enables Test on a stored credential alone, with nothing typed", () => {
            const fields = storedCredentialFields(stored())

            expect(hasRequiredCredential("openai", {apiKey: ""}, fields)).toBe(true)
        })

        it("still refuses an empty form on a connection with nothing stored", () => {
            expect(
                hasRequiredCredential("openai", {apiKey: ""}, storedCredentialFields(connection())),
            ).toBe(false)
        })

        it("keeps enabling a custom endpoint on its base URL alone", () => {
            // Confirmed against the backend, not assumed: `OpenAICompatibleAdapter` adds the
            // Authorization header only `if key`, answers `credential: unknown` +
            // `discovery: fetched` for a keyless 200, and has a test pinning exactly that. An open
            // OpenAI-compatible server is a real deployment, so its URL stays sufficient.
            expect(
                hasRequiredCredential("custom", {apiBaseUrl: "https://llm.example.com/v1"}),
            ).toBe(true)
            expect(hasRequiredCredential("custom", {apiBaseUrl: ""})).toBe(false)
        })
    })

    describe("why a Test produced no verdict", () => {
        // A probe OUTCOME is a 200 with a status inside, so anything that throws is the request
        // failing — and "could not reach the provider" is false for everything the API rejects
        // on its own.
        const httpError = (status: number, detail?: string) => ({
            response: {status, data: detail ? {detail} : undefined},
        })

        it("says the connection is gone on a 404, not that the provider is unreachable", () => {
            expect(probeFailureMessage(httpError(404), "OpenAI")).toContain("no longer exists")
        })

        it("speaks the server's own words for a 4xx that carried a message", () => {
            expect(probeFailureMessage(httpError(422, "Stored key is for another provider."))).toBe(
                "Stored key is for another provider.",
            )
        })

        it("falls back to the reach-the-provider line for a transport failure or a 5xx", () => {
            expect(probeFailureMessage(new Error("network down"), "OpenAI")).toBe(
                "Agenta could not reach OpenAI to test this credential.",
            )
            expect(probeFailureMessage(httpError(500), "OpenAI")).toBe(
                "Agenta could not reach OpenAI to test this credential.",
            )
        })
    })

    describe("the request shape", () => {
        it("names the stored row instead of sending an empty credential", () => {
            const request = probeRequestFor("openai", {apiKey: ""}, stored())

            expect(request).toEqual({provider: {}, secret_id: "sec-1"})
        })

        it("sends typed non-secret fields alongside the stored row, for the server to override", () => {
            const request = probeRequestFor(
                "custom",
                {apiKey: "", apiBaseUrl: "https://edited.example.com/v1"},
                stored({kind: "custom"}),
            )

            expect(request).toEqual({
                provider: {url: "https://edited.example.com/v1"},
                secret_id: "sec-1",
            })
        })

        it("omits `kind` whenever it names a row, so it cannot contradict the stored one", () => {
            // The server rejects (422) a kind that disagrees with the stored one unless a key
            // rides along — and this request deliberately carries none. The stored kind is
            // authoritative, so the card's own canonical spelling is simply not sent.
            expect(probeRequestFor("openai", {apiKey: ""}, stored())).not.toHaveProperty("kind")
            // Without a row to name, the kind is the only thing that says what to probe.
            expect(probeRequestFor("openai", {apiKey: "sk-typed"}, stored()).kind).toBe("openai")
            expect(probeRequestFor("openai", {apiKey: ""}, connection()).kind).toBe("openai")
        })

        it("spends the typed credential and names no row once the user types one", () => {
            const request = probeRequestFor("openai", {apiKey: "sk-typed"}, stored())

            expect(request).toEqual({kind: "openai", provider: {key: "sk-typed"}})
            expect(request.secret_id).toBeUndefined()
        })

        it("names no row when the connection holds nothing, or when there is no connection", () => {
            expect(probeRequestFor("openai", {apiKey: ""}, connection()).secret_id).toBeUndefined()
            expect(probeRequestFor("openai", {apiKey: ""}, null).secret_id).toBeUndefined()
        })

        it("drops blank extras rather than sending a stored-row probe with empty AWS fields", () => {
            const request = probeRequestFor(
                "bedrock",
                {region: "eu-central-1", bearerToken: ""},
                stored({kind: "bedrock"}),
            )

            expect(request).toEqual({
                provider: {extras: {aws_region_name: "eu-central-1"}},
                secret_id: "sec-1",
            })
        })
    })
})
