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

type CrmBody = {
  action?: string;
  orderId?: string;
  status?: string;
  notes?: string;
  quoteId?: string;
  token?: string;
  deviceLabel?: string;
};

type OrderRow = Record<string, unknown>;

const requestWindowMs = 10 * 60 * 1000;
const crmMaxRequests = 120;
const maxBodyBytes = 24 * 1024;
const allowedStatuses = new Set([
  "Pendiente",
  "Confirmado",
  "En preparación",
  "En horno",
  "Empaquetado",
  "En reparto",
  "Listo",
  "Entregado",
  "Rechazado",
  "Cancelado",
]);

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

type ServiceRoleClient = NonNullable<ReturnType<typeof createServiceRoleClient>>;

function resolveErrorStatus(message: string) {
  const normalized = String(message || "").toLowerCase();
  if (normalized.includes("no autenticado")) return 401;
  if (normalized.includes("origen no autorizado")) return 403;
  if (normalized.includes("no autorizado")) return 403;
  if (normalized.includes("demasiadas solicitudes")) return 429;
  if (normalized.includes("demasiado grande")) return 413;
  if (normalized.includes("no encontrado")) return 404;
  return 400;
}

function getBearerTokenFromRequest(req: Request) {
  const authHeader = String(req.headers.get("authorization") || "").trim();
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return "";
  }
  return authHeader.slice(7).trim();
}

async function requireSupabaseUser(serviceClient: ServiceRoleClient, req: Request) {
  const accessToken = getBearerTokenFromRequest(req);
  if (!accessToken) {
    throw new Error("No autenticado.");
  }

  const { data, error } = await serviceClient.auth.getUser(accessToken);
  if (error || !data?.user?.id) {
    throw new Error("No autenticado.");
  }

  return data.user;
}

async function requireCrmAccess(serviceClient: ServiceRoleClient, userIdRaw: unknown) {
  const userId = normalizeInlineText(userIdRaw, 80);
  if (!userId) {
    throw new Error("No autorizado.");
  }

  const { data, error } = await serviceClient
    .from("crm_users")
    .select("id,is_active,role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("No se pudo validar permisos CRM.");
  }
  if (!data || data.is_active !== true) {
    throw new Error("No autorizado.");
  }
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

function normalizeNotificationToken(value: unknown) {
  const token = String(value || "").trim();
  if (!token) throw new Error("token requerido.");
  if (token.length < 30 || token.length > 4096) {
    throw new Error("token push invalido.");
  }
  return token;
}

function normalizeDeviceLabel(value: unknown) {
  return normalizeInlineText(value, 120) || "web";
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

function mapOrderRow(row: OrderRow) {
  return {
    id: String(row.client_order_id || ""),
    clientOrderId: String(row.client_order_id || ""),
    trackingKey: String(row.tracking_key || ""),
    displayId: String(row.display_id || ""),
    localNumber: String(row.local_number || row.display_id || ""),
    client: String(row.client || "Cliente sin nombre"),
    phone: String(row.phone || ""),
    notes: String(row.notes || ""),
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
    createdAt: row.created_at ? String(row.created_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
    createdAtLocal: row.created_at_local ? String(row.created_at_local) : "",
    deliveredAt: row.delivered_at ? String(row.delivered_at) : null,
    rejectedAt: row.rejected_at ? String(row.rejected_at) : null,
    customerNotesEdited: row.customer_notes_edited === true,
    customerNotesEditedAt: row.customer_notes_edited_at ? String(row.customer_notes_edited_at) : null,
    notesUpdatedAt: row.notes_updated_at ? String(row.notes_updated_at) : null,
    source: String(row.source || ""),
  };
}

function mapQuoteRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ""),
    name: String(row.name || ""),
    email: String(row.email || ""),
    phone: String(row.phone || ""),
    event_date: row.event_date ? String(row.event_date) : "",
    details: String(row.details || ""),
    status: String(row.status || "Nueva"),
    source: String(row.source || ""),
    sourceOrigin: String(row.source_origin || ""),
    createdAt: row.created_at ? String(row.created_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  };
}

function getTegucigalpaDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Tegucigalpa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    ymd: `${map.year}-${map.month}-${map.day}`,
  };
}

