# Feedback Loops

Choose the loop that reaches the user's symptom with the least setup.

| Situation | Useful evidence |
| --- | --- |
| Existing failing behavior | Focused test, HTTP request, CLI fixture, or browser flow |
| Failure only with real input | Captured request, event log, trace, or isolated replay |
| Regression between known states | The same input across revisions or a `git bisect run` harness |
| Intermittent failure | Repeated trials with recorded failure rate, workload, seed, and timing |
| Human-only interaction | [HITL script template](../scripts/hitl-loop.template.sh) adapted to the needed action |

Assert the reported symptom, including wrong output or timing thresholds when relevant.
Control sources of noise that affect the verdict. Keep setup cheap enough for the experiments required.
A long or intermittent reproduction remains useful when it is the best available evidence.

For temporary logs, use a distinctive prefix so cleanup is reliable.
For performance, preserve workload and measurement conditions when comparing results.
Request captured artifacts or environment access only when that evidence is needed to proceed.
