import React from "react";
import clsx from "clsx";
import NavbarNavLink from "@theme/NavbarItem/NavbarNavLink";

import type { ExtendedNavbarItemProps, IconConfig } from "..";
import { NavIcon } from "@site/src/icons/library";
import styles from "../styles.module.css";

type MobileNavbarItemProps = ExtendedNavbarItemProps & {
  className?: string;
  isDropdownItem?: boolean;
};

function renderLabel(
  label: React.ReactNode,
  icon?: IconConfig
): React.ReactNode {
  if (!icon) {
    return label;
  }

  return (
    <span className={styles.labelWithIcon}>
      <NavIcon {...icon} className={styles.icon} />
      <span className={styles.text}>{label}</span>
    </span>
  );
}

export default function DefaultNavbarItemMobile({
  className,
  customProps,
  label,
  html,
  ...props
}: MobileNavbarItemProps) {
  const icon = customProps?.icon as IconConfig | undefined;
  const shouldUseRawLabel = Boolean(html) || label === undefined;
  const linkLabel = shouldUseRawLabel ? label : renderLabel(label, icon);

  return (
    <li className="menu__list-item">
      <NavbarNavLink
        className={clsx("menu__link", styles.navItem, className)}
        label={html ? undefined : linkLabel}
        html={html}
        {...props}
      />
    </li>
  );
}
