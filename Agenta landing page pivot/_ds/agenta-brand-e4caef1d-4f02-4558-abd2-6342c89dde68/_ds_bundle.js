/* @ds-bundle: {"format":3,"namespace":"AgentaDesignSystem_e4caef","components":[{"name":"AppButton","sourcePath":"components/app/AppButton.jsx"},{"name":"ToolbarChip","sourcePath":"components/app/AppButton.jsx"},{"name":"AppSidebar","sourcePath":"components/app/AppSidebar.jsx"},{"name":"SidebarItem","sourcePath":"components/app/AppSidebar.jsx"},{"name":"PillTabs","sourcePath":"components/app/PillTabs.jsx"},{"name":"SearchField","sourcePath":"components/app/SearchField.jsx"},{"name":"Badge","sourcePath":"components/buttons/Badge.jsx"},{"name":"Button","sourcePath":"components/buttons/Button.jsx"},{"name":"FAQItem","sourcePath":"components/marketing/FAQItem.jsx"},{"name":"Footer","sourcePath":"components/marketing/Footer.jsx"},{"name":"HighlightChip","sourcePath":"components/marketing/HighlightChip.jsx"},{"name":"NavBar","sourcePath":"components/marketing/NavBar.jsx"},{"name":"SectionTitle","sourcePath":"components/marketing/SectionTitle.jsx"}],"sourceHashes":{"components/app/AppButton.jsx":"d3c15a82984f","components/app/AppSidebar.jsx":"8f4b0f85c5a2","components/app/PillTabs.jsx":"85f449cd6847","components/app/SearchField.jsx":"d178ac600b2f","components/buttons/Badge.jsx":"9a5242abf3b7","components/buttons/Button.jsx":"01bd2cc4ec3a","components/marketing/FAQItem.jsx":"8f8f23e79196","components/marketing/Footer.jsx":"6e92c3d85970","components/marketing/HighlightChip.jsx":"e1684ec6a6b3","components/marketing/NavBar.jsx":"0310bb9edf8a","components/marketing/SectionTitle.jsx":"9959e8ab64d6","ui_kits/web_app/ObservabilityScreen.jsx":"a88dc6d4e7e8","ui_kits/website/HomePage.jsx":"e7f8e30cada2"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.AgentaDesignSystem_e4caef = window.AgentaDesignSystem_e4caef || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/app/AppButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * App-chrome buttons & chips (Geist UI):
 * AppButton  — dark #242220 primary or white ring-shadow default, 28px.
 * ToolbarChip — 32px white chip with icon slot + ring shadow (filters, dates).
 */
function AppButton({
  variant = 'default',
  children,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const variants = {
    dark: {
      background: 'var(--carbon-800, #242220)',
      color: '#FFFFFF',
      boxShadow: '0px 0px 0px 1px rgb(63,70,75), 0px 1px 3px 0px rgba(63,70,75,0.1)'
    },
    default: {
      background: '#FFFFFF',
      color: 'var(--app-text-secondary, #595F61)',
      boxShadow: 'var(--shadow-ring, 0 0 0 1px rgba(63,70,75,0.1), 0 1px 3px rgba(63,70,75,0.1))'
    }
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 28,
      padding: '0 10px',
      border: 'none',
      borderRadius: 'var(--radius-sm, 8px)',
      font: 'var(--app-text-label, 500 14px/20px Geist, sans-serif)',
      cursor: 'pointer',
      filter: hover ? 'brightness(0.96)' : 'none',
      transition: 'filter 120ms ease',
      boxSizing: 'border-box',
      ...variants[variant],
      ...style
    }
  }, rest), children);
}
function ToolbarChip({
  icon,
  children,
  active = false,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", _extends({
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      height: 32,
      padding: '0 8px',
      border: 'none',
      borderRadius: 'var(--radius-md, 10px)',
      background: active ? 'var(--paper-100, #F6F5F3)' : '#FFFFFF',
      boxShadow: 'var(--shadow-ring, 0 0 0 1px rgba(63,70,75,0.1), 0 1px 3px rgba(63,70,75,0.1))',
      font: 'var(--app-text-label, 500 14px/20px Geist, sans-serif)',
      color: 'var(--app-text-secondary, #595F61)',
      cursor: 'pointer',
      filter: hover ? 'brightness(0.98)' : 'none',
      boxSizing: 'border-box',
      ...style
    }
  }, rest), icon ? /*#__PURE__*/React.createElement("img", {
    src: icon,
    alt: "",
    style: {
      width: 16,
      height: 16,
      display: 'block'
    }
  }) : null, children);
}
Object.assign(__ds_scope, { AppButton, ToolbarChip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/app/AppButton.jsx", error: String((e && e.message) || e) }); }

// components/app/AppSidebar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Product-app sidebar (220px, #FCFBFA). Sections of 32px items,
 * Geist Medium 14, selected item gets a #F0F0F0 rounded fill.
 */
function AppSidebar({
  workspace = 'Acme',
  sections = [{
    items: [{
      label: 'App management'
    }, {
      label: 'Test sets'
    }, {
      label: 'Observability'
    }]
  }, {
    heading: 'App name 1',
    items: [{
      label: 'Overview'
    }, {
      label: 'Playground'
    }, {
      label: 'Registry'
    }, {
      label: 'Evaluations',
      selected: true
    }, {
      label: 'Traces'
    }, {
      label: 'Deployments'
    }]
  }],
  footerItems = [{
    label: 'Settings'
  }, {
    label: 'Invite teammate'
  }, {
    label: 'Live chat'
  }, {
    label: 'Help & Docs'
  }],
  onSelect,
  style
}) {
  return /*#__PURE__*/React.createElement("aside", {
    style: {
      width: 'var(--app-sidebar-width, 220px)',
      background: 'var(--surface-app, #FCFBFA)',
      padding: 12,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      boxSizing: 'border-box',
      flexShrink: 0,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      height: 36,
      padding: '0 8px',
      boxSizing: 'border-box'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 20,
      height: 20,
      borderRadius: 6,
      background: 'var(--ink-900, #242424)',
      color: '#fff',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      font: 'var(--app-text-small, 500 12px/16px Geist, sans-serif)'
    }
  }, workspace.charAt(0)), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--app-text-label, 500 14px/20px Geist, sans-serif)',
      color: 'var(--app-text-body, #2A2C2D)'
    }
  }, workspace)), sections.map((section, si) => /*#__PURE__*/React.createElement("div", {
    key: si,
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    }
  }, section.heading ? /*#__PURE__*/React.createElement("span", {
    style: {
      padding: '0 4px',
      font: 'var(--app-text-small, 500 12px/16px Geist, sans-serif)',
      color: 'rgba(36,36,36,0.62)'
    }
  }, section.heading) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 1
    }
  }, section.items.map(item => /*#__PURE__*/React.createElement(SidebarItem, _extends({
    key: item.label
  }, item, {
    onClick: () => onSelect && onSelect(item.label)
  }))))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 1
    }
  }, footerItems.map(item => /*#__PURE__*/React.createElement(SidebarItem, _extends({
    key: item.label
  }, item, {
    muted: true,
    onClick: () => onSelect && onSelect(item.label)
  })))));
}

