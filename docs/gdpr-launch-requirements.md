# Gravitas+ GDPR / TDDDG launch requirements

Status: implementation checklist for production launch. This is not a substitute for legal review.

## Current product data flows

- Account: email, display name, password hash, session/CSRF cookies.
- Newsletter: email address, source, confirmation status; double opt-in is required before activation.
- Community: authenticated user, comment body, moderation status, timestamps.
- Interactive Lab: authenticated user, lab key, JSON progress/result, score/completion state, timestamps.
- KPI: aggregated product activity; do not store raw IP addresses or browser fingerprints for KPI purposes.
- System email: STRATO SMTP, sent from the Gravitas+ domain.

## Consent boundary

Strictly necessary storage may be used for authentication/session security and for remembering a privacy choice. Optional analytics, advertising, personalization or other non-essential client-side storage must remain disabled until opt-in.

A consent UI must provide a real reject option, explain purposes before consent, and allow the user to change/withdraw the choice later. Do not load optional analytics before consent.

## Privacy notice must contain before launch

The final public privacy notice must identify the legal controller and provide its contact details. It must also describe purposes, legal bases, recipients/processors, retention periods or criteria, data-subject rights, complaint rights, transfers outside the EEA where applicable, and the data collected by account, newsletter, community and lab features.

## Operator details still required

Before the public legal pages are finalized, provide the exact legal operator/controller name and postal address. Do not publish guessed or placeholder legal identity information.

## Launch gate

- [ ] Exact controller/operator identity and postal address supplied.
- [ ] Public Privacy Policy finalized with the real operator details.
- [ ] Imprint requirements reviewed for the operator and editorial offering.
- [ ] Consent manager enabled before any optional analytics/tracking.
- [ ] Reject and change/withdraw controls verified.
- [ ] Necessary cookies/storage documented.
- [ ] Processor/data-processing agreements reviewed for hosting, email, monitoring and analytics vendors as applicable.
- [ ] Data retention/deletion rules documented and implemented.
- [ ] Account deletion/export workflow defined before broad public account rollout.
