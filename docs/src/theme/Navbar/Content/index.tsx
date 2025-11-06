import React from 'react';
import {useThemeConfig, ErrorCauseBoundary} from '@docusaurus/theme-common';
import {
  splitNavbarItems,
  useNavbarMobileSidebar,
} from '@docusaurus/theme-common/internal';
import NavbarItem, {type Props as NavbarItemConfig} from '@theme/NavbarItem';
import NavbarColorModeToggle from '@theme/Navbar/ColorModeToggle';
import SearchBar from '@theme/SearchBar';
import NavbarMobileSidebarToggle from '@theme/Navbar/MobileSidebar/Toggle';
import NavbarLogo from '@theme/Navbar/Logo';
import NavbarSearch from '@theme/Navbar/Search';

import styles from './styles.module.css';

function useNavbarItems() {
  return useThemeConfig().navbar.items as NavbarItemConfig[];
}

function NavbarItems({items}: {items: NavbarItemConfig[]}): JSX.Element {
  return (
    <>
      {items.map((item, i) => (
        <ErrorCauseBoundary
          key={i}
          onError={(error) =>
            new Error(
              `A theme navbar item failed to render.
Please double-check the following navbar item (themeConfig.navbar.items) of your Docusaurus config:
${JSON.stringify(item, null, 2)}`,
              {cause: error},
            )
          }>
          <NavbarItem {...item} />
        </ErrorCauseBoundary>
      ))}
    </>
  );
}

function NavbarContentLayout({
  left,
  right,
  mobileSidebarToggle,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  mobileSidebarToggle: React.ReactNode;
}) {
  return (
    <div className="navbar__inner">
      {/* First Row: Logo, Search, Actions */}
      <div className={styles.navbarTopRow}>
        <div className={styles.navbarLeft}>
          {mobileSidebarToggle}
          <NavbarLogo />
        </div>
        <div className={styles.navbarCenter}>
          <NavbarSearch>
            <SearchBar />
          </NavbarSearch>
        </div>
        <div className={styles.navbarRight}>{right}</div>
      </div>

      {/* Second Row: Navigation Links */}
      <div className={styles.navbarBottomRow}>
        <div className={styles.navbarLinks}>{left}</div>
      </div>
    </div>
  );
}

export default function NavbarContent(): JSX.Element {
  const mobileSidebar = useNavbarMobileSidebar();

  const items = useNavbarItems();
  const [leftItems, rightItems] = splitNavbarItems(items);

  // Filter out search from right items as we're placing it in center
  const filteredRightItems = rightItems.filter(
    (item) => item.type !== 'search',
  );

  // All left items go to bottom row (Docs, Tutorials, Reference, etc.)
  const navLinks = leftItems;

  return (
    <NavbarContentLayout
      mobileSidebarToggle={
        !mobileSidebar.disabled ? <NavbarMobileSidebarToggle /> : null
      }
      left={
        <>
          <NavbarItems items={navLinks} />
        </>
      }
      right={
        <>
          <NavbarItems items={filteredRightItems} />
          <NavbarColorModeToggle className={styles.colorModeToggle} />
        </>
      }
    />
  );
}