/** Single 32px sidebar row. Exported for custom sidebars. */
function SidebarItem({
  label,
  selected = false,
  muted = false,
  onClick,
  style
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      height: 'var(--app-item-height, 32px)',
      padding: '6px 8px',
      border: 'none',
      borderRadius: 'var(--radius-md, 10px)',
      background: selected ? 'var(--surface-selected, #F0F0F0)' : hover ? 'rgba(36,36,36,0.04)' : 'transparent',
      font: 'var(--app-text-label, 500 14px/20px Geist, sans-serif)',
      color: selected ? '#070A0D' : muted ? 'var(--ink-300, #A3A19F)' : '#374151',
      cursor: 'pointer',
      textAlign: 'left',
      width: '100%',
      boxSizing: 'border-box',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      width: 16,
      height: 16,
      borderRadius: 4,
      boxShadow: 'inset 0 0 0 1.5px currentColor',
      opacity: 0.45,
      flexShrink: 0
    }
  }), label);
}
Object.assign(__ds_scope, { AppSidebar, SidebarItem });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/app/AppSidebar.jsx", error: String((e && e.message) || e) }); }

// components/app/PillTabs.jsx
try { (() => {
/**
 * Pill tab group from the app chrome: 32px rounded-12 container on
 * #FAFAFA with inset ring; active tab is a white ring-shadow pill.
 */
function PillTabs({
  tabs = ['24h', '7d', '30d'],
  active,
  onChange,
  style
}) {
  const [internal, setInternal] = React.useState(active ?? tabs[0]);
  const current = active ?? internal;
  return /*#__PURE__*/React.createElement("div", {
    role: "tablist",
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      height: 32,
      padding: 4,
      borderRadius: 'var(--radius-lg, 12px)',
      background: '#FAFAFA',
      boxShadow: 'inset 0 0 0 1px var(--divider-app, #EFEFEF)',
      boxSizing: 'border-box',
      gap: 2,
      ...style
    }
  }, tabs.map(tab => {
    const isActive = tab === current;
    return /*#__PURE__*/React.createElement("button", {
      key: tab,
      role: "tab",
      "aria-selected": isActive,
      onClick: () => {
        setInternal(tab);
        if (onChange) onChange(tab);
      },
      style: {
        height: 24,
        padding: '0 10px',
        border: 'none',
        borderRadius: 8,
        background: isActive ? '#FFFFFF' : 'transparent',
        boxShadow: isActive ? 'var(--shadow-ring, 0 0 0 1px rgba(63,70,75,0.1), 0 1px 3px rgba(63,70,75,0.1))' : 'none',
        font: 'var(--app-text-small, 500 12px/16px Geist, sans-serif)',
        color: isActive ? 'var(--app-text-heading, #060402)' : 'var(--app-text-placeholder, #848B8C)',
        cursor: 'pointer'
      }
    }, tab);
  }));
}
Object.assign(__ds_scope, { PillTabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/app/PillTabs.jsx", error: String((e && e.message) || e) }); }

// components/app/SearchField.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * App text/search field — 32px, white, radius 10, ring shadow,
 * Geist Medium placeholder, optional 16px leading icon.
 */
function SearchField({
  placeholder = 'Search',
  icon,
  label,
  value,
  onChange,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      ...style
    }
  }, label ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--app-text-label, 500 14px/20px Geist, sans-serif)',
      color: 'var(--app-text-secondary, #595F61)'
    }
  }, label) : null, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      height: 32,
      padding: '0 8px',
      borderRadius: 'var(--radius-md, 10px)',
      background: '#FFFFFF',
      boxShadow: 'var(--shadow-ring, 0 0 0 1px rgba(63,70,75,0.1), 0 1px 3px rgba(63,70,75,0.1))',
      boxSizing: 'border-box'
    }
  }, icon ? /*#__PURE__*/React.createElement("img", {
    src: icon,
    alt: "",
    style: {
      width: 16,
      height: 16,
      display: 'block'
    }
  }) : null, /*#__PURE__*/React.createElement("input", _extends({
    type: "text",
    placeholder: placeholder,
    value: value,
    onChange: onChange,
    style: {
      border: 'none',
      outline: 'none',
      background: 'transparent',
      width: '100%',
      font: 'var(--app-text-label, 500 14px/20px Geist, sans-serif)',
      color: 'var(--app-text-body, #2A2C2D)'
    }
  }, rest))));
}
Object.assign(__ds_scope, { SearchField });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/app/SearchField.jsx", error: String((e && e.message) || e) }); }

