# Education product upgrade · 9 November 2026

## Baseline and scope

Continued the existing `hsdarestani/gravitas` application from `8bdbce99` on main in an isolated worktree. Recovered and inspected merged Education PRs #322–#326, #331 and #332, the three Education-named remote branches, the prior recovery record, current production page, canonical Brand Book and recent Lab mobile work (#342). Accessible prior worktrees contain the merged Education implementation; their unrelated changes were left alone. No later unmerged Education implementation was found. Inaccessible work from older sessions cannot be ruled out.

The baseline had nine working deterministic models, twelve prepared scenarios, grounded free-text Pulsar requests and a secondary scripted cart. The landing still used nine presentation chapters, displayed all five incline parameters, put the live studio several chapters below the hero, and had no session replay. All models, scenarios, the original cart and the existing public Pulsar endpoint are retained.

Only Education-scoped HTML, CSS, JavaScript, tests, this record and the sitemap change. No shared brand stylesheet, Lab module, backend, authentication, provider configuration, deployment workflow or runtime dependency changes. The existing static release classifier returns `static`.

## Delivered behavior

- Five sections: hero with embedded studio; why Pulsar; disciplines; curriculum; design partnership/contact.
- Complete EN/DE landing copy. English lead: “Don't just explain a concept. Let learners discover it.” German: “Konzepte nicht nur erklären. Entdecken lassen.” CTA: “Design a Learning Pilot” / “Lernpiloten planen”. Concrete paid co-development scope; subsequent licensing negotiated separately; no public pricing or asserted learning gains.
- Three featured subjects, with six more in a native expandable catalog. Every card is a real deep link. Thumbnails use the actual model functions at default values, computed once on visibility; no perpetual catalog animation. Heavy external engines are not added: the small shared deterministic module computes only the selected studio model and visible thumbnail snapshots.
- Explore: one scenario-relevant parameter and one key result. Investigate: additional controls, numerical entries and charts. Advanced: all parameters, equations and accessible model assumptions. The prepared comparison explicitly applies the stated single change; subsequent free exploration cannot overwrite its frozen evidence.
- Evidence emphasizes the teaching question: chemical B concentration, logistic separation, real purchasing power, SIR peak, damping overshoot, queue wait, neighbour similarity and neuron spike count. The spring model adds the exact first opposite peak amplitude to its existing analytic response; governing dynamics are unchanged. The incline equation now explicitly distinguishes static balance from sliding.
- Session replay records prediction, changed values, frozen A/B readings and optional reflection, with A/B replay buttons and up to six experiments in page memory. This is a small structured record, not an analytics platform.
- Only validated numerical model settings, selected scenario, mode and prediction/comparison status enter this tab's `sessionStorage` for language navigation. Free-text reflection, conversation and inquiries are never placed in browser storage or URLs. Reflections and chat are intentionally lost on navigation/reload; no server-side learner persistence or educator dashboard is claimed.
- Compact inline Pulsar guide on mobile; additional scenarios, detailed evidence, explanations and free-text chat expand on request. No floating layer, modal scroll lock or keyboard-obscuring controls. Diagram labels scale for narrow screens; inputs use readable sizes and native keyboard behavior.

## Service and contact contracts

Pulsar still uses `/api/pulsar/ask/`. A send attaches validated parameters, categorical incline motion/friction regime, model readings, assumptions and separately frozen A/B evidence. A separately labeled numeric model reference accompanies generated replies. Prepared guidance remains labeled local; service fallbacks are not identified as live AI. The existing backend bounds responses to 380 tokens. The frontend retains the 4,000-character request, 1,000-character question, six-turn bounded history and 22-second abort, and rejects oversized replies. Added a 12-request/10-minute tab limit and in-memory live-response cache. The cache also checks conversation context; changing the model or intervening conversation prevents an inappropriate reuse. No automatic sends or new paid providers. The client quota is a UX/cost restraint, not a server abuse-control boundary.

No general institutional inquiry delivery endpoint was found in the existing routes. The form validates and prepares an email to the existing `webmaster@gravitasplus.com` address. The visitor reviews and sends it in their email application. A copyable draft and direct address remain available if no mail application opens. The form neither sends nor claims receipt; no inbox delivery or response time is promised.

Both baseline pages already allowed indexing (no robots meta restriction and no robots.txt exclusion). The supplied objective is public institutional acquisition. This release explicitly keeps `index,follow`, preserves canonical/hreflang including x-default and Open Graph metadata, and includes both pages in the sitemap. It does not remove a private-pitch noindex restriction.

## Verification

- `npm test --prefix scripts/education`: **30 passed**. Covers all nine models and twelve scenarios in EN/DE, analytic references/conservation, overshoot peak, five sections/unique IDs/deep links, original cart, progressive depth, numeric bounds/friction constraints, frozen comparisons/replay, session-language restoration, absence of stored free text, safe text rendering, live provenance/reference, payload bounds, contextual caching, request cap, explicit send, oversize/failed/fallback/cancel/timeout paths, email draft and previews/metadata/theme.
- Four existing simulation suites: **27 passed** (`science-evidence`, `science-evidence-integration`, `science-universe-original`, `science-pulsar-scenarios`).
- HTML anchor check: five main sections, no duplicate IDs or broken local anchors in either page. JS syntax and `git diff --check` pass.
- Real Chrome, actual page in iframe viewports: EN and DE at 320/375/390/768/1440 px frame widths. Document scroll width matched client width in all ten combinations (client widths exclude the scrollbar). All nine model prediction/comparison flows worked in each language at 375 px frame width, with no document overflow.
- Education-specific CSS/JS is approximately 42.3 kB compressed in a local zlib comparison versus 38.9 kB at baseline; +3.4 kB for the new behavior, no external runtime libraries. This is a local size comparison, not measured production transfer or a Core Web Vitals audit.

Production acceptance and final browser checks are recorded with the PR after the release result is known. Automated/mocked service checks are not live API verification. Physical Android/iOS keyboards, assistive technology and native email delivery require separate device/inbox checks; no independent learning-outcome validation is asserted.
