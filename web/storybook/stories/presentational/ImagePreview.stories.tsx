import {ImagePreview} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Image as AntImage} from "antd"

// ImagePreview is a small clickable thumbnail that opens an antd Modal with the full image.
// The closest antd counterpart is antd `Image` (which has the same click-to-preview behavior),
// rendered here in the antd cell for the parity diff.
const meta = {
    title: "@agenta/ui/Presentational/Media/ImagePreview",
    component: ImagePreview,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A small clickable thumbnail that opens an antd Modal with the full image. The closest antd counterpart is antd `Image` (same click-to-preview behavior), shown in the antd cell.\n\n**Used in:** 2 places — the eval-run chat message renderer and the online-evaluation prompt preview.",
            },
        },
    },
} satisfies Meta<typeof ImagePreview>

export default meta
type Story = StoryObj

// A base64 PNG, NOT an `svg+xml` data URI: `isSafeImageSrc` rejects SVG data URIs on purpose
// (an SVG can carry script), so an SVG fixture makes the agenta half render its broken-image
// fallback and the row measures the wrong thing.
const IMG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAABgklEQVR4Ae3BwW0cUQxEwefGBGaG8xMyw2FoMrAHAToIkG3tNsfoqh8/f729ETYirERYibASYSXCSoSVCCsRViKsRFiJsBJhJcJKhJUIKxFWIqxEWImwErm4sTm8q+aWLm5kDp+awwfV3MLFDczhj83hoZrVLhabwz+bw0M1K4ml5vCt5rCSWGgOTzGHdcQyc3iqOawiFpnDS8xhDRFWYok5vNQcVhBhJRaYg8Uc7ERYibASZtVYVWMlwkqElQgrsUA1FtXYibASS1TzUtWsIMJKLFLNS1SzhlimmqeqZhWxUDVPUc06YqlqvlU1K10sVs3DHP5aNatd3EA1D3P4smpu4eJGqvlgDu+quaWLG6vm9kRYibASYSXCSoSVCCsRViKsRFhdPMkc/jvVfDsRViKsRFiJsBJhJcJKhJUIKxFWIqxEWImwEmElwkqElQgrEVYirERYibASYSXCSoSVCCsRViKsRFhdPEk18QUirERYibASYfUbENTcYPmwA24AAAAASUVORK5CYII="

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[14rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            {/* Neither `.ant-image` nor a bare `<img>` is in the harness's SUBJECT list, so the
                thumbnail wrapper carries the explicit hook — otherwise the caption is measured. */}
            <div className="flex w-fit items-center" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="flex w-fit items-center" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[760px] flex-col">
            <Row
                label="thumbnail (size 48)"
                a={<AntImage width={48} height={48} src={IMG} alt="preview" />}
                s={<ImagePreview src={IMG} alt="preview" size={48} />}
            />
            <Row
                label="larger thumbnail (size 64)"
                a={<AntImage width={64} height={64} src={IMG} alt="preview" />}
                s={<ImagePreview src={IMG} alt="preview" size={64} />}
            />
        </div>
    ),
}