// components/buttons/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Pill badge / eyebrow chip. Sits above section titles ("Problem",
 * "Solution") or inline ("Announcing our $8M seed round →").
 */
function Badge({
  children,
  variant = 'default',
  style,
  ...rest
}) {
  const variants = {
    default: {
      background: '#FFFFFF',
      color: 'var(--ink-600, #676770)',
      boxShadow: 'var(--shadow-badge, 0 0 0 1px #F0EFED, inset 0 2px 0.4px #fff)'
    },
    dark: {
      background: 'rgba(255,255,255,0.06)',
      color: 'rgba(255,255,255,0.8)',
      boxShadow: '0 0 0 1px rgba(229,229,227,0.18)'
    },
    yellow: {
      background: 'var(--yellow-400, #F2F25C)',
      color: 'var(--ink-900, #242424)',
      boxShadow: '0 0 0 1px rgba(36,36,36,0.12), inset 0 2px 0.4px rgba(255,255,255,0.6)'
    }
  };
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 22,
      padding: '0 12px',
      borderRadius: 'var(--radius-pill, 999px)',
      font: 'var(--text-caption, 500 12px/18px Inter, sans-serif)',
      letterSpacing: 'var(--tracking-caption, 0.03em)',
      whiteSpace: 'nowrap',
      boxSizing: 'border-box',
      ...variants[variant],
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/buttons/Badge.jsx", error: String((e && e.message) || e) }); }

// components/buttons/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Agenta website button. Variants lifted from Figma "button states":
 * primary = yellow gradient keycap, outline = paper ring, dark = charcoal
 * gradient (used on yellow CTA band), ghost = borderless nav button.
 */
function Button({
  variant = 'primary',
  size = 'md',
  children,
  href,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const sizes = {
    sm: {
      height: 30,
      padding: '0 12px'
    },
    md: {
      height: 36,
      padding: '0 16px'
    },
    lg: {
      height: 44,
      padding: '0 20px'
    }
  };
  const variants = {
    primary: {
      background: 'var(--grad-btn-primary, linear-gradient(180deg,#F2F25C,#E7E712))',
      boxShadow: 'var(--shadow-btn-primary, inset 0 2px 6.4px rgba(255,255,255,0.8))',
      color: 'var(--ink-900, #242424)'
    },
    outline: {
      background: 'var(--grad-btn-outline, linear-gradient(180deg,rgba(246,245,243,0.4),rgba(229,229,227,0.4)))',
      boxShadow: 'var(--shadow-btn-outline, 0 0 0 1px #F0EFED, inset 0 2px 6px #fff)',
      color: 'var(--ink-900, #242424)'
    },
    dark: {
      background: 'var(--grad-btn-dark, linear-gradient(180deg,#4D4D4D,#222))',
      boxShadow: 'var(--shadow-btn-dark, inset 0 2px 6.4px rgba(255,255,255,0.3))',
      color: '#FFFFFF'
    },
    ghost: {
      background: hover ? 'rgba(36,36,36,0.06)' : 'transparent',
      boxShadow: 'none',
      color: 'var(--ink-900, #242424)'
    }
  };
  const Tag = href ? 'a' : 'button';
  return /*#__PURE__*/React.createElement(Tag, _extends({
    href: href,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      border: 'none',
      borderRadius: 'var(--radius-sm, 8px)',
      font: 'var(--text-label, 500 14px/20px Inter, sans-serif)',
      cursor: 'pointer',
      textDecoration: 'none',
      whiteSpace: 'nowrap',
      filter: hover && variant !== 'ghost' ? 'brightness(0.97)' : 'none',
      transition: 'filter 120ms ease, background 120ms ease',
      boxSizing: 'border-box',
      ...sizes[size],
      ...variants[variant],
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/buttons/Button.jsx", error: String((e && e.message) || e) }); }

// components/marketing/FAQItem.jsx
try { (() => {
/**
 * FAQ accordion row — GT Alpina 20px question, hairline top border,
 * plus/minus toggle, Inter body answer.
 */
function FAQItem({
  question,
  answer,
  defaultOpen = false,
  style
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: '1px solid var(--border-soft, #F0EFED)',
      padding: '24px 0',
      cursor: 'pointer',
      ...style
    },
    onClick: () => setOpen(!open)
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 24
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-title, 400 20px/24px "GT Alpina", serif)',
      color: 'var(--text-heading, #242424)'
    }
  }, question), /*#__PURE__*/React.createElement("svg", {
    width: "24",
    height: "24",
    viewBox: "0 0 24 24",
    fill: "none",
    "aria-hidden": "true",
    style: {
      flexShrink: 0,
      transition: 'transform 160ms ease',
      transform: open ? 'rotate(45deg)' : 'none'
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 5v14M5 12h14",
    stroke: "var(--ink-600, #676770)",
    strokeWidth: "1.5",
    strokeLinecap: "round"
  }))), open && answer ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '12px 0 0',
      maxWidth: 720,
      font: 'var(--text-body-md, 400 16px/24px Inter, sans-serif)',
      color: 'var(--text-body, #676770)'
    }
  }, answer) : null);
}
Object.assign(__ds_scope, { FAQItem });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/marketing/FAQItem.jsx", error: String((e && e.message) || e) }); }

