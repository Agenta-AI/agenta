import {ImagePreview} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Media/ImagePreview",
    component: ImagePreview,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A small clickable thumbnail that opens a dialog with the full image.\n\n**Used in:** 2 places — the eval-run chat message renderer and the online-evaluation prompt preview.",
            },
        },
    },
} satisfies Meta<typeof ImagePreview>

export default meta
type Story = StoryObj

// A base64 PNG, NOT an `svg+xml` data URI: `isSafeImageSrc` rejects SVG data URIs on purpose
// (an SVG can carry script), so an SVG fixture would render the broken-image fallback.
const IMG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAABgklEQVR4Ae3BwW0cUQxEwefGBGaG8xMyw2FoMrAHAToIkG3tNsfoqh8/f729ETYirERYibASYSXCSoSVCCsRViKsRFiJsBJhJcJKhJUIKxFWIqxEWImwErm4sTm8q+aWLm5kDp+awwfV3MLFDczhj83hoZrVLhabwz+bw0M1K4ml5vCt5rCSWGgOTzGHdcQyc3iqOawiFpnDS8xhDRFWYok5vNQcVhBhJRaYg8Uc7ERYibASZtVYVWMlwkqElQgrsUA1FtXYibASS1TzUtWsIMJKLFLNS1SzhlimmqeqZhWxUDVPUc06YqlqvlU1K10sVs3DHP5aNatd3EA1D3P4smpu4eJGqvlgDu+quaWLG6vm9kRYibASYSXCSoSVCCsRViKsRFhdPMkc/jvVfDsRViKsRFiJsBJhJcJKhJUIKxFWIqxEWImwEmElwkqElQgrEVYirERYibASYSXCSoSVCCsRViKsRFhdPEk18QUirERYibASYfUbENTcYPmwA24AAAAASUVORK5CYII="

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[14rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex w-fit items-center">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[760px] flex-col">
            <Row label="thumbnail (size 48)">
                <ImagePreview src={IMG} alt="preview" size={48} />
            </Row>
            <Row label="larger thumbnail (size 64)">
                <ImagePreview src={IMG} alt="preview" size={64} />
            </Row>
        </div>
    ),
}
