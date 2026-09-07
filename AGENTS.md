# Agent instructions

This project is an MVP. Prefer the simplest, cleanest implementation that works.

## Do not run tests

Never add, run, or update tests. We are not at a stage where tests are useful.

Do not run `npm test`, Playwright, Vitest, or any other test runner. Do not add test files, test scripts, or testing dependencies.

## Keep it an MVP

- Choose the simplest, cleanest solution. No extra layers, abstractions, or “just in case” code.
- Do not add features, files, or tooling beyond what was asked.
- No database, persistence, or premature infrastructure unless explicitly requested.
- If two approaches work, take the smaller one.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
