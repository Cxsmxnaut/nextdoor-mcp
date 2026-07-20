# Plan audit

Audited against the “Never Open the App Again” plan on 2026-07-19.

## Verified live on the authenticated account

- Installed Chrome session/login, headless HTML-first resource blocking, context/page reuse, five-second read cache, identity switching, and structured/fallback extraction.
- Feed, search, inbox, marketplace, groups, events, alerts, notifications, settings, business dashboard, and Ads Manager reads.
- Navigation discovery, encrypted state, redacted audit events, preview tokens, explicit confirmation phrases, atomic action claiming, write pacing, attachment containment, monitor deduplication, and implementation-status reporting.
- Cold start measured around 6–7 seconds; warm surface reads measured around 0.6–1.7 seconds in the audit run.

## Implemented but not live-verified for every form

- Specialized execution adapters: posts with images, messages, comments, and marketplace listings.
- Constrained semantic form adapter: events, groups, invitations, recommendations, reactions, RSVPs, Faves, settings/profile changes, moderation, reports, blocking, deletion, and ads.
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
- Post-action verification confirms a healthy page and observable UI change; it does not yet re-query a domain-specific object ID for every action type.
- Summaries, sentiment, lead classification, response suggestions, conflict detection, and performance recommendations are delegated to Claude using returned structured content rather than implemented as separate algorithms.

## Not implemented

- Operating-system scheduling when Claude Desktop is closed.
- Local scheduled post publishing.
- Official Nextdoor Ads or Conversion API client and pixel/CAPI diagnostics.
- Image dimension validation or image transcoding.
- A comprehensive typed adapter for every present and future Nextdoor dialog.
- Automatic completion of CAPTCHA, identity verification, payments outside supported controls, spam, fake engagement, or policy/rate-limit evasion.

## Safety conclusions

- Writes remain disabled by default.
- Preview tokens are single-use and expire after ten minutes.
- Explicit-risk actions require `APPROVE <KIND> <ACTION_ID>`; account deactivation/deletion requires `CONFIRM <KIND> <ACTION_ID>`.
- Actions are atomically claimed before browser execution, preventing concurrent reuse.
- Corrupt encrypted state fails closed instead of silently losing idempotency history.
- Symlinks are resolved before attachment allowlist checks, and file types/sizes are bounded.
- Ad actions are locked unless both daily and campaign spend ceilings are positive and the previewed amount is within both.
