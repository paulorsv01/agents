---
name: verify-this
description: "Verify a falsifiable claim with fresh baseline and treatment evidence. Use for verify this, prove it works, did this fix it, before-and-after evidence, or measurable behavior claims."
---

# Verify This

Prove or disprove one specific claim with repeatable evidence. A verification request authorizes local checks and temporary artifacts, not product changes, commits, pushes, or external writes.

## Frame the claim

Restate the claim as a condition, metric, and threshold. If the claim is vague, define the smallest measurable version that matches the user's intent. Ask only when multiple definitions would change the verdict.

## Capture evidence

1. Choose the smallest local surface that can disprove the claim.
2. Capture a valid baseline from the merge base, parent commit, failing branch, or current broken reproduction.
3. Capture treatment from the changed state with the same command, data, warmup, and environment.
4. Compare raw artifacts such as numbers, screenshots, transcripts, responses, profiles, snapshots, or test output.
5. Reject comparisons whose environment, inputs, or timing make the result unreliable.

Use the repository's own run, test, and verification tooling for evidence.

When disk artifacts are safe and useful, create a unique temporary directory with `mktemp -d`. Store only the claim, timeline, baseline, treatment, diff, and verdict. Keep sensitive evidence inline unless the user approves storage.

## Verdict

Return exactly one verdict:

- `VERIFIED`: treatment changes in the predicted direction and meets the threshold without an obvious confound.
- `NOT VERIFIED`: behavior is unchanged, moves the wrong way, or misses the threshold.
- `INCONCLUSIVE`: no valid baseline exists, the signal is noisy, a check fails, or environments differ materially.

Report the falsifiable claim, baseline, treatment, delta, threshold, evidence locations, and confounds. A clear negative result is complete verification.
