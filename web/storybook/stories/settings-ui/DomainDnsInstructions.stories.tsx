import type {OrganizationDomain} from "@agenta/entities/organization"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, within} from "storybook/test"

import {DomainDnsInstructions} from "../../../mobile/src/features/settings/DomainDnsInstructions"

// The DNS TXT record for an unverified organization domain. The token is a public dummy value
// and the domain uses the reserved `.invalid` suffix.
const UNVERIFIED_DOMAIN: OrganizationDomain = {
    id: "domain-story-1",
    slug: "company.example.invalid",
    name: "Company",
    description: null,
    organization_id: "organization-story-1",
    token: "story-verification-token",
    flags: {is_verified: false},
    created_at: "2026-01-15T10:00:00.000Z",
    updated_at: null,
}

const VERIFIED_DOMAIN: OrganizationDomain = {
    ...UNVERIFIED_DOMAIN,
    id: "domain-story-2",
    token: null,
    flags: {is_verified: true},
}

const meta = {
    title: "Settings/AccessSecurity/DomainDnsInstructions",
    component: DomainDnsInstructions,
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "The DNS TXT record shown under an unverified domain. The record name and value come from the organization domain; the copy action copies the value only. A verified domain has no token, so the component renders nothing.",
            },
        },
    },
} satisfies Meta<typeof DomainDnsInstructions>

export default meta
type Story = StoryObj<typeof DomainDnsInstructions>

const assertNoHorizontalOverflow = (canvasElement: HTMLElement) => {
    const {documentElement, defaultView} = canvasElement.ownerDocument
    expect(documentElement.scrollWidth).toBeLessThanOrEqual(defaultView?.innerWidth ?? 0)
}

/** An unverified domain with a token: the exact record to publish at the domain provider. */
export const Record: Story = {
    args: {domain: UNVERIFIED_DOMAIN},
    render: (args) => (
        <div className="w-[420px] max-w-[calc(100vw-80px)]">
            <DomainDnsInstructions {...args} />
        </div>
    ),
    play: async ({canvasElement}) => {
        const screen = within(canvasElement.ownerDocument.body)
        await expect(
            screen.getByText("Name: _agenta-verification.company.example.invalid"),
        ).toBeInTheDocument()
        await expect(screen.getByText("Type: TXT")).toBeInTheDocument()
        await expect(
            screen.getByText("Value: _agenta-verification=story-verification-token"),
        ).toBeInTheDocument()
        assertNoHorizontalOverflow(canvasElement)
    },
}

/** A verified domain has no token, so there is no record left to publish. */
export const Verified: Story = {
    args: {domain: VERIFIED_DOMAIN},
}
