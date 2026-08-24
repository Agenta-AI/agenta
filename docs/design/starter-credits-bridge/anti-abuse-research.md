# Signup-email anti-abuse: libraries and services

The plus-tag rule in [design.md](design.md) is a stopgap. This page is the survey of
things that can own the rest of the job: disposable domains, mailbox canonicalization
(Gmail dots, plus tags, `googlemail.com`), and hosted signup-fraud products.

The constraint that every option has to meet: account creation stays open. A failed check
only skips the credit grant. A vendor outage must fail open to "no grant" or fall back to
the local list. It must never fail signup.

No single library owns the whole problem. Split it:

| Job | What it is | Can a list do it? |
| --- | --- | --- |
| Disposable / throwaway domain | mailinator, guerrilla, rotating MX farms | Yes, if the list is fresh |
| Alias / plus / Gmail dots | same inbox, many strings | Local normalizer, not a blocklist |
| Freemail vs work | gmail vs acme.com | Separate list or API flag |
| Fake account / bot / free-tier farm | device, IP, velocity, graph | Hosted fraud product |

## Disposable-domain lists

### disposable-email-domains

- Source: [disposable-email-domains/disposable-email-domains](https://github.com/disposable-email-domains/disposable-email-domains), Python package [disposable-email-domains](https://pypi.org/project/disposable-email-domains/).
- License: list is CC0. PyPI wrapper is MIT. Maintained by Dustin Ingram (`@di`, PyPI).
- Shape: `from disposable_email_domains import blocklist`. In-process set.
- Freshness: PyPI 0.0.243 on 24 Aug 2026. Releases almost daily. 5.4k GitHub stars.
- Detects: known disposable / temporary domains. Maintainers require a screenshot of a page that generates an address on that domain. Second-level domains only; callers must match public-suffix parents (`foo.mailinator.com` to `mailinator.com`).
- Privacy: the email never leaves the process.
- False positives: lowest among public lists. It will miss brand-new rotating domains for days. It does not treat Proton, SimpleLogin, or Gmail as disposable.
- Signup fit: yes. Fail open on import error. Skip the grant only on a hit.
- Used in the wild: PyPI itself blocks throwaway domains with this list ([PyPI blog, Jun 2024](https://blog.pypi.org/posts/2024-06-16-prohibiting-msn-emails/)).

### MailChecker

- Source: [FGRibreau/mailchecker](https://github.com/FGRibreau/mailchecker), PyPI `mailchecker`.
- License: MIT. Python, JS, Go, Rust, PHP, Ruby.
- Freshness: PyPI 6.0.21 on 19 Jul 2026. Claims 55,000+ domains.
- Detects: regex format plus a large disposable-domain set.
- False positives: higher than disposable-email-domains. Bigger list, weaker admission bar.
- Signup fit: same fail-open pattern. Prefer the smaller list unless obscure throwaways become the problem.

### Castle top-1,000 abuse list

- Source: [castle/disposable-email-domains](https://github.com/castle/disposable-email-domains), announced [11 May 2026](https://blog.castle.io/inside-the-infrastructure-behind-fake-signups-our-open-source-disposable-email-domain-list/).
- Shape: one domain per line, ranked by observed abuse.
- Detects: the 1,000 disposable domains Castle actually sees in fake-signup traffic. They do not import other public lists. They exclude privacy relays (SimpleLogin, Addy).
- Signup fit: a second set unioned with disposable-email-domains. Not enough alone. Check the repo LICENSE before vendoring.

### Lists that are a bad first choice

| Name | Why not |
| --- | --- |
| [disposable/disposable](https://github.com/disposable/disposable) | ~100k domains, daily scrape of other lists. High false positives, no admission bar. |
| [7c/fakefilter](https://github.com/7c/fakefilter) | Decent middle ground. Smaller community, no Python package. |
| [wesbos/burner-email-providers](https://github.com/wesbos/burner-email-providers) | Slow updates, documented false-positive PRs. |
| [willwhite/freemail](https://github.com/willwhite/freemail) | Looks stale. Do not vendor. |
| WhoisXML disposable DB | Paid daily dump. Vendor lock. Overkill. |

## Mailbox canonicalization

A blocklist cannot do plus tags, Gmail dots, or `googlemail.com`. A one-line
`if "+" in local` also cannot do Gmail dots, Workspace-vs-consumer Gmail, Fastmail
subdomains, or `me.com` to `icloud.com`.

### email-normalize

- Source: [gmr/email-normalize](https://github.com/gmr/email-normalize), PyPI [email-normalize 3.2.0](https://pypi.org/project/email-normalize/).
- License: BSD-3-Clause. Python 3.11+. Sync `email_normalize.normalize(...)` and an async `Normalizer`. Optional MX lookup via `aiodns` + `tldextract`.
- Freshness: 3.2.0 on 29 Jul 2026. Active in 2026.
- Rewrites:
  - Plus tags: Google, Microsoft, Apple, Fastmail, Proton, Rackspace, Yandex, Zoho.
  - Strip dots: consumer Gmail / googlemail only. Google Workspace custom domains keep dots (Workspace treats dots as real).
  - Domain folding: `googlemail.com` to `gmail.com`; `me.com` / `mac.com` to `icloud.com`. Does not fold `outlook.com` into `hotmail.com` (those are different mailboxes).
  - Fastmail "local part as hostname" on custom domains.
  - Yahoo: no plus-strip (Yahoo plus is not a real alias in the same way).
- Privacy: local. `skip_dns=True` uses a static domain map. Default mode does MX lookups so `user+x@custom-google-workspace.com` still normalizes. MX talks to DNS, not a vendor, and does not send the local part.
- False positives: low if the result is a **dedupe / velocity key**, not the stored login email. Send mail to the original address.
- Signup fit: yes. Normalize, then key Redis velocity on the canonical mailbox. Do not rewrite the auth-stored email.

### Weaker options

| Name | Why not |
| --- | --- |
| [CorentinTh/email-normalizer](https://github.com/CorentinTh/email-normalizer) | TypeScript, 10 stars, Gmail/Hotmail/Live/Outlook only. |
| [JoshData/python-email-validator](https://github.com/JoshData/python-email-validator) | Syntax + DNS. Does not strip plus or Gmail dots. |
| Homemade `local.split("+")[0]` | Misses Gmail dots, `googlemail.com`, the Workspace exception, Fastmail, Apple folding. Fine as the 1-hour stopgap that [design.md](design.md) ships. Not the long-term owner. |

MaxMind publishes a [minFraud email-normalization recipe](https://dev.maxmind.com/minfraud/normalizing-email-addresses-for-minfraud/) (trim, lowercase, NFC, then provider rules, then hash). Useful as a spec if a hash ever goes to a fraud vendor. Not a library.

## Hosted email APIs

These send the address (or the domain) to a vendor. Most of this market is deliverability
(will this bounce?), not signup fraud. Read the flags, not the homepage.

### UserCheck

- Site: [usercheck.com](https://www.usercheck.com/), [docs](https://www.usercheck.com/docs).
- Shape: HTTP. `GET /email/{email}` or `GET /domain/{domain}`. Fine from FastAPI.
- Detects:
  - `disposable` at domain or address level, including throwaways on Gmail/Outlook after normalization.
  - `normalized_email` (plus tags, provider aliases, domain folding). Compare `email` vs `normalized_email`. Send mail to the original.
  - `public_domain` (freemail: Gmail, Yahoo, Outlook). This can replace the 74-domain list.
  - `relay_domain` (SimpleLogin, Apple Hide My Email, DuckDuckGo).
  - `role_account`, `spam`, `free_subdomain`, MX, typo suggestion.
  - Domain-only endpoint: same disposable / public / relay signals without sending the local part.
- Cost: 1,000 credits/month free, 1 req/s. Paid plans are usage-priced.
- Privacy: the email endpoint sends the full address. The domain endpoint does not. That is the cleanest hosted privacy option in this survey. EU hosted, GDPR, DPA on paid plans.
- False positives: they only mark `disposable: true` when the service is confirmed. Relays are a separate flag, so Proton/SimpleLogin stay allowed unless we choose otherwise.
- Signup fit: yes. Short timeout. On 5xx / timeout, keep the local list + velocity. Never block account creation.

### Kickbox, ZeroBounce, NeverBounce, Mailgun, Abstract, IPQS

| Vendor | Useful flag | Cost (public) | Fit |
| --- | --- | --- | --- |
| [Kickbox](https://docs.kickbox.com/docs/single-verification-api) | `disposable`, `free`. "Normalized" is lowercase only. | 100 free, then about $0.008–$0.01/check | Deliverability-first. Official Python SDK. Overkill if we only need a boolean. |
| [ZeroBounce](https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-status-codes) | `disposable`, `free_email`. Also `abuse` / `do_not_mail`. | About $8 / 1,000 | Mailing-list hygiene. `abuse` will over-flag people we still want as users. |
| [NeverBounce](https://www.neverbounce.com/email-verifier) | disposable / accept-all | About $0.008/check | Same class as Kickbox. |
| [Mailgun Validate](https://www.mailgun.com/features/email-validation-api/) | MX, disposable, role, risk | Bundled with Mailgun | Fine if we already pay Mailgun. Not worth adding an ESP for this. |
| [Abstract](https://www.abstractapi.com/api/email-verification-validation-api) | disposable, free, `is_subaddress` (plus tags) | 100 free/month, then $17/month for 5,000 | Decent flags. Sends full email. 3 req/s cap. |
| [IPQualityScore](https://www.ipqualityscore.com/documentation/email-validation-api/overview) | `disposable`, `fraud_score`, `recent_abuse` | About $5 / 1,000 at the low end | Fraud-intel vendor. Higher false-positive risk. Higher tiers attach identity. Cannot justify that for a credit-grant skip. |

## Broader signup-fraud products

Realistic only if email rules stop being enough (device farms, residential proxies, stolen
Gmail).

### Trueguard

- Site: [trueguard.io](https://trueguard.io/).
- What it is: free-tier abuse product. JS snippet + backend API. Device ID, disposable-email intel, IP/VPN/proxy, bot score, rules engine.
- Cost: 1,000 events/month free. Standard $49.99/month for 10,000.
- Privacy: email + IP + device fingerprint leave the browser. DPA available.
- Signup fit: the closest hosted product to "people farm starter credits." Heavier than an email-only first step. Requires a frontend snippet.

### Cloudflare Account Abuse Protection

- Docs: [Account Abuse Protection](https://developers.cloudflare.com/bots/account-abuse-protection/) (Early Access, updated 1 Jul 2026).
- What it is: Bot Management Enterprise add-on. Fields: `cf.fraud_detection.disposable_email` / `disposable_domain`, `cf.fraud.email_risk`. Hashed per-zone User ID. Works with Turnstile ephemeral IDs.
- Cost: no extra charge for a limited period until GA. Requires Bot Management Enterprise. Not on the free/pro plan.
- Privacy: they say they do not store email addresses. User IDs are hashed per zone.
- False positives: `email_risk=high` on a random local part will hit some real people. Use it to skip credits, not to challenge signup.
- Signup fit: excellent if traffic already sits on Cloudflare with Bot Management. Useless as a standalone library. Complementary to Turnstile, not a replacement for a Python package.

### Too heavy for this problem

| Product | Why skip now |
| --- | --- |
| [Castle](https://castle.io) | Full device + behavior + graph. The open list is useful. The product is a trust-and-safety platform. |
| [Sift](https://sift.com) | Enterprise score, sales-led. Overkill for skipping a small grant. |
| [Sumsub](https://sumsub.com/account-fraud-prevention/) | KYC / identity. Wrong layer. |
| [Amazon Fraud Detector](https://aws.amazon.com/blogs/machine-learning/prevent-fake-account-sign-ups-in-real-time-with-ai-using-amazon-fraud-detector/) | Needs labeled history. We do not have it. |
| Arkose, Ping Identity | Bot/ATO suites. Pair with Turnstile later, not with the email policy. |

## Do not pick

- Abandoned or stale lists (`willwhite/freemail`, old `django-email-blacklist`). Disposable providers rotate weekly.
- Giant aggregated lists (`disposable/disposable` at ~100k). They block real users and still miss tomorrow's domain.
- Sending the full email to a deliverability vendor we do not already use (Kickbox, ZeroBounce, NeverBounce, Mailgun Validate) just to read a `disposable` boolean. That is personal data for a problem a local set solves.
- Enrichment APIs that attach names, phones, or "who is this person."
- SMTP "does this mailbox exist" probes. Extra latency. Some providers tarpit or lie. Different question than "will this person farm credits."
- Cloudflare AAP without Bot Management Enterprise. The fields will not exist.
- GPL infection is not a live risk here. MailChecker, disposable-email-domains, and email-normalize are MIT / CC0 / BSD-3.

## Shortlist

### 1. disposable-email-domains + email-normalize

Use this if we want to stop writing rules and never send signup emails to a vendor.

- `pip install disposable-email-domains email-normalize`
- On mint: if the domain is in `blocklist`, skip the grant. Normalize with `skip_dns=True` (or async MX if Workspace plus-tags matter) and key Redis velocity on the canonical mailbox.
- Keep the free-mail tuple for a while, or replace it later with a maintained public-domain set / UserCheck `public_domain`.
- Keep Redis caps. They still do work no list can do.
- Drop the homemade plus ban once normalization is live, or keep it as a belt on top.

Privacy: none leaves the process. Cost: none. Latency: microseconds. Maintenance: Dependabot on two small packages.

### 2. UserCheck (domain endpoint first)

Use this if we want a vendor to own disposable + freemail + relay + canonical form, with a
privacy switch.

- Domain-only call: no local part leaves Agenta. Replaces the disposable list and can replace the 74-domain free-mail list (`public_domain`).
- Email call: adds `normalized_email` and address-level disposable-on-Gmail.
- Timeout 200–400 ms. On failure, fall back to the local list. Skip the grant only.
- 1,000 free checks/month is enough to trial on cloud.

### 3. Trueguard

Use this if credit farming is already a device/IP problem, not just an email-string
problem. $50/month at 10k events. Requires a JS snippet and a DPA conversation. Do not
start here.

### 4. Cloudflare Account Abuse Protection

Use this if signup traffic already terminates on Cloudflare Bot Management Enterprise.
Pair with option 1 for OSS / self-hosted, where Cloudflare is not in the path.

## Recommended sequence

1. Ship the hardcoded plus-tag rule in [design.md](design.md). One check. Closes the hole we can see today.
2. Adopt option 1 (`disposable-email-domains` + `email-normalize`) in the mint path. That retires the homemade plus rule as the owner and closes Mailinator and Gmail-dot twins.
3. Spike UserCheck domain-only on a shadow log for two weeks. Compare hits against option 1. Decide if `public_domain` can replace `DEFAULT_FREEMAIL_DOMAINS`.
4. Do not buy Kickbox, ZeroBounce, or IPQS for this. Do not stand up Sift, Castle, or Sumsub for this.
5. Revisit Trueguard or Cloudflare AAP only after residual grant abuse is not an email-string problem.
