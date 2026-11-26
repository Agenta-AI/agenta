/**
 * Ejected from @docusaurus/theme-classic: the "Releases" list under the
 * section rail. Each entry shows its date over a one-line title.
 */
import React, {memo, type ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import {useVisibleBlogSidebarItems} from '@docusaurus/plugin-content-blog/client';
import type {Props} from '@theme/BlogSidebar/Desktop';
import {SidebarGroup} from '@site/src/components/SidebarShell';

import styles from './styles.module.css';

// "26 Oct": day first like the changelog dates, en-US for three-letter months.
const formatShortDate = (date: Date | string) => {
  const value = new Date(date);
  const month = value.toLocaleDateString('en-US', {month: 'short', timeZone: 'UTC'});
  return `${value.getUTCDate()} ${month}`;
};

function BlogSidebarDesktop({sidebar}: Props): ReactNode {
  const items = useVisibleBlogSidebarItems(sidebar.items);
  return (
    <SidebarGroup title={sidebar.title}>
      {items.map((item) => (
        <li key={item.permalink} className={clsx('menu__list-item', styles.item)}>
          <Link
            isNavLink
            to={item.permalink}
            className={clsx('menu__link', styles.link)}
            title={item.title}
            activeClassName="menu__link--active">
            <span className={styles.date}>{formatShortDate(item.date)}</span>
            <span className={styles.title}>{item.title}</span>
          </Link>
        </li>
      ))}
    </SidebarGroup>
  );
}

export default memo(BlogSidebarDesktop);
