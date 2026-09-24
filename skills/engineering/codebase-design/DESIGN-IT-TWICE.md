# Design It Twice

Compare meaningfully different interfaces when the user requests alternatives or a consequential design choice remains unresolved.

## Frame and explore

Identify real callers, constraints, dependencies, and the behavior each design must hide.
Use the same examples and domain terms to evaluate each option.
Explore differences that affect the decision, such as a smaller interface, simpler common calls, or more flexible dependency substitution.

If parallel agent work is requested and available, give each agent a distinct design constraint and the relevant code context.
Otherwise, explore the options directly. Use as many options as needed to expose the trade-off.

## Deliver

For each viable option, show its interface, a usage example, hidden responsibilities, and dependency strategy.
Compare caller complexity, locality of changes, and seam placement.
Recommend the option best supported by the task's constraints and explain the cost of that choice.
Implement when implementation is part of the authorized task.
