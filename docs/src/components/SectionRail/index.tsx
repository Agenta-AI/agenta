import React, { type ReactNode } from "react";
import { useThemeConfig } from "@docusaurus/theme-common";
import NavbarItem, { type Props as NavbarItemConfig } from "@theme/NavbarItem";

/**
 * The site's section links (Docs, Reference, Roadmap, ...) at the top of every
 * sidebar. They are the navbar's `position: "left"` items, rendered the way the
 * hamburger menu renders them (`mobile`), which gives `menu__link` rows with
 * icons and the same active-state resolution the navbar uses.
 */
export default function SectionRail(): ReactNode {
  const items = (useThemeConfig().navbar.items as NavbarItemConfig[]).filter(
    (item) => item.position === "left",
  );

  return (
    <nav className="sectionRail" aria-label="Sections">
      <ul className="menu__list">
        {items.map((item, i) => (
          <NavbarItem mobile {...item} key={i} />
        ))}
      </ul>
    </nav>
  );
}
