# Gravitas Nextcloud

Nextcloud is the canonical internal file and collaboration layer for Gravitas.

## Responsibilities

- **Gravitas HQ** owns strategy links, projects, tasks, content workflow, evidence metadata, permissions and references.
- **Nextcloud** owns normal team files: documents, PDFs, research packs, images, working exports and shared folders.
- **YouTube / Vimeo** own published streaming video.
- **Dedicated video infrastructure** (for example Opencast or another video platform) will own course/raw/high-volume video later.
- **R2 / S3 / other object storage** can be mounted or referenced when file volume grows beyond the application server.

HQ should store Nextcloud file/share URLs and metadata rather than duplicate binaries.

## Canonical URL

`https://cloud.gravitasplus.com/`

DNS must point `cloud.gravitasplus.com` to the Gravitas server before provisioning runs.

## Server layout

- Application: `/var/www/nextcloud`
- Data: `/srv/nextcloud-data`
- Config/credentials: root-only files under `/etc/gravitas/`
- Database: separate PostgreSQL database/user for Nextcloud
- Cache/locking: Redis
- Web: existing Nginx + PHP-FPM
- TLS: Certbot / Let's Encrypt

## Storage policy

Do not use this instance as a raw-video archive. Team members should keep large raw footage and course video on dedicated media storage. Nextcloud is for normal collaborative files and can later mount external storage when needed.

## Future integration

The HQ integration can use:

- WebDAV for file/folder operations.
- OCS Share API for share links.
- Provisioning API for subscription-based users, groups and quotas.
- OIDC/app-password based authentication for service integration.

Do not store Nextcloud admin passwords or app passwords in Git. Runtime credentials belong in root-only server files or GitHub Actions secrets.
