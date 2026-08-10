import {ImageWithFallback} from "@agenta/ui/components/presentational"
import {ImageBroken} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Image as AntImage} from "antd"

// ImageWithFallback renders an <img> that swaps to a fallback node when the source is
// unsafe/broken. The antd counterpart is antd `Image` with its `fallback` prop, rendered in
// the antd cell for the parity diff.
const meta = {
    title: "@agenta/ui/Presentational/Media/ImageWithFallback",
    component: ImageWithFallback,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Renders an `<img>` that swaps to a fallback node when the source is unsafe or broken. The closest antd counterpart is antd `Image` with its `fallback` prop.\n\n**Used in:** 1 place — inside `ImagePreview` (`@agenta/ui` presentational). No direct app call-site.",
            },
        },
    },
} satisfies Meta<typeof ImageWithFallback>

export default meta
type Story = StoryObj

// Base64 PNGs, NOT `svg+xml` data URIs: `isSafeImageSrc` rejects SVG data URIs on purpose (an
// SVG can carry script), so an SVG fixture makes the agenta half fall back and never renders.
const IMG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAA6ElEQVR4AeXB223EMBAEwXaDgXnDYULecBjaGdC/4YdE3RlT9fb+8XgQTMJJOAkn4SSchJNwEk7CSTgJJ+Ek3OAJ1uRL1dxqcKM1+daaHKq5xeAGa/Jra3KoZivZbE1OWZOtJJxstCaXWJNtJJxssiaXWpMtJJyEk3ASTsJJONmkmktVs4WEk42quUQ120g42ayaU6rZanCDag5r8mPV3GJwo2oOa/Klam41eIJqXoaEk3ASTsJJOAk3OGFNXkY1fyLhJJyEk3ASTsJJOAkn4SSchJNwEk7CSTgJJ+Ek3OCEav49CSfhPgEOHCEU0ejeywAAAABJRU5ErkJggg=="
// Both halves swap to THIS on error, so the row gates the swap itself rather than comparing
// antd's fallback image against agenta's default icon (two deliberately different affordances).
const FALLBACK =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAeUlEQVR4AeXBAQEAMAyDMI5/rbWwCyF5244wiZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4ifuIHQRJCfci2wAAAABJRU5ErkJggg=="
const BROKEN = "https://invalid.invalid/does-not-exist.png"

const box = "w-16 h-16"

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[14rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            {/* Neither `.ant-image` nor a bare `<img>` is in the harness's SUBJECT list, so the
                image wrapper carries the explicit hook — otherwise the caption is measured. */}
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
                label="valid source"
                a={<AntImage width={64} height={64} src={IMG} alt="ok" preview={false} />}
                s={<ImageWithFallback src={IMG} alt="ok" className={`${box} object-cover`} />}
            />
            <Row
                label="broken source → fallback"
                a={
                    <AntImage
                        width={64}
                        height={64}
                        src={BROKEN}
                        alt="broken"
                        preview={false}
                        fallback={FALLBACK}
                    />
                }
                s={
                    <ImageWithFallback
                        src={BROKEN}
                        alt="broken"
                        className={`${box} object-cover`}
                        fallback={<ImageWithFallback src={FALLBACK} alt="broken" className={box} />}
                    />
                }
            />
            <Row
                label="broken → ReactNode fallback"
                a={
                    <span className="text-[10px] italic text-colorTextSecondary">
                        agenta only, no antd counterpart
                    </span>
                }
                s={
                    <ImageWithFallback
                        src={BROKEN}
                        alt="broken"
                        fallback={<ImageBroken size={32} className="text-colorTextTertiary" />}
                    />
                }
            />
        </div>
    ),
}
