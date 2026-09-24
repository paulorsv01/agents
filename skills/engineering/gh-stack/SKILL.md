---
name: gh-stack
description: Create, inspect, or update stacks of dependent branches and PRs with the gh-stack CLI extension.
metadata:
  author: github
  version: "0.0.9"
---

# gh-stack

A stack orders dependent branches above a trunk. Each PR targets the branch below it.
The bottom is closest to trunk; the top is furthest away.

## Select the operation

Start with `gh stack view --json` for an existing stack and inspect Git state relevant to the request.
For new layers or publication, read [branches and PRs](references/branches-and-prs.md).
For rebase, synchronization, or recovery, read [synchronization](references/synchronization.md).
For merging or removing stack grouping, read [merge and restructure](references/merge-and-restructure.md).
Use installed `gh stack <command> --help` for flags beyond these workflows.

## Non-interactive constraints

Supply branch arguments to `init`, `add`, and `checkout`; use `--json` for `view` and `--auto` for `submit`.
These flags avoid prompts or TUIs that block unattended execution.

With multiple remotes, use the intended remote explicitly where supported.
`checkout`, `modify`, and `trunk` rely on `remote.pushDefault`; preserve an existing correct setting.
If no default exists and the intended remote is known, configure that repository locally.

Keep dependent code in the same layer or above its dependency. Stage changes deliberately with `git add` and `git commit`.
Preserve repository requirements for signing, hooks, SSH push, and merge method.
A failed push or signature ends the attempt; report any branches or PRs already changed.

## Completion

Verify the requested branch order and PR bases with `gh stack view --json` and relevant Git state.
After mutations, inspect both output and final state: some commands can stop without completing or apply only part of an operation.
Report the completed action and any remaining conflict or failure.
