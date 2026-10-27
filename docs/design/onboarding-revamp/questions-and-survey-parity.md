# Onboarding questions and the signup survey: one vocabulary

Last updated: 2026-10-27.

The first-agent onboarding and the EE post-signup survey ("Signup 3 - Agents" in PostHog)
both ask who the person is. They used different option lists and different property names,
so the same person produced two answers that could not be counted together. This page is the
mapping that makes them one.

## Who writes what

| Property | Shape | Written by | Values |
| --- | --- | --- | --- |
| `user_role_v2` | string | onboarding, then the survey while it still asks role | the role labels below |
| `company_size_v2` | string | onboarding, then the survey while it still asks size | Solo, 2-10, 11-50, 51-200, 201+ |
| `referral_source_v2` | string | onboarding | the source labels below |
| `agent_experience_v2` | string | the survey | Not yet — just exploring, Built prototypes or side projects, Running some in production, Running many at scale |
| `is_icp_v2` | boolean | the survey, only when it has all three inputs | derived, see below |

One writer per topic. The onboarding owns role, size and source. The survey keeps agent
experience, intent and the email backfill. PostHog person properties are last-write-wins and
keep no history, so a second writer would make "who said this" unanswerable.

`is_icp_v2` needs company size, role and agent experience. After the survey stops asking role
and size, its form writes the property only when every input is present, so it never
overwrites a real answer with `false`; reporting derives it instead (see below).

## Role: old label to new chip

Counts are persons on the Agenta Cloud project on 2026-10-27.

| Old label | People | New chip |
| --- | --- | --- |
| Hobbyist — personal projects | 353 | Hobbyist |
| Software Engineer | 236 | Engineer (AI, SWE, ML) |
| Freelancer / Consultant / Agency | 135 | Freelancer / Consultant / Agency (unchanged) |
| Founder or Executive | 129 | Founder or Executive (unchanged) |
| AI/ML Engineer or Data Scientist | 95 | Engineer (AI, SWE, ML) |
| Product Manager | 83 | Product Manager (unchanged) |
| Ops / Automation (BizOps, RevOps, IT) | 69 | IT / Operations |
| Engineering (one stray value) | 1 | Engineer (AI, SWE, ML) |

New buckets with no history: Sales, Marketing, Support, Student, Other.

The two unchanged labels are deliberately unchanged. Identical strings are what let an answer
from before the switch sit in the same bucket as an answer after it. Renaming one splits the
history and buys nothing.

Chips, in order, with the catalog category each puts first under the gallery's Recommended
chip: Founder or Executive (Ops), Freelancer / Consultant / Agency (Sales), Engineer (AI, SWE,
ML) (Engineering), Product Manager (Engineering), Sales (Sales), Marketing (Sales), Support
(Support), IT / Operations (Ops), Student (none), Hobbyist (none), Other (none).

## Company size: unchanged

Solo, 2-10, 11-50, 51-200, 201+. The same five labels the survey has always used, so no
mapping is needed. ICP treats 11-50, 51-200 and 201+ as the target sizes.

## Referral source: old multi-select answer to new single chip

The survey asks a multi-select question, so an event carries a list. Counts are `survey sent`
events over 180 days. An answer that picked several options counts once under each chip.

| Old label | Answers | New chip |
| --- | --- | --- |
| AI assistant (ChatGPT, Claude, ...) | 271 | ChatGPT or Claude |
| Online search | 256 | Google search |
| Github | 166 | GitHub |
| Social media | 109 | X or LinkedIn (one pick) |
| From a friend or colleague | 104 | Friend or colleague |
| Blog or publication | 56 | Newsletter or blog |
| Reddit | 47 | Reddit |
| Youtube (write-in) | 2 | YouTube |
| Conference write-ins (Slush, Presentation, Live Presentation) | 5 | Conference or event (new chip) |

New chips with no history: Hacker News, Other. When reading older answers, use "contains"
rather than equality, because the old value is a list.

## The Other write-in

Both questions that offer Other ask for one line. The stored value is `Other: <line>`, capped
at 120 characters, trimmed, and the step cannot advance until the line exists. Keeping the
prefix means a report can count Others and still read the text, and the value can never be
confused with a real label.

The survey form does the same thing in its own way: it swaps an Other choice for the
`question_N_other` field. Its write-ins are mostly noise (`asdfsdf`, `test`, `n`), with events
and hosting as the only repeated real ones.

## is_icp_v2

Definition, unchanged: company size in 11-50, 51-200 or 201+, role not Student or Hobbyist,
and agent experience not "Not yet — just exploring".

The role test matches any label starting with "Hobbyist", so a rename cannot flip the result.
Because the inputs now arrive from two surfaces, derive the number in reporting rather than
trusting the stored property:

```sql
SELECT
  countIf(
    properties['company_size_v2'] IN ('11-50','51-200','201+')
    AND lower(properties['user_role_v2']) NOT LIKE 'hobbyist%'
    AND properties['user_role_v2'] != 'Student'
    AND properties['agent_experience_v2'] NOT IN ('Not yet — just exploring', '')
  ) AS icp,
  count() AS people
FROM persons
WHERE properties['agent_experience_v2'] IS NOT NULL
```

## Events

Unchanged: `onboarding_started`, `onboarding_step_completed` (with `step`, the 1-based
position in the registry, and `step_key`, the question id), `onboarding_create_clicked`,
`onboarding_agent_created`, `onboarding_skipped`. Adding the size question shifts the numbers:
credits is step 4 of 5 now, not 3 of 4. Build funnels on `step_key`.

The survey's answers live on the immutable `survey sent` event as `$survey_response_<question
id>`. Those events are the record of what people answered before this change; do not delete
the question ids from the survey without noting them here.

## Question ids in the survey

| Kind | Question id |
| --- | --- |
| company size | `3b4ac88c-7530-46f1-b54a-c42bf6aca67a` |
| role | `d71aec24-7e9b-4d89-9cd7-c8f366693367` |
| agent experience | `789e5248-429f-4ba7-9993-e93ac8ad56a1` |
| intent | `5f1e7a56-2ceb-41ea-8973-6bbe8050f206` |
| referral source | `e15a61d7-15b2-4ddd-9efd-b2e154005675` |
| email | `d6c2d8aa-d624-4736-a71b-25fe0b74d0e9` |

The form resolves a question by id first and falls back to matching its text
(`/hear about (us|agenta)/i`, `/best describes you/i`, `/size of your company/i`). Reword a
question and the fallback is what keeps the property write alive.
