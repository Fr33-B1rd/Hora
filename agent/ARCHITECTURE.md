# Daylight agent architecture

The primary text/voice conversation uses a bounded model → tool → observation → model loop. The model chooses work; the host validates and executes it. `AGENTS.md` supplies global policy and `skills/*/SKILL.md` supply task-specific judgment. They are runtime inputs, not development-only documentation.

## Layers

1. `public/voice-ui.mjs`: local transcription, editable text, recent conversation and action trace. `journey-ui.mjs` sends `/api/agent`, adopts checked plans and updates the map.
2. `lib/agent.mjs`: model messages, skill loading, tool dispatch, repeated-call and execution limits. Only tool calls and observations are retained, never model reasoning fields. Before `finish`, `agent-review.mjs` separately compares the user request, selected plan, actual actions and observations against the proposed reply. Concrete omissions return to the same loop. At most two completion reviews are allowed and count against the model-round/time budgets. An unavailable/unsatisfied review returns an explicit partial status. This is a probabilistic semantic check, not a replacement for deterministic constraints or user confirmation.
3. `lib/agent-skills.mjs`: fixed local catalog and paths. Only metadata is initially exposed; a skill body enters the single trusted system message after `load_skill`. Enabled tools must exist in both its manifest allowlist and the host implementation.
4. `lib/agent-tools.mjs`: per-turn trip state, provisional assumptions, observed place cache, explicit candidate bindings, checked result revisions and read-only services. A search does not mutate the trip. A changed condition invalidates the previous candidate before it can be recommended for saving.
5. `lib/trip-state.mjs`, `activities.mjs`, `journey.mjs`: pure validation, identities, order, timing, budget, walking and deterministic scheduling. Neither skill text nor model output can bypass those checks.
6. Existing Maps, news/events and Calendar adapters: external facts. Calendar preview/confirm remains a separate user-controlled host path with the existing stale-preview/idempotency protections.

## Skill contract

Each directory contains `SKILL.md` with `name` and `description` YAML frontmatter. The body describes objectives, evidence standards, prerequisites, supported actions and stop/handoff criteria. It does not enumerate user utterances or supply fixed fallback hours. `skills.json` maps its name to implemented tools.

To add a capability, first implement a narrow validated adapter and tests, expose its tool definition/handler, add the allowlisted tool to an appropriate skill, and validate its markdown. Editing a skill is enough for workflow guidance changes; it cannot create new executable tools, read arbitrary local paths or grant calendar confirmation permission. The catalog is re-read each turn.

## State and evidence

Sparse trip updates preserve unrelated conditions. Assumptions persist with the browser conversation and are separately supplied to subsequent model turns. Place IDs must come from observations. Named-entity matching remains conservative. The planner returns actual origin, activity sequence, constraints, gaps and diagnostics for semantic checking by the model. This checking can still fail; it is not a formal guarantee of understanding natural language.

Current plan selection and map use the same server-checked result. Expired plans must be regenerated. Calendar details stay local; only busy intervals/counts and checked plan facts enter model observations. User-provided verification sources are not sent to the model.

## Bounds and failure

- Per turn: 24 model rounds, 28 tool calls, 12 place searches/details, 36 route evaluations. Route adapter transit-to-walk fallback can perform a second Google request, so 36 evaluations is not necessarily 36 billable HTTP requests.
- Total execution budget 180 seconds, checked between operations; a running provider request is bounded by its own timeout (model 45 seconds, Maps request 20 seconds).
- Identical calls at the same state revision are limited; a corrected state can be planned again. Provider failures become model observations. The last two model rounds (reply and review), two tool slots, and up to 35 seconds are reserved for a conclusion. Exhaustion/service/review failures use the latest fresh checked facts, including specific infeasibility diagnostics; stale results cannot be narrated as current.
- No general shell, arbitrary URL fetch, browser automation, payment, booking, event deletion or calendar confirmation tool.

## Compatibility and remaining limitations

Main conversation no longer uses `conversation.mjs`'s fixed extraction/clarification pipeline or its separate reply writer. The complete-demand form and direct replan/verification buttons retain legacy endpoints. This avoids changing their approval semantics during migration. They are explicitly documented as compatibility paths.

Only one local day/up to six activities; bounded local search, no exhaustive global optimization. Activity availability beyond Maps data still needs official-source/user verification. Source coverage is limited to configured providers. Skills are read-only project files, not self-generated/self-modifying routines. Voice remains record, transcribe, inspect, send. Trace is shown at turn completion, not streamed live.


## Progress and availability evidence

Every tool observation and the current context expose aggregate readiness: missing fields, origin binding, every missing candidate group, selected places and remaining provider budgets. One failed preflight returns all prerequisites without querying routes/calendar. Changes to estimates preserve search evidence but invalidate the schedule; changing query, identity or activity availability invalidates its candidates.

Activities retain `availability: venue | session` through normalization, conversation slots and planner inputs. The model makes this general semantic classification; it is not inferred by matching user phrases. For a session, a matching dated user check or refreshed official event occurrence is needed to remove `availabilityPending`. Maps search or model assertions cannot create that check. A feasible route with pending sessions is a route draft: the UI labels it, completion facts report it, and the preview endpoint rejects it until the existing user verification form has applied real evidence and replanned. Draft routes remain visible so that the form is reachable. Ordinary venue visits retain the previous tentative personal-time-block flow.

