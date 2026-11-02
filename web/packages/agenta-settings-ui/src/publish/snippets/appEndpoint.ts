/** The languages the app endpoint snippets come in. */
export type AppEndpointLang = "python" | "bash" | "typescript"

export type AppEndpointSnippets = Record<AppEndpointLang, string>

/** Written into a snippet when the reader has not given an API key. */
export const API_KEY_PLACEHOLDER = "YOUR_API_KEY"

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
        inputs[key] = (definition as {default?: unknown} | undefined)?.default ?? "add_a_value"
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

const isChatParams = (params: string): boolean => {
    try {
        return JSON.parse(params)?.data?.inputs?.messages !== undefined
    } catch {
        return false
    }
}

const indent = (text: string, spaces: number): string =>
    text
        .split("\n")
        .map((line, index) => (index === 0 ? line : " ".repeat(spaces) + line))
        .join("\n")

export interface InvokeAppSnippetInput {
    url: string
    /** The body from `buildAppEndpointParams`. */
    params: string
    apiKey?: string
}

/** How to call a deployed app, once per language. */
export const buildInvokeAppSnippets = ({
    url,
    params,
    apiKey,
}: InvokeAppSnippetInput): AppEndpointSnippets => {
    const key = apiKey || API_KEY_PLACEHOLDER
    const chat = isChatParams(params)
    return {
        python: `import requests
import json

url = "${url}"
params = ${params}
headers = {
    "Content-Type": "application/json",
    "Authorization": "ApiKey ${key}",${chat ? `\n    "Baggage": "${SESSION_BAGGAGE}",` : ""}
}

response = requests.post(url, json=params, headers=headers)

data = response.json()

print(json.dumps(data, indent=4))
`,
        bash: `curl -X POST "${url}" \\
-H "Content-Type: application/json" \\
-H "Authorization: ApiKey ${key}" \\${chat ? `\n-H "Baggage: ${SESSION_BAGGAGE}" \\` : ""}
-d '${params}'
`,
        typescript: `import axios from 'axios';

const generate = async () => {
    const url = '${url}';
    const data = ${indent(params, 4)};
    const headers = {
        "Content-Type": "application/json",
        "Authorization": "ApiKey ${key}",${chat ? `\n        "Baggage": "${SESSION_BAGGAGE}",` : ""}
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
    app_slug="${appSlug}",
    environment_slug="${environmentSlug}",
)
print(config)
`,
        bash: `curl -X POST '${endpoint}' \\
-H 'Content-Type: application/json' \\
-H "Authorization: ApiKey ${key}" \\
-d '{
    "application_ref": {
        "slug": "${appSlug}"
    },
    "environment_ref": {
        "slug": "${environmentSlug}"
    }
}'
`,
        typescript: `import axios from 'axios';

const getConfig = async (appSlug: string, environmentSlug: string) => {
    const baseUrl = '${endpoint}';

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
                'Authorization': "ApiKey ${key}",
            },
        });

        return response.data;
    } catch {
        throw new Error('Failed to fetch configuration.');
    }
};

getConfig('${appSlug}', '${environmentSlug}').then(console.log).catch(console.error);
`,
    }
}
