# Community and Discourse operations

The public Community page uses the supplied redesign. The Forum keeps the live
`forum.html` table, room chips, overlapping avatars and replies/views/activity
columns, following the latest product direction. Its native Discourse theme
uses the same palette, type and hairline rows. Home uses the same live table
renderer. Every row opens its own native permalink; unknown metrics are not
invented. The forum runs official
Discourse stable 2026.7.4, pinned by commit in `ops/discourse/render_config.py`.
Its theme uses supported GJS plugin outlets and the native poll component.
No Discourse core files are modified. Existing Django comments and poll votes
remain intact; they are not imported as fabricated forum participation.

## Deployment boundaries

`stage.sh` creates only the `graviquest` Docker container and
`/var/discourse/shared/graviquest`. PostgreSQL and Redis are internal to that
container. Only `127.0.0.1:18880` is exposed. The container has a 3 GB memory
limit and a 2 CPU quota. Initial capacity checks require 4.5 GB available RAM
and 25 GB free storage (2.5 GB available for an already running forum).
Existing containers and PostgreSQL databases
are not restarted, replaced, or reused.

The production deployment must include migration
`0092_discourse_content_links`. Then `launch.sh` verifies DNS and the installed
feature release, adds a dedicated forum nginx virtual host, obtains HTTPS
using the existing ACME account, imports content mappings, and enables the
optional Django environment and logout worker. It restarts Django once to load
that environment. Run it under the existing production concurrency lock.
Do not run it while DNS or the reviewed backend release is missing.

Required DNS: `forum.graviquest.com` must point to the same web server serving
`graviquest.com`. No DNS management connection is supplied by this repository.
Internal staging is not a public deployment or proof of browser SSO.

Public activation requires native Secure Uploads. The user authorized an
isolated self-hosted S3 installation; `storage.sh` installs SeaweedFS 4.52 from
the official checksum-verified release. It runs as `graviquest-objectstore`,
with persistent data in `/var/lib/graviquest-objectstore`, credentials in
`/etc/graviquest-objectstore` and only loopback service/admin listeners. Its
limits are 512 MiB RAM, 0.5 CPU and 128 tasks. Sixty-four 256 MiB volume slots
bound nominal volume capacity to 16 GiB plus metadata; this is not a filesystem
hard quota. Installation requires 3 GiB available RAM and 50 GiB free disk.

Only `https://graviquest.com/graviquest-uploads/` and
`https://graviquest.com/graviquest-backups/` proxy to S3. The existing apex TLS
certificate protects the isolated storage endpoints independently of forum TLS. All
pre-existing nginx routes remain intact; invalid additions roll back. The
deployment template preserves this isolated snippet. Both buckets remain
private, without a public bucket policy. A separate application key has rights
only to those buckets; explicit ObjectWriter ownership supports Discourse's
per-object public/private ACL changes. The tiny server plugin sets the AWS
SDK's supported `force_path_style` option; native CDN settings produce the
canonical HTTPS path without core patches or rewritten signed requests.

`storage.sh` verifies actual HTTPS writes, denied anonymous listing/writes and
private reads, presigned byte checksums, public-to-private ACL changes, scoped
keys and persistence after restarting only the storage service. It connects
the root-only `forum.json` only after these checks pass. Native acceptance then
tests private attachments through Discourse; public launch fails closed until
that passes. Existing local brand uploads are not destructively migrated.
`graviquest-objectstore-health.timer` checks the process, disk headroom and
authenticated HTTPS access to both buckets every five minutes. Failures enter
the systemd journal; no independent external alert channel has been configured.

## Identity and permissions

DiscourseConnect external ID is `graviquest:<Django user primary key>`.
Emails must be verified by GraviQuest before they can map a forum account.
The existing account signup and login screens are used; local Discourse
password and email-code login are disabled. Profile names use the existing
name, with a non-email fallback. Avatar URLs are signed, expire after an hour,
and serve only bounded PNG, JPEG or WebP payloads.

| Django authority | Discourse authority |
| --- | --- |
| Existing active superuser | Forum admin |
| `graviquest-forum-moderators` group | Forum moderator |
| `graviquest-forum-researchers` group | `researchers` private group |
| `graviquest-forum-reviewers` group | `reviewers` private group |
| Other verified active account | Ordinary member |

