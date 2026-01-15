# Dark Mode - Designer Requirements

This document outlines what the designer needs to provide before dark mode implementation can begin.

## Overview

We use Ant Design's token system for theming. The designer needs to provide dark mode values for all semantic tokens. These values will be used to generate:
1. Ant Design theme configuration
2. Tailwind CSS color utilities
3. CSS-in-JS theme tokens

---

## Required Deliverables

### 1. Core Color Palette

Provide hex values for each:

#### Background Colors
| Token | Description | Light Value | Dark Value |
|-------|-------------|-------------|------------|
| `colorBgBase` | Base background | `#ffffff` | ??? |
| `colorBgContainer` | Container/card background | `#ffffff` | ??? |
| `colorBgElevated` | Elevated surfaces (dropdowns, modals) | `#ffffff` | ??? |
| `colorBgLayout` | Page layout background | `#ffffff` | ??? |
| `colorBgSpotlight` | Spotlight/highlight areas | `#f5f7fa` | ??? |
| `colorBgMask` | Overlay/mask background | `rgba(0,0,0,0.45)` | ??? |

#### Text Colors
| Token | Description | Light Value | Dark Value |
|-------|-------------|-------------|------------|
| `colorText` | Primary text | `#1c2c3d` | ??? |
| `colorTextSecondary` | Secondary text | `#586673` | ??? |
| `colorTextTertiary` | Tertiary/muted text | `#758391` | ??? |
| `colorTextQuaternary` | Placeholder text | `#a3b3c2` | ??? |
| `colorTextDisabled` | Disabled text | `#bdc7d1` | ??? |

#### Border Colors
| Token | Description | Light Value | Dark Value |
|-------|-------------|-------------|------------|
| `colorBorder` | Default border | `#bdc7d1` | ??? |
| `colorBorderSecondary` | Secondary/subtle border | `#eaeff5` | ??? |

#### Fill/Hover Colors
| Token | Description | Light Value | Dark Value |
|-------|-------------|-------------|------------|
| `colorFill` | Default fill | `rgba(0,0,0,0.15)` | ??? |
| `colorFillSecondary` | Secondary fill | `rgba(0,0,0,0.06)` | ??? |
| `colorFillTertiary` | Tertiary fill | `rgba(0,0,0,0.04)` | ??? |
| `colorFillQuaternary` | Quaternary fill | `rgba(0,0,0,0.02)` | ??? |

---

### 2. Brand & Status Colors

These may need adjustment for visibility on dark backgrounds:

#### Primary Brand
| Token | Light Value | Dark Value |
|-------|-------------|------------|
| `colorPrimary` | `#1c2c3d` | ??? |
| `colorPrimaryBg` | `#e6f4ff` | ??? |
| `colorPrimaryBgHover` | `#bae0ff` | ??? |
| `colorPrimaryBorder` | `#91caff` | ??? |
| `colorPrimaryBorderHover` | `#69b1ff` | ??? |
| `colorPrimaryHover` | `#4096ff` | ??? |
| `colorPrimaryActive` | `#0958d9` | ??? |
| `colorPrimaryText` | `#1c2c3d` | ??? |
| `colorPrimaryTextHover` | `#4096ff` | ??? |
| `colorPrimaryTextActive` | `#0958d9` | ??? |

#### Success (Green)
| Token | Light Value | Dark Value |
|-------|-------------|------------|
| `colorSuccess` | `#52c41a` | ??? |
| `colorSuccessBg` | `#f6ffed` | ??? |
| `colorSuccessBorder` | `#b7eb8f` | ??? |

#### Warning (Yellow/Orange)
| Token | Light Value | Dark Value |
|-------|-------------|------------|
| `colorWarning` | `#faad14` | ??? |
| `colorWarningBg` | `#fffbe6` | ??? |
| `colorWarningBorder` | `#ffe58f` | ??? |

#### Error (Red)
| Token | Light Value | Dark Value |
|-------|-------------|------------|
| `colorError` | `#d61010` | ??? |
| `colorErrorBg` | `#fff2f0` | ??? |
| `colorErrorBorder` | `#ffccc7` | ??? |

