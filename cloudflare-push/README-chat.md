# Couple chat

Private `/chat/*` endpoints require the existing password/passkey session. Device pairing tokens alone do not grant chat access. Sender identity comes from the verified session.

Messages and compressed JPEG photos are stored separately in D1. Clients poll while foregrounded, load photo data only for visible messages, and never cache conversations in localStorage or the service worker. Photos are resized to at most 1280 pixels and 230,000 data-URL characters; total photo storage is capped at 100 MB.

Unpinned messages and their photos expire after 30 days. An hourly cleanup claim lets the scheduled worker remove them in one D1 transaction without a full cleanup every minute. Pinned messages/photos remain; unpinning an expired item makes it eligible for cleanup. Original Firebase calendar, approval and travel records are untouched.

New chat messages enqueue push delivery after saving. Active, focused app sessions heartbeat presence; push is skipped while any recipient session is active. Visibility/focus/pagehide changes update presence. Suppressed messages remain pending until read or the recipient leaves; read receipts cancel queued delivery. Abrupt OS termination without a final event may leave presence for up to 45 seconds, after which unread notifications retry through cron. Failed pushes retry in the existing minute cron. Approval/calendar cards use existing event notifications to avoid an extra chat push.

Run `npm test`. Deploy `chat-schema.sql` with Wrangler before deploying the Worker. No private keys, pairing codes or photo contents belong in the repository.
