# Aplica as preferências versionadas no config.toml do Codex sem sobrescrever o que já existe.
# O Codex grava estado da máquina no mesmo arquivo, por isso não dá para usar symlink.
# Uso: uv run --with tomlkit codex/apply-config.py <preferencias.toml> <~/.codex/config.toml>
import sys
from pathlib import Path

import tomlkit


def merge_missing(target, source, prefix=""):
    added = []
    for key, value in source.items():
        if key not in target:
            target[key] = value
            added.append(prefix + key)
        elif isinstance(value, dict) and isinstance(target[key], dict):
            added += merge_missing(target[key], value, f"{prefix}{key}.")
    return added


preferences_path, config_path = map(Path, sys.argv[1:3])
preferences = tomlkit.parse(preferences_path.read_text())
config = tomlkit.parse(config_path.read_text()) if config_path.exists() else tomlkit.document()

added = merge_missing(config, preferences)
if added:
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(tomlkit.dumps(config))
print("  [codex] " + (f"chaves adicionadas: {', '.join(added)}" if added else "config já tem todas as preferências"))
