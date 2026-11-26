import {useEffect, type ComponentProps} from "react"

import {organizationAccessApi} from "@agenta/entities/organization"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, userEvent, within} from "storybook/test"

import {OrganizationSlugField} from "../../../mobile/src/features/settings/OrganizationSlugField"

// The organization slug is set once and then read-only because it appears in SSO callback URLs.
// The update route is stubbed at the package API seam, so saving and conflict states need no
// network. The conflict is keyed on the typed slug, which keeps every story independent.
const stubSlugUpdate = async (_organizationId: string, slug: string): Promise<void> => {
    if (slug === "taken-slug") {
        throw Object.assign(new Error("Slug already taken"), {statusCode: 409})
    }
}

const SlugFieldFixture = (props: ComponentProps<typeof OrganizationSlugField>) => {
    useEffect(() => {
        const original = organizationAccessApi.updateOrganizationSlug
        organizationAccessApi.updateOrganizationSlug = stubSlugUpdate
        return () => {
            organizationAccessApi.updateOrganizationSlug = original
        }
    }, [])

    return (
        <div className="w-[380px] max-w-[calc(100vw-80px)]">
            <OrganizationSlugField {...props} />
        </div>
    )
}

const meta = {
    title: "Settings/AccessSecurity/OrganizationSlugField",
    component: OrganizationSlugField,
    render: (args) => <SlugFieldFixture {...args} />,
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "The organization slug form. A missing slug is editable; a set slug renders read-only because it is part of the SSO callback URL. Saving is stubbed at `organizationAccessApi`, so these stories show the saved and conflict states without a request.",
            },
        },
    },
} satisfies Meta<typeof OrganizationSlugField>

export default meta
type Story = StoryObj<typeof OrganizationSlugField>

const ORGANIZATION_ID = "organization-story-1"

const typeAndSave = async (canvasElement: HTMLElement, slug: string) => {
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.type(await screen.findByPlaceholderText("my-organization"), slug)
    await userEvent.click(await screen.findByRole("button", {name: "Save slug"}))
}

const assertNoHorizontalOverflow = (canvasElement: HTMLElement) => {
    const {documentElement, defaultView} = canvasElement.ownerDocument
    expect(documentElement.scrollWidth).toBeLessThanOrEqual(defaultView?.innerWidth ?? 0)
}

/** No slug yet: the form explains that the value is permanent and is needed by SSO. */
export const Unset: Story = {
    args: {organizationId: ORGANIZATION_ID, slug: null, canEdit: true},
    play: async ({canvasElement}) => {
        const screen = within(canvasElement.ownerDocument.body)
        await expect(await screen.findByRole("button", {name: "Save slug"})).toBeDisabled()
        assertNoHorizontalOverflow(canvasElement)
    },
}

/** A slug already exists: it is shown as read-only text with no input or save action. */
export const ReadOnly: Story = {
    args: {organizationId: ORGANIZATION_ID, slug: "acme-example", canEdit: true},
    play: async ({canvasElement}) => {
        const screen = within(canvasElement.ownerDocument.body)
        await expect(screen.getByText("acme-example")).toBeInTheDocument()
        await expect(
            screen.getByText("This slug is used in SSO callback URLs and cannot be changed."),
        ).toBeInTheDocument()
        await expect(screen.queryByPlaceholderText("my-organization")).not.toBeInTheDocument()
        assertNoHorizontalOverflow(canvasElement)
    },
}

/** A successful save replaces the form with the new read-only slug. */
export const Saved: Story = {
    args: {organizationId: ORGANIZATION_ID, slug: null, canEdit: true},
    play: async ({canvasElement}) => {
        await typeAndSave(canvasElement, "acme-story")
        const screen = within(canvasElement.ownerDocument.body)
        await expect(await screen.findByText("acme-story")).toBeInTheDocument()
        await expect(screen.queryByPlaceholderText("my-organization")).not.toBeInTheDocument()
        assertNoHorizontalOverflow(canvasElement)
    },
}

/** A conflict keeps the entered value and shows the reason, so the person can choose another. */
export const ConflictError: Story = {
    args: {organizationId: ORGANIZATION_ID, slug: null, canEdit: true},
    play: async ({canvasElement}) => {
        await typeAndSave(canvasElement, "taken-slug")
        const screen = within(canvasElement.ownerDocument.body)
        await expect(await screen.findByRole("alert")).toHaveTextContent(
            "That slug is already taken. Choose another.",
        )
        await expect(screen.getByPlaceholderText("my-organization")).toHaveValue("taken-slug")
        assertNoHorizontalOverflow(canvasElement)
    },
}
