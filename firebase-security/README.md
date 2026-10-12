# Firebase access and application lifetime

The application has no expiry date. Hosting, shared app data and credentials are not deleted by the retention jobs. Service operation still depends on the owner's GitHub, Firebase and Cloudflare accounts remaining active and within their service limits.

Realtime Database rules deny access by default. Only `couple-rabbit` and `couple-sweet`, with a current `session_until` claim, can access the explicitly listed application paths. These tokens are issued only after the existing Worker password/passkey session is verified. Firebase client authentication uses in-memory persistence and both databases disconnect when the user session is locked.

The Worker accesses Firebase with dedicated project service accounts. Store `FIREBASE_DYDY_ACCOUNT` and `FIREBASE_SMOKE_ACCOUNT` as Cloudflare Worker secrets; never commit their JSON keys or data backups. Redeployments preserve these secrets. Rotate a key deliberately if compromised; there is no scheduled deletion of keys, accounts or application data as a whole.

Retention remains narrowly scoped: smoke requests and their embedded proof images after seven days, whole trips and their nested expenses after thirty days, user calendar events after their calendar year, unpinned chat after thirty days, successful delivery records after seven days. Existing trips without registration timestamps start their retention period at migration. Fixed default calendar dates, passkeys and push registrations are retained.

Rules files are published to the two existing databases using Firebase administrator credentials. Before tightening rules, deploy the authenticated Worker and client, enable Firebase Authentication in both projects, and verify custom-token login. After publishing rules, verify anonymous reads/writes are rejected, both authorized owners can read/write, unrelated users and expired sessions are rejected, and server reminders/cleanup still work.
## Long-term storage safeguards

Saved chat has a confirmed bulk-delete action affecting both users' saved messages and photos. Ordinary chat and source app records are preserved; reply previews are scrubbed. Minimal deletion markers prevent app-card restoration and follow normal thirty-day cleanup. A shared revision refreshes cached views. Saved chat is capped at 1,000 items; total chat photos remain capped at 100 MB.

Daily server retention removes moods and approval history older than thirty days, and completed leave requests older than thirty days. Pending requests and future approved outings remain. Balances, game reward totals, credentials and settings are preserved.

Old wish-ticket usage is folded into archivedUses after thirty days, deducting the corresponding consumed half-tickets from halfTickets. Available tickets and fractional progress remain unchanged, including for legacy clients. New clients include archivedUses in lifetime usage and rewards.

Delivery records now have created_at. Successful and failed records expire after seven days. Upgrade existing databases by adding the column once and initializing legacy rows to the migration time. Auth, pairing and delivery maintenance runs independently of push sending.

These safeguards support long-term normal use; third-party service quotas and future policies still apply.
