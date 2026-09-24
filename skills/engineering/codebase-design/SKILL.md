---
name: codebase-design
description: Design module interfaces or evaluate module depth when reviewing architecture, coupling, or testability.
---

# Codebase Design

Design deep modules: substantial behavior behind an interface callers can understand with little effort.
Preserve the project's domain vocabulary. Use the terms below for architectural reasoning.

## Vocabulary

- **Module**: a function, class, package, or larger slice with an interface and implementation.
- **Interface**: everything callers need to know, including types, invariants, ordering, errors, configuration, and performance guarantees.
- **Implementation**: the behavior hidden behind the interface.
- **Seam**: a place where behavior can vary without editing its callers. An **adapter** satisfies the interface at that seam.
- **Depth**: useful behavior per amount callers must learn. It gives callers **leverage** and concentrates change in one place, improving **locality**.

## Decision criteria

Judge depth by caller complexity, not implementation line counts.
A useful module hides decisions that would otherwise spread across callers.
Reduce exposed methods, parameters, and ordering constraints when that makes real callers simpler.
Justify new seams with actual variation, such as production and test adapters.
Internal seams can support implementation tests without becoming part of the public interface.

## Focused references

For a cluster with coupled dependencies, read [DEEPENING.md](DEEPENING.md).
For comparison of alternative interfaces, read [DESIGN-IT-TWICE.md](DESIGN-IT-TWICE.md).

## Completion

For a design request, present the interface, caller example, hidden responsibilities, and relevant trade-offs.
For an implementation request, integrate the chosen interface and verify affected behavior through a meaningful interface.
