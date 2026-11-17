import {ImageWithFallback} from "@agenta/ui/components/presentational"
import {ImageBroken} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Media/ImageWithFallback",
    component: ImageWithFallback,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Renders an `<img>` that swaps to a fallback node when the source is unsafe or broken.\n\n**Used in:** 1 place — inside `ImagePreview` (`@agenta/ui` presentational). No direct app call-site.",
            },
        },
    },
} satisfies Meta<typeof ImageWithFallback>

export default meta
type Story = StoryObj

// Base64 PNGs, NOT `svg+xml` data URIs: `isSafeImageSrc` rejects SVG data URIs on purpose (an
// SVG can carry script), so an SVG fixture would fall back and never render.
const IMG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAA6ElEQVR4AeXB223EMBAEwXaDgXnDYULecBjaGdC/4YdE3RlT9fb+8XgQTMJJOAkn4SSchJNwEk7CSTgJJ+Ek3OAJ1uRL1dxqcKM1+daaHKq5xeAGa/Jra3KoZivZbE1OWZOtJJxstCaXWJNtJJxssiaXWpMtJJyEk3ASTsJJONmkmktVs4WEk42quUQ120g42ayaU6rZanCDag5r8mPV3GJwo2oOa/Klam41eIJqXoaEk3ASTsJJOAk3OGFNXkY1fyLhJJyEk3ASTsJJOAkn4SSchJNwEk7CSTgJJ+Ek3OCEav49CSfhPgEOHCEU0ejeywAAAABJRU5ErkJggg=="
const FALLBACK =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAeUlEQVR4AeXBAQEAMAyDMI5/rbWwCyF5244wiZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4iZM4ifuIHQRJCfci2wAAAABJRU5ErkJggg=="
const BROKEN = "https://invalid.invalid/does-not-exist.png"

const box = "w-16 h-16"

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[14rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex w-fit items-center">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[760px] flex-col">
            <Row label="valid source">
                <ImageWithFallback src={IMG} alt="ok" className={`${box} object-cover`} />
            </Row>
            <Row label="broken source → fallback">
                <ImageWithFallback
                    src={BROKEN}
                    alt="broken"
                    className={`${box} object-cover`}
                    fallback={<ImageWithFallback src={FALLBACK} alt="broken" className={box} />}
                />
            </Row>
            <Row label="broken → ReactNode fallback">
                <ImageWithFallback
                    src={BROKEN}
                    alt="broken"
                    fallback={<ImageBroken size={32} className="text-colorTextTertiary" />}
                />
            </Row>
        </div>
    ),
}
