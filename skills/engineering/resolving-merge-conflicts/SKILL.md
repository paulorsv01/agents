---
name: resolving-merge-conflicts
description: Resolve conflicts in an in-progress Git merge or rebase and complete the authorized operation.
---

# Resolving Merge Conflicts

## Resolve the intended behavior

Inspect Git state, the conflicting changes, and nearby history to establish each side's intent.
Read PRs or issues when local evidence leaves a consequential ambiguity.
Preserve compatible changes. If intents conflict, follow the requested merge goal or ask about the unresolved behavior.

Stage only resolved files belonging to the operation. Preserve unrelated work in the working tree and index.
Run the project's required checks and those relevant to the combined changes; fix failures caused by the resolution.

## Complete the operation

Continue the authorized merge or rebase with `GIT_EDITOR=true` until it finishes.
Respect repository signing and hook requirements. If intent or a required check remains blocked, report the state and missing decision.
Abort or discard conflict resolutions only when the user authorizes that action.
Confirm no unmerged entries remain and Git reports that the operation finished.
