/**
 * Ejected from @docusaurus/theme-classic: the "Releases" list under the
 * section rail. Sidebar items carry a title and a date only, so each row shows
 * those two.
 */
import React, {memo, type ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import {useVisibleBlogSidebarItems} from '@docusaurus/plugin-content-blog/client';
import type {Props} from '@theme/BlogSidebar/Desktop';
import {SidebarGroup} from '@site/src/components/SidebarShell';

import styles from './styles.module.css';

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function BlogSidebarDesktop({sidebar}: Props): ReactNode {
  const items = useVisibleBlogSidebarItems(sidebar.items);
  return (
    <SidebarGroup title={sidebar.title}>
      {items.map((item) => (
        <li key={item.permalink} className="menu__list-item">
          <Link
            isNavLink
            to={item.permalink}
            className={clsx('menu__link', styles.link)}
            activeClassName="menu__link--active">
            <span className={styles.title}>{item.title}</span>
            <time dateTime={String(item.date)} className={styles.date}>
              {dateFormatter.format(new Date(item.date))}
            </time>
          </Link>
        </li>
      ))}
    </SidebarGroup>
  );
}

export default memo(BlogSidebarDesktop);
