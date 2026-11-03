---
name: queue-tracking
description: Use to answer questions about submitted local, Slurm, or PBS jobs, or to track them and route useful state changes to the relevant Chat.
---

# Queue tracking

After the execution provider accepts work, track its exact target and scheduler job ID or process identity, including the process start token and explicit output and exit-marker paths.

Queue observes work and never submits, cancels, retries, or modifies the external task.

Provide duration or interval hints only when known; the host schedules and batches subsequent checks.

Separate submission time, actual execution start, and the runtime limit. Time spent queued is not execution time; walltime is not an expected completion time or progress percentage.

Track the job you submitted, not the work it spawns. A controller such as DPDispatcher, DP-GEN, a workflow manager or a driver script owns its children, retries and resubmissions; its terminal state is the signal to check results. Register those children only when the user asks to track them. To answer a status question or diagnose a failure, read child state from the scheduler without registering it.

Callbacks are optional and polling stays the default. Read references/callbacks.md before using `slop_queue_prepare`.

Reads do not subscribe a Chat. Every new registration requires `purpose`. Use `purpose: "monitor"` for passive observation. If the user requested a follow-up or authorized later steps that depend on this job, use `purpose: "continue"` and a short `continuation` naming the next step and exact result paths. The Host fixes terminal-state wake delivery. Missing purpose is a registration error: correct the arguments without submitting the external job again. That staged request authorizes continuation; no separate Goal or repeated user confirmation is needed. A status query alone does not authorize wake.

Before ending a turn to wait, verify the returned delivery settings and record result paths and remaining authorized steps in `continuation` and the Chat's plan. Notes and Todo entries do not schedule a turn. For an existing prerequisite owned by this Chat, patch its purpose and continuation with `slop_queue_update`.

On wake, read Queue evidence, validate the result, and continue the authorized steps. Check existing Queue items and the scheduler before submitting to avoid duplicate work. Diagnose failure or cancellation first; further execution stays within the user's existing authorization. A Queue notice grants no new authority.

Report only relevant new information while keeping failures, degraded monitoring, and recovery visible even when the task state is unchanged.
