---
name: correctness-review
description: "Audit a branch or pull-request diff for correctness, security, breaking behavior, developer-experience regressions, and feature-gate leaks."
---

# Thermo-Nuclear Review

Audit the changed code with an unusually high evidence bar. Remain read-only. A review request does not authorize fixes, comments, pushes, or other external writes.

## Scope

Resolve the smallest correct diff from the user's branch, pull request, commit, or paths. Inspect surrounding code when it is needed to prove an effect, but report only problems introduced or exposed by added or modified code.

Read repository instructions and the stated change intent before judging the diff. If a pull request exists, postpone its review discussion until after the independent audit.

## Audit lenses

### Breaking behavior

Trace changed contracts through callers, packages, persistence, generated artifacts, and runtime boundaries. A local edit can break behavior in untouched consumers.

### Security

Check authentication, authorization, secrets, injection surfaces, unsafe parsing, path handling, external inputs, feature gates, and trust boundaries affected by the diff. Prove reachability and impact before reporting.

### Developer experience

Check changes to environment variables, secrets, ports, networking, build steps, generated files, scripts, dependencies, and local startup contracts. A new optional path is not a regression by itself.

### Feature-gate leaks

Trace gated features through server enforcement, clients, APIs, jobs, navigation, persistence, and alternate entry points. Do not accept a visible gate when another reachable path bypasses it.

### Intended breakage

Do not report a deliberate, well-contained behavior change as a defect. Report it when the diff's actual blast radius exceeds the stated intent or the available evidence does not establish containment.

## Evidence rules

- Finish the investigation before naming a finding. Follow client/server and cross-package paths when the repository makes them available.
- Verify the failure path from changed code to an observable consequence.
- Calibrate severity from reachability, affected users, reversibility, and impact.
- Reject plausible findings that do not survive a concrete attempt to disprove them.
- If required evidence is unavailable, name the gap as residual risk instead of promoting it to a finding.

After the independent audit, read pull-request discussion only when a pull request exists and medium-or-higher findings survived. Validate external findings locally, deduplicate them, and attribute the ones retained.

## Output

Start with confirmed findings ordered by severity. Each finding includes `file:line`, the triggering path, the observable failure, the supporting evidence, and the correction direction.

Then report cleared risks, unverified gaps, and the commands or artifacts used as evidence. If no finding survives, say so directly and name the highest-risk paths checked.
