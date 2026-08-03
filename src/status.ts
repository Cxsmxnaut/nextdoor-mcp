export function implementationStatus() {
  return {
    version: "1.3.0",
    meanings: {
      verified: "Implemented and exercised against the authenticated personal account.",
      implemented: "Implemented through semantic UI controls but requires a matching account/UI for live verification.",
      delegated: "The MCP returns structured source material for Claude to summarize or analyze.",
      unavailable: "Not implemented or cannot be provided reliably through Claude Desktop MCP."
    },
    capabilities: {
      account_session: "verified", navigation_discovery: "verified", feed_reading: "verified",
      search: "verified", inbox_reading: "verified", marketplace_reading: "verified",
      groups_reading: "verified", events_reading: "verified", alerts: "verified",
      notifications: "verified", settings_reading: "verified", profiles: "verified",
      business_dashboard: "verified", ads_dashboard: "verified",
      structured_extraction: "verified", encrypted_state: "verified", audit_log: "verified",
      manual_monitors: "verified", scheduled_monitors_while_claude_desktop_is_running: "implemented",
      post_creation: "verified", own_post_url_resolution: "verified", chat_sending: "implemented", comments: "verified",
      reactions: "verified", marketplace_listing_creation: "verified", event_creation: "verified",
      group_creation: "verified", content_listing_event_group_deletion: "verified",
      rsvp: "verified", group_membership: "verified", business_faves: "verified",
      appearance_settings: "verified", semantic_form_actions: "implemented",
      autonomous_single_call_actions: "verified", compatibility_preview_execute: "verified",
      invitations_recommendations_profile_edits: "implemented",
      moderation_reporting_blocking_account_deletion: "implemented",
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
