---
name: clean-code
description: "Remove AI-generated code slop from the current diff while preserving behavior. Use for clean-code, code cleanup, unnecessary defensive code, weak casts, excess comments, or avoidable nesting."
---

# Clean Code

Clean the changed code in place. Preserve behavior and repository conventions. A Clean Code request authorizes focused edits and their verification, not unrelated refactors, commits, pushes, or external writes.

## Scope

1. Resolve the diff from the user's paths, branch, commit, or current changes against the correct base.
2. Read repository instructions and enough surrounding code to establish the local style.
3. Limit edits to slop introduced or exposed by the change. Leave unrelated existing code intact.

## Remove

- Comments that restate code, narrate obvious steps, or conflict with local style.
- Defensive checks and `try`/`catch` blocks that add impossible states to trusted paths.
- `any` casts and assertions used only to bypass a type problem.
- Deep nesting that direct control flow or early returns can remove.
- Redundant wrappers, helpers, branches, temporary variables, and duplicated logic.
- Names, prose, and abstractions that do not match the surrounding codebase.

## Guardrails

- Keep behavior unchanged unless the diff contains a clear bug within the requested scope.
- Prefer deletion and focused edits over broad rewrites.
- Preserve intentional validation at trust boundaries.
- Run the smallest authoritative formatter, typecheck, test, or build checks that cover the edits.
- Inspect the final diff for behavior drift and unrelated churn.

Return what changed, what verification passed, and any residual uncertainty in three concise sentences or fewer.
