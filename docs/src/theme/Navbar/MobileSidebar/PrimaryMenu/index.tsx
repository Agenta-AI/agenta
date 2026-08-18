import React, { type ReactNode } from "react";
import { useThemeConfig } from "@docusaurus/theme-common";
import { useNavbarMobileSidebar } from "@docusaurus/theme-common/internal";
import NavbarItem, { type Props as NavbarItemConfig } from "@theme/NavbarItem";

function useNavbarItems() {
  // TODO temporary casting until ThemeConfig type is improved
  return useThemeConfig().navbar.items as NavbarItemConfig[];
}

function hasClass(item: unknown, cls: string): boolean {
  const html = (item as { html?: unknown })?.html;
  return typeof html === "string" && html.includes(cls);
}

function stripTags(html: string | undefined): string {
  // Strip repeatedly until stable so nested/malformed tags can't survive a
  // single pass (satisfies CodeQL's incomplete-sanitization check). The input
  // is our own static navbar config, but the loop keeps the label extraction
  // robust regardless.
  let out = html ?? "";
  let prev;
  do {
    prev = out;
    out = out.replace(/<[^>]*>/g, "");
  } while (out !== prev);
  return out.trim();
}

/**
 * The primary menu of the hamburger sidebar.
 *
 * Nav links flow in the scrolling list; the call-to-action buttons and the
 * community (GitHub / Slack) links are pulled out into a footer that is pinned
 * to the bottom of the screen. The CTA/social entries are identified by the
 * class names set on their `html` in the navbar config so this stays in sync
 * with `docusaurus.config.*` without hardcoding URLs.
 */
export default function NavbarMobilePrimaryMenu(): ReactNode {
  const mobileSidebar = useNavbarMobileSidebar();
  const items = useNavbarItems();
  const close = () => mobileSidebar.toggle();

  const secondary = items.find((i) => hasClass(i, "nav_secondary_button")) as
    | { href?: string; html?: string }
    | undefined;
  const primary = items.find((i) => hasClass(i, "nav_primary_button")) as
    | { href?: string; html?: string }
    | undefined;
  const github = items.find((i) => hasClass(i, "nav_github_icons")) as
    | { href?: string; html?: string }
    | undefined;
  const slack = items.find((i) => hasClass(i, "nav_slack_icons")) as
    | { href?: string; html?: string }
    | undefined;

  // Everything that isn't the search box, the version selector, a CTA button,
  // or a social icon is a normal navigation link shown in the scrolling list.
  // The version selector is rendered next to the logo by Navbar/Content at
  // every width, so repeating it here would show the same control twice.
  const navItems = items.filter(
    (i) =>
      (i as { type?: string }).type !== "search" &&
      (i as { type?: string }).type !== "docsVersionDropdown" &&
      !hasClass(i, "nav_secondary_button") &&
      !hasClass(i, "nav_primary_button") &&
      !hasClass(i, "nav_github_icons") &&
      !hasClass(i, "nav_slack_icons"),
  );

  const hasFooter = secondary || primary || github || slack;

  return (
    <>
      <ul className="menu__list">
        {navItems.map((item, i) => (
          <NavbarItem mobile {...item} onClick={close} key={i} />
        ))}
      </ul>

      {hasFooter && (
        <div className="mobileSidebarFooter">
          {(secondary || primary) && (
            <div className="mobileSidebarActions">
              {secondary && (
                <a
                  className="nav_secondary_button"
                  href={secondary.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={close}
                >
                  {stripTags(secondary.html)}
                </a>
              )}
              {primary && (
                <a
                  className="nav_primary_button"
                  href={primary.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={close}
                >
                  {stripTags(primary.html)}
                </a>
              )}
            </div>
          )}

          {(github || slack) && (
            <div className="mobileSidebarCommunity">
              <span className="mobileSidebarCommunityLabel">Community</span>
              <div className="mobileSidebarCommunityIcons">
                {github && (
                  <a
                    className="mobileSidebarSocialIcon"
                    href={github.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="GitHub"
                    onClick={close}
                    dangerouslySetInnerHTML={{ __html: github.html ?? "" }}
                  />
                )}
                {slack && (
                  <a
                    className="mobileSidebarSocialIcon"
                    href={slack.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Slack"
                    onClick={close}
                    dangerouslySetInnerHTML={{ __html: slack.html ?? "" }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
