import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from tools.validate import metadata, read_record, validate

ROOT = Path(__file__).resolve().parents[1]


class FormatTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="command-format-test-")
        self.base = Path(self.temp.name)
        self.project = self.base / "project"
        shutil.copytree(ROOT / "examples/minimal", self.project)

    def tearDown(self):
        self.temp.cleanup()

    def edit(self, relative, old, new):
        path = self.project / relative
        path.write_text(path.read_text().replace(old, new))

    def assert_invalid(self, contains):
        report = validate(self.project)
        self.assertFalse(report["valid"], report)
        self.assertIn(contains, str(report["errors"]))

    def test_example_and_self_tracking(self):
        self.assertTrue(validate(self.project)["valid"])
        self.assertTrue(validate(ROOT)["valid"])

    def test_yaml_core_scalars(self):
        value = metadata("title: on\ndate: 2026-09-24\nnumber: 012\noctal: 0o12\nexponent: 1e2\nyes: true\n")
        self.assertEqual(value, {"title": "on", "date": "2026-09-24", "number": 12, "octal": 10, "exponent": 100.0, "yes": True})

    def test_ambiguous_yaml_is_rejected(self):
        for text in ["id: a\nid: b", "a: &id value\nb: *id", "a: !!str value", "a: .nan", "1: value"]:
            with self.subTest(text=text), self.assertRaises(ValueError):
                metadata(text)

    def test_unsupported_version(self):
        self.edit(".command/project.yaml", '"0.1"', '"9.0"')
        self.assert_invalid("0.1")

    def test_filename_identity(self):
        self.edit(".command/tasks/T-002.md", "id: T-002", "id: T-999")
        self.assert_invalid("filename stem")

    def test_missing_dependency(self):
        self.edit(".command/tasks/T-002.md", "depends_on: [T-001]", "depends_on: [T-999]")
        self.assert_invalid("missing depends_on")

    def test_dependency_cycle(self):
        self.edit(".command/tasks/T-001.md", "status: done", "status: done\ndepends_on: [T-002]")
        self.assert_invalid("cycle")

    def test_missing_decision(self):
        self.edit(".command/tasks/T-002.md", "decisions: [D-001]", "decisions: [D-999]")
        self.assert_invalid("missing decision")

    def test_supersession_cycle(self):
        self.edit(".command/decisions/D-001.md", "status: accepted", "status: accepted\nsupersedes: D-001")
        self.assert_invalid("cycle")

    def test_unknown_field(self):
        self.edit(".command/tasks/T-002.md", "status: planned", "status: planned\nunknown: value")
        self.assert_invalid("Additional properties")

    def test_paths(self):
        path = self.project / ".command/tasks/T-002.md"
        original = path.read_text()
        for invalid in ["../outside", "/tmp/outside", "a/../b", ".git/config", "a//b", "a/", "C:/windows", "a\\b"]:
            with self.subTest(path=invalid):
                path.write_text(original.replace("paths: [src/browser]", "paths: " + json.dumps([invalid])))
                self.assert_invalid("does not match")
        path.write_text(original.replace("paths: [src/browser]", "paths: [x]"))
        self.assertTrue(validate(self.project)["valid"])

    def test_missing_artifact(self):
        self.edit(".command/tasks/T-002.md", "status: planned", "status: planned\nartifacts: [missing.png]")
        self.assert_invalid("missing artifact")

    def test_symlink_escape(self):
        (self.base / "outside.md").write_text("private")
        (self.project / "outside.md").symlink_to(self.base / "outside.md")
        self.edit(".command/tasks/T-002.md", "paths: [src/browser]", "paths: [outside.md]")
        self.assert_invalid("escapes")

    def test_worktree_edits_and_integration_without_mcp(self):
        def git(cwd, *args, text=None):
            return subprocess.run(
                ["git", "-c", "user.name=Format test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", *args],
                cwd=cwd, input=text, text=True, capture_output=True, check=True,
            ).stdout

        git(self.project, "init", "-b", "main")
        git(self.project, "add", ".command")
        git(self.project, "commit", "-m", "Initial plan")
        worktree = self.base / "task-worktree"
        git(self.project, "worktree", "add", "-b", "task/T-002", str(worktree))
        self.assertTrue((worktree / ".git").is_file())
        task = worktree / ".command/tasks/T-002.md"
        task.write_text(task.read_text().replace("status: planned", "status: in_progress\nassignee: agent-17"))
        self.assertTrue(validate(worktree)["valid"])
        self.assertEqual(read_record(self.project / ".command/tasks/T-002.md")[0]["status"], "planned")
        git(worktree, "add", ".command/tasks/T-002.md")
        git(worktree, "commit", "-m", "Start browser task\n\nTask: T-002")
        (worktree / "src").mkdir()
        (worktree / "src/browser.txt").write_text("fixture implementation")
        task.write_text(task.read_text().replace("status: in_progress", "status: done"))
        git(worktree, "add", "src/browser.txt", ".command/tasks/T-002.md")
        git(worktree, "commit", "-m", "Finish browser task\n\nTask: T-002")
        self.assertIn("status: planned", git(self.project, "show", "main:.command/tasks/T-002.md"))
        self.assertIn("status: done", git(self.project, "show", "task/T-002:.command/tasks/T-002.md"))
        self.assertEqual(git(worktree, "interpret-trailers", "--parse", text=git(worktree, "log", "-1", "--format=%B")).strip(), "Task: T-002")
        git(self.project, "merge", "--ff-only", "task/T-002")
        self.assertEqual(read_record(self.project / ".command/tasks/T-002.md")[0]["status"], "done")
        self.assertTrue((self.project / "src/browser.txt").is_file())
        self.assertTrue(validate(self.project)["valid"])


if __name__ == "__main__":
    unittest.main()
