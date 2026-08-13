# Gravitas+ Production Launch Gate

## Infrastructure
- [x] gravitasplus.com points to Strato production server.
- [x] HTTPS / Let's Encrypt enabled.
- [x] Nginx + Gunicorn + systemd production environment.
- [x] Automated GitHub deployment.
- [x] PostgreSQL production database.
- [x] Daily backups.
- [x] Uptime / TLS / health monitoring.
- [x] Backend log error monitor.
- [x] Staging environment at staging.gravitasplus.com.

## Product platform
- [x] Account signup/login/logout/session backend and production UI.
- [x] Newsletter persistence.
- [x] Double opt-in backend and UI state.
- [x] Password reset backend and production UI.
- [x] Community comments + moderation backend.
- [x] Interactive Lab progress persistence backend.
- [x] First-party KPI endpoint for staff.
- [x] CMS/Admin base for articles, dossiers, learning paths and labs.
- [x] Published-only public CMS API.
- [x] Live CMS renderer connected to Dossiers, Magazine, Learn and Lab.
- [ ] Move/retire remaining static prototype editorial blocks once real CMS content is populated.

## Launch blockers
- [~] Remove remaining prototype metrics, freshness labels, placeholder socials and demo-only copy. Site-wide cleanup is active; final manual pass remains.
- [x] Consent manager active site-wide before optional analytics.
- [ ] Publish final Privacy / Cookie / legal-controller information when the legal identity is ready.
- [ ] Decide whether external analytics is needed; keep optional analytics disabled until then.
- [ ] Complete final production smoke test after real launch content is loaded.
- [ ] Remove temporary pre-launch noindex only when the site is approved for indexing.

## Language policy
- [x] English is the canonical/base language.
- [x] German and Persian are planned as localized editions, not independent canonicals.
- [ ] Implement translated CMS content / URLs and hreflang before enabling DE/FA publicly.

## SEO
- [x] robots.txt allows public content and blocks /admin/, /api/, /django-static/.
- [x] sitemap.xml is declared in robots.txt.
- [x] Google Search Console domain property verified.
- [x] sitemap.xml submitted successfully in Search Console.
- [x] Canonical tags are injected for current public pages.
- [x] Temporary pre-launch noindex is active intentionally.
- [ ] Remove noindex at launch and request indexing of priority URLs.
- [ ] Validate hreflang when localized editions are enabled.

## GDPR / privacy
- [x] Necessary session and CSRF storage separated from optional analytics.
- [x] Optional analytics remains disabled by default.
- [x] Consent UI is active and the visitor can change the choice later.
- [x] GDPR/TDDDG implementation requirements documented in docs/gdpr-launch-requirements.md.
- [ ] Controller identity/address completed in final privacy notice when available.