// components/marketing/Footer.jsx
try { (() => {
/**
 * Website footer — logo + tagline + social chips left, four link
 * columns right, copyright rule at the bottom. White panel.
 */
function Footer({
  logoSrc,
  socialSrcs = [],
  columns = [{
    heading: 'Product',
    links: ['Prompt engineering', 'Evaluation', 'Human annotation', 'Observability', 'Deployment']
  }, {
    heading: 'Resources',
    links: ['Documentation', 'Blog', 'Changelog', 'Roadmap']
  }, {
    heading: 'Company',
    links: ['About', 'Careers', 'Contact']
  }, {
    heading: 'Legal',
    links: ['Privacy policy', 'Terms', 'Imprint']
  }],
  style
}) {
  return /*#__PURE__*/React.createElement("footer", {
    style: {
      background: 'var(--surface-section, #FFFFFF)',
      border: '1px solid var(--border-default, #E5E5E3)',
      boxSizing: 'border-box',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: 64,
      padding: '64px 172px 96px',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      maxWidth: 268
    }
  }, logoSrc ? /*#__PURE__*/React.createElement("img", {
    src: logoSrc,
    alt: "Agenta",
    style: {
      height: 23,
      width: 'fit-content',
      display: 'block'
    }
  }) : /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-display, "GT Alpina", serif)',
      fontWeight: 500,
      fontSize: 20,
      color: 'var(--ink-900,#242424)'
    }
  }, "Agenta"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-label, 500 14px/17.5px Inter, sans-serif)',
      lineHeight: 1.25,
      color: 'var(--text-body, #676770)',
      whiteSpace: 'pre-line'
    }
  }, 'Fast-tracking LLM apps\nto production'), socialSrcs.length ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 4,
      marginTop: 8
    }
  }, socialSrcs.map((src, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      width: 32,
      height: 32,
      background: 'var(--paper-100, #F6F5F3)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: "",
    style: {
      width: 20,
      height: 20,
      display: 'block'
    }
  })))) : null), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 64,
      flexWrap: 'wrap'
    }
  }, columns.map(col => /*#__PURE__*/React.createElement("div", {
    key: col.heading,
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      minWidth: 120
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-caption, 500 12px/18px Inter, sans-serif)',
      letterSpacing: 'var(--tracking-caption, 0.03em)',
      color: 'var(--text-faint, #A3A19F)'
    }
  }, col.heading), col.links.map(link => /*#__PURE__*/React.createElement("a", {
    key: link,
    href: "#",
    onClick: e => e.preventDefault(),
    style: {
      font: 'var(--text-label, 500 14px/20px Inter, sans-serif)',
      color: 'var(--ink-600, #676770)',
      textDecoration: 'none'
    }
  }, link)))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '16px 32px',
      borderTop: '1px solid var(--border-default, #E5E5E3)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-caption, 500 12px/18px Inter, sans-serif)',
      color: 'var(--text-faint, #A3A19F)'
    }
  }, "Copyright \xA9 ", new Date().getFullYear(), " Agentatech UG"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-caption, 500 12px/18px Inter, sans-serif)',
      color: 'var(--text-faint, #A3A19F)'
    }
  }, "Privacy policy")));
}
Object.assign(__ds_scope, { Footer });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/marketing/Footer.jsx", error: String((e && e.message) || e) }); }

