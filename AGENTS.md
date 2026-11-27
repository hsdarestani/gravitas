# GraviQuest development

Use the [Development and Release Guide](docs/development-and-release-workflow.md) for task tracking, CI, shared staging and release approval. Check the existing QA owner and active staging SHA before requesting a deployment. Obtain explicit Final Approval before merging or releasing changes covered by an approval hold.

See [CLAUDE.md](CLAUDE.md) for repository conventions, the brand system and development commands.

Use the [architecture](docs/staging-architecture.md) and [staging parity matrix](docs/staging-feature-parity.md) to confirm subsystem-specific acceptance, credential scope and evidence before marking a change verified.

For production, check exact-commit Platform CI, exact-commit staging acceptance and independent Final Approval. Keep the shared staging revision on hold until its QA owner releases it. Record evidence on the existing development task.
