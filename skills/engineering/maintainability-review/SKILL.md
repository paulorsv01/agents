---
name: maintainability-review
description: "Run an unusually strict maintainability review for structural simplification, abstraction quality, file growth, branching, types, boundaries, and codebase health."
---

# Thermo-Nuclear Code Quality Review

Review only the added or modified code and its demonstrated structural effects. Remain read-only unless the user separately asks for fixes.

Read the [canonical code-quality rubric](references/code-quality-review.md) in full before reviewing. Apply its code-judo, file-size, branching, boundary, type, canonical-layer, atomicity, and approval-bar rules.

## Workflow

1. Resolve the intended change and the smallest correct diff.
2. Read surrounding modules only as needed to judge ownership, reuse, and structural effects.
3. Search for an implementation shape that deletes concepts, branches, wrappers, or state.
4. Test every candidate finding against intended behavior and repository conventions.
5. Return a small set of high-conviction findings instead of cosmetic volume.

## Output

Order findings by structural regression, missed simplification, branching growth, boundary or type problems, file growth, then smaller maintainability concerns.

Each finding names `file:line`, the concrete maintenance cost, and the cleaner structural direction. If the implementation meets the rubric, approve it directly and name the strongest checks performed.
