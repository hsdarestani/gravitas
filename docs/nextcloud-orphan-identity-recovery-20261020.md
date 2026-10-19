# Native Nextcloud identity recovery (Oct 20, 2026)

Production Nextcloud provisioning failed for the managed identity
\`gravitas-u-1190\`: password reset returned OCS 998, while an attempted
recreate returned OCS 101 ("Login is invalid because files already exist for
this user"). Nextcloud explicitly prevents creating an account if a residual
home folder with the same user ID already exists.

\`ops/nextcloud/rescue-orphan-managed-identity.sh\` is a one-time narrowly
targeted recovery step installed by \`.github/workflows/nextcloud.yml\`
**before** running the normal managed credential reconciliation:

1. Confirm the exact managed account is absent according to \`occ user:info\`.
   If it exists, refuse to touch the home directory.
2. Check the mounted persistent Nextcloud volume layout and encryption
   status. Refuse any unexpected data directories and encrypted volumes.
3. Validate free disk space, and take independent backups of both the
   PostgreSQL database and the complete orphaned home directory.
4. Atomically move the abandoned home into a persisted, non-served
   quarantine directory without deletion.
5. Recreate the same native UID using a temporary random secret, then copy
   the files back without overwriting any files created by Nextcloud,
   rescan with \`occ files:scan\`, and keep the full original in quarantine.
6. The standard Django credential-repair service reasserts the stable,
   encrypted credential held by Gravitas.
7. Provision Nextcloud only succeeds when the subsequent credential repair,
   Notes/Deck reconciliation and native health checks succeed.

The script never deletes user files, does not modify other native user
directories, does not log any passwords, and aborts before mutation if the
backup, free-space check, expected mount layout, or encryption preflight
fails. Backups live under
\`/var/backups/gravitas-nextcloud/orphan-identity\`; the preserved original
lives under the persistent HTML volume's
\`.gravitas-orphan-rescues\` directory.

**Do not remove the backup or quarantine directory without reviewing file
counts, content, timestamps, permissions, restore status and compliance
retention requirements.** This script restores file bytes and rebuilds the
file index, but an orphaned account may have had historical shares or
application-specific metadata that need independent review.

The one-off workflow invocation specifically names user \`1190\`; it is
a no-op if that native user already exists. If the user is present yet OCS
password reset fails, a separate admin-authentication investigation is
needed instead of moving the account's files.

## Deployment replay after concurrent main update

The initial production deployment of PR #232 was cancelled during concurrent
updates to main and cannot be treated as a successful restore. This record is
also used to request a fresh standard production deployment against the
currently merged main, followed by Nextcloud provisioning and authenticated
DAV verification. Only a green **Provision Gravitas Nextcloud** production
workflow (not its PR syntax-validation job) constitutes verified recovery.
