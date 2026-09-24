#!/usr/bin/env bash
# Instala instruções, skills e configurações do Claude Code e do Codex por symlink.
# Pode rodar de novo. Um arquivo existente que não é o link esperado vai para <arquivo>.bak.<timestamp>.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTS_HOME="$HOME/.agents"

link() {
    local source="$1" target="$2"
    mkdir -p "$(dirname "$target")"

    if [ -L "$target" ] && [ "$(readlink "$target")" = "$source" ]; then
        echo "  [ok] $target"
        return
    fi

    if [ -e "$target" ] || [ -L "$target" ]; then
        local backup
        backup="$target.bak.$(date +%s)"
        mv "$target" "$backup"
        echo "  [backup] $target -> $backup"
    fi

    ln -s "$source" "$target"
    echo "  [link] $target -> $source"
}

echo "instruções"
link "$REPO/AGENTS.md" "$AGENTS_HOME/AGENTS.md"
link "$AGENTS_HOME/AGENTS.md" "$HOME/.claude/CLAUDE.md"
link "$AGENTS_HOME/AGENTS.md" "$HOME/.codex/AGENTS.md"

echo "claude"
link "$REPO/claude" "$AGENTS_HOME/claude"
link "$AGENTS_HOME/claude/settings.json" "$HOME/.claude/settings.json"

echo "skills"
mkdir -p "$AGENTS_HOME/skills"
# Remove links de skills que saíram do repo, para o agente não ver skill quebrada.
find "$AGENTS_HOME/skills" -maxdepth 1 -type l ! -exec test -e {} \; -print -delete | sed 's/^/  [removido] /'
for skill in "$REPO"/skills/*/*/; do
    skill="${skill%/}"
    [ -f "$skill/SKILL.md" ] || continue
    link "$skill" "$AGENTS_HOME/skills/$(basename "$skill")"
done
# O Codex lê ~/.agents/skills direto; o Claude Code lê ~/.claude/skills.
link "$AGENTS_HOME/skills" "$HOME/.claude/skills"

echo "codex"
# O Codex grava estado da máquina no config.toml, então as preferências entram só onde faltam.
if command -v uv >/dev/null; then
    uv run --quiet --with tomlkit "$REPO/codex/apply-config.py" "$REPO/codex/config.toml" "$HOME/.codex/config.toml"
else
    echo "  [codex] uv não encontrado; preferências do Codex não aplicadas"
fi

echo "pronto"
