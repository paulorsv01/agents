# Synchronization and Recovery

## Choose the scope

`gh stack sync` fetches, rebases, pushes, and synchronizes stack state. Use it when remote publication is authorized.
It mirrors branches added remotely and never opens new PRs.
`--prune` deletes local merged branches; use it only with authorization for that cleanup.

For local rebasing, use `gh stack rebase` and the intended remote where supported.
`--upstack` updates the current layer and higher layers; `--downstack` selects the lower portion.
`--no-trunk` skips fetching and rebasing trunk while aligning stack branches.

To change a middle layer, check out that branch, commit the change, and rebase dependent layers before returning to the caller's branch.
If an earlier PR was already squash-merged externally, gh-stack detects the merged history and rebases remaining commits with `--onto`.

## Conflicts and interrupted operations

If `sync` finds a rebase conflict, it restores pre-rebase branches and exits with code 3.
Use `gh stack rebase` to enter a resolvable conflict state, inspect the files, and stage only resolved changes.
Continue with `GIT_EDITOR=true gh stack rebase --continue` until the rebase finishes.
Abort only when authorized to discard the operation's resolutions.

A diverged local and remote stack can produce `Sync aborted` with exit code 0.
Inspect the output and final state before claiming success. Reconcile the intended composition before rebuilding tracking.

| Code | Response |
| --- | --- |
| 1 | Inspect the error; stop and report push or signing failures. |
| 2 | Determine whether the task concerns an existing stack before creating one. |
| 3 | Resolve the rebase conflict in the state described above. |
| 4 | Check authentication and remote state before considering a retry; a remote mutation may already have succeeded. |
| 5 | Check arguments against installed command help. |
| 6 | Select a branch that belongs to one stack. |
| 7 | Inspect the active rebase before continuing it. |
| 8 | Check for another writer and wait for its lock to clear. |
| 9 | Report that the repository needs stacked PRs enabled. |
| 10 | Inspect the interrupted `modify` session; preserve it until recovery or abort is authorized. |

Status messages go to stderr; JSON data goes to stdout. Keep errors visible when diagnosing incomplete operations.
