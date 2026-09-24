# Skill mechanics

Use this reference when the agent-facing document is a skill.

## Invocation

A model-invoked skill keeps an always-loaded description. Its description names the distinct trigger branches. Use this form when the agent or another skill needs to discover it.

A user-invoked skill removes model discovery. It spends no ambient context and requires the human to invoke it by name. Use this form when the skill only runs by hand.

In Codex, set `policy.allow_implicit_invocation` in `agents/openai.yaml`. This plugin sets every skill to `false`, so all skills require explicit invocation.

## Splitting

Split a model-invoked skill when one distinct leading concept needs independent discovery or another skill must reach it. The new always-loaded description must earn its context cost.

## Router skills

When explicit-only skills become hard to remember, provide one router that lists each skill and its use. The router guides the human to the correct explicit invocation. It does not invoke another explicit-only skill by itself.
