import type {Props as NavbarItemConfig} from "@theme/NavbarItem";

/**
 * The header's two call-to-action buttons are navbar items whose `html`
 * carries one of these classes (see themeConfig.navbar.items). Navbar/Content
 * and the hamburger's PrimaryMenu both pick them out with this helper so the
 * class names live in one place.
 */
export const CTA_CLASSES = {
  primary: "nav_primary_button",
  secondary: "nav_secondary_button",
} as const;

type CtaClass = (typeof CTA_CLASSES)[keyof typeof CTA_CLASSES];

/** The fields a CTA item carries; NavbarItem's Props union does not expose `html`. */
export type CtaItem = NavbarItemConfig & {html?: string; href?: string};

export function hasCtaClass(item: NavbarItemConfig, cls: CtaClass): boolean {
  const {html} = item as CtaItem;
  return typeof html === "string" && html.includes(cls);
}

export function isCta(item: NavbarItemConfig): boolean {
  return (
    hasCtaClass(item, CTA_CLASSES.primary) ||
    hasCtaClass(item, CTA_CLASSES.secondary)
  );
}
