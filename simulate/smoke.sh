#!/usr/bin/env bash
# DevQuest CLI smoke test — exercises every tool in checklist order without
# touching the (paused) Custom Agent. Run from the repo root:
#   bash simulate/smoke.sh
# Uses a dedicated test persona so it won't disturb real records.

set -uo pipefail

PERSONA="CLI Smoke Test"
run() {
	echo ""
	echo "=== $1 ==="
	shift
	"$@" || echo ">>> FAILED (continuing)"
}

run "0. whoami — identity behind the token" \
	ntn workers exec whoami -d '{}'

run "1. read_company_context — config + teams discovered?" \
	ntn workers exec read_company_context -d '{}'

run "2. read_team_context — the Platform Team permissions probe" \
	ntn workers exec read_team_context -d '{"team":"platform"}'

run "3. find_persona — fresh name should be found=false" \
	ntn workers exec find_persona -d "{\"persona_id\":\"$PERSONA\"}"

run "4. update_persona — upsert creates the record" \
	ntn workers exec update_persona -d "{\"persona_id\":\"$PERSONA\",\"goal\":\"automation\",\"language\":\"python\",\"experience\":\"beginner\",\"api_comfort\":\"none\"}"

run "5. query_docs — beginner/automation-flavored ranking" \
	ntn workers exec query_docs -d "{\"persona_id\":\"$PERSONA\",\"category\":null,\"max_results\":5}"

run "6. get_starter_code — python install + snippet" \
	ntn workers exec get_starter_code -d "{\"persona_id\":\"$PERSONA\"}"

run "7. create_guide_page — full guide incl. Start Coding section" \
	ntn workers exec create_guide_page -d "{\"persona_id\":\"$PERSONA\",\"parent_page\":null,\"session_note\":\"CLI smoke test\"}"

run "8. read_guide_page — to-dos + session log parse back" \
	ntn workers exec read_guide_page -d "{\"persona_id\":\"$PERSONA\"}"

run "9. find_persona again — found=true, whats_new populated if KB has fresh docs" \
	ntn workers exec find_persona -d "{\"persona_id\":\"$PERSONA\"}"

run "10. insights_digest sync — check the Insights DB row afterwards" \
	ntn workers sync trigger insights_digest

echo ""
echo "Done. Manual follow-ups:"
echo "  - Open the guide page (URL in step 7) — verify Start Coding renders"
echo "  - Open DevQuest Insights — this week's row should include '$PERSONA'"
echo "  - verify_first_call needs a real page URL:"
echo "      ntn workers exec verify_first_call -d '{\"persona_id\":\"$PERSONA\",\"page_url\":\"<url>\"}'"
echo "  - Clean up: archive the '$PERSONA' persona + its guide page when done"
