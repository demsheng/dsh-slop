# Release notes

## 0.0.17, public preview

Targets DeepSeek Harness **0.2.2-rc.3** exactly; rc.5 is no longer accepted. All DSH package pins, the `cordis` 4.1.0 line and the `zod` catalog entry move together with upstream. The plugin behaves as before; the changes are the upstream contracts it now uses:

- Queue reads its delivery receipts through the projection registration handle and resolves the durable Agent preset through the preset service, because the projection registry's cross-domain read is deprecated; Cordis 4.1 requires those reads to go through `ctx.get()` on an Agent's own context.
- The Queue fallback worker builds the flat `SubagentActivationSpec` the subagent service now requires.
- The Chat view keeps rendering persisted PTC tool calls by taking the event declarations from `@deepseek-ai/dsh-tool-executor-ptc`.
- The standalone CLI now needs Node.js `>=24.9.0`, matching the pinned Harness.

See [upstream](UPSTREAM.md) for the exact tag, commit and the full list of adopted contract changes.

## 0.0.16, public preview

Targets DeepSeek Harness **0.2.1-rc.5** exactly; rc.3 is no longer accepted. All DSH package pins move together and no SLOP source change was required. See [upstream](UPSTREAM.md).

A new sidebar **Jobs** page lists Queue jobs from every Chat, with filters, search and grouping by Machine or Chat. It can check a job now, pause and resume checks while a Machine is offline, and edit a job's label, interval, tags, notes and whether it notifies or continues its Chat. It shows the scheduler command to stop a job but never runs it.

**Keep SSH connections alive** (Machines settings, off by default) refreshes each ready connection every 30 minutes so it outlives the 12-hour idle limit. It never starts a sign-in.

Agent behavior gains a seventh preference, *Working files*: it asks the Agent to keep its own helper scripts, dry-run output, logs and backups outside the project (or in one `_agent/` folder) and to edit project files in place rather than leave `_r2`/`.resume` copies. Presets set it too. The behavior preferences now apply to the whole Chat, not only to SLOP tools.

For a controller such as DPDispatcher or DP-GEN the Agent tracks only the controller job and reads child state from the scheduler when asked. Callback instructions moved into the queue-tracking Skill, which shortens the always-loaded prompt.

The Chat header's Machine strip no longer squeezes the title and header controls, and the always-ready local Machine chip is hidden.

## 0.0.15, first public preview

Targets DeepSeek Harness **0.2.1-rc.3** exactly. An OpenSSH socket directory removed by the OS while the Host keeps running (macOS `/tmp` cleanup, a WSL restart) is now re-created before the next connection instead of failing with `unix_listener: cannot bind to path`.

On Windows, archive components load through paths anchored beside the bundle patch so their dependencies resolve from the installed bundle. Plugin Manager displays those paths as component names.

Agent behavior now covers six preferences instead of one: *Follow-through*, *Errors*, *Before real runs*, *Checking* (how much the Agent re-verifies settled facts and gathers context), *Scope and conventions*, and *Reporting*. Presets set them together (Careful, Balanced, Autopilot), and the prompt text of any level can be edited or reset to its default. The text states that AGENTS.md, CLAUDE.md, Skills and the user's own words take precedence. Changes apply to new sessions only and do not change approvals. Existing `followThrough` values are kept; the other preferences start at the Balanced defaults.

The Queue fallback check worker can run on its own provider, model and reasoning effort through new Queue settings (`fallbackProvider`, `fallbackModel`, `fallbackReasoningEffort`). Empty values keep using the Chat's model, and the Chat and Queue delivery are unaffected.

This release includes Chat-native Machine setup and protected SSH authentication, reusable connections, approved Machine Info, remote shell and Host-relayed transfer; Markdown Knowledge for Home and the current Workspace; and Queue observation of already-submitted work.

This is the first public preview. The installation archive excludes dependency test fixtures, examples and TypeScript build caches, and retains the bundled dependencies' license notices. See [status](docs/status.md) for known limits and outstanding real-system evidence.
