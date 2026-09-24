---
name: deep-review
description: "Run independent correctness and maintainability audits, then synthesize one evidence-backed verdict. Use for deep branch review or a combined two-lane audit."
---

# Deep Review

Run two independent, read-only review lanes over the same change, then synthesize one verdict. By default, run both lanes yourself, one after the other. Use subagents for the lanes only when the user asks for them.

## Prepare

1. Resolve the review scope from the user's pull request, branch, commit, paths, or current changes.
2. Gather the diff, change intent, repository instructions, and the surrounding files required to prove effects.
3. Read the [correctness review](../correctness-review/SKILL.md) and [maintainability review](../maintainability-review/SKILL.md) before starting.
4. Keep the lanes read-only. Review authority does not include fixes, comments, commits, pushes, or other external writes.

## Run the lanes

- Correctness and security: follow the [correctness reviewer prompt](references/correctness-reviewer.md).
- Structural quality: follow the [code-quality reviewer prompt](references/code-quality-reviewer.md).

Run the correctness lane to completion and write its findings down before starting the structural lane, so the second lens does not inherit the first one's conclusions. Give both lanes the same diff and intent, and let each read more repository context as needed. Require findings with `file:line`, a concrete failure or maintenance cost, and evidence.

If the user asked for subagents, give one lane to each, with the matching prompt in its brief; neither lane starts nested subagents.

## Synthesize

Read both lane results completely. Verify their surviving findings against the repository. Deduplicate shared root causes, resolve disagreements with direct evidence, and reject speculative items.

Return findings first, ordered by severity and confidence. Then report cleared risks, remaining gaps, and how the lanes ran (in sequence or in subagents).
