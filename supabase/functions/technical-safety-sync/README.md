# Technical Safety sync

This integration replaces browser automation with a scoped server-side endpoint.

## Security model

- Visits are stored in `public.be_safety_visits` and protected by Row Level Security.
- Signed-in users can access only rows whose `owner_auth_user_id` equals `auth.uid()`.
- The Edge Function uses the Supabase service role only on the server.
- The sync endpoint can manage only rows marked `sync_source = 'TA-SYNC'`.
- Full-sync deletions are additionally limited to one owner and one `YYYY_MM.pdf` source file.
- Never commit the service-role key or the sync key.

## Deployment

1. Apply `supabase/migrations/20260820120000_technical_safety_sync.sql`.
2. In Supabase Authentication → Users, copy the UUID of the Auth user that owns the
   `elias` Project Tracking profile.
3. Generate a high-entropy random secret for the integration.
4. Configure these Edge Function secrets:

   - `TECHNICAL_SAFETY_OWNER_USER_ID`: the Auth UUID from step 2.
   - `TECHNICAL_SAFETY_SYNC_KEY`: the generated integration secret.
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied by Supabase.

5. Deploy `technical-safety-sync` with Supabase JWT verification disabled. The function
   performs its own Bearer-key verification. Do not expose the key to the frontend.
6. Deploy the updated frontend after the migration is live.

## Request format

Send `POST /functions/v1/technical-safety-sync` with:

```http
Authorization: Bearer <TECHNICAL_SAFETY_SYNC_KEY>
Content-Type: application/json
```

```json
{
  "sourceFile": "2026_09.pdf",
  "sourceChecksum": "sha256-of-the-pdf",
  "dryRun": true,
  "visits": [
    {
      "syncKey": "row-001",
      "company": "AXL IMPERIAL LTD ΥΠΟΚΑΤΑΣΤΗΜΑ ΕΛΛΑΔΟΣ",
      "visitAt": "2026-09-01T08:00:00+03:00",
      "durationMinutes": 120,
      "location": "5ο χλμ Π.Ε.Ο. Θηβών Χαλκίδας, 32200",
      "notes": "",
      "reminderAt": null,
      "completed": false
    }
  ]
}
```

All timestamps must contain a timezone. Run once with `dryRun: true`, review the counts,
then repeat the identical request with `dryRun: false`.

## Idempotency and deletion rules

- `syncKey` must be stable for the same PDF row across reruns.
- The function derives a deterministic row ID from owner, source file, and sync key.
- Identical rows are returned as `unchanged`.
- Missing rows are deleted only when they were previously created by `TA-SYNC` for the
  same owner and source file.
- Manual visits are never deleted by this endpoint.

## Rollback

The frontend retains a compatibility fallback to existing Supabase Auth metadata if the
new table has not yet been deployed. Once the migration is live, existing metadata visits
are copied into the table on the user's first successful sign-in.
