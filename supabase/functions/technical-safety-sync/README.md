# Technical Safety sync

This integration replaces browser automation with a scoped server-side endpoint for the
`elias` and `thomas` Project Tracking users.

## Security model

- Visits are stored in `public.be_safety_visits` and protected by Row Level Security.
- Signed-in users can access only rows whose `owner_auth_user_id` equals `auth.uid()`.
- The Edge Function uses the Supabase service role only on the server.
- Requests may select only the allow-listed aliases `elias` or `thomas`; the corresponding
  Auth UUIDs remain server-side secrets.
- The sync endpoint can manage only rows marked `sync_source = 'TA-SYNC'`.
- Full-sync deletions are additionally limited to one owner and one `YYYY_MM.pdf` source file.
- Manual visits are never deleted by this endpoint.
- Never commit the service-role key, owner UUIDs, or the sync key.

## Required Edge Function secrets

- `TECHNICAL_SAFETY_ELIAS_USER_ID`: Supabase Auth UUID for `elias`. During migration,
  `TECHNICAL_SAFETY_OWNER_USER_ID` remains a supported fallback for this owner.
- `TECHNICAL_SAFETY_THOMAS_USER_ID`: Supabase Auth UUID for `thomas`.
- `TECHNICAL_SAFETY_SYNC_KEY`: high-entropy Bearer key for the integration.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied by Supabase.

## Request format

Send `POST /functions/v1/technical-safety-sync` with the integration Bearer key and a body
like this:

```json
{
  "owner": "elias",
  "sourceFile": "2026_09.pdf",
  "sourceChecksum": "dropbox-revision-or-checksum",
  "dryRun": true,
  "visits": [
    {
      "syncKey": "TA-SYNC|2026_09.pdf|2026-09-01T08:00:00+03:00|AXL IMPERIAL LTD ΥΠΟΚΑΤΑΣΤΗΜΑ ΕΛΛΑΔΟΣ",
      "company": "AXL IMPERIAL LTD ΥΠΟΚΑΤΑΣΤΗΜΑ ΕΛΛΑΔΟΣ",
      "visitAt": "2026-09-01T08:00:00+03:00",
      "durationMinutes": 120,
      "location": "5οχλμ Π.Ε.Ο. Θηβών Χαλκίδας, 32200",
      "notes": "TA-SYNC|2026_09.pdf|2026-09-01T08:00:00+03:00|AXL IMPERIAL LTD ΥΠΟΚΑΤΑΣΤΗΜΑ ΕΛΛΑΔΟΣ",
      "reminderAt": null,
      "completed": false
    }
  ]
}
```

`owner` must be `elias` or `thomas`. Every `syncKey` must start with
`TA-SYNC|<sourceFile>|`.

## Deployment and execution

1. Add `TECHNICAL_SAFETY_THOMAS_USER_ID` as a protected GitHub Actions secret.
2. Run **Deploy Technical Safety Sync** with confirmation `DEPLOY-BOTH`.
3. Run **Dry Run Technical Safety Sync** with confirmation `DRY-RUN-BOTH`.
4. Review both owner summaries.
5. Run **Sync Technical Safety Visits** with confirmation `SYNC-BOTH-35`.

The two-owner workflows validate both dry-run responses before any production visit write.
The stored Base64 payload is canonicalized at runtime so the stable `TA-SYNC` identifier is
used as both `syncKey` and `notes` without exposing visit content in the repository.

## Idempotency and deletion rules

- The function derives a deterministic row ID from owner UUID, source file, and sync key.
- Identical rows are returned as `unchanged`.
- Missing rows are deleted only when they were created by `TA-SYNC` for the same owner and
  source file.
- Manual or unrelated rows are outside the deletion query.
