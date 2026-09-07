/* @ds-bundle: {"format":4,"namespace":"AgentaDesignSystem_0263eb","components":[{"name":"Button","sourcePath":"components/Button/Button.jsx"},{"name":"Tag","sourcePath":"components/Tag/Tag.jsx"}],"sourceHashes":{"components/Button/Button.jsx":"8b29d5d6aefd","components/Tag/Tag.jsx":"a26c713c0f51","ui_kits/web/home-page-kit.jsx":"9a0b1df8593e","ui_kits/web/icons-kit.jsx":"d794c909ec30","ui_kits/web/pages-kit.jsx":"913ccaa9b42f","ui_kits/web/shell-kit.jsx":"3b79232ba53d"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.AgentaDesignSystem_0263eb = window.AgentaDesignSystem_0263eb || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/Button/Button.jsx
try { (() => {
function Button({
  variant = "default",
  size,
  disabled = false,
  onClick,
  style,
  children
}) {
  const base = {
    fontFamily: "inherit",
    fontSize: size === "sm" ? 13 : 14,
    fontWeight: 400,
    padding: size === "sm" ? "2px 11px" : "5px 15px",
    borderRadius: 6,
    cursor: disabled ? "not-allowed" : "pointer",
    border: "1px solid transparent",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    lineHeight: 1.57,
    whiteSpace: "nowrap",
    opacity: disabled ? 0.5 : 1
  };
  const variants = {
    primary: {
      background: "#242424",
      color: "#ffffff"
    },
    hero: {
      background: "#f2f25c",
      color: "#242424",
      fontWeight: 500
    },
    default: {
      background: "#ffffff",
      color: "#242424",
      borderColor: "#d7d7d7"
    },
    text: {
      background: "transparent",
      color: "#242424"
    },
    danger: {
      background: "#ffffff",
      color: "#5e0908",
      borderColor: "#d94c4a"
    }
  };
  return /*#__PURE__*/React.createElement("button", {
    style: {
      ...base,
      ...(variants[variant] || variants.default),
      ...style
    },
    disabled: disabled,
    onClick: onClick
  }, children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/Button/Button.jsx", error: String((e && e.message) || e) }); }

// components/Tag/Tag.jsx
try { (() => {
const SLOTS = {
  blue: {
    bg: "#e5f1f9",
    text: "#113955",
    rgb: "17,57,85"
  },
  neutral: {
    bg: "#ebeaea",
    text: "#413f3f",
    rgb: "65,63,63"
  },
  amber: {
    bg: "#fbf3d9",
    text: "#8a6400",
    rgb: "138,100,0"
  },
  olive: {
    bg: "#f8f8dd",
    text: "#5e5e08",
    rgb: "94,94,8"
  },
  red: {
    bg: "#f9e5e5",
    text: "#5e0908",
    rgb: "94,9,8"
  },
  green: {
    bg: "#eaf2e3",
    text: "#2c7737",
    rgb: "44,119,55"
  }
};
function Tag({
  slot = "neutral",
  outlined = false,
  style,
  children
}) {
  const s = SLOTS[slot] || SLOTS.neutral;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      padding: "0 7px",
      height: 22,
      borderRadius: 4,
      fontSize: 12,
      lineHeight: 1,
      fontFamily: "inherit",
      background: s.bg,
      color: s.text,
      border: `1px solid ${outlined ? `rgba(${s.rgb},0.22)` : "transparent"}`,
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/Tag/Tag.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/home-page-kit.jsx
try { (() => {
// HomePage.jsx — the Home/dashboard surface

const WelcomeCard = ({
  title,
  desc
}) => /*#__PURE__*/React.createElement("div", {
  className: "card",
  style: {
    cursor: "pointer",
    position: "relative",
    paddingRight: 40
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    fontSize: 14,
    fontWeight: 500,
    color: "#242424",
    marginBottom: 4
  }
}, title), /*#__PURE__*/React.createElement("div", {
  style: {
    fontSize: 13,
    color: "#848b8c",
    lineHeight: 1.5
  }
}, desc), /*#__PURE__*/React.createElement("span", {
  style: {
    position: "absolute",
    right: 16,
    bottom: 16,
    color: "#848b8c"
  }
}, /*#__PURE__*/React.createElement(IconArrowUR, {
  size: 14
})));
const Sparkline = ({
  color,
  points
}) => /*#__PURE__*/React.createElement("svg", {
  width: "100%",
  height: "48",
  viewBox: "0 0 200 48",
  preserveAspectRatio: "none",
  style: {
    display: "block"
  }
}, /*#__PURE__*/React.createElement("polyline", {
  fill: "none",
  stroke: color,
  strokeWidth: "1.5",
  points: points
}));
const MetricCard = ({
  label,
  values,
  color,
  spark
}) => /*#__PURE__*/React.createElement("div", {
  className: "card"
}, /*#__PURE__*/React.createElement("div", {
  style: {
    fontSize: 13,
    fontWeight: 500,
    color: "#242424",
    marginBottom: 4
  }
}, label), /*#__PURE__*/React.createElement("div", {
  style: {
    display: "flex",
    gap: 14,
    fontSize: 12,
    color: "#676770",
    marginBottom: 8
  }
}, values.map((v, i) => /*#__PURE__*/React.createElement("span", {
  key: i
}, v.label, ": ", /*#__PURE__*/React.createElement("b", {
  style: {
    color: v.color || "#242424",
    fontWeight: 500
  }
}, v.value)))), /*#__PURE__*/React.createElement(Sparkline, {
  color: color,
  points: spark
}), /*#__PURE__*/React.createElement("div", {
  style: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 11,
    color: "#a3a19f",
    marginTop: 4
  }
}, /*#__PURE__*/React.createElement("span", null, "25 Mar"), /*#__PURE__*/React.createElement("span", null, "1 Apr"), /*#__PURE__*/React.createElement("span", null, "8 Apr"), /*#__PURE__*/React.createElement("span", null, "17 Apr")));
const HomePage = () => {
  const apps = [{
    name: "RAG QA Chatbot",
    created: "26 Feb 2026 · 09:21",
    type: "Chat"
  }, {
    name: "capitals",
    created: "15 Feb 2026 · 14:03",
    type: "Completion"
  }, {
    name: "docs-capital-finder",
    created: "09 Jan 2026 · 11:47",
    type: "Completion"
  }];
  return /*#__PURE__*/React.createElement("div", {
    className: "content"
  }, /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      background: "#f6f5f3",
      border: 0,
      padding: 24,
      marginBottom: 20,
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("button", {
    style: {
      position: "absolute",
      right: 16,
      top: 14,
      background: "transparent",
      border: 0,
      cursor: "pointer",
      color: "#848b8c"
    }
  }, /*#__PURE__*/React.createElement(IconClose, {
    size: 16
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      color: "#676770",
      marginBottom: 4
    }
  }, "Welcome,"), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 30,
      fontWeight: 600,
      color: "#242424",
      margin: "0 0 20px",
      letterSpacing: "-0.005em"
    }
  }, "What do you want to do?"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(WelcomeCard, {
    title: "Create a prompt",
    desc: "Start with a prompt and test it in the playground"
  }), /*#__PURE__*/React.createElement(WelcomeCard, {
    title: "Run an evaluation",
    desc: "Measure quality on a test set and compare versions"
  }), /*#__PURE__*/React.createElement(WelcomeCard, {
    title: "Set up tracing",
    desc: "Send traces from your AI app to debug and improve reliability"
  }), /*#__PURE__*/React.createElement(WelcomeCard, {
    title: "Explore demo project",
    desc: "How Agenta looks with real example data (view-only)"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "flex-end",
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "filter-btn"
  }, /*#__PURE__*/React.createElement(IconCalendar, {
    size: 14
  }), "Last 1 month")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
      gap: 16,
      marginBottom: 24
    }
  }, /*#__PURE__*/React.createElement(MetricCard, {
    label: "Requests",
    values: [{
      label: "Total",
      value: "57"
    }, {
      label: "Failed",
      value: "0.07%",
      color: "#5e0908"
    }],
    color: "#5e0908",
    spark: "0,44 30,44 60,42 90,39 120,42 150,40 170,6 180,18 190,44 200,44"
  }), /*#__PURE__*/React.createElement(MetricCard, {
    label: "Latency",
    values: [{
      label: "Avg",
      value: "0.83ms"
    }],
    color: "#d97757",
    spark: "0,46 30,44 60,42 90,36 120,40 150,34 170,10 180,22 190,40 200,42"
  }), /*#__PURE__*/React.createElement(MetricCard, {
    label: "Cost",
    values: [{
      label: "Total",
      value: "$0.001541"
    }, {
      label: "Avg",
      value: "$0.000027"
    }],
    color: "#d97757",
    spark: "0,46 30,46 60,45 90,44 120,45 150,43 170,8 180,20 190,44 200,46"
  }), /*#__PURE__*/React.createElement(MetricCard, {
    label: "Tokens",
    values: [{
      label: "Total",
      value: "8,357"
    }, {
      label: "Avg",
      value: "146.61"
    }],
    color: "#d97757",
    spark: "0,46 30,46 60,44 90,42 120,44 150,40 170,4 180,16 190,42 200,46"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 20,
      fontWeight: 600,
      margin: 0
    }
  }, "Applications")), /*#__PURE__*/React.createElement("div", {
    className: "toolbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "toolbar-left"
  }, /*#__PURE__*/React.createElement("div", {
    className: "search-wrap"
  }, /*#__PURE__*/React.createElement(IconSearch, null), /*#__PURE__*/React.createElement("input", {
    className: "input",
    placeholder: "Search",
    style: {
      width: 280
    }
  }))), /*#__PURE__*/React.createElement("div", {
    className: "toolbar-right"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn text"
  }, /*#__PURE__*/React.createElement(IconExport, {
    size: 14
  }), "Export CSV"), /*#__PURE__*/React.createElement("button", {
    className: "btn primary"
  }, /*#__PURE__*/React.createElement(IconPlus, {
    size: 14
  }), "Create New Prompt"))), /*#__PURE__*/React.createElement("div", {
    className: "card table-wrap",
    style: {
      padding: 0
    }
  }, /*#__PURE__*/React.createElement("table", {
    className: "tbl"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
    style: {
      width: 48
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "cb"
  })), /*#__PURE__*/React.createElement("th", null, "Name"), /*#__PURE__*/React.createElement("th", null, "Created At"), /*#__PURE__*/React.createElement("th", null, "Type"), /*#__PURE__*/React.createElement("th", {
    style: {
      width: 48,
      textAlign: "right"
    }
  }, /*#__PURE__*/React.createElement(IconGear, {
    size: 14
  })))), /*#__PURE__*/React.createElement("tbody", null, apps.map((a, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: "cb"
  })), /*#__PURE__*/React.createElement("td", {
    style: {
      fontWeight: 500
    }
  }, a.name), /*#__PURE__*/React.createElement("td", {
    className: "muted"
  }, a.created), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: "tag pending"
  }, a.type)), /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: "right"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "row-actions"
  }, /*#__PURE__*/React.createElement(IconDots, {
    size: 16
  })))))))));
};
Object.assign(window, {
  HomePage
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/home-page-kit.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/icons-kit.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// Icons.jsx — inline SVG icons matching Phosphor regular + Lucide styles used in Agenta
// Kept as small stroke-outlined SVGs, no fills.

const Icon = ({
  children,
  size = 16,
  ...props
}) => /*#__PURE__*/React.createElement("svg", _extends({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.8",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, props), children);
const IconHome = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("path", {
  d: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
}), /*#__PURE__*/React.createElement("polyline", {
  points: "9 22 9 12 15 12 15 22"
}));
const IconGrid = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("rect", {
  x: "3",
  y: "3",
  width: "7",
  height: "7"
}), /*#__PURE__*/React.createElement("rect", {
  x: "14",
  y: "3",
  width: "7",
  height: "7"
}), /*#__PURE__*/React.createElement("rect", {
  x: "14",
  y: "14",
  width: "7",
  height: "7"
}), /*#__PURE__*/React.createElement("rect", {
  x: "3",
  y: "14",
  width: "7",
  height: "7"
}));
const IconTestTube = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("ellipse", {
  cx: "12",
  cy: "5",
  rx: "8",
  ry: "3"
}), /*#__PURE__*/React.createElement("path", {
  d: "M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5"
}), /*#__PURE__*/React.createElement("path", {
  d: "M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"
}));
const IconBox = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("path", {
  d: "m14 14-5.5 5.5a2.12 2.12 0 0 1-3-3L11 11"
}), /*#__PURE__*/React.createElement("path", {
  d: "m20.5 10.5-5-5"
}), /*#__PURE__*/React.createElement("path", {
  d: "m16.5 14.5 3-3"
}), /*#__PURE__*/React.createElement("path", {
  d: "m9.5 7.5 3-3"
}), /*#__PURE__*/React.createElement("path", {
  d: "m7.5 9.5 9 9"
}));
const IconChart = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("polyline", {
  points: "3 17 9 11 13 15 21 7"
}), /*#__PURE__*/React.createElement("polyline", {
  points: "14 7 21 7 21 14"
}));
const IconQueue = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("line", {
  x1: "8",
  y1: "6",
  x2: "21",
  y2: "6"
}), /*#__PURE__*/React.createElement("line", {
  x1: "8",
  y1: "12",
  x2: "21",
  y2: "12"
}), /*#__PURE__*/React.createElement("line", {
  x1: "8",
  y1: "18",
  x2: "21",
  y2: "18"
}), /*#__PURE__*/React.createElement("line", {
  x1: "3",
  y1: "6",
  x2: "5",
  y2: "6"
}), /*#__PURE__*/React.createElement("line", {
  x1: "3",
  y1: "12",
  x2: "5",
  y2: "12"
}), /*#__PURE__*/React.createElement("line", {
  x1: "3",
  y1: "18",
  x2: "5",
  y2: "18"
}));
const IconObserve = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("polyline", {
  points: "3 17 9 11 13 15 21 7"
}), /*#__PURE__*/React.createElement("polyline", {
  points: "14 7 21 7 21 14"
}));
const IconSettings = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("circle", {
  cx: "12",
  cy: "12",
  r: "3"
}), /*#__PURE__*/React.createElement("path", {
  d: "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
}));
const IconUserPlus = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("path", {
  d: "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
}), /*#__PURE__*/React.createElement("line", {
  x1: "12",
  y1: "9",
  x2: "12",
  y2: "13"
}), /*#__PURE__*/React.createElement("line", {
  x1: "12",
  y1: "17",
  x2: "12.01",
  y2: "17"
}));
const IconCompass = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("line", {
  x1: "22",
  y1: "2",
  x2: "11",
  y2: "13"
}), /*#__PURE__*/React.createElement("polygon", {
  points: "22 2 15 22 11 13 2 9 22 2"
}));
const IconChat = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("path", {
  d: "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
}));
const IconHelp = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("circle", {
  cx: "12",
  cy: "12",
  r: "10"
}), /*#__PURE__*/React.createElement("path", {
  d: "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"
}), /*#__PURE__*/React.createElement("line", {
  x1: "12",
  y1: "17",
  x2: "12.01",
  y2: "17"
}));
const IconSearch = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("circle", {
  cx: "11",
  cy: "11",
  r: "8"
}), /*#__PURE__*/React.createElement("path", {
  d: "m21 21-4.35-4.35"
}));
const IconPlus = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("line", {
  x1: "12",
  y1: "5",
  x2: "12",
  y2: "19"
}), /*#__PURE__*/React.createElement("line", {
  x1: "5",
  y1: "12",
  x2: "19",
  y2: "12"
}));
const IconClose = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("line", {
  x1: "18",
  y1: "6",
  x2: "6",
  y2: "18"
}), /*#__PURE__*/React.createElement("line", {
  x1: "6",
  y1: "6",
  x2: "18",
  y2: "18"
}));
const IconExport = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("path", {
  d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
}), /*#__PURE__*/React.createElement("polyline", {
  points: "17 8 12 3 7 8"
}), /*#__PURE__*/React.createElement("line", {
  x1: "12",
  y1: "3",
  x2: "12",
  y2: "15"
}));
const IconArrowUR = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("line", {
  x1: "7",
  y1: "17",
  x2: "17",
  y2: "7"
}), /*#__PURE__*/React.createElement("polyline", {
  points: "7 7 17 7 17 17"
}));
const IconFilter = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("polygon", {
  points: "22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"
}));
const IconCalendar = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("rect", {
  x: "3",
  y: "4",
  width: "18",
  height: "18",
  rx: "2",
  ry: "2"
}), /*#__PURE__*/React.createElement("line", {
  x1: "16",
  y1: "2",
  x2: "16",
  y2: "6"
}), /*#__PURE__*/React.createElement("line", {
  x1: "8",
  y1: "2",
  x2: "8",
  y2: "6"
}), /*#__PURE__*/React.createElement("line", {
  x1: "3",
  y1: "10",
  x2: "21",
  y2: "10"
}));
const IconDots = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("circle", {
  cx: "12",
  cy: "12",
  r: "1"
}), /*#__PURE__*/React.createElement("circle", {
  cx: "12",
  cy: "5",
  r: "1"
}), /*#__PURE__*/React.createElement("circle", {
  cx: "12",
  cy: "19",
  r: "1"
}));
const IconRefresh = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("polyline", {
  points: "23 4 23 10 17 10"
}), /*#__PURE__*/React.createElement("polyline", {
  points: "1 20 1 14 7 14"
}), /*#__PURE__*/React.createElement("path", {
  d: "M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"
}));
const IconGear = IconSettings;
const IconChevron = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("polyline", {
  points: "6 9 12 15 18 9"
}));
const IconChevronRight = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("polyline", {
  points: "9 18 15 12 9 6"
}));
const IconInfo = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("circle", {
  cx: "12",
  cy: "12",
  r: "10"
}), /*#__PURE__*/React.createElement("line", {
  x1: "12",
  y1: "16",
  x2: "12",
  y2: "12"
}), /*#__PURE__*/React.createElement("line", {
  x1: "12",
  y1: "8",
  x2: "12.01",
  y2: "8"
}));
const IconRun = p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("polygon", {
  points: "5 3 19 12 5 21 5 3"
}));
const IconGithub = p => /*#__PURE__*/React.createElement("svg", _extends({
  width: "14",
  height: "14",
  viewBox: "0 0 24 24",
  fill: "currentColor"
}, p), /*#__PURE__*/React.createElement("path", {
  d: "M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57v-2.17c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.33-1.76-1.33-1.76-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.84 2.82 1.31 3.5 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.66 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.81 5.62-5.48 5.92.42.36.81 1.1.81 2.22v3.29c0 .31.22.69.83.57A12 12 0 0 0 12 .3"
}));
const IconLinkedin = p => /*#__PURE__*/React.createElement("svg", _extends({
  width: "14",
  height: "14",
  viewBox: "0 0 24 24",
  fill: "currentColor"
}, p), /*#__PURE__*/React.createElement("path", {
  d: "M20.5 2h-17A1.5 1.5 0 0 0 2 3.5v17A1.5 1.5 0 0 0 3.5 22h17a1.5 1.5 0 0 0 1.5-1.5v-17A1.5 1.5 0 0 0 20.5 2zM8 19H5v-9h3zM6.5 8.25A1.75 1.75 0 1 1 8.3 6.5a1.78 1.78 0 0 1-1.8 1.75zM19 19h-3v-4.74c0-1.42-.6-1.93-1.38-1.93A1.74 1.74 0 0 0 13 14.19a.66.66 0 0 0 0 .14V19h-3v-9h2.9v1.3a3.11 3.11 0 0 1 2.7-1.4c1.55 0 3.36.86 3.36 3.66z"
}));
const IconTwitter = p => /*#__PURE__*/React.createElement("svg", _extends({
  width: "14",
  height: "14",
  viewBox: "0 0 24 24",
  fill: "currentColor"
}, p), /*#__PURE__*/React.createElement("path", {
  d: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
}));
const IconAgent = ({
  size = 16
}) => /*#__PURE__*/React.createElement("svg", {
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.8",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("path", {
  d: "M12 8V4H8"
}), /*#__PURE__*/React.createElement("rect", {
  width: "16",
  height: "12",
  x: "4",
  y: "8",
  rx: "2"
}), /*#__PURE__*/React.createElement("path", {
  d: "M2 14h2"
}), /*#__PURE__*/React.createElement("path", {
  d: "M20 14h2"
}), /*#__PURE__*/React.createElement("path", {
  d: "M15 13v2"
}), /*#__PURE__*/React.createElement("path", {
  d: "M9 13v2"
}));
Object.assign(window, {
  IconAgent,
  IconHome,
  IconGrid,
  IconTestTube,
  IconBox,
  IconChart,
  IconQueue,
  IconObserve,
  IconSettings,
  IconUserPlus,
  IconCompass,
  IconChat,
  IconHelp,
  IconSearch,
  IconPlus,
  IconClose,
  IconExport,
  IconArrowUR,
  IconFilter,
  IconCalendar,
  IconDots,
  IconRefresh,
  IconGear,
  IconChevron,
  IconChevronRight,
  IconInfo,
  IconRun,
  IconGithub,
  IconLinkedin,
  IconTwitter
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/icons-kit.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/pages-kit.jsx
try { (() => {
// Pages.jsx — Evaluations, Observability, Queues

const PageToolbar = ({
  search,
  onSearch,
  filterCount = 0,
  right,
  children
}) => /*#__PURE__*/React.createElement("div", {
  className: "toolbar"
}, /*#__PURE__*/React.createElement("div", {
  className: "toolbar-left"
}, /*#__PURE__*/React.createElement("div", {
  className: "search-wrap"
}, /*#__PURE__*/React.createElement(IconSearch, null), /*#__PURE__*/React.createElement("input", {
  className: "input",
  placeholder: search,
  style: {
    width: 280
  },
  value: onSearch?.value ?? "",
  onChange: onSearch?.onChange
})), /*#__PURE__*/React.createElement("button", {
  className: "filter-btn"
}, /*#__PURE__*/React.createElement(IconFilter, {
  size: 13
}), /*#__PURE__*/React.createElement("span", {
  className: "count"
}, filterCount)), children), /*#__PURE__*/React.createElement("div", {
  className: "toolbar-right"
}, right));
const EvaluationsPage = () => {
  const rows = [{
    status: "gray",
    name: "default-v2-asfasfdwe-1g1t4",
    kind: "Human",
    testset: "asfasfdwe",
    v: "v1",
    app: "default",
    appV: "v2",
    score: null
  }, {
    status: "green",
    name: "SDK Eval [26-03-03 · 13:03]",
    kind: "SDK",
    testset: "RAG Eval — 3 queries",
    v: "v1",
    app: "RAG QA Chatbot\nRAG QA Chatbot",
    appV: "v2",
    score: 1
  }, {
    status: "green",
    name: "SDK Eval [26-03-03 · 12:59]",
    kind: "SDK",
    testset: "RAG Eval — 3 queries",
    v: "v1",
    app: "RAG QA Chatbot\nRAG QA Chatbot",
    appV: "v1",
    score: 1
  }, {
    status: "red",
    name: "default-v2-capitals-1fx0z",
    kind: "Auto",
    testset: "capitals",
    v: "v2",
    app: "default",
    appV: "v1",
    score: null
  }, {
    status: "gray",
    name: "default-v1-comcom_testset_corre…",
    kind: "Human",
    testset: "comcom_testset_cor…",
    v: "v3",
    app: "default",
    appV: "v1",
    score: null
  }, {
    status: "green",
    name: "Docs Evaluation [26-01-15 · 19:28]",
    kind: "SDK",
    testset: "—",
    v: "v1",
    app: "docs-capital-finder\ndefault",
    appV: "v1",
    score: null
  }, {
    status: "green",
    name: "ghfj-v2-Country Testcases-1qeli",
    kind: "Auto",
    testset: "—",
    v: "v1",
    app: "prompt\nghfj",
    appV: "v2",
    score: null
  }, {
    status: "gray",
    name: "ghfj-v2-Country Testcases-1gqmj",
    kind: "Human",
    testset: "—",
    v: "v1",
    app: "prompt\nghfj",
    appV: "v2",
    score: null
  }];
  const kindTag = k => ({
    Human: "human",
    SDK: "sdk",
    Auto: "auto"
  })[k];
  return /*#__PURE__*/React.createElement("div", {
    className: "content"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-end",
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 20,
      fontWeight: 600,
      margin: 0
    }
  }, "Evaluations"), /*#__PURE__*/React.createElement("div", {
    className: "tabs",
    style: {
      border: 0
    }
  }, ["All Evals", "Auto Evals", "Human Evals", "Online Evals", "SDK Evals"].map((t, i) => /*#__PURE__*/React.createElement("div", {
    key: t,
    className: `tab ${i === 0 ? "active" : ""}`
  }, t)))), /*#__PURE__*/React.createElement(PageToolbar, {
    search: "Search evaluations",
    filterCount: 0,
    right: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
      className: "muted",
      style: {
        fontSize: 13
      }
    }, "No filters applied"), /*#__PURE__*/React.createElement("button", {
      className: "btn text",
      disabled: true
    }, /*#__PURE__*/React.createElement(IconClose, {
      size: 13
    }), "Delete"), /*#__PURE__*/React.createElement("button", {
      className: "btn text"
    }, /*#__PURE__*/React.createElement(IconExport, {
      size: 13
    }), "Export CSV"), /*#__PURE__*/React.createElement("button", {
      className: "btn primary"
    }, /*#__PURE__*/React.createElement(IconPlus, {
      size: 13
    }), "New Evaluation"))
  }), /*#__PURE__*/React.createElement("div", {
    className: "card table-wrap",
    style: {
      padding: 0
    }
  }, /*#__PURE__*/React.createElement("table", {
    className: "tbl"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
    style: {
      width: 40
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "cb"
  })), /*#__PURE__*/React.createElement("th", {
    style: {
      width: 70
    }
  }, "Status"), /*#__PURE__*/React.createElement("th", null, "Name"), /*#__PURE__*/React.createElement("th", {
    style: {
      width: 90
    }
  }, "Kind"), /*#__PURE__*/React.createElement("th", null, "Test set"), /*#__PURE__*/React.createElement("th", null, "Application"), /*#__PURE__*/React.createElement("th", null, "a1c87dd414784ec993\u2026", /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 400,
      color: "#848b8c"
    }
  }, "Test Test")), /*#__PURE__*/React.createElement("th", null, "Answer Relevancy", /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 400,
      color: "#848b8c"
    }
  }, "Score")), /*#__PURE__*/React.createElement("th", {
    style: {
      width: 36
    }
  }, /*#__PURE__*/React.createElement(IconGear, {
    size: 14
  })))), /*#__PURE__*/React.createElement("tbody", null, rows.map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: "cb"
  })), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: `dot ${r.status}`
  })), /*#__PURE__*/React.createElement("td", null, r.name), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: `tag ${kindTag(r.kind)}`
  }, r.kind)), /*#__PURE__*/React.createElement("td", null, r.testset !== "—" ? /*#__PURE__*/React.createElement(React.Fragment, null, r.testset, " ", /*#__PURE__*/React.createElement("span", {
    className: "tag v"
  }, r.v)) : /*#__PURE__*/React.createElement("span", {
    className: "tag v"
  }, "v1")), /*#__PURE__*/React.createElement("td", {
    style: {
      whiteSpace: "pre-line",
      fontSize: 13
    }
  }, r.app, " ", /*#__PURE__*/React.createElement("span", {
    className: "tag v"
  }, r.appV)), /*#__PURE__*/React.createElement("td", {
    style: {
      background: r.score === null ? "repeating-linear-gradient(45deg,#fbfaf8,#fbfaf8 4px,#f6f5f3 4px,#f6f5f3 8px)" : "transparent"
    }
  }, r.score ?? ""), /*#__PURE__*/React.createElement("td", null, r.score ?? ""), /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: "right"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "row-actions"
  }, /*#__PURE__*/React.createElement(IconDots, {
    size: 14
  })))))))));
};
const ObservabilityPage = () => {
  const rows = [{
    name: "t",
    type: "workflow",
    inputs: "{}",
    outputs: "—"
  }, {
    name: "t",
    type: "workflow",
    inputs: "{}",
    outputs: "—"
  }, {
    name: "t",
    type: "workflow",
    inputs: "{}",
    outputs: "—"
  }, {
    name: "t",
    type: "workflow",
    inputs: "{}",
    outputs: "—"
  }, {
    name: "test_span",
    type: "workflow",
    inputs: '{\n  "country": "France"\n}',
    outputs: "Paris"
  }];
  return /*#__PURE__*/React.createElement("div", {
    className: "content"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-end",
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 20,
      fontWeight: 600,
      margin: 0
    }
  }, "Observability"), /*#__PURE__*/React.createElement("div", {
    className: "tabs",
    style: {
      border: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "tab active"
  }, /*#__PURE__*/React.createElement(IconObserve, {
    size: 13
  }), "Traces"), /*#__PURE__*/React.createElement("div", {
    className: "tab"
  }, /*#__PURE__*/React.createElement(IconChat, {
    size: 13
  }), "Sessions"))), /*#__PURE__*/React.createElement("div", {
    className: "toolbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "toolbar-left"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn default sm"
  }, /*#__PURE__*/React.createElement(IconRefresh, {
    size: 13
  })), /*#__PURE__*/React.createElement("div", {
    className: "search-wrap"
  }, /*#__PURE__*/React.createElement(IconSearch, null), /*#__PURE__*/React.createElement("input", {
    className: "input",
    placeholder: "Search",
    style: {
      width: 240
    }
  })), /*#__PURE__*/React.createElement("button", {
    className: "filter-btn"
  }, /*#__PURE__*/React.createElement(IconFilter, {
    size: 13
  }), /*#__PURE__*/React.createElement("span", {
    className: "count"
  }, "1")), /*#__PURE__*/React.createElement("button", {
    className: "filter-btn"
  }, /*#__PURE__*/React.createElement(IconCalendar, {
    size: 13
  }), "Last 3 months"), /*#__PURE__*/React.createElement("label", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      fontSize: 13,
      color: "#676770"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 28,
      height: 14,
      borderRadius: 8,
      background: "#d7d7d7",
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      left: 2,
      top: 2,
      width: 10,
      height: 10,
      borderRadius: "50%",
      background: "white"
    }
  })), "auto-refresh")), /*#__PURE__*/React.createElement("div", {
    className: "toolbar-right"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn text"
  }, /*#__PURE__*/React.createElement(IconExport, {
    size: 13
  }), "Export"), /*#__PURE__*/React.createElement("button", {
    className: "btn text"
  }, /*#__PURE__*/React.createElement(IconGrid, {
    size: 13
  }), "Edit columns"), /*#__PURE__*/React.createElement("button", {
    className: "btn text",
    disabled: true
  }, "Delete"), /*#__PURE__*/React.createElement("button", {
    className: "btn default",
    disabled: true
  }, /*#__PURE__*/React.createElement(IconPlus, {
    size: 13
  }), "Add"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 4,
      padding: "8px 0"
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn default sm",
    style: {
      background: "#f6f5f3",
      fontWeight: 500
    }
  }, "Root"), /*#__PURE__*/React.createElement("button", {
    className: "btn text sm"
  }, "LLM"), /*#__PURE__*/React.createElement("button", {
    className: "btn text sm"
  }, "All")), /*#__PURE__*/React.createElement("div", {
    className: "card table-wrap",
    style: {
      padding: 0
    }
  }, /*#__PURE__*/React.createElement("table", {
    className: "tbl"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
    style: {
      width: 40
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "cb"
  })), /*#__PURE__*/React.createElement("th", {
    style: {
      width: 240
    }
  }, "Name"), /*#__PURE__*/React.createElement("th", {
    style: {
      width: 120
    }
  }, "Span type"), /*#__PURE__*/React.createElement("th", null, "Inputs"), /*#__PURE__*/React.createElement("th", null, "Outputs"))), /*#__PURE__*/React.createElement("tbody", null, rows.map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: i,
    style: {
      height: 72
    }
  }, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: "cb"
  })), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      color: "#242424"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M13 2L3 14h9l-1 8 10-12h-9l1-8z"
  })), r.name)), /*#__PURE__*/React.createElement("td", {
    className: "muted"
  }, r.type), /*#__PURE__*/React.createElement("td", {
    className: "mono",
    style: {
      whiteSpace: "pre",
      fontSize: 12
    }
  }, r.inputs), /*#__PURE__*/React.createElement("td", null, r.outputs)))))));
};
const QueuesPage = () => /*#__PURE__*/React.createElement("div", {
  className: "content"
}, /*#__PURE__*/React.createElement("h2", {
  style: {
    fontSize: 20,
    fontWeight: 600,
    marginTop: 0,
    marginBottom: 16
  }
}, "Queues"), /*#__PURE__*/React.createElement(PageToolbar, {
  search: "Search queues",
  filterCount: 0,
  right: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    className: "btn text",
    disabled: true
  }, /*#__PURE__*/React.createElement(IconClose, {
    size: 13
  }), "Delete"), /*#__PURE__*/React.createElement("button", {
    className: "btn text"
  }, /*#__PURE__*/React.createElement(IconExport, {
    size: 13
  }), "Export CSV"), /*#__PURE__*/React.createElement("button", {
    className: "btn primary"
  }, /*#__PURE__*/React.createElement(IconPlus, {
    size: 13
  }), "New Queue"))
}), /*#__PURE__*/React.createElement("div", {
  className: "card table-wrap",
  style: {
    padding: 0
  }
}, /*#__PURE__*/React.createElement("table", {
  className: "tbl"
}, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
  style: {
    width: 40
  }
}, /*#__PURE__*/React.createElement("span", {
  className: "cb"
})), /*#__PURE__*/React.createElement("th", null, "Name"), /*#__PURE__*/React.createElement("th", null, "Type"), /*#__PURE__*/React.createElement("th", null, "Reviewed"), /*#__PURE__*/React.createElement("th", null, "Status"), /*#__PURE__*/React.createElement("th", null, "Description"), /*#__PURE__*/React.createElement("th", null, "Modified on"), /*#__PURE__*/React.createElement("th", null, "Created"), /*#__PURE__*/React.createElement("th", {
  style: {
    width: 36
  }
}, /*#__PURE__*/React.createElement(IconGear, {
  size: 14
})))), /*#__PURE__*/React.createElement("tbody", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
  className: "cb"
})), /*#__PURE__*/React.createElement("td", null, "q"), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
  style: {
    color: "#54b5fa"
  }
}, "Traces")), /*#__PURE__*/React.createElement("td", null, "0 out of 3"), /*#__PURE__*/React.createElement("td", null, "Pending"), /*#__PURE__*/React.createElement("td", {
  className: "muted"
}, "\u2014"), /*#__PURE__*/React.createElement("td", {
  className: "muted"
}, "31 Mar 2026, 12:20"), /*#__PURE__*/React.createElement("td", {
  className: "muted"
}, "31 Mar 2"), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
  className: "row-actions"
}, /*#__PURE__*/React.createElement(IconDots, {
  size: 14
}))))))));
const PromptsPage = () => /*#__PURE__*/React.createElement("div", {
  className: "content"
}, /*#__PURE__*/React.createElement("h2", {
  style: {
    fontSize: 20,
    fontWeight: 600,
    marginTop: 0,
    marginBottom: 16
  }
}, "Prompts"), /*#__PURE__*/React.createElement(PageToolbar, {
  search: "Search prompts",
  filterCount: 0,
  right: /*#__PURE__*/React.createElement("button", {
    className: "btn primary"
  }, /*#__PURE__*/React.createElement(IconPlus, {
    size: 13
  }), "Create New Prompt")
}), /*#__PURE__*/React.createElement("div", {
  className: "card",
  style: {
    padding: 48,
    textAlign: "center",
    color: "#848b8c"
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    marginBottom: 8,
    fontSize: 14,
    color: "#242424",
    fontWeight: 500
  }
}, "No prompts yet"), /*#__PURE__*/React.createElement("div", {
  style: {
    fontSize: 13
  }
}, "Create your first prompt to start testing in the playground.")));
Object.assign(window, {
  EvaluationsPage,
  ObservabilityPage,
  QueuesPage,
  PromptsPage
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/pages-kit.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web/shell-kit.jsx
try { (() => {
// Shell.jsx — Sidebar, Topbar (breadcrumb), Footer
// These are the persistent chrome elements across every Agenta page.

const Sidebar = ({
  active,
  onNavigate
}) => {
  const navItems = [{
    key: "home",
    label: "Home",
    Icon: IconHome
  }, {
    key: "prompts",
    label: "Prompts",
    Icon: IconGrid
  }, {
    key: "agents",
    label: "Agents",
    Icon: IconAgent
  }, {
    key: "sessions",
    label: "Sessions",
    Icon: IconChat
  }, {
    key: "testsets",
    label: "Test sets",
    Icon: IconTestTube
  }, {
    key: "evaluators",
    label: "Evaluators",
    Icon: IconBox
  }, {
    key: "evaluations",
    label: "Evaluations",
    Icon: IconChart
  }, {
    key: "queues",
    label: "Annotation Queues",
    Icon: IconQueue
  }, {
    key: "observability",
    label: "Observability",
    Icon: IconObserve
  }];
  const bottomItems = [{
    key: "settings",
    label: "Settings",
    Icon: IconSettings
  }, {
    key: "invite",
    label: "Invite Teammate",
    Icon: IconUserPlus
  }, {
    key: "guide",
    label: "Get Started Guide",
    Icon: IconCompass
  }, {
    key: "chat",
    label: "Live Chat Support: Off",
    Icon: IconChat
  }, {
    key: "help",
    label: "Help & Docs",
    Icon: IconHelp
  }];
  return /*#__PURE__*/React.createElement("aside", {
    className: "sider"
  }, /*#__PURE__*/React.createElement("div", {
    className: "org-switcher"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "avatar"
  }, "M"), /*#__PURE__*/React.createElement("span", null, "mahmoud"), /*#__PURE__*/React.createElement(IconChevron, {
    className: "caret",
    size: 12
  })), /*#__PURE__*/React.createElement("div", {
    className: "row project"
  }, /*#__PURE__*/React.createElement("span", {
    className: "avatar"
  }, "D"), /*#__PURE__*/React.createElement("span", null, "Default Project"), /*#__PURE__*/React.createElement(IconChevron, {
    className: "caret",
    size: 12
  }))), /*#__PURE__*/React.createElement("div", {
    className: "divider"
  }), /*#__PURE__*/React.createElement("nav", {
    className: "nav"
  }, navItems.map(({
    key,
    label,
    Icon
  }) => /*#__PURE__*/React.createElement("div", {
    key: key,
    className: `nav-item ${active === key ? "active" : ""}`,
    onClick: () => onNavigate?.(key)
  }, /*#__PURE__*/React.createElement(Icon, {
    size: 16
  }), /*#__PURE__*/React.createElement("span", null, label)))), /*#__PURE__*/React.createElement("div", {
    className: "sider-bottom"
  }, bottomItems.map(({
    key,
    label,
    Icon
  }) => /*#__PURE__*/React.createElement("div", {
    key: key,
    className: "nav-item"
  }, /*#__PURE__*/React.createElement(Icon, {
    size: 16
  }), /*#__PURE__*/React.createElement("span", null, label))), /*#__PURE__*/React.createElement("div", {
    className: "social"
  }, /*#__PURE__*/React.createElement("a", {
    href: "#",
    title: "GitHub"
  }, /*#__PURE__*/React.createElement(IconGithub, null)), /*#__PURE__*/React.createElement("a", {
    href: "#",
    title: "LinkedIn"
  }, /*#__PURE__*/React.createElement(IconLinkedin, null)), /*#__PURE__*/React.createElement("a", {
    href: "#",
    title: "X"
  }, /*#__PURE__*/React.createElement(IconTwitter, null)))));
};
const Topbar = ({
  crumb
}) => /*#__PURE__*/React.createElement("div", {
  className: "topbar"
}, /*#__PURE__*/React.createElement("div", {
  className: "crumb"
}, /*#__PURE__*/React.createElement("svg", {
  width: "14",
  height: "14",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2"
}, /*#__PURE__*/React.createElement("rect", {
  x: "3",
  y: "3",
  width: "18",
  height: "18",
  rx: "2"
})), crumb.map((c, i) => /*#__PURE__*/React.createElement(React.Fragment, {
  key: i
}, i > 0 && /*#__PURE__*/React.createElement("span", {
  className: "sep"
}, "/"), i === crumb.length - 1 ? /*#__PURE__*/React.createElement("span", {
  className: "curr"
}, c) : /*#__PURE__*/React.createElement("span", null, c)))), /*#__PURE__*/React.createElement("div", {
  className: "version"
}, "agenta v0.112.0"));
const Footer = () => /*#__PURE__*/React.createElement("div", {
  className: "footer"
}, /*#__PURE__*/React.createElement("div", null), /*#__PURE__*/React.createElement("div", null, "Copyright \xA9 2026 | Agenta."));
Object.assign(window, {
  Sidebar,
  Topbar,
  Footer
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web/shell-kit.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Tag = __ds_scope.Tag;

})();
