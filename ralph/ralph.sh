#!/usr/bin/env bash
# Fresh-context Ralph loop for assist-ant.
# Behavior modeled on coleam00/ralph-loop-quickstart (fresh `claude -p` per
# iteration, PROMPT.md + prd.md + activity.md). That repo has no license, so
# this script is an original implementation, not a copy.
#
# Usage: ralph/ralph.sh [max_iterations=10] [budget_usd_per_iteration=5]
# Stops when: no pending/in-progress task rows remain in prd.md, the iteration
# limit is reached, or two consecutive iterations make no progress.
set -uo pipefail

cd "$(dirname "$0")/.."
MAX_ITER="${1:-10}"
BUDGET="${2:-5}"
LOG_DIR="ralph/logs"
mkdir -p "$LOG_DIR" ralph/evidence

for f in PROMPT.md prd.md activity.md CLAUDE.md; do
  [ -f "$f" ] || { echo "missing $f" >&2; exit 2; }
done

GOAL='Per PROMPT.md, exactly one dependency-ready pending task in prd.md is finished: its status row is updated to done or needs supervised check (or blocked with the blocker recorded in activity.md and docs/launch-blockers.md), its verification command was run and the real output is quoted in activity.md, and the change is committed locally. Stop after 5 turns if not met and record why in activity.md.'

open_tasks() { grep -cE '^\| T[0-9]+ .*\| (pending|in progress) \|$' prd.md || true; }
# Progress = a change in task status rows, not activity.md notes or commits.
progress_mark() { grep -E '^\| T[0-9]+ ' prd.md | awk -F'|' '{print $2 $(NF-1)}' | shasum | cut -c1-12; }

stalls=0
for ((i = 1; i <= MAX_ITER; i++)); do
  left="$(open_tasks)"
  if [ "$left" -eq 0 ]; then
    echo "No pending tasks remain in prd.md. Review blocked rows before claiming Gate A."
    echo "<promise>COMPLETE</promise>"
    exit 0
  fi
  stamp="$(date +%Y%m%d-%H%M%S)"
  log="$LOG_DIR/iter-$i-$stamp.log"
  before="$(progress_mark)"
  echo "== iteration $i/$MAX_ITER, $left open tasks, budget \$$BUDGET, log $log"

  claude -p "/goal $GOAL" \
    --model claude-sonnet-5-5 \
    --permission-mode acceptEdits \
    --max-budget-usd "$BUDGET" \
    --output-format text >"$log" 2>&1
  echo "   exit $? ; tail:"; tail -5 "$log" | sed 's/^/   /'

  after="$(progress_mark)"
  if [ "$before" = "$after" ]; then
    stalls=$((stalls + 1))
    echo "   no progress ($stalls consecutive)"
    if [ "$stalls" -ge 2 ]; then
      echo "Stopping: two consecutive iterations without progress. Not complete."
      exit 1
    fi
  else
    stalls=0
  fi
  sleep 2
done

echo "Iteration limit ($MAX_ITER) reached with $(open_tasks) open tasks. Not complete."
exit 1
