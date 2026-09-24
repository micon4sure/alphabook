"""Read-only reference validator for Alphabook Format 1.0."""
import argparse
import json
import re
import subprocess
from collections import deque
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator, FormatChecker

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "schemas/1.0/schema.json"


class CoreLoader(yaml.SafeLoader):
    """YAML 1.2 core scalars without PyYAML's legacy booleans/timestamps."""

    def construct_mapping(self, node, deep=False):
        result = {}
        for key_node, value_node in node.value:
            key = self.construct_object(key_node, deep=deep)
            if not isinstance(key, str):
                raise ValueError("metadata mapping keys must be strings")
            if key in result:
                raise ValueError(f"duplicate metadata key: {key}")
            result[key] = self.construct_object(value_node, deep=deep)
        return result


_legacy = {"bool", "int", "float", "timestamp"}
CoreLoader.yaml_implicit_resolvers = {
    key: [(tag, regex) for tag, regex in entries if tag.rsplit(":", 1)[-1] not in _legacy]
    for key, entries in yaml.SafeLoader.yaml_implicit_resolvers.items()
}
CoreLoader.add_implicit_resolver(
    "tag:yaml.org,2002:bool", re.compile(r"^(true|True|TRUE|false|False|FALSE)$"), list("tTfF")
)
CoreLoader.add_implicit_resolver(
    "tag:yaml.org,2002:int", re.compile(r"^(?:[-+]?[0-9]+|0o[0-7]+|0x[0-9a-fA-F]+)$"), list("-+0123456789")
)
CoreLoader.add_constructor(
    "tag:yaml.org,2002:int",
    lambda loader, node: int(node.value, 0 if node.value.startswith(("0o", "0x")) else 10),
)
CoreLoader.add_implicit_resolver(
    "tag:yaml.org,2002:float",
    re.compile(r"^(?:[-+]?(?:[0-9]+\.[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?|[-+]?[0-9]+[eE][-+]?[0-9]+|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$"),
    list("-+0123456789."),
)


def metadata(text):
    for token in yaml.scan(text):
        if isinstance(token, (yaml.tokens.AnchorToken, yaml.tokens.AliasToken, yaml.tokens.TagToken)):
            raise ValueError("anchors, aliases and explicit tags are not allowed")
    value = yaml.load(text, Loader=CoreLoader)
    json.dumps(value, allow_nan=False)
    if not isinstance(value, dict):
        raise ValueError("metadata must be an object")
    return value


def read_record(path):
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    if not lines or lines[0].rstrip("\r\n") != "---":
        raise ValueError("record must start with YAML frontmatter")
    end = next((i for i in range(1, len(lines)) if lines[i].rstrip("\r\n") == "---"), None)
    if end is None:
        raise ValueError("missing closing frontmatter delimiter")
    return metadata("".join(lines[1:end])), "".join(lines[end + 1:])


def inside(root, path):
    if not path.resolve().is_relative_to(root):
        raise ValueError(f"path escapes the project: {path}")
    return path


def check_graph(records, field):
    outgoing = {key: [] for key in records}
    incoming = {key: 0 for key in records}
    for key, record in records.items():
        edges = record.get(field, [])
        if isinstance(edges, str):
            edges = [edges]
        for target in edges:
            if target not in records:
                raise ValueError(f"{key}: missing {field} target {target}")
            outgoing[target].append(key)
            incoming[key] += 1
    ready = deque(key for key, count in incoming.items() if count == 0)
    seen = 0
    while ready:
        seen += 1
        for target in outgoing[ready.popleft()]:
            incoming[target] -= 1
            if incoming[target] == 0:
                ready.append(target)
    if seen != len(records):
        raise ValueError(f"cycle in {field} graph")


def validate(root):
    root = Path(root).resolve()
    errors = []
    schema = json.loads(SCHEMA_PATH.read_text())
    Draft202012Validator.check_schema(schema)
    validators = {
        kind: Draft202012Validator(
            {"$defs": schema["$defs"], "$ref": f"#/$defs/{kind}"},
            format_checker=FormatChecker(),
        )
        for kind in ("project", "task", "decision")
    }
    project = None
    tasks, decisions, ids = {}, {}, set()

    def check(data, kind):
        error = next(validators[kind].iter_errors(data), None)
        if error:
            raise ValueError(error.message)

    try:
        manifest = inside(root, root / "project.yaml")
        project = metadata(manifest.read_text(encoding="utf-8"))
        check(project, "project")
        branch = project.get("code_branch", "alphabook")
        result = subprocess.run(["git", "check-ref-format", f"refs/heads/{branch}"], capture_output=True)
        if result.returncode or branch.startswith("-") or branch == "HEAD":
            raise ValueError("invalid integration branch name")
    except (OSError, ValueError, yaml.YAMLError, RuntimeError) as exc:
        errors.append(f"manifest: {exc}")
        return {"valid": False, "errors": errors}

    for kind, records in (("task", tasks), ("decision", decisions)):
        try:
            folder = inside(root, root / f"{kind}s")
            if folder.exists() and not folder.is_dir():
                raise ValueError(f"{folder.name} must be a directory")
            for path in sorted(folder.glob("*.md")):
                try:
                    record, _ = read_record(inside(root, path))
                    check(record, kind)
                    if path.stem != record["id"]:
                        raise ValueError("filename stem must match record ID")
                    if record["id"] in ids:
                        raise ValueError(f"duplicate record ID {record['id']}")
                    ids.add(record["id"])
                    for branch in record.get("branches", []):
                        result = subprocess.run(["git", "check-ref-format", f"refs/heads/{branch}"], capture_output=True)
                        if result.returncode or branch.startswith("-") or branch in ("HEAD", "alphabook"):
                            raise ValueError("invalid code branch link")
                    for related in record.get("paths", []) + record.get("artifacts", []):
                        inside(root, root / related)
                    for artifact in record.get("artifacts", []):
                        if not artifact.startswith("artifacts/"):
                            raise ValueError(f"missing artifact under artifacts: {artifact}")
                        if not (root / artifact).is_file():
                            raise ValueError(f"missing artifact {artifact}")
                    records[record["id"]] = record
                except (OSError, ValueError, yaml.YAMLError, RuntimeError) as exc:
                    errors.append(f"{path.relative_to(root)}: {exc}")
        except (OSError, ValueError, RuntimeError) as exc:
            errors.append(str(exc))
    for records, field in ((tasks, "depends_on"), (decisions, "supersedes")):
        try:
            check_graph(records, field)
        except ValueError as exc:
            errors.append(str(exc))
    for task in tasks.values():
        for decision in task.get("decisions", []):
            if decision not in decisions:
                errors.append(f"{task['id']}: missing decision {decision}")
    return {
        "valid": not errors,
        "project_id": project["id"],
        "tasks": len(tasks),
        "decisions": len(decisions),
        "errors": errors,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path)
    report = validate(parser.parse_args().project)
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if report["valid"] else 1)
