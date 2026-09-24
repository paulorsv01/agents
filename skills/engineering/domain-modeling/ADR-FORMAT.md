# ADR Format

Follow existing ADR conventions. Without an established convention, use `docs/adr/` and sequential numbering: `0001-slug.md`, `0002-slug.md`, etc.

Create the `docs/adr/` directory lazily — only when the first ADR is needed.

## Template

```md
# {Short title of the decision}

{1-3 sentences: what's the context, what did we decide, and why.}
```

That's it. An ADR can be a single paragraph. The value is in recording *that* a decision was made and *why* — not in filling out sections.

## Optional sections

Only include these when they add genuine value. Most ADRs won't need them.

- **Status** frontmatter (`proposed | accepted | deprecated | superseded by ADR-NNNN`) — useful when decisions are revisited
- **Considered Options** — only when the rejected alternatives are worth remembering
- **Consequences** — only when non-obvious downstream effects need to be called out

## Numbering

Scan `docs/adr/` for the highest existing number and increment by one.

## When to record

Use the decision criteria in [SKILL.md](SKILL.md): meaningful reversal cost, a real trade-off, and reasoning future readers need.
Record decisions already authorized for documentation directly. Mark unsettled choices as proposed.
Examples include data ownership, integration contracts, and technology choices with lasting constraints.
