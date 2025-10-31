import React from 'react';
import DocCard from '@theme/DocCard';
import type { PropSidebarItem } from '@docusaurus/plugin-content-docs';

interface CustomDocCardProps {
  item: PropSidebarItem;
  icon?: string; // Emoji or text icon
  imagePath?: string; // Path to SVG/image icon
  noIcon?: boolean; // Set to true to hide the default icon
}

/**
 * CustomDocCard - A wrapper around Docusaurus DocCard with custom icon support
 *
 * Usage examples:
 *
 * 1. With emoji icon:
 *    <CustomDocCard item={item} icon="🚀" />
 *
 * 2. With image/SVG icon:
 *    <CustomDocCard item={item} imagePath="/img/icons/rocket.svg" />
 *
 * 3. Without icon:
 *    <CustomDocCard item={item} noIcon={true} />
 *
 * 4. Default (standard arrow):
 *    <CustomDocCard item={item} />
 */
export default function CustomDocCard({
  item,
  icon,
  imagePath,
  noIcon
}: CustomDocCardProps) {
  const getClassName = () => {
    if (noIcon) return 'no-icon';
    if (imagePath) return 'icon-img';
    if (icon) return 'custom-icon';
    return '';
  };

  const getStyle = () => {
    if (imagePath) {
      return {
        '--card-icon-image': `url(${imagePath})`,
      } as React.CSSProperties;
    }
    return {};
  };

  // For image icons, we need to apply the background via inline style
  const cardProps: any = {
    item,
  };

  return (
    <div
      className={getClassName()}
      style={{
        ...(icon && { '--card-icon': `"${icon}"` }),
        ...(imagePath && { '--card-icon-bg': `url(${imagePath})` })
      } as React.CSSProperties}
    >
      <DocCard {...cardProps} />
    </div>
  );
}
