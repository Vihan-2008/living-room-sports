"""This project's check: JARVIS runs `python check.py` before it puts a change in, and only when it passes.

Whoever builds this project keeps it running the project's own tests, whatever they are written in (for example
`npm test`, `pytest`, `cargo test`, `dotnet test`, `go test ./...`), and makes it fail when they fail.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

# The commands that test this project, each a list (the program and its words). Add the project's own here.
TESTS: list[list[str]] = [["node", "--test", "tests/app.test.js"]]


def main() -> int:
    if not (HERE / "README.md").exists():
        print("README.md is missing.")
        return 1
    for command in TESTS:
        print("$", " ".join(command), flush=True)
        if subprocess.run(command, cwd=HERE).returncode != 0:
            print("Failed:", " ".join(command))
            return 1
    print("All checks passed." if TESTS else "No tests yet: add the project's own to TESTS in check.py.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
