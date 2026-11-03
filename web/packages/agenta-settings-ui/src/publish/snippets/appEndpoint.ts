/** The languages the app endpoint snippets come in. */
export type AppEndpointLang = "python" | "bash" | "typescript"

export type AppEndpointSnippets = Record<AppEndpointLang, string>

/** Written into a snippet when the reader has not given an API key. */
const API_KEY_PLACEHOLDER = "YOUR_API_KEY"

const SESSION_BAGGAGE = "ag.session.id=your_session_id"

export interface AppEndpointParamsInput {
    /** The JSON Schema of the deployed revision's inputs. */
    inputSchema: Record<string, unknown> | null
    environmentSlug: string
    isChat: boolean
    appSlug: string | null
}

/**
 * The example request body for an app: one input per schema property (its default, else a
 * placeholder), a user message for a chat app, and the app and environment references.
 */
export const buildAppEndpointParams = ({
    inputSchema,
    environmentSlug,
    isChat,
    appSlug,
}: AppEndpointParamsInput): string => {
    const inputs: Record<string, unknown> = {}
    const properties = inputSchema?.properties as Record<string, unknown> | undefined
    for (const [key, definition] of Object.entries(properties ?? {})) {
        const fallback = (definition as {default?: unknown} | undefined)?.default
        inputs[key] = fallback === undefined ? "add_a_value" : fallback
    }
    if (isChat) inputs.messages = [{role: "user", content: ""}]
    return JSON.stringify(
        {
            data: {inputs},
            references: {
                ...(appSlug ? {application: {slug: appSlug}} : {}),
                environment: {slug: environmentSlug},
            },
        },
        null,
        2,
    )
}

/** The value as Python source: JSON text breaks on `true`, `false` and `null`. */
const pythonLiteral = (value: unknown, depth = 0): string => {
    if (value === null || value === undefined) return "None"
    if (value === true) return "True"
    if (value === false) return "False"
    if (typeof value !== "object") return JSON.stringify(value)
    const pad = "  ".repeat(depth + 1)
    const close = "  ".repeat(depth)
    if (Array.isArray(value)) {
        if (!value.length) return "[]"
        return `[\n${value.map((item) => pad + pythonLiteral(item, depth + 1)).join(",\n")}\n${close}]`
    }
    const entries = Object.entries(value)
    if (!entries.length) return "{}"
    return `{\n${entries
        .map(([key, item]) => `${pad}${JSON.stringify(key)}: ${pythonLiteral(item, depth + 1)}`)
        .join(",\n")}\n${close}}`
}

/** The text as one shell argument in single quotes. */
const shellSingleQuoted = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`

/** The text as a quoted string literal that Python and TypeScript both accept. */
const stringLiteral = (text: string): string => JSON.stringify(text)

/**
 * The body as a TypeScript expression. An object literal turns a `__proto__` key into a
 * prototype setter, so a body with that key is parsed from JSON text instead.
 */
const typescriptValue = (json: string, spaces: number): string =>
    json.includes('"__proto__"') ? `JSON.parse(${stringLiteral(json)})` : indent(json, spaces)

const indent = (text: string, spaces: number): string =>
    text
        .split("\n")
        .map((line, index) => (index === 0 ? line : " ".repeat(spaces) + line))
        .join("\n")

export interface InvokeAppSnippetInput {
    url: string
    /** The body from `buildAppEndpointParams`. */
    params: string
    /** A chat app also needs the session header. */
    isChat: boolean
    apiKey?: string
}

/** How to call a deployed app, once per language. */
export const buildInvokeAppSnippets = ({
    url,
    params,
    isChat: chat,
    apiKey,
}: InvokeAppSnippetInput): AppEndpointSnippets => {
    const key = apiKey || API_KEY_PLACEHOLDER
    return {
        python: `import requests
import json

url = ${stringLiteral(url)}
params = ${pythonLiteral(JSON.parse(params))}
headers = {
    "Content-Type": "application/json",
    "Authorization": ${stringLiteral(`ApiKey ${key}`)},${chat ? `\n    "Baggage": "${SESSION_BAGGAGE}",` : ""}
}

response = requests.post(url, json=params, headers=headers)

data = response.json()

print(json.dumps(data, indent=4))
`,
        bash: `curl -X POST ${shellSingleQuoted(url)} \\
-H "Content-Type: application/json" \\
-H ${shellSingleQuoted(`Authorization: ApiKey ${key}`)} \\${chat ? `\n-H "Baggage: ${SESSION_BAGGAGE}" \\` : ""}
-d ${shellSingleQuoted(params)}
`,
        typescript: `import axios from 'axios';

const generate = async () => {
    const url = ${stringLiteral(url)};
    const data = ${typescriptValue(params, 4)};
    const headers = {
        "Content-Type": "application/json",
        "Authorization": ${stringLiteral(`ApiKey ${key}`)},${chat ? `\n        "Baggage": "${SESSION_BAGGAGE}",` : ""}
    };

    const response = await axios.post(url, data, { headers });

    console.log(response.data);
};

generate().catch(console.error);
`,
    }
}

export interface FetchConfigSnippetInput {
    /** The API origin and path, for example `https://host/api`. */
    apiUrl: string
    appSlug: string
    environmentSlug: string
    apiKey?: string
}

/** How to fetch an app's deployed config for one environment, once per language. */
export const buildFetchConfigSnippets = ({
    apiUrl,
    appSlug,
    environmentSlug,
    apiKey,
}: FetchConfigSnippetInput): AppEndpointSnippets => {
    const key = apiKey || API_KEY_PLACEHOLDER
    const endpoint = `${apiUrl}/applications/revisions/retrieve`
    return {
        python: `import os
import agenta as ag

os.environ["AGENTA_API_KEY"] = ${JSON.stringify(key)}
os.environ["AGENTA_API_URL"] = ${JSON.stringify(apiUrl)}

ag.init()
config = ag.ConfigManager.get_from_registry(
    app_slug=${stringLiteral(appSlug)},
    environment_slug=${stringLiteral(environmentSlug)},
)
print(config)
`,
        bash: `curl -X POST ${shellSingleQuoted(endpoint)} \\
-H 'Content-Type: application/json' \\
-H ${shellSingleQuoted(`Authorization: ApiKey ${key}`)} \\
-d ${shellSingleQuoted(
            JSON.stringify(
                {application_ref: {slug: appSlug}, environment_ref: {slug: environmentSlug}},
                null,
                4,
            ),
        )}
`,
        typescript: `import axios from 'axios';

const getConfig = async (appSlug: string, environmentSlug: string) => {
    const baseUrl = ${stringLiteral(endpoint)};

    try {
        const response = await axios.post(baseUrl, {
            application_ref: {
                slug: appSlug,
            },
            environment_ref: {
                slug: environmentSlug,
            },
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': ${stringLiteral(`ApiKey ${key}`)},
            },
        });

        return response.data;
    } catch {
        throw new Error('Failed to fetch configuration.');
    }
};

getConfig(${stringLiteral(appSlug)}, ${stringLiteral(environmentSlug)}).then(console.log).catch(console.error);
`,
    }
}