function getMonthStart(parts = getTegucigalpaDateParts()) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-01`;
}

function getWeekStartYmd(parts = getTegucigalpaDateParts()) {
  const todayUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  const date = new Date(todayUtc);
  const dayOfWeek = date.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(todayUtc - mondayOffset * 24 * 60 * 60 * 1000);
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, "0");
  const d = String(monday.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function enforceRequestRateLimit(
  req: Request,
  serviceClient: ServiceRoleClient
) {
  const ip = getClientIp(req.headers);
  const userAgent = getClientUserAgent(req.headers);
  const fingerprint = `${ip}|${userAgent || "unknown"}`;
  const fingerprintHash = (await sha256Hex(fingerprint)).slice(0, 32);

  const localCheck = enforceLocalRateLimit("crm-orders", fingerprintHash, crmMaxRequests, requestWindowMs);
  if (!localCheck.allowed) {
    throw new Error("Demasiadas solicitudes. Intenta mas tarde.");
  }

  if (!serviceClient) return;
  const { data, error } = await serviceClient
    .rpc("enforce_request_rate_limit", {
      p_action: "crm-orders",
      p_fingerprint_hash: fingerprintHash,
      p_bucket: localCheck.bucket,
      p_max_requests: crmMaxRequests,
      p_window_seconds: Math.ceil(requestWindowMs / 1000),
    })
    .single();

  if (error) {
    console.warn("Rate limit RPC crm-orders no disponible:", error.message);
    return;
  }
  if (!data?.allowed) {
    throw new Error("Demasiadas solicitudes. Intenta mas tarde.");
  }
}

async function listOrders(serviceClient: ServiceRoleClient) {
  const { data, error } = await serviceClient
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    throw new Error("No se pudieron cargar pedidos.");
  }
  return (data || []).map((row) => mapOrderRow(row as OrderRow));
}

async function listQuotes(serviceClient: ServiceRoleClient) {
  const { data, error } = await serviceClient
    .from("quotes")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(6);
  if (error) {
    throw new Error("No se pudieron cargar cotizaciones.");
  }
  return (data || []).map((row) => mapQuoteRow((row || {}) as Record<string, unknown>));
}

async function fetchMetrics(serviceClient: ServiceRoleClient) {
  const today = getTegucigalpaDateParts();
  const weekStart = getWeekStartYmd(today);
  const monthStart = getMonthStart(today);

  const [dayRes, weekRes, monthRes] = await Promise.all([
    serviceClient.from("orders").select("id", { count: "exact", head: true }).eq("order_date", today.ymd),
    serviceClient.from("orders").select("id", { count: "exact", head: true }).gte("order_date", weekStart),
    serviceClient.from("orders").select("id", { count: "exact", head: true }).gte("order_date", monthStart),
  ]);

  return {
    day: Number(dayRes.count) || 0,
    week: Number(weekRes.count) || 0,
    month: Number(monthRes.count) || 0,
  };
}

async function fetchCalendarStatuses(serviceClient: ServiceRoleClient) {
  const monthStart = getMonthStart();
  const { data, error } = await serviceClient
    .from("orders")
    .select("order_date,status")
    .gte("order_date", monthStart)
    .limit(1000);
  if (error) {
    return {};
  }
  const map: Record<string, string> = {};
  for (const row of data || []) {
    const date = String((row as Record<string, unknown>)?.order_date || "").trim();
    if (!date) continue;
    const status = String((row as Record<string, unknown>)?.status || "").trim();
    const isPending = !["Entregado", "Rechazado", "Cancelado"].includes(status);
    if (isPending) {
      map[date] = "pending";
    } else if (!map[date]) {
      map[date] = "available";
    }
  }
  return map;
}

async function updateOrderStatus(
  serviceClient: ServiceRoleClient,
  orderIdRaw: unknown,
  statusRaw: unknown
) {
  const orderId = normalizeInlineText(orderIdRaw, 120);
  const status = normalizeInlineText(statusRaw, 40);
  if (!orderId) throw new Error("orderId requerido.");
  if (!allowedStatuses.has(status)) throw new Error("Estado no permitido.");

  const deliveredAt = status === "Entregado" ? new Date().toISOString() : null;
  const rejectedAt = status === "Rechazado" || status === "Cancelado" ? new Date().toISOString() : null;
  const { data, error } = await serviceClient
    .from("orders")
    .update({
      status,
      delivered_at: deliveredAt,
      rejected_at: rejectedAt,
    })
    .eq("client_order_id", orderId)
    .select("*")
    .limit(1);
  if (error) {
    throw new Error("No se pudo actualizar el estado.");
  }
  if (!data?.length) {
    throw new Error("Pedido no encontrado.");
  }
  return mapOrderRow((data[0] || {}) as OrderRow);
}

async function updateOrderNotes(
  serviceClient: ServiceRoleClient,
  orderIdRaw: unknown,
  notesRaw: unknown
) {
  const orderId = normalizeInlineText(orderIdRaw, 120);
  const notes = normalizeMultilineText(notesRaw, 800);
  if (!orderId) throw new Error("orderId requerido.");

  const nowIso = new Date().toISOString();
  const { data, error } = await serviceClient
    .from("orders")
    .update({
      notes,
      notes_updated_at: nowIso,
      updated_at: nowIso,
    })
    .eq("client_order_id", orderId)
    .select("*")
    .limit(1);
  if (error) {
    throw new Error("No se pudieron actualizar las notas.");
  }
  if (!data?.length) {
    throw new Error("Pedido no encontrado.");
  }
  return mapOrderRow((data[0] || {}) as OrderRow);
}

async function deleteOrderById(
  serviceClient: ServiceRoleClient,
  orderIdRaw: unknown
) {
  const orderId = normalizeInlineText(orderIdRaw, 120);
  if (!orderId) throw new Error("orderId requerido.");
  const { error } = await serviceClient.from("orders").delete().eq("client_order_id", orderId);
  if (error) {
    throw new Error("No se pudo eliminar el pedido.");
  }
  return true;
}

async function deleteQuoteById(
  serviceClient: ServiceRoleClient,
  quoteIdRaw: unknown
) {
  const quoteId = Number(quoteIdRaw);
  if (!Number.isFinite(quoteId) || quoteId <= 0) {
    throw new Error("quoteId invalido.");
  }
  const { error } = await serviceClient.from("quotes").delete().eq("id", quoteId);
  if (error) {
    throw new Error("No se pudo eliminar la cotizacion.");
  }
  return true;
}

async function registerNotificationToken(
  serviceClient: ServiceRoleClient,
  authUser: { id?: string; email?: string | null },
  tokenRaw: unknown,
  deviceLabelRaw: unknown
) {
  const token = normalizeNotificationToken(tokenRaw);
  const userId = normalizeInlineText(authUser?.id, 80);
  if (!userId) throw new Error("No autenticado.");
  const nowIso = new Date().toISOString();
  const payload = {
    token,
    user_id: userId,
    user_email: normalizeInlineText(authUser?.email || "", 160),
    device_label: normalizeDeviceLabel(deviceLabelRaw),
    enabled: true,
    last_seen_at: nowIso,
    updated_at: nowIso,
  };
  const { error } = await serviceClient
    .from("crm_notification_tokens")
    .upsert(payload, { onConflict: "token" });
  if (error) {
    throw new Error("No se pudo registrar token push.");
  }
  return true;
}

async function unregisterNotificationToken(
  serviceClient: ServiceRoleClient,
  authUser: { id?: string },
  tokenRaw: unknown
) {
  const token = normalizeNotificationToken(tokenRaw);
  const userId = normalizeInlineText(authUser?.id, 80);
  if (!userId) throw new Error("No autenticado.");
  const { error } = await serviceClient
    .from("crm_notification_tokens")
    .delete()
    .eq("token", token)
    .eq("user_id", userId);
  if (error) {
    throw new Error("No se pudo desactivar token push.");
  }
  return true;
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
    const authUser = await requireSupabaseUser(serviceClient, req);
    await requireCrmAccess(serviceClient, authUser.id);

    const body = (await req.json().catch(() => ({}))) as CrmBody;
    const action = normalizeInlineText(body.action, 40).toLowerCase();
    if (!action) {
      throw new Error("Accion requerida.");
    }

    if (action === "list_orders") {
      return json({ ok: true, orders: await listOrders(serviceClient) }, corsHeaders, 200);
    }
    if (action === "list_quotes") {
      return json({ ok: true, quotes: await listQuotes(serviceClient) }, corsHeaders, 200);
    }
    if (action === "fetch_metrics") {
      return json({ ok: true, metrics: await fetchMetrics(serviceClient) }, corsHeaders, 200);
    }
    if (action === "fetch_calendar") {
      return json(
        { ok: true, calendar: await fetchCalendarStatuses(serviceClient) },
        corsHeaders,
        200
      );
    }
    if (action === "update_order_status") {
      const order = await updateOrderStatus(serviceClient, body.orderId, body.status);
      return json({ ok: true, order }, corsHeaders, 200);
    }
    if (action === "update_order_notes") {
      const order = await updateOrderNotes(serviceClient, body.orderId, body.notes);
      return json({ ok: true, order }, corsHeaders, 200);
    }
    if (action === "delete_order") {
      await deleteOrderById(serviceClient, body.orderId);
      return json({ ok: true }, corsHeaders, 200);
    }
    if (action === "delete_quote") {
      await deleteQuoteById(serviceClient, body.quoteId);
      return json({ ok: true }, corsHeaders, 200);
    }
    if (action === "register_notification_token") {
      await registerNotificationToken(serviceClient, authUser, body.token, body.deviceLabel);
      return json({ ok: true }, corsHeaders, 200);
    }
    if (action === "unregister_notification_token") {
      await unregisterNotificationToken(serviceClient, authUser, body.token);
      return json({ ok: true }, corsHeaders, 200);
    }

    throw new Error("Accion no permitida.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo completar la solicitud.";
    return json({ ok: false, error: message }, corsHeaders, resolveErrorStatus(message));
  }
});
