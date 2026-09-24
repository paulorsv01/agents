---
name: diagnosing-bugs
description: Investigate bugs with uncertain causes, intermittent failures, or performance regressions using reproducible evidence.
---

# Diagnosing Bugs

Establish the cause of the reported symptom and verify a correction against that symptom.

## Evidence and diagnosis

Start from the failing input, observed behavior, and relevant code or logs.
Choose a feedback loop that exercises the real failure: an existing test, request replay, CLI fixture, or UI flow.
Read [feedback loops](references/feedback-loops.md) when reproduction needs a harness, intermittent sampling, or human interaction.

Minimize the reproduction enough to distinguish causes. Keep a record of the original scenario for final verification.
Test hypotheses with explicit predictions and targeted probes. Change one causal variable per experiment when practical.
If reproduction is unavailable, continue useful code and artifact analysis while stating what remains unverified.
Ask for the specific missing input or access when progress depends on it.

For performance work, measure the same workload before and after the change.
Use timing, profiling, or query plans to locate the bottleneck before changing code.

## Correction and completion

Implement the smallest correction supported by the evidence.
When a regression test can reproduce the actual failure at a meaningful interface, demonstrate failure before the fix and success afterward.
If automated coverage cannot capture the symptom, document the verification method and its limits.

Recheck the original scenario and affected behavior. Remove temporary instrumentation and artifacts created for this investigation.
Finish with the cause, correction, and verification evidence. Report unresolved limitations that affect confidence in the fix.
