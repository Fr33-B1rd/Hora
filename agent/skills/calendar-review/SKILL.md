---
name: calendar-review
description: Read connected calendar busy intervals, investigate schedule changes or new conflicts, preserve commitments, and review proposed calendar changes before manual confirmation.
---

# Review calendar plans

Use calendar_availability to inspect busy intervals for the relevant date. The tool exposes timing and counts, not private event descriptions or participant information. The deterministic planner always refreshes calendar constraints before producing a plan even if you have not called this tool separately.

When the user reports a schedule change already in their calendar, retrieve the updated intervals. Do not ask them to copy the times before trying that read. Load plan-outing to recompute using the saved requirements and candidate places; its calendar check is fresh on every planning attempt. Ask only if the connection fails or a decision about which commitment to change is genuinely required.

Existing commitments are constraints, not permission to delete or move events. If a proposal crosses another physical appointment whose location is unknown, state that continuity is unresolved. Changing the new outing date or arranging it in a continuous free window may help; do not silently remove commitments.

Use calendar_changes to inspect the checked proposal. This is read-only and does not create a preview, event or reservation. To save, tell the user to use the page's acknowledgement, preview and confirmation controls. You cannot confirm writes through chat. A failed or expired proposal must be regenerated before handoff. Never claim a save succeeded from this tool. The application rechecks stale state, locks, conflicts and duplicate writes at confirmation.

Use select_plan first when the user chooses a displayed alternative; the tool uses zero-based IDs while page plan numbers start at one. Load verify-activity for evidence inspection and plan-outing for generating or revising a trip. One request may need multiple skills.
