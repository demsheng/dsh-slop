# Upstream baseline

## Current pin

- Repository: `https://github.com/deepseek-ai/deepseek-harness.git`
- Release: `dsh-v0.2.2-rc.3`
- Commit: `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`
- Verified: 2026-11-16

The tag was verified against GitHub and the published npm packages. Session format remains V4. The 0.2.2 line replaces the loader, projection, subagent and tool-executor contracts SLOP uses; the changes SLOP needed are listed below. Nothing in this repository vendors or patches upstream code.

## Changes adopted

- `@deepseek-ai/cordis` 4.1.0, `cordis-plugin-loader` 1.1.0 and `schemastery` 3.19.0 replace the 4.0.5/1.0.6/3.18.5 line, and the `zod` catalog entry follows upstream to 4.6.6 so one copy of the type system serves both sides.
- Session projections take the key and state as two type arguments, `register()` is asynchronous, and the registry's `stateOf(session, key)` is deprecated. Queue registers its receipt fold with `await` and reads it through the returned `ProjectionHandle`.
- The owning service now answers the durable Agent preset: Queue calls `agentPresets.presetForSession(session)` instead of reading another domain's projection cell. Cordis 4.1 rejects a typed service property read on a context that declares no injection, so the Queue reads the preset service and the worker's `tools` through `ctx.get()` on the Agent's own context.
- `SubagentActivationSpec` carries the task fields flat, with no nested `request` object; Queue's fallback worker builds that spec directly.
- The PTC session events (`tool/ptc-dispatch`, `tool/ptc-dispatch-start`) are declared by `@deepseek-ai/dsh-tool-executor-ptc` rather than `dsh-session`; the UI takes a type-only dependency on that package to keep reading persisted PTC logs.
- Tool execution is selected by plugin. `ToolRuntime` no longer has a `mode` config or `presentAs()`, so tests mount `@deepseek-ai/dsh-tool-executor-native` or `@deepseek-ai/dsh-tool-executor-ptc` as the composition does.
- `AgentRegistry` requires `sessionProjections`; fixtures mount that registry first.
- The Composer's `InputActions` gained `insertQuote`, and the shared `Tooltip` opens on pointer and focus events.
- `@deepseek-ai/dsh` requires Node.js `>=24.9.0`; the standalone CLI requirement and the root `engines` field follow it.

## Dependency policy

DSH-SLOP stays out of tree. It consumes the exact matching set of public `@deepseek-ai/dsh-*` packages and contributes an installable bundle, a standalone profile, agent presets, Skills and client modules. It must not edit upstream packages, vendor selected upstream source files, or depend on undocumented source paths.

Because DSH is a developer preview with explicit compatibility-breaking changes, all DSH packages use one exact version. No caret, tilde, `next`, `master` or floating Git reference is allowed in a release lockfile. Version-scoped `packageExtensions` in `pnpm-workspace.yaml` supply imports that a published upstream package forgot to declare; they do not edit upstream code.

## Upgrade procedure

1. Immediately before implementation begins and before every release, fetch upstream tags and packages and identify the intended exact tag and commit. If a newer release exists, do not keep calling this pin "latest": either run this upgrade review first or record explicit approval to stay on the older target.
2. Read upstream architecture, migration notes, package manifests, client slot contracts, preset examples and persistence format changes.
3. Update the compatibility fixture (`tests/fixtures/upstream-release.json`) and all DSH package pins together on a dedicated branch.
4. Build from a clean checkout and run composition, preset-mount, client-module, migration, restart-recovery and end-to-end acceptance tests.
5. Record behavior changes and the new exact commit here.
6. Merge only when the complete product passes. Do not carry compatibility shims for an unshipped upstream format unless real user data requires a migration.

Community packages may be studied or adopted only after review of source, license, release pin, threat model, maintenance and compatibility. See [runtime](docs/internals/runtime.md) for the boundary between SLOP and external runtime configuration.

## Validation

See [status](docs/status.md) for candidate checks and outstanding real-system evidence. Repository checks do not validate an operator's deployment, accounts or historical data.

## Native Windows SSH dependency

Machine pins the MIT-licensed [`ssh2` 1.17.0](https://github.com/mscdex/ssh2/releases/tag/v1.17.0), tag commit `844f1edfc41589737671f96a4f4e76afdf46abd4`, with development-only `@types/ssh2` 1.15.6. The published client, agent, host-verification, exec and SFTP APIs were reviewed against that installed release. This is a Machine transport dependency; it adds no personal provider or credentials to core.

The archive bundles its installed JavaScript runtime and required dependency graph with original licenses, removing generated-package lifecycle scripts, dependency test/example fixtures, TypeScript build caches and optional native addons. This avoids Harness's strict build-script approval gate and keeps Windows installation independent of compilers and WSL. The SSH library handles protocol cryptography; SLOP owns explicit host-key approval, owner-scoped protected prompts, profile-revision checks and connection lifetime. Algorithm negotiation intersects the resolved OpenSSH policy with supported modern algorithms. Unsupported proxy, certificate and hardware-key configuration fails explicitly instead of silently connecting directly.

A repository-wide dependency audit is not clean: existing transitive dependencies have advisories. The SSH runtime graph had none in that audit, which is not a claim that the library or Host is vulnerability-free.
