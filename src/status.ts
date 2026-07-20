export function implementationStatus() {
  return {
    version: "1.1.0",
    meanings: {
      verified: "Implemented and exercised against the authenticated personal account.",
      implemented: "Implemented through semantic UI controls but requires a matching account/UI for live verification.",
      delegated: "The MCP returns structured source material for Claude to summarize or analyze.",
      unavailable: "Not implemented or cannot be provided reliably through Claude Desktop MCP."
    },
    capabilities: {
      account_session: "verified", navigation_discovery: "verified", feed_reading: "verified",
      search: "verified", inbox_reading: "verified", marketplace_reading: "implemented",
      groups_reading: "implemented", events_reading: "implemented", alerts: "implemented",
      notifications: "implemented", settings_reading: "implemented", profiles: "implemented",
      business_dashboard: "implemented", ads_dashboard: "implemented",
      structured_extraction: "verified", encrypted_state: "verified", audit_log: "verified",
      manual_monitors: "verified", scheduled_monitors_while_claude_desktop_is_running: "implemented",
      post_creation: "implemented", chat_sending: "implemented", comments: "implemented",
      marketplace_listing_creation: "implemented", semantic_form_actions: "implemented",
      groups_events_recommendations_rsvp_faves: "implemented",
      profile_settings_moderation_reporting_blocking_deletion: "implemented",
      ad_creation_and_budget_actions: "implemented",
      summaries_sentiment_lead_classification_recommendations: "delegated",
      image_dimension_validation: "unavailable",
      operating_system_scheduling_when_claude_is_closed: "unavailable",
      official_ads_or_conversion_api: "unavailable",
      guaranteed_support_for_every_future_nextdoor_ui: "unavailable"
    },
    note: "Run capability_inventory for account availability. Implemented does not mean Nextdoor granted this account the required role or feature."
  };
}
