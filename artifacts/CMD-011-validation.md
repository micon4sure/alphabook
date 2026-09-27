# CMD-011 validation

Implementation commit: `6af27f9a6cfba3da1812cbf33657274355a5e9ac`

Verified on 2026-09-27:

- `bun run test`: 41 passed, 0 failed.
- `python -m unittest discover -s tests -p 'test_*.py'`: 14 passed.
- `bun run typecheck`: passed.
- `CHROMIUM_PATH=/home/micon/.local/bin/google-chrome bun run test:browser`:
  1 passed. The browser loaded the PNG preview at its expected natural size.
- `git diff --check`: passed before the source commit.

Focused coverage confirms byte-signature identification for PNG, JPEG, GIF and
WebP; a `.png` containing text is not identified as an image. The artifact-byte
endpoint requires an exact planning commit, artifact path and SHA-256 revision,
and rejects ordinary text, an LFS pointer, a mismatched revision and a document
outside `artifacts/`.
