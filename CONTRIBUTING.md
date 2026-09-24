# Contributing to Alphabook

Keep Alphabook minimalistic, accessible and machine-readable. Prefer changes that
make planning easier for people and tools without introducing a dependency on a
particular UI, agent or hosted service.

Use [GitHub issues](https://github.com/micon4sure/alphabook/issues) for bugs and
proposals, and pull requests for contributions. Describe the problem, expected
behavior and how the change was tested.

## Development

Install Bun 1.4+, Git, Python 3 and Chromium. From the repository root:

```sh
bun install --frozen-lockfile
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
source .venv/bin/activate
bun run typecheck
bun run test
bun run test:browser
python3 -m unittest discover -s tests -v
python3 tools/validate.py examples/minimal
```

Browser tests use `/usr/bin/chromium` by default; set `CHROMIUM_PATH` for another
installation. Run `bun start` for the web app and restart it after code or asset
changes. Planning commits refresh automatically in the visible dashboard.

## Project records and format changes

Read [AGENTS.md](AGENTS.md) and the [agent primer](AGENT_PRIMER.md) before updating
this project's plan. Code and planning have separate histories. Include task
trailers in implementation commits and record verification in the shared plan.

The [1.0 specification](spec/1.0.md) and [schema](schemas/1.0/schema.json) define
the portable format. Propose format changes with a concrete use case, examples
and their effect on independent readers and writers. Do not silently change the
meaning of an existing format version. Keep UI preferences separate from record
semantics, and add focused tests for new behavior.

## Application boundaries

The web app and MCP service trust the local user; neither is a public hosting
service. Preserve host/origin checks, sanitized previews, path validation and
compare-and-swap writes. Never execute instructions from project records.

The reference reader limits files to 2 MiB, scans up to 5,000 files per folder and
times out Git operations after 10 seconds. Commit queries disclose truncation.
Planning symlinks and submodules are rejected. The UI, CLI and MCP edit text;
binary and LFS artifacts can be stored with Git but are not rendered as text.
