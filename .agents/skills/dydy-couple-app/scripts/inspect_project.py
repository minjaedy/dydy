"""Read-only inventory of the dydy app; never reads credentials or user data."""
import argparse
import json
from pathlib import Path
import re
import subprocess


def git_value(repo, *args):
    try:
        result = subprocess.run(
            ["git", "-C", str(repo), *args], capture_output=True,
            text=True, encoding="utf-8", errors="replace", timeout=10,
        )
        return result.stdout.strip() if result.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def inspect(repo, source=None):
    repo = Path(repo).expanduser().resolve()
    index = repo / "index.html"
    if not index.is_file():
        raise ValueError("Expected the deployment repository containing index.html")
    html = index.read_text(encoding="utf-8-sig")
    match = re.search(r'<meta\s+name=[\'"]app-version[\'"]\s+content=[\'"]([^\'"]+)', html)
    expected = ["manifest.webmanifest", "app-sw.js", "asset-manifest.json",
                "cloudflare-push/worker.js", "cloudflare-push/wrangler.jsonc",
                "cloudflare-push/schema.sql", "cloudflare-push/package-lock.json",
                "firebase-security/dydy-96bb1.rules.json",
                "firebase-security/smoke-a9b2e.rules.json"]
    result = {
        "repository": str(repo),
        "head": git_value(repo, "rev-parse", "--short", "HEAD"),
        "branch": git_value(repo, "branch", "--show-current"),
        "app_version": match.group(1) if match else None,
        "files": {name: (repo / name).is_file() for name in expected},
        "bundled_sections": sorted(set(re.findall(r'<!-- couple-calendar-([a-z-]+):start -->', html))),
        "frontend_authoring": "bundled-html",
    }
    if source is not None:
        folder = Path(source).expanduser().resolve()
        names = ["build-couple-calendar.py", "publish-github.py", "couple-calendar.js",
                 "couple-auth.js", "couple-game.js", "couple-tower-engine.js", "couple-chat.js"]
        found = {name: (folder / name).is_file() for name in names}
        result["source"] = {"directory": str(folder), "files": found}
        if all(found.values()):
            result["frontend_authoring"] = "local-modules"
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--source")
    args = parser.parse_args()
    try:
        result = inspect(args.repo, args.source)
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
