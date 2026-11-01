#!/usr/bin/env bash
# Print every failed check run for a commit or PR, with its annotations
# (docs/REFERENCE.md §7: evidence first). Actions logs are not reachable from
# Claude's sandbox; annotations are.
#   scripts/ci-failures.sh <sha>       a commit
#   scripts/ci-failures.sh pr <number> the head commit of a pull request
set -euo pipefail
REPO="${REPO:-sagarcrossfire-cyber/zanshin}"
if [ "${1:-}" = "pr" ]; then
  SHA=$(gh api "repos/$REPO/pulls/$2" --jq .head.sha)
else
  SHA="${1:?usage: ci-failures.sh <sha> | pr <number>}"
fi
echo "commit $SHA"
gh api "repos/$REPO/commits/$SHA/check-runs" \
  --jq '.check_runs[] | "\(.id)\t\(.name)\t\(.status)\t\(.conclusion // "-")"' |
while IFS=$'\t' read -r id name status conclusion; do
  echo "• $name: $status $conclusion"
  if [ "$conclusion" = "failure" ] || [ "$conclusion" = "timed_out" ]; then
    gh api "repos/$REPO/check-runs/$id/annotations" \
      --jq '.[] | "    \(.path):\(.start_line) [\(.annotation_level)] \(.title // "")\n      \(.message | gsub("\n"; "\n      "))"' | head -200
  fi
done
