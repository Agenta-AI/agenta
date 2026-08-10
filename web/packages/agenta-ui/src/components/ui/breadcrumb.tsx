import * as React from "react"

import {Slot} from "@radix-ui/react-slot"
import {MoreHorizontal} from "lucide-react"

import {cn} from "./utils"

/**
 * Breadcrumb — a presentational @agenta/ui re-skin of antd `Breadcrumb`, built from the
 * canonical shadcn `nav > ol > li` pattern (no Radix primitive; only `Slot` for `asChild`,
 * like Button). Colours resolve through the antd semantic token layer so they flip light↔dark.
 *
 * antd token map (from antd-themeConfig.json → Breadcrumb, confirmed in theme-variables.css):
 *   itemColor / linkColor / separatorColor = colorTextDescription (#758391 light)
 *   lastItemColor / linkHoverColor          = colorText            (#1c2c3d light)
 *   separatorMargin = marginXS (8px)  ·  fontSize 12px  ·  lineHeight 1.6667 (→ text-field-md)
 *
 * antd → @agenta/ui mapping. The layout call-site (`oss/src/components/Layout/assets/
 * Breadcrumbs.tsx`) renders a next/link `<Link>` — a real `<a>` — inside `title`, so antd's
 * `.ant-breadcrumb-link a` rules DO apply; the call-site then neutralises them with
 * `!p-0 !h-auto hover:!bg-transparent`. We drop antd's `padding: 0 4px` / `margin-inline: -4px`
 * pair (they cancel to zero) and the `colorBgTextHover` hover pill, which is the one real
 * deviation — see Breadcrumb.md §Deliberate deviations:
 *   <Breadcrumb items={[{title, href, menu}]} separator="/" />
 *     → <Breadcrumb><BreadcrumbList>
 *         <BreadcrumbItem><BreadcrumbLink href>…</BreadcrumbLink></BreadcrumbItem>
 *         <BreadcrumbSeparator/>
 *         <BreadcrumbItem><BreadcrumbPage>…</BreadcrumbPage></BreadcrumbItem>
 *       </BreadcrumbList></Breadcrumb>
 */

function Breadcrumb({className, ...props}: React.ComponentProps<"nav">) {
    return (
        <nav data-slot="breadcrumb" aria-label="breadcrumb" className={cn(className)} {...props} />
    )
}

function BreadcrumbList({className, ...props}: React.ComponentProps<"ol">) {
    return (
        <ol
            data-slot="breadcrumb-list"
            // antd: fontSize 12px + lineHeight 1.6667 = text-field-md; base crumb colour =
            // itemColor (colorTextDescription). Separator spacing lives on the separator (mx-2),
            // so the list has no inter-item gap. m-0/p-0/list-none reset UA <ol> (preflight off).
            className={cn(
                "m-0 flex list-none flex-wrap items-center p-0 text-field-md text-colorTextDescription",
                className,
            )}
            {...props}
        />
    )
}

function BreadcrumbItem({className, ...props}: React.ComponentProps<"li">) {
    // gap-1 aligns an optional leading icon with the label (both call-sites use flex/gap-1).
    return (
        <li
            data-slot="breadcrumb-item"
            className={cn("inline-flex items-center gap-1", className)}
            {...props}
        />
    )
}

function BreadcrumbLink({
    asChild,
    className,
    ...props
}: React.ComponentProps<"a"> & {asChild?: boolean}) {
    const Comp = asChild ? Slot : "a"
    return (
        <Comp
            data-slot="breadcrumb-link"
            // antd linkColor (colorTextDescription) → linkHoverColor (colorText). Dropping antd's
            // `colorBgTextHover` pill is the one deliberate deviation — the layout call-site
            // strips it from antd too (`hover:!bg-transparent`), and it needs no new token.
            // h-[22px] = antd fontHeight: antd's `a` is inline-block height:fontHeight, which
            // makes the whole row 22px (line-height 20 top-aligns the text, 2px below) — matched
            // so the crop dimensions equal antd's (a 20px row misregisters ~9% in the pixel VRT).
            className={cn(
                "inline-block h-[22px] cursor-pointer text-colorTextDescription transition-colors hover:text-colorText",
                className,
            )}
            {...props}
        />
    )
}

function BreadcrumbPage({className, ...props}: React.ComponentProps<"span">) {
    // antd lastItemColor = colorText. aria-current marks the current page for AT.
    return (
        <span
            data-slot="breadcrumb-page"
            role="link"
            aria-disabled="true"
            aria-current="page"
            // h-[22px] = antd fontHeight (see BreadcrumbLink) — keeps the row 22px + text top-aligned.
            className={cn("inline-block h-[22px] text-colorText", className)}
            {...props}
        />
    )
}

function BreadcrumbSeparator({children, className, ...props}: React.ComponentProps<"li">) {
    // antd: separatorColor = colorTextDescription; separatorMargin = marginXS (8px) each side;
    // icon separators render at fontSizeIcon 12px. aria-hidden — decorative.
    return (
        <li
            data-slot="breadcrumb-separator"
            role="presentation"
            aria-hidden="true"
            // h-[22px] = antd fontHeight (see BreadcrumbLink); mx-2 = separatorMargin (8px each
            // side); text top-aligns like antd's separator (glyph top 2). svg separator = 12px.
            className={cn(
                "inline-block h-[22px] mx-2 text-colorTextDescription [&>svg]:size-3",
                className,
            )}
            {...props}
        >
            {children ?? "/"}
        </li>
    )
}

function BreadcrumbEllipsis({className, ...props}: React.ComponentProps<"span">) {
    return (
        <span
            data-slot="breadcrumb-ellipsis"
            role="presentation"
            aria-hidden="true"
            // antd renders an icon crumb top-aligned in the 22px row (icon top 2 / centerY 8),
            // NOT centered. h-[22px] keeps the item from being centre-shifted by the list;
            // items-start + [&>svg]:mt-0.5 (2px = the size-4→size-3 inset) puts the 12px icon at
            // top 2 to match antd. w-4 = antd's size-4 box width.
            className={cn(
                "inline-flex h-[22px] w-4 items-start justify-center text-colorTextDescription [&>svg]:mt-0.5",
                className,
            )}
            {...props}
        >
            <MoreHorizontal className="size-3" />
            <span className="sr-only">More</span>
        </span>
    )
}

export {
    Breadcrumb,
    BreadcrumbList,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbPage,
    BreadcrumbSeparator,
    BreadcrumbEllipsis,
}
