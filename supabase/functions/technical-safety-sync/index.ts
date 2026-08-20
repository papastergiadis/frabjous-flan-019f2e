import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

type SyncVisitInput = {
  syncKey: string;
  company: string;
  visitAt: string;
  durationMinutes?: number;
  location?: string;
  notes?: string;
  reminderAt?: string | null;
  completed?: boolean;
};

type SyncRequest = {
  sourceFile: string;
  sourceChecksum?: string;
  dryRun?: boolean;
  visits: SyncVisitInput[];
};

type ExistingVisit = {
  id: string;
  sync_key: string;
  source_payload_hash: string | null;
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function secureEqual(left: string, right: string) {
  const [a, b] = await Promise.all([sha256(left), sha256(right)]);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

function requireText(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${field} must contain 1-${maxLength} characters`);
  }
  return normalized;
}

function optionalText(value: unknown, field: string, maxLength: number) {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`${field} must contain at most ${maxLength} characters`);
  }
  return value;
}

function requireTimestamp(value: unknown, field: string) {
  if (
    typeof value !== "string" ||
    !/T/.test(value) ||
    !/(Z|[+-][0-9]{2}:[0-9]{2})$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new Error(`${field} must be an ISO-8601 timestamp with a timezone`);
  }
  return new Date(value).toISOString();
}

function optionalTimestamp(value: unknown, field: string) {
  if (value == null || value === "") return null;
  return requireTimestamp(value, field);
}

function duration(value: unknown) {
  const minutes = value == null ? 60 : Number(value);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
    throw new Error("durationMinutes must be an integer between 0 and 1440");
  }
  return minutes;
}

function validateRequest(value: unknown): SyncRequest {
  if (!value || typeof value !== "object") throw new Error("Request body must be an object");
  const body = value as Record<string, unknown>;
  const sourceFile = requireText(body.sourceFile, "sourceFile", 64);
  if (!/^[0-9]{4}_[0-9]{2}\.pdf$/.test(sourceFile)) {
    throw new Error("sourceFile must use the YYYY_MM.pdf format");
  }
  if (!Array.isArray(body.visits) || body.visits.length > 300) {
    throw new Error("visits must be an array containing at most 300 entries");
  }

  const seen = new Set<string>();
  const visits = body.visits.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`visits[${index}] must be an object`);
    const item = raw as Record<string, unknown>;
    const syncKey = requireText(item.syncKey, `visits[${index}].syncKey`, 180);
    if (seen.has(syncKey)) throw new Error(`Duplicate syncKey: ${syncKey}`);
    seen.add(syncKey);
    return {
      syncKey,
      company: requireText(item.company, `visits[${index}].company`, 180),
      visitAt: requireTimestamp(item.visitAt, `visits[${index}].visitAt`),
      durationMinutes: duration(item.durationMinutes),
      location: optionalText(item.location, `visits[${index}].location`, 300),
      notes: optionalText(item.notes, `visits[${index}].notes`, 2000),
      reminderAt: optionalTimestamp(item.reminderAt, `visits[${index}].reminderAt`),
      completed: item.completed === true,
    };
  });

  return {
    sourceFile,
    sourceChecksum:
      body.sourceChecksum == null ? undefined : requireText(body.sourceChecksum, "sourceChecksum", 128),
    dryRun: body.dryRun === true,
    visits,
  };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return reply(405, { error: "method_not_allowed" });
  }

  const expectedKey = Deno.env.get("TECHNICAL_SAFETY_SYNC_KEY") || "";
  const ownerUserId = Deno.env.get("TECHNICAL_SAFETY_OWNER_USER_ID") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (!expectedKey || !ownerUserId || !supabaseUrl || !serviceRoleKey) {
    console.error("Technical Safety sync is missing required server-side configuration");
    return reply(503, { error: "service_not_configured" });
  }

  const match = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  if (!match || !(await secureEqual(match[1], expectedKey))) {
    return reply(401, { error: "unauthorized" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let sourceFile = "unknown";
  let sourceChecksum: string | null = null;
  let dryRun = false;

  try {
    const payload = validateRequest(await request.json());
    sourceFile = payload.sourceFile;
    sourceChecksum = payload.sourceChecksum || null;
    dryRun = payload.dryRun === true;

    const prepared = await Promise.all(
      payload.visits.map(async (visit) => {
        const canonical = JSON.stringify({
          company: visit.company,
          visitAt: visit.visitAt,
          durationMinutes: visit.durationMinutes,
          location: visit.location,
          notes: visit.notes,
          reminderAt: visit.reminderAt,
          completed: visit.completed,
        });
        const identityHash = await sha256(`${ownerUserId}|${sourceFile}|${visit.syncKey}`);
        const payloadHash = await sha256(canonical);
        return {
          id: `ta_${identityHash.slice(0, 40)}`,
          owner_auth_user_id: ownerUserId,
          company: visit.company,
          visit_at: visit.visitAt,
          duration_minutes: visit.durationMinutes,
          location: visit.location,
          notes: visit.notes,
          reminder_at: visit.reminderAt,
          completed: visit.completed,
          announcement_path: null,
          announcement_name: null,
          announcement_type: null,
          announcement_size: 0,
          sync_source: "TA-SYNC",
          source_file: sourceFile,
          sync_key: visit.syncKey,
          source_payload_hash: payloadHash,
          updated_at: new Date().toISOString(),
        };
      }),
    );

    const { data: existingData, error: existingError } = await supabase
      .from("be_safety_visits")
      .select("id,sync_key,source_payload_hash")
      .eq("owner_auth_user_id", ownerUserId)
      .eq("sync_source", "TA-SYNC")
      .eq("source_file", sourceFile);

    if (existingError) throw existingError;

    const existing = (existingData || []) as ExistingVisit[];
    const existingByKey = new Map(existing.map((row) => [row.sync_key, row]));
    const incomingKeys = new Set(prepared.map((row) => row.sync_key));

    const created = prepared.filter((row) => !existingByKey.has(row.sync_key));
    const updated = prepared.filter((row) => {
      const current = existingByKey.get(row.sync_key);
      return current && current.source_payload_hash !== row.source_payload_hash;
    });
    const unchanged = prepared.filter((row) => {
      const current = existingByKey.get(row.sync_key);
      return current && current.source_payload_hash === row.source_payload_hash;
    });
    const deleted = existing.filter((row) => !incomingKeys.has(row.sync_key));

    if (!dryRun) {
      const changes = [...created, ...updated];
      if (changes.length) {
        const { error } = await supabase
          .from("be_safety_visits")
          .upsert(changes, { onConflict: "id" });
        if (error) throw error;
      }

      if (deleted.length) {
        const { error } = await supabase
          .from("be_safety_visits")
          .delete()
          .eq("owner_auth_user_id", ownerUserId)
          .eq("sync_source", "TA-SYNC")
          .eq("source_file", sourceFile)
          .in("id", deleted.map((row) => row.id));
        if (error) throw error;
      }
    }

    const result = {
      sourceFile,
      dryRun,
      created: created.length,
      updated: updated.length,
      deleted: deleted.length,
      unchanged: unchanged.length,
      total: prepared.length,
    };

    const { error: auditError } = await supabase.from("be_safety_sync_runs").insert({
      owner_auth_user_id: ownerUserId,
      source_file: sourceFile,
      source_checksum: sourceChecksum,
      dry_run: dryRun,
      created_count: created.length,
      updated_count: updated.length,
      deleted_count: deleted.length,
      unchanged_count: unchanged.length,
      status: "success",
    });
    if (auditError) console.error("Could not write sync audit log", auditError);

    return reply(200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Technical Safety sync failed", message);

    if (sourceFile !== "unknown") {
      await supabase.from("be_safety_sync_runs").insert({
        owner_auth_user_id: ownerUserId,
        source_file: sourceFile,
        source_checksum: sourceChecksum,
        dry_run: dryRun,
        status: "failed",
        error_message: message.slice(0, 1000),
      }).then(({ error: auditError }) => {
        if (auditError) console.error("Could not write failed sync audit log", auditError);
      });
    }

    return reply(400, { error: "sync_failed", message });
  }
});
