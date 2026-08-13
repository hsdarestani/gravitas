# Gravitas+ Production Launch Gate

## Infrastructure
- [x] gravitasplus.com points to Strato production server.
- [x] HTTPS / Let's Encrypt enabled.
- [x] Nginx + Gunicorn + systemd production environment.
- [x] Automated GitHub deployment.
- [x] PostgreSQL production database.
- [x] Daily backups.
- [x] Uptime / TLS / health monitoring.
- [x] Staging environment at staging.gravitasplus.com.

## Product platform
- [x] Account signup/login/logout/session backend.
- [x] Newsletter persistence.
- [x] Double opt-in backend.
- [x] Password reset backend.
- [x] Community comments + moderation backend.
- [x] Interactive Lab progress persistence backend.
- [x] First-party KPI endpoint for staff.
- [x] CMS/Admin base for articles, dossiers, learning paths and labs.

## Launch blockers
- [ ] Replace remaining demo / front-end-only user-facing copy.
- [ ] Wire final password-reset UI to the production reset endpoints.
- [ ] Surface the double-opt-in state correctly in newsletter UI.
- [ ] Activate the prepared consent manager site-wide before any optional analytics is introduced.
- [ ] Publish final Privacy / Cookie / legal-controller information.
- [ ] Confirm controller legal name and postal address.
- [ ] Add Search Console verification and submit sitemap.
- [ ] Decide whether external analytics is needed; keep it disabled until consent is available.
- [ ] Connect application error tracking (Sentry or equivalent) if used.
- [ ] Run final production smoke test for homepage, account, newsletter email delivery, comments, lab persistence, admin and backups.

## Language policy
- [x] English is the canonical/base language.
- [x] German and Persian are prepared as localized editions, not independent canonicals.
- [ ] Enable localized content only after translated pages/content records are ready.

## SEO
- [x] robots.txt allows public content and blocks /admin/, /api/, /django-static/.
- [x] sitemap.xml is declared in robots.txt.
- [ ] Search Console verification.
- [ ] Validate canonicals / hreflang when localized editions are enabled.

## GDPR / privacy
- [x] Necessary session and CSRF storage separated conceptually from optional analytics.
- [x] Optional analytics remains disabled by default.
- [x] GDPR/TDDDG implementation requirements documented in docs/gdpr-launch-requirements.md.
- [ ] Controller identity/address completed in final privacy notice.
- [ ] Consent UI activated site-wide before optional analytics.
