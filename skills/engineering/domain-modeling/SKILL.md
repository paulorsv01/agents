---
name: domain-modeling
description: Define domain terminology or record architectural decisions when the user requests domain modeling or decision documentation.
---

# Domain Modeling

Resolve domain concepts and record the agreed vocabulary or architectural decisions within the requested scope.

## Choose the record

If `CONTEXT-MAP.md` exists, use it to locate the relevant context. Otherwise, use the project's existing glossary location.
Read [CONTEXT-FORMAT.md](CONTEXT-FORMAT.md) when creating or updating a domain glossary.
Read [ADR-FORMAT.md](ADR-FORMAT.md) when recording an architectural decision.
Create files only when there is agreed content to record. Preserve existing repository formats and locations.

## Resolve and record

Compare ambiguous terms with existing definitions and relevant code.
Use concrete scenarios to clarify distinctions that affect the model. Ask when a consequential ambiguity remains.
Distinguish current implementation from intended behavior when they differ.

Keep domain definitions in the glossary and implementation decisions in ADRs.
An ADR is useful when a decision has meaningful reversal cost, a real trade-off, and reasoning future readers need.
Within authorized documentation work, write agreed decisions directly; leave unresolved decisions marked as proposed or open.

## Completion

The agreed terms or decisions are recorded consistently, with references to affected contexts where needed.
Report changed records and remaining questions.
