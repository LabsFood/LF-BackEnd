# LF-BackEnd

NestJS + Prisma API. Auth via Clerk, Postgres via Prisma/Supabase, payments via Stripe Connect + CESU. Deployed on Railway.

## graphify

This project has its own knowledge graph at `graphify-out/` — separate from the sibling
projects in the parent codespace. Paths below are relative to this directory.

Rules:
- For codebase questions, run `graphify query "<question>"` first when `graphify-out/graph.json`
  exists. Use `graphify path "<A>" "<B>"` for relationships, `graphify explain "<concept>"` for a
  focused concept, and `graphify affected "<X>"` for blast radius. These return a scoped subgraph,
  usually much smaller than `GRAPH_REPORT.md` or raw grep output.
- The graph covers **this project only**. For the sibling projects, query their graphs:
  `graphify query "<q>" --graph ../<other-project>/graphify-out/graph.json`
- Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review, or when
  query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
