# Custom Card Icon Usage Guide

This guide explains how to use custom icons with DocCard components in the documentation.

## Quick Start

Import the CustomDocCard component in your MDX files:

```mdx
import CustomDocCard from '@site/src/components/CustomDocCard';
```

## Usage Examples

### 1. Default Card (Standard Arrow Icon)
```mdx
import DocCard from '@theme/DocCard';

<DocCard item={{
  type: 'link',
  href: '/docs/getting-started',
  label: 'Getting Started',
  description: 'Learn the basics'
}} />
```

### 2. Card with Emoji Icon
```mdx
import CustomDocCard from '@site/src/components/CustomDocCard';

<CustomDocCard
  item={{
    type: 'link',
    href: '/docs/getting-started',
    label: 'Getting Started',
    description: 'Learn the basics'
  }}
  icon="🚀"
/>
```

### 3. Card with Image/SVG Icon
```mdx
import CustomDocCard from '@site/src/components/CustomDocCard';

<CustomDocCard
  item={{
    type: 'link',
    href: '/docs/api',
    label: 'API Reference',
    description: 'Explore our API'
  }}
  imagePath="/img/icons/api.svg"
/>
```

### 4. Card Without Icon
```mdx
import CustomDocCard from '@site/src/components/CustomDocCard';

<CustomDocCard
  item={{
    type: 'link',
    href: '/docs/faq',
    label: 'FAQ',
    description: 'Frequently asked questions'
  }}
  noIcon={true}
/>
```

## Using with DocCardList

For auto-generated card lists, you'll need to use a custom wrapper:

```mdx
import { useCurrentSidebarCategory } from '@docusaurus/theme-common';
import CustomDocCard from '@site/src/components/CustomDocCard';

export function CustomCardList({ icons = {} }) {
  const category = useCurrentSidebarCategory();

  return (
    <div className="row">
      {category.items.map((item, index) => (
        <article key={index} className="col col--6 margin-bottom--lg">
          <CustomDocCard
            item={item}
            icon={icons[item.docId]}
          />
        </article>
      ))}
    </div>
  );
}

<CustomCardList icons={{
  'getting-started': '🚀',
  'api-reference': '📚',
  'tutorials': '🎓'
}} />
```

## Direct HTML Approach (Alternative)

If you prefer not to use the component, you can add custom classes directly to regular DocCard:

### Using data attribute for emoji:
```mdx
<div data-card-icon="🎯">
  <DocCard item={{...}} />
</div>
```

### Using className for no icon:
```mdx
<div className="no-icon">
  <DocCard item={{...}} />
</div>
```

## Supported Icon Types

| Type | Method | Example |
|------|--------|---------|
| Emoji | `icon` prop | `icon="🚀"` |
| Unicode | `icon` prop | `icon="★"` |
| SVG File | `imagePath` prop | `imagePath="/img/icon.svg"` |
| PNG/JPG | `imagePath` prop | `imagePath="/img/icon.png"` |
| None | `noIcon` prop | `noIcon={true}` |

## Icon Best Practices

1. **Emoji Size**: Emojis are automatically sized at 24px
2. **Image Icons**: Should be square (24x24px recommended) for best results
3. **SVG Icons**: Preferred for crisp rendering at any resolution
4. **Consistency**: Use similar icon styles across related cards
5. **Accessibility**: Icons are decorative - ensure card titles are descriptive

## CSS Classes Reference

- `.custom-icon` - Applied when using emoji/text icons
- `.icon-img` - Applied when using image/SVG icons
- `.no-icon` - Applied when hiding the default icon
- `[data-card-icon]` - Attribute used to pass emoji/text content

## Troubleshooting

**Icons not showing?**
- Clear browser cache (Ctrl+Shift+R / Cmd+Shift+R)
- Verify image paths are correct (relative to /static folder)
- Check that CSS custom.css has been updated

**Default arrow still showing?**
- Ensure you're using `CustomDocCard` component or proper class names
- Verify the `noIcon` prop is set to `true`
