/**
 * The tree's connector lines, ported from `react-jss` to Tailwind arbitrary variants.
 *
 * JSS cannot ship in this package (mobile bundles it without a JSS provider), and the rules are
 * pure geometry plus two theme colours, so they translate 1:1. Measurements are unchanged:
 * the vertical rule sits 6px in and overshoots 12px below; the elbow is 12px wide at 50% height,
 * 13px to the left; the label chip is 2px/4px padded with a 200px cap.
 */
export const treeLineClass =
    "before:content-[''] before:absolute before:left-[6px] before:top-0 before:-bottom-[12px] before:w-px before:bg-colorBorder [&.last]:before:h-1/2 [&.last]:before:bottom-auto"

export const nodeLabelClass =
    "relative cursor-default flex items-center mt-3 mb-3 before:content-[''] before:absolute before:top-1/2 before:-left-[13px] before:w-3 before:h-px before:bg-colorBorder"

export const nodeLabelContentClass =
    "max-w-[200px] py-0.5 px-1 rounded-control cursor-pointer hover:bg-colorFillSecondary"
