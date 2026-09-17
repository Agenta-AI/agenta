/**
 * Ejected from @docusaurus/theme-classic: the site footer. Logo and social
 * links on the left, the link columns from themeConfig.footer.links on the
 * right, and a copyright row below a rule. The social links come from
 * siteConfig.customFields.footerSocials (the footer config schema has no slot
 * for them).
 */
import React, {type ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import {useThemeConfig, type MultiColumnFooter} from '@docusaurus/theme-common';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import ThemedImage from '@theme/ThemedImage';
import useBaseUrl from '@docusaurus/useBaseUrl';

import styles from './styles.module.css';

type Social = {label: string; href: string; icon: 'x' | 'linkedin' | 'github' | 'slack'};

const ICONS: Record<Social['icon'], ReactNode> = {
  x: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.9 2H22l-7.2 8.2L23 22h-6.7l-5.2-6.8L5 22H1.9l7.7-8.8L1 2h6.8l4.7 6.2L18.9 2zm-1.2 18h1.8L7.1 3.9H5.2L17.7 20z" />
    </svg>
  ),
  linkedin: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.5 2h-17A1.5 1.5 0 0 0 2 3.5v17A1.5 1.5 0 0 0 3.5 22h17a1.5 1.5 0 0 0 1.5-1.5v-17A1.5 1.5 0 0 0 20.5 2zM8 19H5v-9h3v9zM6.5 8.3A1.8 1.8 0 1 1 6.5 4.7a1.8 1.8 0 0 1 0 3.6zM19 19h-3v-4.7c0-1.4-.5-2.1-1.6-2.1-1.2 0-1.9.8-1.9 2.1V19h-3v-9h2.9v1.3a3.4 3.4 0 0 1 3-1.6c2 0 3.6 1.2 3.6 3.8V19z" />
    </svg>
  ),
  github: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5A11.5 11.5 0 0 0 .5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.6v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5z" />
    </svg>
  ),
  slack: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M5.1 15.2a2.1 2.1 0 1 1-2.1-2.1h2.1v2.1zm1 0a2.1 2.1 0 0 1 4.2 0v5.2a2.1 2.1 0 0 1-4.2 0v-5.2zM8.2 6.7a2.1 2.1 0 1 1 2.1-2.1v2.1H8.2zm0 1.1a2.1 2.1 0 0 1 0 4.2H3a2.1 2.1 0 0 1 0-4.2h5.2zm8.6 1a2.1 2.1 0 1 1 2.1 2.1h-2.1V8.8zm-1 0a2.1 2.1 0 0 1-4.2 0V3.6a2.1 2.1 0 0 1 4.2 0v5.2zm-2.1 8.5a2.1 2.1 0 1 1-2.1 2.1v-2.1h2.1zm0-1.1a2.1 2.1 0 0 1 0-4.2H19a2.1 2.1 0 0 1 0 4.2h-5.3z" />
    </svg>
  ),
};

function FooterLogo({logo}: {logo: NonNullable<MultiColumnFooter['logo']>}): ReactNode {
  const sources = {
    light: useBaseUrl(logo.src),
    dark: useBaseUrl(logo.srcDark ?? logo.src),
  };
  const image = (
    <ThemedImage className={styles.logo} alt={logo.alt} sources={sources} height={logo.height} />
  );
  return logo.href ? (
    <Link href={logo.href} className={styles.logoLink} target={logo.target}>
      {image}
    </Link>
  ) : (
    image
  );
}

export default function Footer(): ReactNode {
  const {footer} = useThemeConfig();
  const {siteConfig} = useDocusaurusContext();
  const socials = (siteConfig.customFields?.footerSocials ?? []) as Social[];

  if (!footer) {
    return null;
  }
  const {logo, links, copyright} = footer as MultiColumnFooter;

  return (
    <footer className={clsx('footer', styles.footer)}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          {logo && <FooterLogo logo={logo} />}
          {socials.length > 0 && (
            <ul className={styles.socials}>
              {socials.map((s) => (
                <li key={s.href}>
                  <Link href={s.href} className={styles.social} aria-label={s.label}>
                    {ICONS[s.icon]}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={styles.columns}>
          {links.map((column) => (
            <div key={column.title} className={styles.column}>
              <div className={styles.columnTitle}>{column.title}</div>
              <ul className={styles.columnList}>
                {column.items.map((item) => (
                  <li key={item.label}>
                    {'html' in item && item.html ? (
                      <span dangerouslySetInnerHTML={{__html: item.html}} />
                    ) : (
                      <Link
                        className={styles.link}
                        to={'to' in item ? item.to : undefined}
                        href={'href' in item ? item.href : undefined}>
                        {item.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      {copyright && (
        <div className={styles.bottom}>
          <span dangerouslySetInnerHTML={{__html: copyright}} />
        </div>
      )}
    </footer>
  );
}
