import React from "react";
import DefaultNavbarItemMobile from "./Mobile";
import DefaultNavbarItemDesktop from "./Desktop";

export type IconConfig = {
  name: string;
  library?: string;
};

export type ExtendedNavbarItemProps = {
  mobile?: boolean;
  customProps?: {
    icon?: IconConfig;
    [key: string]: unknown;
  };
  label?: React.ReactNode;
  html?: string;
  [key: string]: unknown;
};

export default function DefaultNavbarItem({
  mobile = false,
  position, // Avoid passing position on to DOM elements
  ...props
}: ExtendedNavbarItemProps) {
  const Comp = mobile ? DefaultNavbarItemMobile : DefaultNavbarItemDesktop;

  return (
    <Comp
      {...props}
      activeClassName={
        props.activeClassName ??
        (mobile ? "menu__link--active" : "navbar__link--active")
      }
    />
  );
}
