# Research project providers and buffered Nextcloud edits

## Trust boundaries

Research projects store **references** to approved connection aliases, never
access tokens, database passwords or arbitrary outbound URLs. Adding a tool
to a project is not equivalent to activating an external service.

GitHub private access is read only, over a fixed GitHub API endpoint with
redirects disabled. Tokens MUST have least-privilege read-only repository
metadata/contents access. Each token alias MUST have an explicit server
allowlist of repository names. A manager cannot use an alias for another repo.

External PostgreSQL connections are only a `SELECT 1` connectivity check;
there is no arbitrary SQL or schema-browser endpoint. Provision a dedicated,
read-only database role and grant no modification privileges.

### Server environment variables

All JSON values below are **illustrative**, not actual credentials. Install
them in the protected service environment, not in Git, a document, or the web UI:

```text
GRAVITAS_PROJECT_GITHUB_TOKENS_JSON={"teamresearch":"<token stored by ops>"}
GRAVITAS_PROJECT_GITHUB_ALLOWED_REPOS_JSON={"teamresearch":["example-organization/private-research"]}
GRAVITAS_PROJECT_REMOTE_DATABASES_JSON={"research_lab":{"HOST":"db.example.invalid","PORT":"5432","NAME":"lab","USER":"reader","PASSWORD":"<read-only credential>","SSLROOTCERT":"/etc/ssl/private/ca.pem"}}
GRAVITAS_PROJECT_DATABASE_ALIASES_JSON={"laboratory":"research_lab"}
```

Only deploy when actual credentials and an approved host are provided. Backend
restart and a successful API verification are required before a project is
marked as previously verified. A stale binding may become setup-required
again if its server allowlist or configured alias is removed.

## Buffered Nextcloud file editing

Projects with adopted canonical files expose the **Drafts & Sync** tab.
Only users with edit permission on both project and the specific canonical
object can see or edit its private draft.

1. Open a known canonical file. Its content and base ETag are read from DAV.
2. Edit and save to a private, server-side buffer; the Nextcloud file is not
   changed. The editor also debounces private-buffer writes.
3. Press **Push to Nextcloud** to compare ETags and conditionally write.
4. If changes are nonoverlapping, the existing conservative merge code can
   merge them. Otherwise a 409 returns base, mine, remote and latest ETag.
5. The editor displays the conflict for a manual, reviewed merge, saves the
   new buffer against the exact remote ETag, and still requires another
   explicit Push.

The existing canonical revision records and DAV journal remain authoritative.
No 'force overwrite' option is provided. Audit documents are not editable.
Drafts are not browser-offline storage: an offline-first encrypted browser
cache requires additional security review. Private research content is **not
sent to any AI provider** as part of conflict resolution.

## Remaining work

- A fully reviewed private/self-hosted Pulsar merge assistant with explicit
  per-use consent and no third-party transfer.
- External database browsing, scoped query policies and safe dataset imports;
  the first adapter currently only verifies connectivity.
- Signed, versioned third-party plugin installation and isolation. Uninstalled
  Compute, Analysis and Machine Learning providers show setup-required.
- End-to-end acceptance tests on real server accounts and external providers.
