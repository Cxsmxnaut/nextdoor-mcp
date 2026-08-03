# Plan audit

Audited against the “Never Open the App Again” plan on 2026-08-02.

## Autonomous execution update

- `perform_action` validates and executes supported actions in one call without a human approval token or typed confirmation.
- Fresh setup enables writes by default. An explicit existing `NEXTDOOR_ALLOW_WRITE=false` setting is preserved.
- The preview/token workflow remains available for backward compatibility, not as a mandatory execution gate.
- Domain containment, CAPTCHA refusal, attachment containment, pacing, execution tracking, and configured ad-spend ceilings remain hard operational boundaries.

## Verified live on the authenticated account

- Installed Chrome session/login, headless HTML-first resource blocking, context/page reuse, five-second read cache, identity switching, and structured/fallback extraction.
- Feed, search, inbox, marketplace, groups, events, alerts, notifications, settings, business dashboard, and Ads Manager reads.
- Navigation discovery, encrypted state, redacted audit events, preview tokens, explicit confirmation phrases, atomic action claiming, write pacing, attachment containment, monitor deduplication, and implementation-status reporting.
- Autonomous and compatibility post creation with exact profile/direct-URL read-back; comments and reaction toggle/restore; owned-post deletion.
- Marketplace listing create/direct-read/delete; event create/direct and My Events read/delete; private group create/direct-read/delete.
- Reversible RSVP, public-group membership, Local Faves, and appearance-setting cycles, each restored to its original state.
- `find_own_post` direct URL resolution and post/listing/event/group-specific deletion verification.
- Cold start measured around 6–7 seconds; warm surface reads measured around 0.6–1.7 seconds in the audit run.

## Implemented but not live-verified for every form

- Specialized execution adapter not live-tested because it requires another person: messages.
- Constrained semantic form adapter: invitations, recommendations, profile changes beyond appearance, moderation, reports, blocking, account deletion/deactivation, and ads/billing.
- Scheduled monitors while Claude Desktop keeps the MCP process alive.
- Optional evidence screenshots and arbitrary authenticated Nextdoor URL inspection.

These depend on visible labels and permissions in the current account. The MCP reports selector, permission, verification, and page-health failures rather than claiming success.

## Partial relative to the original plan

- Search accepts a query but does not expose every Nextdoor-specific category/distance/price/condition filter as typed fields.
- Generic entity extraction does not yet provide a specialized schema for every post, nested comment, chat attachment, listing, attendee, ad metric, or recommendation field.
- Post creation has a specialized body/images path; polls, events, captions, audience, identity, category, mentions, and CTA fields rely on the semantic form adapter.
- Messaging has a specialized text path; message attachments, archive/mute/read state, edits, reactions, and reports rely on the semantic adapter.
- Business and advertising dashboards are readable, but metric normalization, campaign objects, lead export, anomaly detection, and every campaign editor are not specialized.
- Profile/business identity detection and switching are not represented as a dedicated typed tool.
- Monitors retain entity IDs and new results, not a complete local full-text archive of all viewed content.
- Post-action verification performs domain-specific read-back for the specialized actions above; the remaining semantic-form actions verify a healthy page and observable UI change but do not all re-query a typed object ID.
- Summaries, sentiment, lead classification, response suggestions, conflict detection, and performance recommendations are delegated to Claude using returned structured content rather than implemented as separate algorithms.

## Not implemented

- Operating-system scheduling when Claude Desktop is closed.
- Local scheduled post publishing.
- Official Nextdoor Ads or Conversion API client and pixel/CAPI diagnostics.
- Image dimension validation or image transcoding.
- A comprehensive typed adapter for every present and future Nextdoor dialog.
- Automatic completion of CAPTCHA, identity verification, payments outside supported controls, spam, fake engagement, or policy/rate-limit evasion.

## Execution-integrity conclusions

- Autonomous writes are enabled for fresh installations and can be disabled explicitly.
- Preview tokens are single-use and expire after ten minutes.
- Explicit-risk actions require `APPROVE <KIND> <ACTION_ID>`; account deactivation/deletion requires `CONFIRM <KIND> <ACTION_ID>`.
- `perform_action` intentionally bypasses those compatibility confirmations and executes in one call.
- Actions are atomically claimed before browser execution, preventing concurrent reuse.
- Corrupt encrypted state fails closed instead of silently losing idempotency history.
- Symlinks are resolved before attachment allowlist checks, and file types/sizes are bounded.
- Ad actions are locked unless both daily and campaign spend ceilings are positive and the previewed amount is within both.