// components/marketing/HighlightChip.jsx
try { (() => {
/**
 * The PP Mondwest "bitmap word" chip used inside hero headlines:
 * a soft gradient keycap holding one highlighted word, e.g.
 * "The open-source [LLMOps] platform".
 */
function HighlightChip({
  children,
  fontSize = 68,
  style
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-block',
      padding: '0.02em 0.18em 0.08em',
      borderRadius: 10,
      background: 'var(--grad-chip, linear-gradient(180deg,#F4F2F0,#E9E5E2))',
      boxShadow: 'inset 0px 2px 0.4px 0px #FFFFFF',
      fontFamily: 'var(--font-bitmap, "PP Mondwest", monospace)',
      fontWeight: 400,
      fontSize,
      lineHeight: 1.06,
      color: 'var(--ink-900, #242424)',
      verticalAlign: 'baseline',
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { HighlightChip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/marketing/HighlightChip.jsx", error: String((e && e.message) || e) }); }

// components/marketing/NavBar.jsx
try { (() => {
/**
 * Website navbar: logo left, center links, "Book a demo" outline +
 * "Get started" primary right. 68px tall, paper background, hairline border.
 */
function NavBar({
  logoSrc,
  links = ['Product', 'Pricing', 'Docs', 'Resources', 'Community'],
  withChevron = ['Product', 'Resources', 'Community'],
  style
}) {
  return /*#__PURE__*/React.createElement("nav", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: 'var(--nav-height, 68px)',
      padding: '0 32px',
      background: 'var(--surface-page, #F6F5F3)',
      border: '1px solid var(--border-default, #E5E5E3)',
      boxSizing: 'border-box',
      ...style
    }
  }, logoSrc ? /*#__PURE__*/React.createElement("img", {
    src: logoSrc,
    alt: "Agenta",
    style: {
      height: 23,
      display: 'block'
    }
  }) : /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-display, "GT Alpina", serif)',
      fontWeight: 500,
      fontSize: 20,
      color: 'var(--ink-900, #242424)'
    }
  }, "Agenta"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 4
    }
  }, links.map(label => /*#__PURE__*/React.createElement(__ds_scope.Button, {
    key: label,
    variant: "ghost",
    size: "sm"
  }, label, withChevron.includes(label) ? /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 12 12",
    fill: "none",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M2.5 4.25 6 7.75l3.5-3.5",
    stroke: "currentColor",
    strokeWidth: "1.5"
  })) : null))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "outline",
    size: "sm"
  }, "Book a demo"), /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "primary",
    size: "sm"
  }, "Get started")));
}
Object.assign(__ds_scope, { NavBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/marketing/NavBar.jsx", error: String((e && e.message) || e) }); }

// components/marketing/SectionTitle.jsx
try { (() => {
/**
 * Centered section header: eyebrow badge → GT Alpina Light title →
 * muted subcopy. The core rhythm of every Agenta website section.
 */
function SectionTitle({
  badge,
  title,
  subtitle,
  dark = false,
  align = 'center',
  size = 'lg',
  style
}) {
  const titleFont = size === 'xl' ? 'var(--text-display-xl, 300 68px/72px "GT Alpina", serif)' : 'var(--text-display-lg, 300 48px/52px "GT Alpina", serif)';
  return /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      alignItems: align === 'center' ? 'center' : 'flex-start',
      textAlign: align,
      maxWidth: 'var(--prose-width, 677px)',
      ...style
    }
  }, badge ? /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    variant: dark ? 'dark' : 'default'
  }, badge) : null, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      font: titleFont,
      color: dark ? '#FFFFFF' : 'var(--text-heading, #242424)',
      textWrap: 'pretty'
    }
  }, title), subtitle ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--text-body-md, 400 16px/24px Inter, sans-serif)',
      color: dark ? 'var(--text-on-dark-muted, rgba(255,255,255,0.64))' : 'var(--text-muted, rgba(2,1,17,0.6))',
      textWrap: 'pretty'
    }
  }, subtitle) : null);
}
Object.assign(__ds_scope, { SectionTitle });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/marketing/SectionTitle.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web_app/ObservabilityScreen.jsx
try { (() => {
// Agenta web app — Observability screen (traces table)
// Recreated from Figma node 2373:13866 "web app"

const {
  AppSidebar,
  AppButton,
  ToolbarChip,
  PillTabs,
  SearchField
} = window.AgentaDesignSystem_e4caef;
const TRACES = [{
  id: '8f3a-22c1',
  input: 'Summarize the refund policy for…',
  output: 'Our refund policy allows returns within 30 days…',
  duration: '1.24s',
  cost: '$0.0031',
  usage: '1,204 tok',
  ts: 'Dec 9, 2024 14:32'
}, {
  id: '7be2-91d4',
  input: 'Classify this support ticket: "My invoi…',
  output: '{ "category": "billing", "priority": "high" }',
  duration: '0.82s',
  cost: '$0.0012',
  usage: '486 tok',
  ts: 'Dec 9, 2024 14:31'
}, {
  id: '3cd1-08aa',
  input: 'Extract entities from the attached con…',
  output: '[{ "name": "Acme GmbH", "type": "org" }…',
  duration: '2.07s',
  cost: '$0.0058',
  usage: '2,011 tok',
  ts: 'Dec 9, 2024 14:29'
}, {
  id: 'f214-77b0',
  input: 'Translate onboarding email to German',
  output: 'Willkommen bei Agenta! Wir freuen uns…',
  duration: '1.49s',
  cost: '$0.0027',
  usage: '954 tok',
  ts: 'Dec 9, 2024 14:25'
}, {
  id: '60e9-3c5f',
  input: 'Draft a reply declining the feature req…',
  output: 'Thanks for the suggestion — for now we…',
  duration: '1.11s',
  cost: '$0.0022',
  usage: '812 tok',
  ts: 'Dec 9, 2024 14:21'
}, {
  id: 'a98b-d042',
  input: 'Rate this answer for groundedness',
  output: '{ "score": 4, "rationale": "Cites source…',
  duration: '0.64s',
  cost: '$0.0009',
  usage: '301 tok',
  ts: 'Dec 9, 2024 14:18'
}, {
  id: '1d77-5e23',
  input: 'Generate test cases for the prompt v…',
  output: '12 test cases generated across 4 edge…',
  duration: '3.12s',
  cost: '$0.0104',
  usage: '3,842 tok',
  ts: 'Dec 9, 2024 14:12'
}];
const COLS = [{
  key: 'id',
  label: 'ID',
  width: 96,
  mono: true
}, {
  key: 'input',
  label: 'Input',
  width: 250
}, {
  key: 'output',
  label: 'Output',
  width: 250
}, {
  key: 'duration',
  label: 'Duration',
  width: 80,
  mono: true
}, {
  key: 'cost',
  label: 'Cost',
  width: 76,
  mono: true
}, {
  key: 'usage',
  label: 'Usage',
  width: 84,
  mono: true
}, {
  key: 'ts',
  label: 'Timestamp',
  width: 140,
  mono: true
}];
function TracesTable({
  query,
  onOpen
}) {
  const [checked, setChecked] = React.useState({});
  const rows = TRACES.filter(t => !query || (t.input + t.output + t.id).toLowerCase().includes(query.toLowerCase()));
  const cellBase = {
    padding: '10px 24px 10px 0',
    font: 'var(--app-text-label)',
    fontSize: 13,
    color: 'var(--app-text-body)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    textAlign: 'left'
  };
  return /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      tableLayout: 'fixed'
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      borderBottom: '1px solid var(--divider-app)'
    }
  }, /*#__PURE__*/React.createElement("th", {
    style: {
      width: 40
    }
  }), COLS.map(c => /*#__PURE__*/React.createElement("th", {
    key: c.key,
    style: {
      ...cellBase,
      width: c.width,
      font: 'var(--app-text-small)',
      color: 'var(--app-text-secondary)'
    }
  }, c.label)))), /*#__PURE__*/React.createElement("tbody", null, rows.map(t => /*#__PURE__*/React.createElement("tr", {
    key: t.id,
    onClick: () => onOpen(t),
    style: {
      borderBottom: '1px solid var(--divider-app)',
      cursor: 'pointer'
    },
    onMouseEnter: e => e.currentTarget.style.background = 'var(--paper-50)',
    onMouseLeave: e => e.currentTarget.style.background = 'transparent'
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      width: 40,
      padding: '10px 24px 10px 0'
    }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: e => {
      e.stopPropagation();
      setChecked({
        ...checked,
        [t.id]: !checked[t.id]
      });
    },
    style: {
      display: 'inline-block',
      width: 16,
      height: 16,
      borderRadius: 4,
      background: checked[t.id] ? 'var(--carbon-800)' : '#fff',
      boxShadow: 'var(--shadow-ring)'
    }
  })), COLS.map(c => /*#__PURE__*/React.createElement("td", {
    key: c.key,
    style: {
      ...cellBase,
      width: c.width,
      fontFamily: c.mono ? 'var(--font-mono)' : 'var(--font-ui)',
      fontSize: c.mono ? 12 : 13
    }
  }, t[c.key])))), rows.length === 0 ? /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: COLS.length + 1,
    style: {
      ...cellBase,
      color: 'var(--app-text-placeholder)',
      padding: '24px 0'
    }
  }, "No traces match \"", query, "\"")) : null));
}
function TraceDrawer({
  trace,
  onClose
}) {
  if (!trace) return null;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 8,
      right: 8,
      bottom: 8,
      width: 380,
      background: '#fff',
      borderRadius: 8,
      boxShadow: '0 0 0 1px rgba(63,70,75,0.1), 0 8px 24px rgba(63,70,75,0.16)',
      padding: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      boxSizing: 'border-box',
      zIndex: 5
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--app-text-title)',
      color: 'var(--app-text-heading)'
    }
  }, "Trace"), /*#__PURE__*/React.createElement(AppButton, {
    variant: "default",
    onClick: onClose
  }, "Close")), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--app-text-mono)',
      color: 'var(--app-text-secondary)'
    }
  }, "trace_id: ", trace.id, " \xB7 ", trace.duration, " \xB7 ", trace.cost, " \xB7 ", trace.usage), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--app-text-small)',
      color: 'var(--app-text-secondary)'
    }
  }, "Input"), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 12,
      borderRadius: 10,
      background: 'var(--paper-50)',
      boxShadow: 'inset 0 0 0 1px var(--divider-app)',
      font: 'var(--app-text-label)',
      fontSize: 13,
      color: 'var(--app-text-body)'
    }
  }, trace.input)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--app-text-small)',
      color: 'var(--app-text-secondary)'
    }
  }, "Output"), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 12,
      borderRadius: 10,
      background: 'var(--paper-50)',
      boxShadow: 'inset 0 0 0 1px var(--divider-app)',
      font: 'var(--app-text-mono)',
      color: 'var(--app-text-body)'
    }
  }, trace.output)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      marginTop: 'auto'
    }
  }, /*#__PURE__*/React.createElement(AppButton, {
    variant: "default"
  }, "Add to test set"), /*#__PURE__*/React.createElement(AppButton, {
    variant: "dark"
  }, "Annotate")));
}
function ObservabilityScreen() {
  const [view, setView] = React.useState('Evaluations');
  const [query, setQuery] = React.useState('');
  const [openTrace, setOpenTrace] = React.useState(null);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      display: 'flex',
      width: 1440,
      height: 800,
      borderRadius: 8,
      background: 'var(--surface-app)',
      boxShadow: 'var(--shadow-ring)',
      overflow: 'hidden',
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement(AppSidebar, {
    workspace: "Acme",
    onSelect: setView,
    sections: [{
      items: [{
        label: 'App management'
      }, {
        label: 'Test sets'
      }, {
        label: 'Observability'
      }]
    }, {
      heading: 'App name 1',
      items: ['Overview', 'Playground', 'Registry', 'Evaluations', 'Traces', 'Deployments'].map(label => ({
        label,
        selected: label === view
      }))
    }]
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      padding: '8px 8px 8px 0',
      boxSizing: 'border-box'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: '100%',
      background: '#fff',
      borderRadius: 8,
      boxShadow: 'var(--shadow-ring)',
      padding: '24px 32px',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      gap: 20,
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--app-text-title)',
      color: 'var(--app-text-heading)'
    }
  }, "Observability"), /*#__PURE__*/React.createElement(PillTabs, {
    tabs: ['Root', 'LLM', 'All', '24h']
  })), /*#__PURE__*/React.createElement(AppButton, {
    variant: "dark"
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/icons/plus.svg",
    alt: "",
    style: {
      width: 16,
      height: 16,
      filter: 'invert(1)'
    }
  }), "Compare")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(SearchField, {
    placeholder: "Search",
    icon: "../../assets/icons/search.svg",
    style: {
      width: 280
    },
    value: query,
    onChange: e => setQuery(e.target.value)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(ToolbarChip, {
    icon: "../../assets/icons/filter.svg"
  }, "Add filter"), /*#__PURE__*/React.createElement(ToolbarChip, {
    icon: "../../assets/icons/calendar.svg"
  }, "Dec 2, 2024 \u2192 Dec 9, 2024"))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflow: 'auto'
    }
  }, /*#__PURE__*/React.createElement(TracesTable, {
    query: query,
    onOpen: setOpenTrace
  })))), /*#__PURE__*/React.createElement(TraceDrawer, {
    trace: openTrace,
    onClose: () => setOpenTrace(null)
  }));
}
Object.assign(window, {
  ObservabilityScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web_app/ObservabilityScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/HomePage.jsx
try { (() => {
// Agenta website — homepage sections (recreated from Figma "Landing Page v1", node 1719:10985)
const {
  NavBar,
  SectionTitle,
  HighlightChip,
  Badge,
  Button,
  FAQItem,
  Footer,
  AppSidebar,
  PillTabs,
  AppButton,
  SearchField,
  ToolbarChip
} = window.AgentaDesignSystem_e4caef;

/* White panel wrapper — every website section is a square-cornered
   white (or dark) panel with a hairline border, inside the 12px gutter. */
function Panel({
  dark,
  cta,
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: cta ? 'var(--surface-cta)' : dark ? 'var(--surface-dark)' : 'var(--surface-section)',
      border: dark ? '1px solid var(--border-on-dark)' : '1px solid var(--border-default)',
      marginTop: -1,
      ...style
    }
  }, children);
}

/* Simplified product-app mock used as the hero "screenshot". */
function AppMock({
  width = 1064,
  height = 430
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width,
      height,
      borderRadius: 8,
      background: 'var(--surface-app)',
      boxShadow: 'var(--shadow-frame)',
      display: 'flex',
      overflow: 'hidden',
      textAlign: 'left'
    }
  }, /*#__PURE__*/React.createElement(AppSidebar, {
    workspace: "Acme",
    style: {
      height: '100%',
      transform: 'scale(0.92)',
      transformOrigin: 'top left'
    },
    sections: [{
      items: [{
        label: 'App management'
      }, {
        label: 'Test sets'
      }, {
        label: 'Observability'
      }]
    }, {
      heading: 'App name 1',
      items: [{
        label: 'Overview'
      }, {
        label: 'Playground',
        selected: true
      }, {
        label: 'Evaluations'
      }, {
        label: 'Traces'
      }]
    }],
    footerItems: []
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      padding: '8px 8px 8px 0'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: '100%',
      background: '#fff',
      borderRadius: 8,
      boxShadow: 'var(--shadow-ring)',
      padding: 20,
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--app-text-title)',
      color: 'var(--app-text-heading)'
    }
  }, "Playground"), /*#__PURE__*/React.createElement(AppButton, {
    variant: "dark"
  }, "Run all")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12,
      flex: 1,
      minHeight: 0
    }
  }, ['Claude 4 Sonnet', 'GPT-4o'].map(model => /*#__PURE__*/React.createElement("div", {
    key: model,
    style: {
      flex: 1,
      borderRadius: 10,
      boxShadow: 'var(--shadow-ring)',
      padding: 14,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--app-text-label)',
      color: 'var(--app-text-body)'
    }
  }, model), /*#__PURE__*/React.createElement(PillTabs, {
    tabs: ['v1', 'v2']
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      borderRadius: 8,
      background: 'var(--paper-50)',
      boxShadow: 'inset 0 0 0 1px var(--divider-app)',
      padding: 12,
      font: 'var(--app-text-mono)',
      color: 'var(--app-text-secondary)',
      overflow: 'hidden'
    }
  }, "You are a helpful support agent. Answer strictly from the provided context\u2026"), /*#__PURE__*/React.createElement(SearchField, {
    placeholder: "Type a test input"
  })))))));
}
function Hero() {
  return /*#__PURE__*/React.createElement(Panel, {
    style: {
      padding: '64px 0 88px',
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 32
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 30
    }
  }, /*#__PURE__*/React.createElement(Badge, null, "Announcing our $8M seed round \u2192"), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      font: 'var(--text-display-xl)',
      color: 'var(--text-heading)'
    }
  }, "The open-source", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement(HighlightChip, {
    fontSize: 68
  }, "LLMOps"), " platform"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--text-body-md)',
      color: 'var(--text-body)',
      maxWidth: 560
    }
  }, "Build reliable LLM apps together with integrated prompt management, evaluation, and observability.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary"
  }, "Get started"), /*#__PURE__*/React.createElement(Button, {
    variant: "outline"
  }, "Read the docs")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 32
    }
  }, /*#__PURE__*/React.createElement(AppMock, null))));
}
const PROBLEMS = [{
  title: 'Prompts scattered everywhere',
  body: 'Versions live in code, docs, and chat threads. Nobody knows which one is in production.'
}, {
  title: 'Vibe-based evaluation',
  body: 'Changes ship after a few manual spot checks. Regressions surface in front of users.'
}, {
  title: 'Experts locked out',
  body: 'Domain experts can\u2019t iterate without asking engineers for every change.'
}];
function Problem() {
  return /*#__PURE__*/React.createElement(Panel, {
    style: {
      padding: '112px 0',
      background: 'var(--surface-page)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 64
    }
  }, /*#__PURE__*/React.createElement(SectionTitle, {
    badge: "Problem",
    title: "Why most AI teams struggle",
    subtitle: "LLMs are unpredictable by nature. Building reliable products requires quick iteration and feedback, but most teams don't have the right process."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 0,
      width: 1072,
      border: '1px solid var(--border-default)'
    }
  }, PROBLEMS.map((p, i) => /*#__PURE__*/React.createElement("div", {
    key: p.title,
    style: {
      padding: 32,
      background: '#fff',
      borderLeft: i ? '1px solid var(--border-default)' : 'none',
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-title)',
      color: 'var(--text-heading)'
    }
  }, p.title), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--text-body-sm)',
      color: 'var(--text-body)'
    }
  }, p.body))))));
}
const PILLARS = [{
  badge: 'Prompt management',
  title: 'Iterate your prompts with the whole team',
  body: 'A playground where PMs, experts, and devs compare models and versions side by side — every change versioned.'
}, {
  badge: 'Evaluation',
  title: 'Replace guesswork with evidence',
  body: 'Run evaluations on test sets before you ship. Catch regressions with automatic and human review.'
}];
function Pillars() {
  return /*#__PURE__*/React.createElement(Panel, {
    style: {
      padding: '112px 0'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 96
    }
  }, PILLARS.map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: s.badge,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 64,
      width: 1072,
      flexDirection: i % 2 ? 'row-reverse' : 'row'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: '0 0 380px',
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(SectionTitle, {
    badge: s.badge,
    title: s.title,
    subtitle: s.body,
    align: "left"
  }), /*#__PURE__*/React.createElement("a", {
    href: "#",
    onClick: e => e.preventDefault(),
    style: {
      font: 'var(--text-label)',
      color: 'var(--text-heading)',
      textDecoration: 'underline',
      textUnderlineOffset: 3
    }
  }, "Learn more \u2192")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(AppMock, {
    width: 600,
    height: 320
  }))))));
}
const DARK_FEATURES = [{
  title: 'Trace every request',
  body: 'And find the exact failure points across your agent runs.'
}, {
  title: 'Turn any trace into a test case',
  body: 'Capture real-world edge cases into your test sets in one click.'
}, {
  title: 'Monitor performance',
  body: 'Detect regressions in cost, latency, and quality over time.'
}, {
  title: 'Gather user feedback',
  body: 'Annotate traces with your team or collect feedback from users.'
}];
function DarkSection() {
  return /*#__PURE__*/React.createElement(Panel, {
    dark: true,
    style: {
      padding: '128px 0'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 96
    }
  }, /*#__PURE__*/React.createElement(SectionTitle, {
    badge: "Observability",
    dark: true,
    title: /*#__PURE__*/React.createElement("span", null, "Debug your AI systems and", /*#__PURE__*/React.createElement("br", null), "gather user feedback")
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      width: 1072,
      border: '1px solid rgba(240,239,237,0.1)'
    }
  }, DARK_FEATURES.map((f, i) => /*#__PURE__*/React.createElement("div", {
    key: f.title,
    style: {
      padding: 24,
      borderLeft: i ? '1px solid rgba(240,239,237,0.1)' : 'none',
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--text-title)',
      color: '#fff'
    }
  }, f.title), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--text-body-sm)',
      color: 'var(--text-on-dark-muted)'
    }
  }, f.body))))));
}
function CTA() {
  return /*#__PURE__*/React.createElement(Panel, {
    cta: true,
    style: {
      padding: '96px 0'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: 1072,
      margin: '0 auto',
      gap: 48
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 24,
      maxWidth: 470
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      font: 'var(--text-display-lg)',
      color: 'var(--text-on-yellow)'
    }
  }, "Ship reliable agents faster with Agenta"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      font: 'var(--text-body-md)',
      color: 'var(--ink-900)',
      opacity: 0.75
    }
  }, "Build reliable LLM apps together with integrated prompt management, evaluation, and observability."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "dark"
  }, "Start Building"), /*#__PURE__*/React.createElement(Button, {
    variant: "outline"
  }, "Book a demo"))), /*#__PURE__*/React.createElement("div", {
    style: {
      transform: 'scale(0.82)',
      transformOrigin: 'center right'
    }
  }, /*#__PURE__*/React.createElement(AppMock, {
    width: 560,
    height: 300
  }))));
}
function FAQ() {
  return /*#__PURE__*/React.createElement(Panel, {
    style: {
      padding: '96px 0'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 48
    }
  }, /*#__PURE__*/React.createElement(SectionTitle, {
    badge: "FAQ",
    title: "Frequently asked questions"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 768
    }
  }, /*#__PURE__*/React.createElement(FAQItem, {
    question: "Who is Agenta for?",
    answer: "AI teams building LLM applications \u2014 product managers, domain experts, and developers who need one shared workflow for prompts, evaluation, and observability.",
    defaultOpen: true
  }), /*#__PURE__*/React.createElement(FAQItem, {
    question: "How does Agenta compare to building in-house?",
    answer: "Agenta gives you versioning, evaluation, and tracing out of the box \u2014 open source, so you can self-host and extend it instead of maintaining internal tooling."
  }), /*#__PURE__*/React.createElement(FAQItem, {
    question: "Can I self-host Agenta?",
    answer: "Yes. Agenta is open source; run it on your own infrastructure or use Agenta Cloud."
  }))));
}
function HomePage() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: 1440,
      margin: '0 auto',
      background: 'var(--surface-page)',
      padding: '0 12px',
      boxSizing: 'border-box'
    }
  }, /*#__PURE__*/React.createElement(NavBar, {
    logoSrc: "../../assets/logos/Agenta-logo-full-light.svg"
  }), /*#__PURE__*/React.createElement(Hero, null), /*#__PURE__*/React.createElement(Problem, null), /*#__PURE__*/React.createElement(Pillars, null), /*#__PURE__*/React.createElement(DarkSection, null), /*#__PURE__*/React.createElement(CTA, null), /*#__PURE__*/React.createElement(FAQ, null), /*#__PURE__*/React.createElement(Footer, {
    logoSrc: "../../assets/logos/Agenta-logo-full-light.svg",
    socialSrcs: ['../../assets/icons/social-1.svg', '../../assets/icons/social-2.svg', '../../assets/icons/social-3.svg', '../../assets/icons/social-4.svg']
  }));
}
Object.assign(window, {
  HomePage,
  AppMock
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/HomePage.jsx", error: String((e && e.message) || e) }); }

__ds_ns.AppButton = __ds_scope.AppButton;

__ds_ns.ToolbarChip = __ds_scope.ToolbarChip;

__ds_ns.AppSidebar = __ds_scope.AppSidebar;

__ds_ns.SidebarItem = __ds_scope.SidebarItem;

__ds_ns.PillTabs = __ds_scope.PillTabs;

__ds_ns.SearchField = __ds_scope.SearchField;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.FAQItem = __ds_scope.FAQItem;

__ds_ns.Footer = __ds_scope.Footer;

__ds_ns.HighlightChip = __ds_scope.HighlightChip;

__ds_ns.NavBar = __ds_scope.NavBar;

__ds_ns.SectionTitle = __ds_scope.SectionTitle;

})();
