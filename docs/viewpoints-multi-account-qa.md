# GraviQuest — Viewpoints backend / multi-account QA report

**Date:** 23 November 2026  
**Scope:** Topic 01, `/topic-answer-that-looked-right#views`  
**Status:** Original “frontend not connected to backend” claim **not confirmed**; two narrower cross-account problems **confirmed in source and corrected in PR #398**, with isolated Django + client regression coverage. Production rollout and authenticated browser acceptance must be reported separately from code/CI approval.

## Verified production read-only evidence (before patch)

- `GET /api/content/answer-that-looked-right/` returns published Topic 01 with Viewpoints poll `where-do-you-land`, its options, and its configurable question.
- `GET /api/content/answer-that-looked-right/poll/?poll_id=where-do-you-land&sealed=1` returns HTTP 200 and `total_votes=5`. For a reader who has not voted, `selected=null` and individual option counts are hidden; this is *expected sealed behavior*, not a broken endpoint.
- `GET /api/community/comments/answer-that-looked-right-poll-where-do-you-land/` as an anonymous reader returns an empty *published* reason list; it cannot establish whether unpublished reasons exist or whether moderation is working. Never infer the private moderator queue from this public response.
- `/api/community/comments/{content_key}/` is implemented in Django: authenticated posts begin `pending`; only published comments, plus the author's own pending comments, are returned. Replies require a published parent. Reactions require authentication and a published comment.
- Viewpoints moderation is separate from the Discourse Forum; Django Admin's `CommentAdmin` publishes/hides Viewpoints reasons and replies.

## Confirmed source-level defects, not a missing backend

1. **Account identity vs browser session:** Prior to #398, poll `voter_key` was a hash of the Django session ID even when authenticated. The same account using two browsers could be counted twice, and its earlier choice was not shared between browsers. **Fix:** member-scoped key for Viewpoints (using a server-secret hash of account ID); anonymous votes remain browser-scoped. The database's existing per-topic/per-poll uniqueness constraint enforces one row per account.
2. **Guest vote continuity at login:** Django rotates session IDs during login, so a guest's prior poll choice could disappear from the UI and be counted a second time. **Fix:** preserve the anonymous vote key in session data and adopt its existing vote into the signed-in member key without counting a duplicate. Existing vote rows are not wiped in bulk. A legacy vote already detached from every current account/session cannot be retroactively attributed to a specific person without evidence.
3. **Stale front-end state after switching accounts in different tabs:** `GQTalk.me()` and reason lists were cached in memory; a visible page could retain another account's pending reason or reaction state. **Fix:** recheck auth when the tab becomes active, clear cached comments on identity change, notify subscribed panels, and reset the selected Viewpoints poll/reason state. Direct Viewpoints write actions revalidate current auth.

## Isolated multi-account acceptance

New tests in `backend/core/test_viewpoints_multiaccount.py` use separate Django clients and temporary users in a **test database**, never production. Verified contracts:
- Alice and Bob independently vote; each sees their own choice.
- Alice votes in two distinct browser sessions; the row is **updated**, not duplicated.
- Anonymous voter signs into Alice in the same browser; her choice survives and can be changed without adding a second count.
- “See results first” prevents a subsequent first vote in that session but does not prevent a separate user from voting.
- Alice posts a reason: only Alice sees it pending. After moderator publication, Bob and a guest see it.
- Bob replies: only Bob sees the pending reply until publication. After approval, Alice and guests see it.
- Anonymous reactions fail with HTTP 401. Distinct accounts have independently persisted like/dislike choices and correct combined totals.

`scripts/test-viewpoints-auth-cache.cjs` additionally executes the **shipped client module** in an isolated browser-like harness: guest → Alice → Bob → guest changes invalidate in-memory private comment caches. The CI checks syntax of `assets/topic-talk.js` and `assets/topic-viewpoints.js`.

CI workflow: `.github/workflows/viewpoints-multi-account.yml`.  
PR: https://github.com/hsdarestani/gravitas/pull/398

## Remaining distinctions for an honest release report

- API connectivity and cross-account test-database correctness are **not** evidence that multiple independently owned accounts performed writes on live production. Live cross-account POST checks were intentionally not performed, to avoid polluting public votes, creating posts or requiring private credentials.
- Public reason list currently being empty does **not** prove moderation is broken; the admin queue was not inspected on production.
- Anonymous voting remains session scoped by design; anonymous users can still create different sessions. Sealed “seen results first” is also session scoped, not a global account-wide fraud-prevention guarantee.
- Before marking this complete, record the final CI result and successful production deploy; afterwards check public GETs and page JavaScript, and schedule a permissioned browser E2E with explicitly designated QA accounts and cleanup where required.

## Corrected conclusion

**Incorrect:** “Viewpoints is not connected to the backend.”  
**Accurate:** “The published Viewpoints frontend uses functioning Django APIs for poll definitions, votes, moderated reasons/replies and reactions. The previous implementation had account-identity and client-cache inconsistencies during multi-account/browser testing; these are being corrected and isolated regression-tested. The end-to-end production account/browser acceptance remains a distinct verification item.”