#### Info (Blue)
| Token | Light Value | Dark Value |
|-------|-------------|------------|
| `colorInfo` | `#1677ff` | ??? |
| `colorInfoBg` | `#e6f4ff` | ??? |
| `colorInfoBorder` | `#91caff` | ??? |

---

### 3. Zinc Gray Scale

We use a custom zinc palette for grays. Provide dark mode versions:

| Token | Light Value | Dark Value | Usage |
|-------|-------------|------------|-------|
| `zinc.1` | `#f5f7fa` | ??? | Lightest background |
| `zinc.2` | `#eaeff5` | ??? | Light borders |
| `zinc.3` | `#dfe6ed` | ??? | Borders |
| `zinc.4` | `#bdc7d1` | ??? | Disabled |
| `zinc.5` | `#a3b3c2` | ??? | Placeholder |
| `zinc.6` | `#8898a8` | ??? | Secondary text |
| `zinc.7` | `#758391` | ??? | Tertiary text |
| `zinc.8` | `#586673` | ??? | Secondary text |
| `zinc.9` | `#1c2c3d` | ??? | Primary text |
| `zinc.10` | `#051729` | ??? | Darkest text |

---

### 4. Component-Specific Tokens (Optional but Helpful)

If you want specific component styling in dark mode:

#### Table
| Token | Light Value | Dark Value |
|-------|-------------|------------|
| `Table.headerBg` | `#fafafa` | ??? |
| `Table.rowHoverBg` | `#fafafa` | ??? |
| `Table.borderColor` | `#f0f0f0` | ??? |

#### Card
| Token | Light Value | Dark Value |
|-------|-------------|------------|
| `Card.colorBgContainer` | `#ffffff` | ??? |

#### Input
| Token | Light Value | Dark Value |
|-------|-------------|------------|
| `Input.colorBgContainer` | `#ffffff` | ??? |
| `Input.activeBorderColor` | `#1c2c3d` | ??? |

---

## Delivery Format

Please provide as JSON file (`antd-themeConfig-dark.json`):

```json
{
  "token": {
    "colorBgBase": "#0d0d0d",
    "colorBgContainer": "#141414",
    "colorBgElevated": "#1f1f1f",
    "colorBgLayout": "#0d0d0d",
    "colorText": "rgba(255, 255, 255, 0.85)",
    "colorTextSecondary": "rgba(255, 255, 255, 0.65)",
    "colorTextTertiary": "rgba(255, 255, 255, 0.45)",
    "colorBorder": "#424242",
    "colorBorderSecondary": "#303030",
    "colorPrimary": "#4096ff",
    "zinc": {
      "1": "#1f1f1f",
      "2": "#303030",
      "9": "rgba(255, 255, 255, 0.85)",
      "10": "#ffffff"
    }
  },
  "components": {
    "Table": {
      "headerBg": "#1f1f1f"
    }
  }
}
```

---

## Design Considerations

### Contrast Requirements
- Text on backgrounds should meet WCAG AA contrast ratio (4.5:1 for normal text)
- Interactive elements should be clearly distinguishable
- Status colors should remain meaningful in dark mode

### Common Patterns to Consider
1. **Inverted hierarchy:** In light mode, elevation often means lighter. In dark mode, elevation often means lighter too (slightly)
2. **Reduced saturation:** Bright colors on dark backgrounds can be harsh - consider slightly muted versions
3. **Border visibility:** Borders may need to be slightly lighter in dark mode to be visible

### Reference Examples
- [GitHub Dark Mode](https://github.com/settings/appearance)
- [Ant Design Dark Theme](https://ant.design/docs/react/customize-theme#use-dark-algorithm)
- [VS Code Dark Theme](https://code.visualstudio.com/docs/getstarted/themes)

---

## Questions for Designer

1. Should the primary brand color (`#1c2c3d`) change in dark mode? (It's very dark)
2. Do we want a "pure black" dark mode or a "soft dark" (dark gray) mode?
3. Should code editor backgrounds be darker than surrounding UI?
4. Any specific areas of the app that need special attention?