This is evidence tracking, not an automatic event-booking service. Classification still depends on the model. Old saved activities without the new field default to venue for compatibility and should be reinterpreted on a new request. Official event/session pages are not fetched by Places; unavailable evidence must be explained or a different activity discussed.

Place observations use short turn-local handles (`place_1`, etc.). The host alone resolves them to Maps IDs, while current progress lists observed names and handles. Provider IDs remain in the checked UI result, not in the model-facing place observations. Unknown handles cannot resolve to arbitrary places.


## Multi-turn discovery and clarification

`clarify` is a control outcome, not failed completion: it atomically records a sparse patch and returns a question. Re-asking already recorded origin/date/budget/time is rejected; the semantic choice of question and extraction remain model responsibilities. This outcome bypasses the completion reviewer, which otherwise still reviews substantive answers. No executable external action is available through clarification.

A bounded server evidence cache stores discovered event facts. The browser carries only its opaque reference in slots; tool context reconstructs source data on the next turn. Event refs bind activities to a venue and a refreshed published occurrence; event details use allowlisted, previously discovered Visit Stockholm URLs. Source-derived checks retain provenance and never indicate booking/stock. Replanning preserves source checks, and source time changes invalidate old model-side results. Expiry/restart requires rediscovery, not silently trusting the assistant's previous prose.

Five/six-stop candidate generation uses a bounded beam (up to128 partial orders) and zero-travel temporal feasibility pruning before paid routes. User time windows, fixed sessions and explicit order remain enforced. Search remains approximate, not a global feasibility proof. Source parser currently accepts explicitly dated same-day start/end occurrences; incomplete and overnight sessions remain unverified.

Pending planning tasks survive a clarification in conversation slots. A concrete planning clarification saves the raw planning request and records activities before returning; `finish` cannot discharge an active task without a current `plan_itinerary` result, even if the semantic reviewer would approve. Zero-plan results count as checked outcomes and are explained honestly. A user-directed topic change can pause the task without erasing requirements. Extraction, candidate relevance, and whether a user has changed goals remain model decisions, so this contract is not a guarantee of all semantic correctness.

If a same-day checked attempt is followed by an unfinished revision, the host may return a partial result containing `lastAttempt` and an explicit statement that the new conditions/candidates are unverified. It does not expose that stale result as the current journey or allow it to be saved. Moving to a different day suppresses the previous attempt instead of presenting its conflicts as relevant. This preserves useful failed-search evidence without claiming the latest revision succeeded.

Event-only discovery terminates through `present_events`: the model selects source references and the host renders occurrences, date-only uncertainty, and the named distance centre. A new departure point must be backed by a quote appearing in a user message; an assistant-selected discovery centre cannot silently populate it. This is a provenance check, not a full semantic proof of location intent.

When the model finishes after a new checked plan, the host renders the plan's actual diagnostics and source sessions rather than sending generated conflict claims through a second model. Semantic review still applies to general answers, but cannot override a missing execution result or author new facts. Activity schemas explicitly require nullable evidence/time-window fields; windows without an event occurrence need a quote present in user history. This prevents ungrounded arbitrary per-stop constraints while leaving timing interpretation and candidate selection to the model.

A hard activity window also requires a recognizable clock/day-part anchor in that quote. This is a conservative field-format guard, not natural-language intent classification: quoting an activity name cannot authorize arbitrary fixed hours. Unresolved relative timing should remain a preference to clarify rather than fabricated clock times. The supported anchor syntax is finite and does not guarantee semantic interpretation; the selected numeric window is displayed explicitly as an interpretation.

`discover_candidates` explicitly prepares all missing groups in one operation, reuses selected groups and shares the existing 12-search budget. The agent sees names and may replace unsuitable candidates before planning. `set_budget` and `set_activity_window` support narrow edits without rewriting the whole activity array.

Before route calls, a separate small intake check compares requested activities and their time preferences with user messages scoped to the active planning task. Earlier discovery questions, assistant replies and calendar/provider observations are excluded. It returns typed omissions with exact user quotes; the host rejects non-user quotes and omissions contradicted by populated fields. Normal clarification bypasses semantic review entirely; it must not be held hostage by a fallible review model. Origin/date/budget/overall-hour readiness remains in deterministic preflight. It cannot introduce order, feasibility, price or duration requirements. Up to three distinct state checks are cached and counted in the model-round budget; corrections remain the agent's responsibility. This semantic check is fallible, unlike source-field rendering and execution-result guards, and must not be described as a guarantee of understanding.
### Event venue identity (2026-10-07)

Source event labels are not canonical map names. Event details retain the source address and coordinates. The planning environment resolves event venues with `event-venue.mjs`: an exact source name is accepted (but conflicting coordinates reject it); localized aliases require both all name tokens and a source/map separation of at most 100 m. Swedish possessive normalization is used only with this coordinate corroboration. Localized aliases are retrieved by the same observed Google Place ID, not supplied as model assertions. Coordinates alone never establish identity.

The binding receipt records original source venue, map name, local name, source URL and separation. It appears in the action trace and persists in source checks. The scheduler uses that receipt without requiring the English name to equal meeting-point prose. Manual time/price verification does not erase the independent source identity. Source refresh revalidates the binding. Departure origin remains a separate user-provenanced field. These rules do not verify a tour end point, entrance, tickets or a merchant service.

Activity display labels accept the same 220-character limit as source event titles. Tool schemas publish label/query limits, and domain validation identifies the specific failing field instead of repeatedly returning an ambiguous intake error.
