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

type TrackBody = {
  trackingKeys?: string[];
};

const requestWindowMs = 10 * 60 * 1000;
const trackingMaxRequests = 60;
const maxBodyBytes = 18 * 1024;

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
  return 400;
}

function normalizeInlineText(value: unknown, max = 160) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function mapItems(itemsRaw: unknown) {
  if (!Array.isArray(itemsRaw)) return [];
  return itemsRaw.map((item) => {
    const entry = (item || {}) as Record<string, unknown>;
    const quantity = Math.max(1, Number(entry.quantity) || 1);
    const unitPrice = Number(entry.price) || Number(entry.unitPriceHnl) || 0;
    const itemTotal = Number(entry.itemTotal) || Number(entry.totalHnl) || quantity * unitPrice;
    return {
      productKey: normalizeInlineText(entry.productKey, 60),
      name: normalizeInlineText(entry.name, 140) || "Producto",
      quantity,
      price: unitPrice,
      itemTotal,
      pricingNote: normalizeInlineText(entry.pricingNote, 180),
    };
  });
}

function mapTrackingRow(row: Record<string, unknown>) {
  return {
    id: String(row.tracking_key || ""),
    trackingKey: String(row.tracking_key || ""),
    orderId: String(row.client_order_id || ""),
    displayId: String(row.display_id || ""),
    client: String(row.client || "Cliente sin nombre"),
    items: mapItems(row.items),
    total: Number(row.total_hnl) || 0,
    paymentMethod: String(row.payment_method || "pay_later"),
    paymentStatus: String(row.payment_status || "pending"),
    paymentProvider: String(row.payment_provider || ""),
    paypalOrderId: String(row.paypal_order_id || ""),
    paypalCaptureId: String(row.paypal_capture_id || ""),
    paymentCurrency: String(row.payment_currency || ""),
    paymentAmount: Number(row.payment_amount) || 0,
    paidAt: row.paid_at ? String(row.paid_at) : null,
    status: String(row.status || "Pendiente"),
    time: String(row.order_time || "--:--"),
    orderDate: String(row.order_date || ""),
    notes: String(row.notes || ""),
    createdAt: row.created_at ? String(row.created_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
    deliveredAt: row.delivered_at ? String(row.delivered_at) : null,
    rejectedAt: row.rejected_at ? String(row.rejected_at) : null,
    customerNotesEdited: row.customer_notes_edited === true,
    customerNotesEditedAt: row.customer_notes_edited_at ? String(row.customer_notes_edited_at) : null,
    notesUpdatedAt: row.notes_updated_at ? String(row.notes_updated_at) : null,
  };
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
    "customer-track-orders",
    fingerprintHash,
    trackingMaxRequests,
    requestWindowMs
  );
  if (!localCheck.allowed) {
    throw new Error("Demasiadas solicitudes. Intenta mas tarde.");
  }

  if (!serviceClient) return;
  const { data, error } = await serviceClient
    .rpc("enforce_request_rate_limit", {
      p_action: "customer-track-orders",
      p_fingerprint_hash: fingerprintHash,
      p_bucket: localCheck.bucket,
      p_max_requests: trackingMaxRequests,
      p_window_seconds: Math.ceil(requestWindowMs / 1000),
    })
    .single();

  if (error) {
    console.warn("Rate limit RPC customer-track-orders no disponible:", error.message);
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

    const body = (await req.json().catch(() => ({}))) as TrackBody;
    const keys = Array.isArray(body.trackingKeys)
      ? [...new Set(body.trackingKeys.map((value) => normalizeInlineText(value, 120)).filter(Boolean))]
      : [];
    if (!keys.length) {
      return json({ ok: true, items: [] }, corsHeaders, 200);
    }
    if (keys.length > 20) {
      throw new Error("Se supero el limite de tracking keys.");
    }

    const { data, error } = await serviceClient
      .from("orders")
      .select("*")
      .in("tracking_key", keys)
      .limit(50);

    if (error) {
      throw new Error("No se pudo cargar el tracking.");
    }

    const items = (data || []).map((row) => mapTrackingRow((row || {}) as Record<string, unknown>));
    return json({ ok: true, items }, corsHeaders, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo consultar el tracking.";
    return json({ ok: false, error: message }, corsHeaders, resolveErrorStatus(message));
  }
});
