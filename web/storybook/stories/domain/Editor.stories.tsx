import {Editor} from "@agenta/ui/editor"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * Editor — the @agenta/ui Lexical-based rich/code editor engine (`@agenta/ui/editor`).
 *
 * In the app this is fed by playground/eval state (token schemas, remote hydration,
 * onChange wiring). Here it renders entirely off local props with MOCK initial content
 * — no atoms, no fetchers, no remote hydration. The editor manages its own Lexical
 * composer internally (no external provider required), so a bare `initialValue` +
 * `language` is enough to see the engine render. This is the presentational surface;
 * the app's data logic is everything that computes `initialValue`/`tokens`/`onChange`.
 */
const meta = {
    title: "@agenta/ui/Domain/Editor",
    component: Editor,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The @agenta/ui Lexical-based rich/code editor engine (`@agenta/ui/editor`). Rendered entirely off local props with mocked content — no atoms, fetchers, or remote hydration.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const MOCK_JSON = JSON.stringify(
    {
        model: "gpt-4o",
        temperature: 0.7,
        max_tokens: 1024,
        messages: [
            {role: "system", content: "You are a concise assistant."},
            {role: "user", content: "Summarize the quarterly report."},
        ],
        tools: ["retrieval", "code_interpreter"],
    },
    null,
    2,
)

const MOCK_YAML = `model: gpt-4o
temperature: 0.7
max_tokens: 1024
messages:
  - role: system
    content: You are a concise assistant.
  - role: user
    content: Summarize the quarterly report.
`

const MOCK_MARKDOWN = `# Prompt template

You are a helpful assistant. Answer using the **context** below.

- Be concise
- Cite sources
- Prefer bullet points

\`\`\`
context: {{documents}}
\`\`\`
`

const Frame = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="mb-6 max-w-[720px]">
        <div className="mb-2 text-xs text-colorTextSecondary">{label}</div>
        <div className="border border-colorBorderSecondary rounded-md overflow-hidden">
            {children}
        </div>
    </div>
)

/**
 * Read-only JSON code view — mirrors how the app renders config/invocation blobs
 * (see EvalRunDetails FocusDrawer): `codeOnly`, `disabled`, mock `initialValue`.
 */
export const JsonReadOnly: Story = {
    render: () => (
        <Frame label="language=json · codeOnly · disabled (read-only mock config)">
            <Editor
                initialValue={MOCK_JSON}
                language="json"
                codeOnly
                disabled
                showToolbar={false}
                showLineNumbers
                enableResize={false}
                boundWidth
                dimensions={{width: "100%", height: "auto"}}
            />
        </Frame>
    ),
}

/**
 * Editable JSON with line numbers + toolbar — the interactive code editing surface.
 */
export const JsonEditable: Story = {
    render: () => (
        <Frame label="language=json · editable · line numbers">
            <Editor
                initialValue={MOCK_JSON}
                language="json"
                codeOnly
                showToolbar={false}
                showLineNumbers
                enableResize={false}
                boundWidth
                dimensions={{width: "100%", height: "auto"}}
            />
        </Frame>
    ),
}

/**
 * YAML syntax highlighting off the same mocked config.
 */
export const YamlReadOnly: Story = {
    render: () => (
        <Frame label="language=yaml · codeOnly · disabled">
            <Editor
                initialValue={MOCK_YAML}
                language="yaml"
                codeOnly
                disabled
                showToolbar={false}
                showLineNumbers
                enableResize={false}
                boundWidth
                dimensions={{width: "100%", height: "auto"}}
            />
        </Frame>
    ),
}

/**
 * Rich-text / markdown mode with token highlighting — the prompt-editing surface.
 * `enableTokens` + a mocked token list simulate the playground's variable tokens.
 */
export const RichTextWithTokens: Story = {
    render: () => (
        <Frame label="rich text · markdown · enableTokens (mock variable tokens)">
            <Editor
                initialValue={MOCK_MARKDOWN}
                showToolbar
                enableTokens
                tokens={["documents", "question"]}
                templateFormat="mustache"
                enableResize={false}
                boundWidth
                dimensions={{width: "100%", height: "auto"}}
            />
        </Frame>
    ),
}
