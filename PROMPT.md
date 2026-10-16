# Per-iteration instructions (assist-ant)

Each fresh session:

1. Read `CLAUDE.md`, `prd.md`, `activity.md`, and `docs/launch-blockers.md`.
2. Pick exactly one dependency-ready atomic task from `prd.md`.
3. Establish a bounded `/goal` quoting that task's acceptance criteria and the
   verification command whose real output will decide it. Max 5 turns.
4. Implement only that task.
5. Run the task's automated checks plus the relevant browser or runtime check.
6. Update the task status and record evidence paths.
7. Append progress, commands, results, and blockers to `activity.md`.
8. Commit only this task's changes, if commits are authorized.

Stop on verified completion, a documented blocker needing human input, or the
turn limit. Never mark a blocked task passing to end the loop. Emit the success
marker only when every approved task genuinely meets its acceptance criteria.
