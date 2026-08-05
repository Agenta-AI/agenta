# rubrics/web.md – Web Frontend Review

**Domain:** UI correctness, accessibility, XSS prevention, client-side security, performance.
**Applies to:** Browser-rendered HTML, CSS, JavaScript, and framework components (React, Vue, Angular, etc.).

---

## Goals

- Verify that the UI is correct, accessible, and performs well in the browser.
- Confirm that client-side code does not introduce XSS or other injection vulnerabilities.
- Ensure assets are delivered efficiently and the application degrades gracefully.

---

## Checklist

### Security

| # | Criterion | Severity if violated |
|---|---|---|
| W‑1 | User-supplied data is never inserted into the DOM via `innerHTML`, `dangerouslySetInnerHTML`, or `document.write` without sanitisation | critical |
| W‑2 | `eval()` and `Function()` are not used with dynamic strings | critical |
| W‑3 | Sensitive data (tokens, PII) is not stored in `localStorage` or `sessionStorage` unencrypted | high |
| W‑4 | Content Security Policy (CSP) headers are set and do not use `unsafe-inline` or `unsafe-eval` | high |
| W‑5 | `postMessage` listeners validate the origin before acting on the message | high |
| W‑6 | Redirect targets are validated against an allowlist; open redirects are not possible | high |
| W‑7 | Third-party scripts are loaded from trusted CDNs with Subresource Integrity (SRI) hashes | medium |

### Accessibility (WCAG 2.1 AA)

| # | Criterion | Severity if violated |
|---|---|---|
| W‑8 | Interactive elements are reachable and operable by keyboard alone | high |
| W‑9 | Images have meaningful `alt` text; decorative images use `alt=""` | medium |
| W‑10 | Form inputs have associated `<label>` elements or `aria-label` attributes | medium |
| W‑11 | Colour contrast ratio meets WCAG AA minimums (4.5:1 for normal text) | medium |
| W‑12 | Focus indicators are visible and not suppressed globally | high |
| W‑13 | Dynamic content changes are announced to screen readers via ARIA live regions where appropriate | medium |
| W‑14 | Page language is declared (`<html lang="…">`) | low |

### Correctness and UX

| # | Criterion | Severity if violated |
|---|---|---|
| W‑15 | Forms validate input client-side and provide clear inline error messages | medium |
| W‑16 | Async operations display loading indicators and handle error states gracefully | medium |
| W‑17 | UI state is not lost on navigation unless that is the intended behaviour | medium |
| W‑18 | Responsive layout works on supported viewport sizes | medium |
| W‑19 | Links that open in a new tab include `rel="noopener noreferrer"` | low |

### Performance

| # | Criterion | Severity if violated |
|---|---|---|
| W‑20 | Images are served in modern formats (WebP/AVIF) and are appropriately sized | medium |
| W‑21 | JavaScript bundles are code-split; unused code is not shipped to the client | medium |
| W‑22 | Fonts are subset or loaded with `font-display: swap` | low |
| W‑23 | Render-blocking scripts are deferred or loaded async | medium |
| W‑24 | Core Web Vitals regressions (LCP, CLS, INP) are assessed for changed pages | high |

### Testing

| # | Criterion | Severity if violated |
|---|---|---|
| W‑25 | Component behaviour is covered by unit or integration tests | medium |
| W‑26 | Critical user journeys have end-to-end test coverage | medium |
| W‑27 | Accessibility is tested with automated tools (e.g., axe-core) as a baseline | medium |

---

## Scoring guidance

XSS and CSRF vulnerabilities are **critical**.  Accessibility failures on primary flows (login, checkout, form submission) are **high**.  Style or cosmetic issues that do not affect functionality or accessibility are **low**.
