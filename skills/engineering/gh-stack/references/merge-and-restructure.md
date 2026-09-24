# Merge and Restructure

## Merge

Before an authorized merge, confirm the intended stack or PR range and repository merge requirements.
Use `gh stack merge <target> --yes --merge` when the repository supports merge commits.
The user's global instructions prohibit squash-merging a PR that was already pushed; do not inherit an unknown last-used merge method.
If repository policy cannot satisfy that constraint, report the conflict before merging.

A numeric target can name a stack or an upper PR; verify which target the installed CLI resolves.
With no target, the command merges the entire current stack.
Use `gh stack merge` for stacked PRs; `gh pr merge` does not handle the stack operation.

Merging is atomic when performed directly and does not bypass repository requirements.
If a merge queue applies, it controls the method and can merge PRs in separate groups.
Check queue policy before submission when the method matters. Report queued state as queued, not merged.

## Restructure

`gh stack unstack` removes local and remote stack grouping while preserving branches and PRs.
`gh stack unstack <number>` targets a remote stack even without local tracking.
`gh stack unstack --local` removes only local tracking and does not contact GitHub.

Inspect the current branch order and preserve the information needed to reconstruct it.
Use the scope already authorized for restructuring; obtain confirmation before removing grouping that the user has not authorized.
Recreate the intended order with `gh stack init --base <trunk> <branches...>`.
For a conflicting remote checkout, replace local tracking only when that replacement is authorized, then retry checkout with an explicit target.
Verify the resulting order, PR bases, and preserved branches.