Research workspace access alone does not create forum access. Private groups
must be explicitly assigned by an administrator. Ordinary member submissions
require native moderation approval. Staff can publish directly.

GraviQuest logout revokes mapped native forum sessions. A network failure
retains a durable outbox entry retried every minute. Account suspension and
removal from managed groups, managed-group rename/deletion, or admin authority revoke sessions after the access
change commits. Account deletion preserves a retryable external-identity outbox
even when the Django user row no longer exists.
Native Forum logout ends its own session and opens a CSRF-protected GraviQuest
sign-out form. Finishing that form ends the workspace session too; this is a
two-step flow and must not be described as atomic single-click logout.

Public feed and Topic integrations make **anonymous** Discourse reads. They
never use the server API key, never expose private research categories, and
do not cache a private authenticated response. All posting, attachment upload,
poll voting, likes, reporting, notifications and profile editing use native
Discourse controls. The website's reasoning form opens a native discussion
draft; it does not falsely report that a reply has already been submitted.

## Secrets, backup and recovery

`/etc/gravitas/forum.json` is root-only and reuses the host's existing SMTP
configuration without printing values. Existing active Django administrator
emails define the initial developer list. A new DiscourseConnect secret is
generated once. The Django session-revocation key has only `users/show` and
`users/log_out` granular scopes. It is never sent to a browser. Public reads
do not use it. SMTP certificate verification remains `peer`.

Native daily backups include local and S3 uploads, retaining 14 backups. The
second bucket is reserved for storage/backup workflows; native backups remain
in the forum's local persistent backup directory. The acceptance workflow restores a native archive into an isolated temporary
database, verifies the brand, discussions and an original S3 attachment digest,
then removes that temporary database. An independent off-host destination is
still unconfigured. Local backups, same-host recovery and container restart
checks do not establish recovery after loss of this entire server. Do not restore
over a running production forum. Keep a root-only copy of the configuration
and record the pinned Discourse and launcher commits alongside backups.

`graviquest-forum-health.timer` checks HTTP, feed availability and backup age
every five minutes. Failures enter the systemd journal. External alert routing
and off-host monitoring are operator prerequisites; they are not implied by a
successful local health check. Review stable security releases monthly, test
an updated pin and theme in staging, back up, and rebuild only this container.
Never run an unattended major upgrade or delete the shared storage directory.

## Research workflow boundary

`ForumDiscussion` stores an explicit published-content key, protected CMS
content ID, Discourse topic/category IDs, public flag and source version hash.
Discourse owns posts, reply relationships, upload permissions, polls and votes.
No invented source, member count, vote or research result is seeded. Initial
threads are labelled official and link only to published CMS material or the
existing Topic 01 static page when it is explicitly linked from the deployed
landing page. Preview topics and sample forum members are never imported.

These independent workflows are **not implemented** by the forum theme:

| Workflow | Required service integration |
| --- | --- |
| Exact video timestamp feedback | Versioned content asset ID and timestamp anchor mapped to Discourse post ID |
| Pending / Accepted / Rejected / Resolved scientific review | Server-authorized review records, transitions and audit trail; native post approval is a different decision |
| Scientific content, scenario and rhythm evaluation | Separate review criteria and version-specific evaluation records |
| Reviewer-only content versions | Explicit reviewer ACL checked in both the content service and private Discourse category |
| Pulsar feedback summaries | User-scoped native access or independently checked review records; never an admin-key scrape of private posts |

Discourse has native reply-to relationships and maintained post-voting modes;
it does not reproduce an unlimited Reddit-style nested thread tree. The theme
shows real likes, native polls and native voting where available. These are
intentional differences from the preview's arbitrary local up/down counters.

## Acceptance boundaries

The native acceptance runner uses recorded reserved-domain QA identities, then
removes only its own IDs and votes. It checks native SSO, member moderation,
replies/editing/deletion permissions, real uploads, polls/likes, search/tags,
private text ACLs, notifications and persistence after restarting only the forum
container. Chromium then renders the actual native application through an SSH
loopback bridge at desktop and mobile widths, retaining the HTTPS origin and
production CSP. This is not a public-browser Django SSO or email delivery test.
Physical Android and iOS devices, delivered email, external alert delivery and
off-host recovery remain unverified. Public HTTPS browser acceptance is recorded
separately below; it does not substitute for those checks.

## Verified internal installation

