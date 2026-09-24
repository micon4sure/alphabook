# CMD-010 verification

Code commit: e6682b402dc0fba7a9a8b6bd89bdb811bb1bdb93

- README leads with minimalistic, accessible, machine-readable project planning and includes clone, run, initialize/register and agent entry points.
- Application and MCP report 1.0.0; format, schema, examples, validators and the live manifest use 1.0.
- Removed obsolete draft spec/schema files from the current code tree; Git history remains intact.
- Published agent primer matches AGENT_PRIMER.md byte-for-byte.
- Frozen-lockfile installation and TypeScript typecheck passed.
- 39 unit/API/MCP/primer tests passed, with 199 assertions.
- 14 Python tests and the standalone example validator passed.
- Browser end-to-end test passed; inspected the desktop screenshot and verified the 1.0 badge.
- All relative Markdown links across the seven entry-point documents resolve.
- Fresh clone: installed locked dependencies, checked out the local planning ref without switching code branches, registered and validated the shared plan, initialized a new 1.0 project, and started and queried the cloned web app successfully.
- The running local app serves 1.0 and reports no project validation errors.
