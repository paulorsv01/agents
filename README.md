# agents

Meu setup de agentes de código para Claude Code e Codex: instruções globais, skills e configuração do Claude Code e do Codex.

## Conteúdo

- `AGENTS.md`: preferências globais. Os dois agentes leem o mesmo arquivo.
- `skills/`: skills por categoria (`engineering/`, `design/`, `communication/`).
- `claude/settings.json`: configuração global do Claude Code.
- `claude/statusline-command.py`: statusline do Claude Code.
- `codex/config.toml`: preferências do Codex (modelo, effort, features, TUI, MCP do Figma).
- `install.sh`: instala tudo por symlink.

## Instalação

```bash
./install.sh
```

- `~/.claude/CLAUDE.md` e `~/.codex/AGENTS.md` apontam para o `AGENTS.md`.
- `~/.claude/settings.json` aponta para `claude/settings.json`.
- Cada skill vira um link em `~/.agents/skills/`. O Codex lê essa pasta; `~/.claude/skills` aponta para ela.
- As preferências do Codex entram em `~/.codex/config.toml` só nas chaves que faltam, porque o Codex grava estado da máquina nesse arquivo.
- Um arquivo que já existe e não é o link esperado vai para `<arquivo>.bak.<timestamp>`.
- Pode rodar de novo. Para atualizar: `git pull && ./install.sh`.
- Precisa de Python 3 para a statusline e de `uv` para aplicar as preferências do Codex.

## Skills

O agente usa as automáticas quando o pedido combina com a descrição. As manuais só rodam quando você chama pelo nome (`/nome` no Claude Code, `$nome` no Codex).

### Automáticas

| Skill | Para quê |
| --- | --- |
| `correctness-review` | Review de diff ou PR: correção, segurança, quebra de contrato |
| `maintainability-review` | Review estrito de estrutura e manutenção |
| `deep-review` | As duas reviews acima, em sequência, com um veredito único |
| `blast-radius` | O que uma mudança quebra fora do diff, provando o fato central |
| `clean-code` | Tira excesso de código gerado por IA sem mudar comportamento |
| `verify-this` | Prova ou refuta uma afirmação com baseline e tratamento |
| `diagnosing-bugs` | Investigação de bug com evidência reproduzível |
| `tdd` | Teste que falha antes e passa depois, só quando faz sentido |
| `type-system-discipline` | Tipos que tornam estado inválido impossível |
| `laziness-protocol` | Menor mudança que resolve, sem abstração sobrando |
| `codebase-design` | Interfaces de módulo e profundidade |
| `domain-modeling` | Termos de domínio e registro de decisões |
| `research` | Pesquisa técnica com fontes primárias |
| `resolving-merge-conflicts` | Resolve conflito de merge ou rebase |
| `gh-stack` | Pilhas de branches e PRs dependentes |
| `writing-for-agents` | Escrita de skills, `AGENTS.md` e docs para agentes |
| `cli-for-agents` | CLIs que agentes usam bem |
| `figma-read` | Lê design do Figma a partir do `.fig` |

### Manuais

| Skill | Para quê |
| --- | --- |
| `grill-me`, `grilling` | Entrevista para testar um plano ou decisão |
| `grill-with-docs` | Entrevista que registra termos e decisões |
| `handoff` | Documento para outro agente continuar o trabalho |
| `plain-language` | Reexplica a última resposta sem jargão |
| `show-me` | Explica o assunto com diagramas e esboços visuais |
| `claude-advisor` | Segunda opinião do Claude Code a partir do Codex |
