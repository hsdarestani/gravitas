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
certificate avoids dependency on the currently incorrect forum DNS. All
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
in the forum's local persistent backup directory. Before public
launch, configure an independent off-host destination and test restoring a
backup into a separate disposable Discourse installation. Local backups and
container restart checks do not establish disaster recovery. Do not restore
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
Real Android Chrome, iOS Safari, external email delivery, and off-host backup
restore remain launch acceptance requirements until tested explicitly.

## Verified internal installation

Native acceptance and Chromium screenshots passed in [Actions run 42500237600](https://github.com/hsdarestani/gravitas/actions/runs/42500237600), using theme/service source from commit `e8e155230d0f52d77654dfd8a1e36be3e00db3d2`. Actual moderation approval uses the authenticated native review API. The runner verifies persisted image bytes by checksum after restart, as well as discussions, replies, polls, ACLs and notifications, then removes only recorded QA users, posts and votes.

Both desktop 1440px and Android emulation at 390px rendered the native poll, loaded the bundled DM Sans font and visible brand logo, opened a native discussion, and had zero horizontal page overflow or uncaught JavaScript errors. These are browser emulations, not tests on physical Android or iOS devices.

The new service remains loopback-only on the GraviQuest host. The production `forum.html` has not been switched to this feature branch. The final read-only host check confirms that forum DNS now resolves and both existing Django and the new internal forum are healthy. Public activation is blocked by unconfigured secure S3-compatible storage. The reviewed Django feature release is not yet deployed. DNS destination and public HTTPS, native private-file acceptance, real GraviQuest browser SSO, email delivery, and off-host restore must still be verified before describing this as a production launch.

Final Django validation after managed-group lifecycle hardening: 1,156 tests passed with 3 skips. The focused Forum/account suite passed 46 tests. These checks preserve existing Workspace, Pulsar, Labs and account behavior; they do not replace the pending public SSO and email delivery checks.
