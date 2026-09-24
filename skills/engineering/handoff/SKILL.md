---
name: handoff
description: Save a handoff document so another agent can continue the current conversation's work.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

# Handoff

## Artifact

Save a Markdown handoff in the operating system's temporary directory, using a unique path.
If arguments describe the next session's focus, tailor the document to that work.

Include the active objective, user constraints and authorization, completed work, current state, blockers, and the next actionable step.
Reference existing specs, plans, ADRs, issues, commits, and diffs by path or URL.
Include commands and verification results needed to resume reliably. Omit secrets and unnecessary personal information.
Recommend skills only when the next task specifically needs them.

## Completion

A fresh agent can locate the work and continue without inventing missing decisions or permissions.
Return the absolute document path.
