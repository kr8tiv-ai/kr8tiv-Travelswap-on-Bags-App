#!/usr/bin/env bash
set -euo pipefail

# fix-branding.sh
# Finds and optionally fixes remaining FlightBrain/flightbrain references
# in the kr8tiv Travelswap codebase.
#
# Usage:
#   ./scripts/fix-branding.sh          # dry-run (report only)
#   ./scripts/fix-branding.sh --fix    # apply replacements

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIX_MODE=false

if [[ "${1:-}" == "--fix" ]]; then
  FIX_MODE=true
  echo "=== FIX MODE: applying replacements ==="
else
  echo "=== DRY RUN: reporting only (pass --fix to apply) ==="
fi

echo ""
echo "Scanning for FlightBrain / flightbrain references..."
echo "Excluding: PRD.md, node_modules, .git, package-lock.json"
echo ""

# Find all matching files (excluding noise)
MATCHES=$(grep -rl \
  --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  --include='*.json' --include='*.yml' --include='*.yaml' --include='*.md' \
  --include='*.env*' --include='*.html' --include='*.css' --include='*.sh' \
  -e 'FlightBrain' -e 'flightbrain' -e 'flight-brain' -e 'flight_brain' \
  "$REPO_ROOT" 2>/dev/null \
  | grep -v 'node_modules' \
  | grep -v '\.git/' \
  | grep -v 'package-lock\.json' \
  | grep -v 'PRD\.md' \
  || true)

if [[ -z "$MATCHES" ]]; then
  echo "No FlightBrain references found. Branding is clean."
  exit 0
fi

COUNT=$(echo "$MATCHES" | wc -l | tr -d ' ')
echo "Found references in $COUNT file(s):"
echo ""

# Show each match with context
for file in $MATCHES; do
  REL_PATH="${file#$REPO_ROOT/}"
  echo "  --- $REL_PATH ---"
  grep -n -i 'flightbrain\|flight-brain\|flight_brain' "$file" | head -20 | sed 's/^/    /'
  echo ""
done

if [[ "$FIX_MODE" == true ]]; then
  echo "Applying replacements..."

  for file in $MATCHES; do
    # PascalCase: FlightBrain -> TravelSwap
    sed -i 's/FlightBrain/TravelSwap/g' "$file"

    # camelCase: flightBrain -> travelSwap
    sed -i 's/flightBrain/travelSwap/g' "$file"

    # lowercase: flightbrain -> travelswap
    sed -i 's/flightbrain/travelswap/g' "$file"

    # kebab-case: flight-brain -> travel-swap
    sed -i 's/flight-brain/travel-swap/g' "$file"

    # snake_case: flight_brain -> travel_swap
    sed -i 's/flight_brain/travel_swap/g' "$file"

    # UPPER_SNAKE: FLIGHT_BRAIN -> TRAVEL_SWAP
    sed -i 's/FLIGHT_BRAIN/TRAVEL_SWAP/g' "$file"

    # UPPERCASE: FLIGHTBRAIN -> TRAVELSWAP
    sed -i 's/FLIGHTBRAIN/TRAVELSWAP/g' "$file"
  done

  echo "Replacements applied to $COUNT file(s)."
else
  echo "Run with --fix to apply these replacements."
fi

echo ""
echo "=== Branding scan complete ==="
echo "Files scanned: $(find "$REPO_ROOT" -type f \
  \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \
     -o -name '*.json' -o -name '*.yml' -o -name '*.yaml' -o -name '*.md' \
     -o -name '*.html' -o -name '*.css' -o -name '*.sh' \) \
  -not -path '*/node_modules/*' \
  -not -path '*/.git/*' \
  -not -name 'package-lock.json' \
  -not -name 'PRD.md' | wc -l | tr -d ' ')"
echo "Files with references: $COUNT"
