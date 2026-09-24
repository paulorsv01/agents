---
name: writing-for-agents
description: "Write predictable documents for agents. Use for skills, AGENTS.md, CLAUDE.md, or agent-facing reference documents."
---

# Writing for Agents

Write every agent-facing document so repeated runs follow the same process. Apply the same rules to skills, repository instructions, and referenced documents. For skill packaging, invocation, and routers, read [skill mechanics](references/skill-mechanics.md).

## Context pointers

A context pointer names material outside the current context and states when to read it. Its wording controls discovery.

- State what the material contains.
- Name one trigger for each distinct branch.
- Front-load the leading concept.
- Remove identity already carried by the target.

Always-loaded pointers spend context on every turn. User-invoked material spends human attention because the human must remember it.

## Information hierarchy

Place each instruction at the highest useful level:

1. In-file steps describe the ordered process.
2. In-file reference defines rules consulted during that process.
3. Disclosed reference serves branches that only some runs need.

Keep definitions, rules, and caveats together. Split a document when a branch hides the main process or the visible later steps cause premature completion.

## Completion criteria

End every step with an observable completion criterion. Sharpen vague criteria before splitting the sequence. Demand exhaustive output where missing one item invalidates the result.

Use leading words that already carry useful meaning. Reuse the token across the document. Phrase target behavior positively. Reserve prohibitions for hard guardrails and pair them with the desired action.

## Pruning

- Keep each meaning in one authoritative location.
- Treat configuration, commands, and directory layout as sources of truth.
- Document conventions, reasons, and traps the environment cannot reveal.
- Remove stale lines, duplicated branches, and no-op instructions.
- Test disputed instructions by running the document and comparing behavior.

The document is complete when every live branch has a pointer, every step has a checkable end, and every line changes behavior or preserves necessary reference.
