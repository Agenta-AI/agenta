import React from "react";
import clsx from "clsx";
import NavbarNavLink from "@theme/NavbarItem/NavbarNavLink";

import type { ExtendedNavbarItemProps, IconConfig } from "..";
import { NavIcon } from "@site/src/icons/library";
import styles from "../styles.module.css";

type DesktopNavbarItemProps = ExtendedNavbarItemProps & {
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

export default function DefaultNavbarItemDesktop({
  className,
  isDropdownItem = false,
  customProps,
  label,
  html,
  ...props
}: DesktopNavbarItemProps) {
  const icon = customProps?.icon as IconConfig | undefined;
  const shouldUseRawLabel = Boolean(html) || label === undefined;
  const linkLabel = shouldUseRawLabel ? label : renderLabel(label, icon);

  const element = (
    <NavbarNavLink
      className={clsx(
        isDropdownItem ? "dropdown__link" : "navbar__item navbar__link",
        styles.navItem,
        className
      )}
      isDropdownLink={isDropdownItem}
      label={html ? undefined : linkLabel}
      html={html}
      {...props}
    />
  );

  if (isDropdownItem) {
    return <li>{element}</li>;
  }

  return element;
}
