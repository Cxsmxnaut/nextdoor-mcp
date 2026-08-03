# Nextdoor MCP for Claude Desktop

A personal-and-business Nextdoor automation server for Claude Desktop. It uses installed Google Chrome with a dedicated persistent profile and exposes compact structured MCP tools for feeds, search, chats, marketplace, groups, events, alerts, notifications, settings, business pages, ads, monitoring, and autonomous actions.

## Install

Install Node.js LTS, Google Chrome, and Claude Desktop. Copy this folder to the target computer, then run:

```sh
npm run setup
npm run login
```

Fully quit and restart Claude Desktop. Ask Claude to run `account_status`, then `capability_inventory`.

The installer preserves existing MCP entries and adds this server to:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

## Performance model

`NEXTDOOR_HEADLESS=true` and `NEXTDOOR_RESOURCE_MODE=html` are the defaults. Normal MCP calls open no browser window. The visible `npm run login` helper is only for authentication and verification.

The MCP reuses one 1024×768 Chrome context and one page; blocks images, video/audio, fonts, stylesheets, and common telemetry; extracts bounded semantic DOM entities; caches identical reads for five seconds; and falls back to compact text chunks only when semantic containers are unavailable. Monitors always bypass the cache. Use `performance_status` to inspect resource counters. Set resource mode to `lean` to retain stylesheets or `full` for visual debugging.

This is still Chrome browser automation: Nextdoor is a JavaScript application, so scripts and essential styles must load. It cannot be reduced to a simple HTML HTTP client because authentication, data loading, and actions depend on Nextdoor's browser application.

## Tools

Core administration:

- `account_status`, `capability_inventory`, `implementation_status`, `performance_status`, `discover_navigation`, `audit_log`
- `inspect_nextdoor_url` for structured inspection and optional evidence screenshots
- `find_own_post` to resolve an exact post body on the signed-in profile to its direct `/p/...` URL
- `browse_surface`, `search_nextdoor`
- `create_monitor`, `list_monitors`, `run_monitor`, `delete_monitor`

Convenience reads:

- `list_feed`, `list_chats`, `list_marketplace`, `list_groups`, `list_events`
- `list_alerts`, `list_notifications`, `get_settings`
- `get_business_dashboard`, `get_ads_dashboard`

`perform_action` is the primary write tool. It validates and immediately executes any supported action in one MCP call, without a separate approval token or typed human confirmation.

`preview_action` and `execute_action` retain the older two-step contract for clients and conversations that still use it. Preview tokens remain single-use and expire after ten minutes.

Both paths use the same payload validation, write pacing, encrypted state, execution tracking, and post-action page-health checks.

Live-verified specialized adapters cover posts, exact own-post URL resolution, comments, reactions, marketplace listings, events, private/public groups, RSVPs, group membership, business Faves, appearance settings, and deletion of owned posts/listings/events/groups. They bind writes to exact content text or names and verify the resulting state through a direct URL, profile, owner collection, or control-state read-back before reporting success.

Messaging is specialized but requires a real recipient and was not exercised by the repository's owner-account lifecycle tests. Invitations, recommendations, profile edits, moderation/reporting/blocking, and advertising use the constrained semantic-form adapter: requests must provide a matching Nextdoor URL, exact visible field labels, attachment paths where relevant, and an exact final control label. `implementation_status` distinguishes live-verified capabilities from account/target-gated implementations.

For an authenticated development checkout, run `npm run test:live` to exercise all read surfaces, convenience aliases, monitoring lifecycle/deduplication, inspection screenshots, audit retrieval, and MCP tool discovery. Live write tests should use uniquely named temporary objects and delete them through `perform_action(delete_content)` after read-back.

## Execution boundaries

Fresh installations enable autonomous writes. Set `NEXTDOOR_ALLOW_WRITE=false` to make the server read-only. Existing installations that explicitly disabled writes keep that setting when rerunning setup.

- Attachments must be under a directory in `NEXTDOOR_ALLOWED_FILES` and are limited to 25 MB each.
- Ad operations remain locked until positive `NEXTDOOR_MAX_DAILY_SPEND` and `NEXTDOOR_MAX_CAMPAIGN_SPEND` limits are configured.
- Passwords are never stored. Session cookies remain in `~/.nextdoor-mcp/profile`.
- MCP state is AES-256-GCM encrypted under `~/.nextdoor-mcp`; the local key and ciphertext are mode `0600`.
- Audit entries record action metadata, not post or message bodies.
- Writes are paced by `NEXTDOOR_MIN_WRITE_INTERVAL_MS`; encrypted state mutations are locked across processes; and action IDs are tracked before browser execution to prevent concurrent duplicates.
- CAPTCHA and identity/account verification always pause for the user.

Do not use this server for spam, fake engagement, harassment, mass unsolicited messaging, scraping inaccessible neighborhoods, or circumventing Nextdoor controls.

## Reliability

Nextdoor does not provide a comprehensive public API for member features. `capability_inventory` discovers account availability; `implementation_status` distinguishes live-verified, implemented/account-gated, Claude-delegated, and unavailable capabilities. UI changes may require semantic locator updates; the server reports these failures rather than claiming success.

Scheduled monitors run only while Claude Desktop keeps the MCP server alive. Operating-system scheduling while Claude is closed and an official Ads/Conversions API client are not implemented.