Native acceptance, private S3 files, backup and three browser projects passed in [Actions run 42506023094](https://github.com/hsdarestani/gravitas/actions/runs/42506023094), from source commit `62ae1d3cf6221a2afea89512b872e024a8fefe19`. The root-only local configuration now connects Discourse Secure Uploads to the installed SeaweedFS service. Real signed bytes, unsigned private denial, public-to-private ACL changes, scoped keys, storage restart and native container restart persistence passed. Secure Uploads uses randomized access hashes; byte checks use its original content digest. Native moderation, replies/edit/delete permissions, polls, likes, search/tags and in-app notifications passed, followed by removal of only recorded QA users, posts and votes. The native backup includes S3 uploads.

Desktop Chromium at 1440px, Android Chrome emulation at 390px and iPhone WebKit emulation at 390px rendered the native poll, loaded the bundled DM Sans font and visible brand logo, opened a native discussion, and had zero horizontal page overflow or uncaught JavaScript errors. These are browser emulations, not physical Android or iOS device tests. Extra native login/search/filter controls and the native reply/composer model retain Discourse behavior within the GraviQuest table design; this is not a pixel-identical replacement for every native screen.

## Verified public launch — 8 November 2026

The public forum is live at <https://forum.graviquest.com>. The existing table at
<https://graviquest.com/forum.html> reads real anonymous Discourse data, and
<https://graviquest.com/community> and published scientific Topic routes connect
to their actual discussion IDs. The user updated `forum` to a CNAME of
`graviquest.com`; both address families matched before activation. A dedicated
nginx virtual host proxies only the native loopback port. Let's Encrypt issued
a valid certificate with the existing renewal mechanism. Migration 0092 and
four official content mappings are installed. The optional Django environment,
logout retry worker and forum health timer are active.

Main deployment `924b48d38879d7804d6d4f6505edb4259b5bba05` passed in
[run 42530889002](https://github.com/hsdarestani/gravitas/actions/runs/42530889002).
The later concurrent Topic 01/Pulsar deployment
`aebb8c5ab1344b298499398809b92e178c91b7c4` also passed; its published essay and
Pulsar changes are preserved. Deployment now retains an existing administrator
instead of trying to recreate it when a credential-export file is absent.

[Public acceptance run 42533631566](https://github.com/hsdarestani/gravitas/actions/runs/42533631566),
source `c3a35e06d356039731ff118a7ffe14af51fe0e71`, passed real HTTPS without
TLS bypasses, request mocks or browser administrator keys:

- Existing GraviQuest password login and DiscourseConnect for three recorded
  ordinary-member, moderator and researcher identities; stable repeat login.
- Native composer creation with an actual file selection/upload, moderation
  approval, replies, own-post editing, persistent poll voting and search.
- In-app mention notification, private research membership and private file
  access allowed only for the authorized researcher.
- GraviQuest logout revoked the native Forum session.
- Actual server-side identity, group, post, attachment and vote records checked
  after browser reload, followed by exact-ID cleanup of all temporary QA data.
- The public table, filters and scientific Topic mapping, plus desktop Chromium,
  Android Chrome emulation and iPhone WebKit emulation; no mobile page overflow.
- Native backup restoration into a separate temporary database, including
  original S3 attachment byte verification, followed by temporary database
  removal. Production was never restored over.

The storage service remains isolated on loopback. Public S3 uses two paths on
the verified apex HTTPS host; uploaded documents have a sandbox, MIME protection
and no forwarded application cookies. Native process, feed, backup age, storage
availability and disk headroom have periodic local health checks. Existing site
and backend health checks still pass. Credentials remain in root/service-only
files and never enter screenshot artifacts or frontend responses.

Remaining operational actions are an independent off-host backup destination
and external alert recipient/channel. Delivered SMTP mail and physical-device
checks have not been verified. Advanced version/timestamp research reviews and
permission-aware Pulsar summaries remain the separate service work described
above. The native composer/search/profile controls retain supported Discourse
behavior and differ from the original preview's custom widgets. No synthetic
engagement remains in the public feed.

Final Django validation after managed-group lifecycle hardening: 1,156 tests passed with 3 skips. The focused Forum/account suite passed 46 tests. These checks preserve existing Workspace, Pulsar, Labs and account behavior; they do not replace the separate email delivery and off-host recovery checks.
