#!/usr/bin/env python3
"""Claude Code statusline — colorful, compact."""

import json
import os
import re
import subprocess
import sys
import time
from typing import Optional

RESET = "\033[0m"
ANSI_CODE_RE = re.compile(r"^\d+(?:;\d+)*$")

MODEL = "1;38;5;141"
DIR = "38;5;75"
BRANCH = "38;5;213"
COST = "38;5;179"
ASH = "38;5;242"
GREEN = "38;5;114"
YELLOW = "38;5;179"
ORANGE = "38;5;208"
RED = "38;5;203"
RED_BOLD = "1;38;5;203"


def colors_enabled() -> bool:
    # https://no-color.org/ — any non-empty value disables
    if os.environ.get("NO_COLOR"):
        return False
    if os.environ.get("CLAUDE_STATUSLINE_NO_COLOR") == "1":
        return False
    return True


def c(code: str, text: object) -> str:
    plain_text = str(text)
    if not colors_enabled():
        return plain_text
    if not ANSI_CODE_RE.fullmatch(code):
        return plain_text
    return f"\033[{code}m{plain_text}{RESET}"


def to_float(value: object) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def ramp(pct_bad: float) -> str:
    if pct_bad >= 80:
        return RED_BOLD
    if pct_bad >= 60:
        return ORANGE
    if pct_bad >= 40:
        return YELLOW
    return GREEN


def reset_note(resets_at: Optional[float], window_secs: float) -> str:
    if resets_at is None:
        return ""
    secs = resets_at - time.time()
    if secs <= 0:
        return ""
    minutes = max(1, round(secs / 60))
    hours, minutes = divmod(minutes, 60)
    days, hours = divmod(hours, 24)
    if days:
        rel = f"{days}d {hours}h" if hours else f"{days}d"
    elif hours:
        rel = f"{hours}h {minutes}m" if minutes else f"{hours}h"
    else:
        rel = f"{minutes}m"
    frac = secs / window_secs
    color = GREEN if frac <= 0.1 else YELLOW if frac <= 0.35 else ASH
    return " " + c(color, f"({rel})")


def rate_segment(pct: float, label: str, resets_at: Optional[float], window_secs: float) -> str:
    pct_color = ASH if pct < 40 else ramp(pct)
    return c(ASH, f"{label} ") + c(pct_color, f"{100 - pct:.0f}%") + reset_note(resets_at, window_secs)


def pr_segment(pr: dict) -> str:
    number = pr.get("number")
    if not number:
        return ""
    state_colors = {
        "approved": GREEN,
        "changes_requested": RED_BOLD,
        "pending": YELLOW,
        "draft": ASH,
    }
    color = state_colors.get(pr.get("review_state"), BRANCH)
    return c(color, f"PR#{number}")


def path_segment(path: str) -> str:
    home = os.path.expanduser("~")
    if path == home:
        return c(DIR, "~")
    if path.startswith(home + os.sep):
        path = "~" + path[len(home):]
    parts = path.split(os.sep)
    if len(parts) > 4:
        parts = ["…", *parts[-3:]]
    return c(DIR, os.sep.join(parts))


def run_git(cwd: str, *args: str) -> str:
    try:
        env = {**os.environ, "GIT_OPTIONAL_LOCKS": "0"}
        r = subprocess.run(
            ["git", "-C", cwd, *args],
            capture_output=True,
            text=True,
            timeout=2,
            env=env,
        )
        return r.stdout.strip() if r.returncode == 0 else ""
    except Exception:
        return ""


def git_segment(cwd: str) -> str:
    out = run_git(cwd, "status", "--porcelain=v2", "--branch", "--untracked-files=no")
    if not out:
        return ""
    branch = ""
    ahead = behind = 0
    dirty = False
    for line in out.splitlines():
        if line.startswith("# branch.head "):
            branch = line[len("# branch.head "):]
        elif line.startswith("# branch.ab "):
            ahead, behind = (abs(int(n)) for n in line[len("# branch.ab "):].split())
        elif not line.startswith("#"):
            dirty = True
    if branch == "(detached)":
        commit = run_git(cwd, "rev-parse", "--short", "HEAD")
        if not commit:
            return ""
        branch = f"@{commit}"
    if not branch:
        return ""
    segment = c(BRANCH, f"⎇ {branch}") + (c(ORANGE, "*") if dirty else "")
    if ahead:
        segment += c(GREEN, f" ↑{ahead}")
    if behind:
        segment += c(RED, f" ↓{behind}")
    return segment


def main() -> None:
    data = json.load(sys.stdin)

    parts: list[str] = []
    sep = c(ASH, " · ")

    model = (data.get("model") or {}).get("display_name", "")
    if model:
        flash = " ⚡" if data.get("fast_mode") else ""
        parts.append(c(MODEL, f"✦ {model}{flash}"))

    cost = data.get("cost") or {}
    total_cost = to_float(cost.get("total_cost_usd"))
    if total_cost is not None and total_cost > 0:
        parts.append(c(COST, f"${total_cost:.2f}"))

    workspace = data.get("workspace") or {}
    cwd = workspace.get("current_dir") or data.get("cwd", "")
    if cwd:
        parts.append(path_segment(cwd))
        git = git_segment(cwd)
        if git:
            parts.append(git)

    pr = pr_segment(data.get("pr") or {})
    if pr:
        parts.append(pr)

    limits: list[str] = []
    ctx = data.get("context_window") or {}
    remaining = to_float(ctx.get("remaining_percentage"))
    if remaining is None:
        used = to_float(ctx.get("used_percentage"))
        remaining = 100 - used if used is not None else None
    if remaining is not None:
        limits.append(c(ramp(100 - remaining), f"context {round(remaining)}%"))

    rate_limits = data.get("rate_limits") or {}
    for key, label, window_secs in (
        ("five_hour", "5h", 5 * 3600),
        ("seven_day", "weekly", 7 * 86400),
    ):
        window = rate_limits.get(key) or {}
        pct = to_float(window.get("used_percentage"))
        if pct is not None:
            limits.append(rate_segment(pct, label, to_float(window.get("resets_at")), window_secs))

    lines = [sep.join(parts)]
    if limits:
        lines.append(sep.join(limits))
    print("\n".join(lines), end="")


if __name__ == "__main__":
    main()
