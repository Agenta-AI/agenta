import type {AppEnvironmentDeployment} from "@agenta/entities/environment"
import {
    buildAppEndpointParams,
    buildFetchConfigSnippets,
    buildInvokeAppSnippets,
} from "@agenta/settings-ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, userEvent, within} from "storybook/test"

import {EndpointsView} from "../../../mobile/src/features/endpoints/EndpointsView"

const meta = {
    title: "@agenta/mobile/Developer/Endpoints/EndpointsScreen",
    component: EndpointsView,
    parameters: {layout: "padded"},
    decorators: [
        (Story) => (
            <div className="mx-auto max-w-3xl">
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof EndpointsView>

export default meta
type Story = StoryObj<typeof meta>

const APPS = [
    {id: "app-1", name: "Capital finder", slug: "capital-finder"},
    {id: "app-2", name: "Support chat", slug: "support-chat"},
]

const env = (name: string, deployed: boolean): AppEnvironmentDeployment => ({
    name,
    slug: name,
    deployedVariantId: deployed ? `${name}-variant` : null,
    deployedRevisionId: deployed ? `${name}-revision` : null,
    deployedVariantName: deployed ? "default" : null,
    revision: deployed ? "3" : null,
    updatedAt: null,
})

const ENVIRONMENTS = [env("production", true), env("staging", true), env("development", false)]

const snippetsFor = (isChat: boolean) => {
    const params = buildAppEndpointParams({
        inputSchema: isChat ? null : {properties: {country: {type: "string"}}},
        environmentSlug: "production",
        isChat,
        appSlug: isChat ? "support-chat" : "capital-finder",
    })
    return {
        invoke: buildInvokeAppSnippets({
            url: "https://cloud.example.com/services/app/invoke",
            params,
        }),
        fetchConfig: buildFetchConfigSnippets({
            apiUrl: "https://cloud.example.com/api",
            appSlug: isChat ? "support-chat" : "capital-finder",
            environmentSlug: "production",
        }),
    }
}

const base = {
    state: "ready" as const,
    apps: APPS,
    appId: "app-1",
    onPickApp: () => undefined,
    onRetry: () => undefined,
    environments: ENVIRONMENTS,
    selected: ENVIRONMENTS[0],
    onSelectEnvironment: () => undefined,
    ...snippetsFor(false),
}

export const PickApp: Story = {args: {...base, state: "pickApp", appId: null, selected: null}}

export const Loading: Story = {args: {...base, state: "loading"}}

export const NoVariants: Story = {args: {...base, state: "noVariants", environments: []}}

export const PublishRequired: Story = {args: {...base, selected: ENVIRONMENTS[2]}}

export const LoadError: Story = {args: {...base, state: "error"}}

export const Filled: Story = {
    args: base,
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getByText("cURL"))
        await expect(canvas.getByTestId("endpoints-invoke-code")).toHaveTextContent("curl -X POST")
        await userEvent.click(canvas.getByRole("button", {name: /copy/i}))
    },
}

export const FilledChat: Story = {
    args: {...base, appId: "app-2", ...snippetsFor(true)},
}
