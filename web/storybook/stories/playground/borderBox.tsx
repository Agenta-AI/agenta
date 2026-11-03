import type {Decorator} from "@storybook/nextjs"

/**
 * Storybook's Tailwind has no preflight, so its boxes are content-box, while the /m app's are
 * border-box. A `w-full` box with padding then comes out wider than its parent and the story
 * scrolls sideways at phone width. This draws the story with the app's box sizing.
 */
export const withAppBoxSizing: Decorator = (Story) => (
    <>
        <style>{".m-box-sizing, .m-box-sizing * { box-sizing: border-box; }"}</style>
        <div className="m-box-sizing">
            <Story />
        </div>
    </>
)
