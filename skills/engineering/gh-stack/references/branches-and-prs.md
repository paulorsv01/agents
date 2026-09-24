# Branches and Pull Requests

## Setup and local layers

Check that `gh` is installed and authenticated and the `github/gh-stack` extension is available.
If installation is part of the task, use `gh extension install github/gh-stack`.
Before `init`, enable repository-local `rerere.enabled` to avoid its first-run prompt.

| Action | Command |
| --- | --- |
| Create or adopt branches, bottom to top | `gh stack init branch-a branch-b` |
| Select a trunk | `gh stack init --base develop branch-a` |
| Add a layer from the current top | `gh stack add branch-c` |
| Inspect state | `gh stack view --json` |
| Navigate | `gh stack up`, `gh stack down`, `gh stack top`, `gh stack bottom` |

Names are used verbatim. `init` checks out the last branch; `add` requires the current top and carries uncommitted changes into the new branch.
Use explicit staging and signed commits with the repository's required checks before advancing layers.
If a branch belongs to multiple stacks, select a non-shared branch to resolve exit code 6.

## Publish within the requested scope

`gh stack push` pushes active branches without creating PRs.
`gh stack submit --auto` pushes and creates draft PRs; add `--open` when ready-for-review publication is requested.
Both operations can leave partial changes if a later branch fails. Inspect the state and report a failed push without retrying.

`submit` derives a single-commit PR's title and body from that commit.
With multiple commits, it derives the title from the branch name. Review the resulting PR text.
For custom text, write and review a temporary body file, then use `gh pr edit <number> --title <title> --body-file <path>`.
Write titles and bodies in the language the user's instructions require (PT-BR by default).

For branches managed outside gh-stack, `gh stack link branch-a branch-b` creates or links the remote stack without local tracking.
`link` can push branches, create PRs, and change PR bases. Include those effects in the authorized operation.
A stack number as the first argument appends subsequent branches or PRs to that stack.
If stacked PRs are unavailable, report exit code 9 and the repository requirement.

## Checkout

`gh stack checkout <branch>` resolves locally tracked branches.
A numeric argument resolves as a stack number first, then a PR number, then a branch name.
Use a PR URL when that ambiguity matters.

Remote checkout fetches branches and creates local tracking.
If local and remote compositions differ, checkout can enter an unbypassable prompt.
Inspect the compositions first; read [merge and restructure](merge-and-restructure.md) when replacing tracking is authorized.
