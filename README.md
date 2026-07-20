# Nextdoor MCP for Claude Desktop

A personal-and-business Nextdoor automation server for Claude Desktop. It uses installed Google Chrome with a dedicated persistent profile and exposes compact structured MCP tools for feeds, search, chats, marketplace, groups, events, alerts, notifications, settings, business pages, ads, monitoring, and approved actions.

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

- `account_status`, `capability_inventory`, `implementation_status`, `discover_navigation`, `audit_log`
- `inspect_nextdoor_url` for structured inspection and optional evidence screenshots
- `browse_surface`, `search_nextdoor`
- `create_monitor`, `list_monitors`, `run_monitor`, `delete_monitor`

Convenience reads:

- `list_feed`, `list_chats`, `list_marketplace`, `list_groups`, `list_events`
- `list_alerts`, `list_notifications`, `get_settings`
- `get_business_dashboard`, `get_ads_dashboard`

Writes use a two-step contract:

1. `preview_action` validates the action and returns an action ID plus a ten-minute approval token.
2. `execute_action` consumes that token exactly once, performs the action, and verifies an observable UI state change.

Explicit-risk actions also require `APPROVE <ACTION_KIND> <ACTION_ID>`. Account deactivation/deletion requires `CONFIRM <ACTION_KIND> <ACTION_ID>`.

Specialized adapters implement posts, messages, comments, and listings. Other action classes use a constrained semantic-form adapter: the preview must supply a Nextdoor URL, exact visible field labels, attachment paths, and an exact final control label. Account-gated actions are reported as implemented—not verified—until exercised with an account that exposes the matching controls.

## Safety configuration

Writes are off after installation. Set `NEXTDOOR_ALLOW_WRITE=true` only after read testing.

- Attachments must be under a directory in `NEXTDOOR_ALLOWED_FILES` and are limited to 25 MB each.
- Ad operations remain locked until positive `NEXTDOOR_MAX_DAILY_SPEND` and `NEXTDOOR_MAX_CAMPAIGN_SPEND` limits are configured.
- Passwords are never stored. Session cookies remain in `~/.nextdoor-mcp/profile`.
- MCP state is AES-256-GCM encrypted under `~/.nextdoor-mcp`; the local key and ciphertext are mode `0600`.
- Audit entries record action metadata, not post or message bodies.
- Writes are paced by `NEXTDOOR_MIN_WRITE_INTERVAL_MS` and action IDs are atomically claimed before browser execution to prevent concurrent duplicates.
- CAPTCHA and identity/account verification always pause for the user.

Do not use this server for spam, fake engagement, harassment, mass unsolicited messaging, scraping inaccessible neighborhoods, or circumventing Nextdoor controls.

## Reliability

Nextdoor does not provide a comprehensive public API for member features. `capability_inventory` discovers account availability; `implementation_status` distinguishes live-verified, implemented/account-gated, Claude-delegated, and unavailable capabilities. UI changes may require semantic locator updates; the server reports these failures rather than claiming success.

Scheduled monitors run only while Claude Desktop keeps the MCP server alive. Operating-system scheduling while Claude is closed and an official Ads/Conversions API client are not implemented.
