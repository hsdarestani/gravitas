# Isolated application release rehearsal

The Release Center can deploy an independently approved development revision to a separate loopback target. The rehearsal covers authorization, version transition, health readback, rollback and audit history using preinstalled HTML artifacts. It does not provision the production Django service, proxy, database or workflows.

Create a private rehearsal directory on a disposable instance and place the identifier `isolated-production-rehearsal` in a file named `.isolated-release-target`. Install independently verified bundles as `artifacts/<exact SHA>/index.html`. Provision the same dedicated `GQ_ISOLATED_RELEASE_TOKEN` to the rehearsal Release Center and target process through their isolated environment files. Give ownership of the rehearsal directory to the target service account. Run the service as that non-root account with `python3 ops/staging/isolated_release_target.py <directory> <baseline SHA>`. The service binds only `127.0.0.1:18120` and never accepts uploads. Production and the active shared staging system require no changes for the test suite.

1. Register a development change with both the proposed and previous SHA.
2. Submit the change. A different reviewer records the successful Platform CI run for that exact revision and approves the proposal.
3. A release manager other than the author selects **Deploy to isolated release target**. The receipt records the target, exact current and previous SHA, idempotency key and served artifact digest.
4. Select **Roll back isolated release**. Rollback requires the active candidate and original receipt. It verifies the earlier artifact before recording the restored revision.

The target rejects stale bases, unauthorized requests, mismatched rollback requests and unavailable artifacts. Deployment and rollback receipts are committed atomically with the active artifact pointer. Repeating the identical request after a lost response preserves the original receipt while that revision is active. Production release authority stays disabled.

Run the focused Django integration test to exercise the full Release Center flow over a real loopback HTTP connection. It creates a temporary target, reads the served artifact after each operation and verifies authorization and stale-target rejection.
