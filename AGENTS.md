# Agent Requirements

- Every CLI build must run the MCP smoke test (`bun run test:mcp`).
- Every CLI build must also run the bundle integrity test (`bun run test:bundle`).
- Treat failures in these tests as release blockers.

This is critical to prevent hardcoded build paths or MCP regressions from reaching customers.
