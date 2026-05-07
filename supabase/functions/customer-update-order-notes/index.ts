import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  enforceLocalRateLimit,
  ensureRequestBodyLimit,
  getClientIp,
  getClientUserAgent,
  getCorsHeaders,
  isAllowedOrigin,
  sha256Hex,
} from "../_shared/paypal.ts";

type NotesBody = {
  trackingKey?: string;
  orderId?: string;
  notes?: string;
};

const requestWindowMs = 10 * 60 * 1000;
const notesMaxRequests = 20;
const maxBodyBytes = 16 * 1024;

function json(data: unknown, headers: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
  });
}

function createServiceRoleClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRole) return null;
  return createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false },
  });
}

function resolveErrorStatus(message: string) {
  const normalized = String(message || "").toLowerCase();
  if (normalized.includes("origen no autorizado")) return 403;
  if (normalized.includes("demasiadas solicitudes")) return 429;
  if (normalized.includes("demasiado grande")) return 413;
  if (normalized.includes("no encontrado")) return 404;
  if (normalized.includes("ya fue editada")) return 409;
  return 400;
}

function normalizeInlineText(value: unknown, max = 160) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalizeMultilineText(value: unknown, max = 1200) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

async function enforceRequestRateLimit(
  req: Request,
  serviceClient: ReturnType<typeof createServiceRoleClient>
) {
  const ip = getClientIp(req.headers);
  const userAgent = getClientUserAgent(req.headers);
  const fingerprint = `${ip}|${userAgent || "unknown"}`;
  const fingerprintHash = (await sha256Hex(fingerprint)).slice(0, 32);

  const localCheck = enforceLocalRateLimit(
    "customer-update-order-notes",
    fingerprintHash,
    notesMaxRequests,
    requestWindowMs
  );
  if (!localCheck.allowed) {
    throw new Error("Demasiadas solicitudes. Intenta mas tarde.");
  }

  if (!serviceClient) return;
  const { data, error } = await serviceClient
    .rpc("enforce_request_rate_limit", {
      p_action: "customer-update-order-notes",
      p_fingerprint_hash: fingerprintHash,
      p_bucket: localCheck.bucket,
      p_max_requests: notesMaxRequests,
      p_window_seconds: Math.ceil(requestWindowMs / 1000),
    })
    .single();

  if (error) {
    console.warn("Rate limit RPC customer-update-order-notes no disponible:", error.message);
    return;
  }
  if (!data?.allowed) {
    throw new Error("Demasiadas solicitudes. Intenta mas tarde.");
  }
}

Deno.serve(async (req) => {
  const requestOrigin = req.headers.get("origin") || "";
  const corsHeaders = getCorsHeaders(requestOrigin);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Metodo no permitido." }, corsHeaders, 405);
  }
  if (!isAllowedOrigin(requestOrigin)) {
    return json({ ok: false, error: "Origen no autorizado." }, corsHeaders, 403);
  }

  try {
    ensureRequestBodyLimit(req, maxBodyBytes);
    const serviceClient = createServiceRoleClient();
    if (!serviceClient) {
      throw new Error("Falta configuracion de backend segura.");
    }
    await enforceRequestRateLimit(req, serviceClient);

    const body = (await req.json().catch(() => ({}))) as NotesBody;
    const trackingKey = normalizeInlineText(body.trackingKey, 120);
    const orderId = normalizeInlineText(body.orderId, 120);
    const notes = normalizeMultilineText(body.notes, 800);
    if (!trackingKey) {
      throw new Error("trackingKey requerido.");
    }

    const query = serviceClient
      .from("orders")
      .select("client_order_id,tracking_key,customer_notes_edited")
      .eq("tracking_key", trackingKey)
      .limit(1);
    if (orderId) {
      query.eq("client_order_id", orderId);
    }
    const { data: rows, error: findError } = await query;
    if (findError) {
      throw new Error("No se pudo validar la orden.");
    }
    const row = (rows?.[0] || null) as Record<string, unknown> | null;
    if (!row) {
      throw new Error("Pedido no encontrado.");
    }
    if (row.customer_notes_edited === true) {
      throw new Error("La nota del pedido ya fue editada anteriormente.");
    }

    const nowIso = new Date().toISOString();
    const { error: updateError } = await serviceClient
      .from("orders")
      .update({
        notes,
        customer_notes_edited: true,
        customer_notes_edited_at: nowIso,
        notes_updated_at: nowIso,
        updated_at: nowIso,
      })
      .eq("tracking_key", trackingKey)
      .eq("client_order_id", String(row.client_order_id || ""));
    if (updateError) {
      throw new Error("No se pudieron actualizar las notas.");
    }

    return json({ ok: true }, corsHeaders, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo actualizar la nota.";
    return json({ ok: false, error: message }, corsHeaders, resolveErrorStatus(message));
  }
});
