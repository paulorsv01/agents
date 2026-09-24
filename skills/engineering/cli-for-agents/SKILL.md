---
name: cli-for-agents
description: "Design or review command-line interfaces for reliable agent use. Use for non-interactive commands, layered help, pipelines, actionable errors, idempotency, dry-run, and machine-readable output."
---

# CLI for Agents

Design command-line interfaces that work headlessly, compose in pipelines, and remain understandable through incremental discovery.

## Inputs and discovery

- Express every required input as a flag, value, stdin stream, or stable environment contract.
- Keep interactive prompts as an optional fallback after non-interactive inputs.
- Let the root command and each subcommand own layered `--help` output.
- Include copyable examples in every subcommand help surface.
- Use one predictable command grammar across resources and verbs.

## Execution contracts

- Fail immediately on missing inputs with the exact correction and one valid invocation.
- Make successful retries safe through idempotency, no-op detection, or an explicit conflict.
- Provide `--dry-run` for destructive or expensive work.
- Keep human confirmation by default and expose an explicit non-interactive confirmation flag.
- Accept stdin and emit stable stdout when the command belongs in a pipeline.
- Keep diagnostics on stderr and use meaningful exit codes.

## Output

Return machine-usable identifiers, URLs, durations, state, and result data. Offer structured output when callers need more than one stable field. Decorative output cannot be the only representation.

## Review an existing CLI

Exercise the actual command. Check its non-interactive path, help hierarchy, examples, pipeline behavior, errors, idempotency, preview mode, confirmation bypass, command grammar, exit codes, and success output. Report concrete gaps against observed behavior, then apply changes only when the request authorizes implementation.
