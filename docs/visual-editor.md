# GraviQuest Visual Editor

The candidate uses the existing workspace shell at `/workspace/core/visual-editor`. An authorized editor opens a page, selects a visible element in the same-origin sandbox or chooses its field from the inspector, sets the proposed value, and previews the result. The editor offers undo, redo, light and dark preview, and viewport widths 360, 390, 768, 1024 and 1440 pixels. Saving commits an authenticated draft, and **Save and submit** sends that revision to independent review. The staging public page banner offers **Edit Page** only when the API confirms that the signed-in user may author changes.

| Area | Direct editing | Existing workflow or development path |
| --- | --- | --- |
| Homepage | Page title, search description, heading, hero summary, Topics button label and allowlisted link, hero spacing preset | Icon, illustration, layout and new components go through development. |
| Topics index, Lab index, Education, About | Page title, search description and main heading | Dynamic topic entries and editorial content stay in CMS. Lab and course authoring stay in Lab Studio and LMS. |
| Essays and individual topics | — | Use Nextcloud source, CMS and the existing Essay publication/version history. |
| Navigation, footer, images, Open Graph, sections and internal interface | — | Register a development change for structural work. Media selection, uploads, promotion, theme tokens and broader component coverage remain open. |
| Security configuration and private records | — | Use the existing restricted administration or deployment workflow. |

The source markup declares a stable identity using the registered page ID and a `data-visual-field` marker. The backend requires one matching marker for each field. The preview serializes structured values as text and allows only enumerated internal links and spacing presets. Scripts and external frames are stripped and the preview uses a restrictive CSP. Preview form submissions are blocked. A change proposal never alters the public homepage directly.

When a field has no visual schema, use the Release Center’s development form and link the existing task. The draft revision history belongs to Release Center. Canonical content, Nextcloud files, Labs and courses continue to use their existing system of record.
