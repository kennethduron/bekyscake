import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertHumanTiming,
  detectSpamTrap,
  enforceLocalRateLimit,
  ensureRequestBodyLimit,
  getClientIp,
  getClientUserAgent,
  getCorsHeaders,
  getOrderTotalHnl,
  isAllowedOrigin,
  normalizeOrderItems,
  sha256Hex,
} from "../_shared/paypal.ts";
import { sendCrmPushNotification } from "../_shared/push.ts";

type SubmitOrderBody = {
  client?: string;
  phone?: string;
  notes?: string;
  website?: string;
  startedAt?: number | string;
  items?: Array<{ productKey?: string; quantity?: number }>;
  paymentMethod?: string;
  paypalOrderId?: string;
  internalOrderId?: string;
  paypalInternalOrderId?: string;
};

type PayPalIntentRow = {
  id: number;
  internal_order_id: string;
  paypal_order_id: string;
  status: string;
  currency: string;
  total_hnl: number;
  total_charge: number;
  capture_id: string;
  cart: Array<Record<string, unknown>> | null;
  paypal_payload: Record<string, unknown> | null;
  submitted_order_id: string | null;
  submitted_tracking_key: string | null;
};

const requestWindowMs = 10 * 60 * 1000;
const submitOrderMaxRequests = 10;
const maxBodyBytes = 24 * 1024;

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
  if (normalized.includes("no reconocida") || normalized.includes("no encontrado")) return 404;
  if (normalized.includes("ya fue usado") || normalized.includes("ya registrado")) return 409;
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

function normalizePhone(value: unknown, { required = false } = {}) {
  const raw = String(value || "").trim();
  if (!raw) {
    if (required) throw new Error("Debes indicar un telefono valido.");
    return "";
  }
  const normalized = raw.replace(/[^\d+]/g, "");
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    throw new Error("Debes indicar un telefono valido.");
  }
  return normalized.slice(0, 24);
}

function normalizePaymentMethod(value: unknown) {
  return String(value || "").trim().toLowerCase() === "paypal" ? "paypal" : "pay_later";
}

function normalizePayPalOrderId(value: unknown) {
  const normalized = String(value || "").trim().toUpperCase();
  const validPattern = /^[A-Z0-9]{10,40}$/;
  if (!validPattern.test(normalized)) {
    throw new Error("paypalOrderId invalido.");
  }
  return normalized;
}

function normalizeInternalOrderId(value: unknown) {
  const normalized = normalizeInlineText(value, 120);
  const validPattern = /^[A-Za-z0-9_-]{8,120}$/;
  if (!validPattern.test(normalized)) {
    throw new Error("internalOrderId invalido.");
  }
  return normalized;
}

function createPublicId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function createDisplayId() {
  const seed = `${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
  return seed.slice(-6);
}

function getTegucigalpaDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Tegucigalpa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getTegucigalpaTime(date = new Date()) {
  return new Intl.DateTimeFormat("es-HN", {
    timeZone: "America/Tegucigalpa",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatHnl(value: unknown) {
  const amount = Number(value) || 0;
  return `L ${amount.toFixed(2)}`;
}

function extractPayPalPaidAt(payload: Record<string, unknown> | null) {
  const purchaseUnits = (payload?.purchase_units as Array<Record<string, unknown>> | undefined) || [];
  const firstUnit = purchaseUnits[0] || {};
  const payments = (firstUnit.payments as Record<string, unknown> | undefined) || {};
  const captures = (payments.captures as Array<Record<string, unknown>> | undefined) || [];
  const firstCapture = captures[0] || {};
  const createTime = normalizeInlineText(firstCapture.create_time, 80);
  if (!createTime) return new Date().toISOString();
  const parsed = Date.parse(createTime);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

function normalizeIntentCart(cartRaw: unknown) {
  if (!Array.isArray(cartRaw)) return [];
  return cartRaw.map((item) => ({
    productKey: normalizeInlineText((item as { productKey?: unknown })?.productKey, 60),
    quantity: Number((item as { quantity?: unknown })?.quantity) || 0,
    totalHnl: Number((item as { totalHnl?: unknown })?.totalHnl) || 0,
  }));
}

function isSameCart(items: Array<Record<string, unknown>>, intentCartRaw: unknown) {
  const normalizedItems = items.map((item) => ({
    productKey: normalizeInlineText(item.productKey, 60),
    quantity: Number(item.quantity) || 0,
    totalHnl: Number(item.totalHnl) || 0,
  }));
  const intentItems = normalizeIntentCart(intentCartRaw);
  if (normalizedItems.length !== intentItems.length) return false;
  for (let index = 0; index < normalizedItems.length; index += 1) {
    const current = normalizedItems[index];
    const expected = intentItems[index];
    if (current.productKey !== expected.productKey) return false;
    if (current.quantity !== expected.quantity) return false;
    if (Math.abs(current.totalHnl - expected.totalHnl) > 0.01) return false;
  }
  return true;
}

function mapOrderRow(row: Record<string, unknown>) {
  const createdAtLocalRaw = row.created_at_local || row.created_at;
  const createdAtLocal = createdAtLocalRaw ? String(createdAtLocalRaw) : new Date().toISOString();
  return {
    id: String(row.client_order_id || ""),
    orderId: String(row.client_order_id || ""),
    clientOrderId: String(row.client_order_id || ""),
    trackingKey: String(row.tracking_key || ""),
    displayId: String(row.display_id || ""),
    localNumber: String(row.local_number || row.display_id || ""),
    client: String(row.client || ""),
    phone: String(row.phone || ""),
    notes: String(row.notes || ""),
    customerNotesEdited: row.customer_notes_edited === true,
    customerNotesEditedAt: row.customer_notes_edited_at ? String(row.customer_notes_edited_at) : null,
    notesUpdatedAt: row.notes_updated_at ? String(row.notes_updated_at) : null,
    items: Array.isArray(row.items) ? row.items : [],
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
    createdAtLocal,
    orderDate: String(row.order_date || ""),
    deliveredAt: row.delivered_at ? String(row.delivered_at) : null,
    rejectedAt: row.rejected_at ? String(row.rejected_at) : null,
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
    "submit-order",
    fingerprintHash,
    submitOrderMaxRequests,
    requestWindowMs
  );
  if (!localCheck.allowed) {
    throw new Error("Demasiadas solicitudes. Intenta mas tarde.");
  }

  if (!serviceClient) return;
  const { data, error } = await serviceClient
    .rpc("enforce_request_rate_limit", {
      p_action: "submit-order",
      p_fingerprint_hash: fingerprintHash,
      p_bucket: localCheck.bucket,
      p_max_requests: submitOrderMaxRequests,
      p_window_seconds: Math.ceil(requestWindowMs / 1000),
    })
    .single();

  if (error) {
    console.warn("Rate limit RPC submit-order no disponible:", error.message);
    return;
  }
  if (!data?.allowed) {
    throw new Error("Demasiadas solicitudes. Intenta mas tarde.");
  }
}

async function getIntentForOrder(
  serviceClient: NonNullable<ReturnType<typeof createServiceRoleClient>>,
  paypalOrderId: string,
  internalOrderId: string
) {
  const identifier = internalOrderId || paypalOrderId;
  const column = internalOrderId ? "internal_order_id" : "paypal_order_id";
  const { data, error } = await serviceClient
    .from("paypal_order_intents")
    .select(
      "id,internal_order_id,paypal_order_id,status,currency,total_hnl,total_charge,capture_id,cart,paypal_payload,submitted_order_id,submitted_tracking_key"
    )
    .eq(column, identifier)
    .limit(1);

  if (error) {
    throw new Error("No se pudo validar la orden de PayPal.");
  }
  const row = (data?.[0] || null) as PayPalIntentRow | null;
  if (!row) {
    throw new Error("Orden PayPal no reconocida.");
  }
  if (paypalOrderId && row.paypal_order_id && row.paypal_order_id !== paypalOrderId) {
    throw new Error("Orden PayPal no coincide con el intento registrado.");
  }
  if (String(row.status || "").toLowerCase() !== "captured") {
    throw new Error("El pago PayPal aun no esta confirmado.");
  }
  if (!normalizeInlineText(row.capture_id, 120)) {
    throw new Error("No se encontro captureId valido en PayPal.");
  }
  return row;
}

async function getOrderByClientOrderId(
  serviceClient: NonNullable<ReturnType<typeof createServiceRoleClient>>,
  orderId: string
) {
  const { data, error } = await serviceClient
    .from("orders")
    .select("*")
    .eq("client_order_id", orderId)
    .limit(1);
  if (error) return null;
  return (data?.[0] || null) as Record<string, unknown> | null;
}

async function getOrderByCaptureId(
  serviceClient: NonNullable<ReturnType<typeof createServiceRoleClient>>,
  captureId: string
) {
  const { data, error } = await serviceClient
    .from("orders")
    .select("*")
    .eq("paypal_capture_id", captureId)
    .limit(1);
  if (error) return null;
  return (data?.[0] || null) as Record<string, unknown> | null;
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

    const body = (await req.json().catch(() => ({}))) as SubmitOrderBody;
    detectSpamTrap(body.website);
    assertHumanTiming(body.startedAt);

    const client = normalizeInlineText(body.client, 120);
    const phone = normalizePhone(body.phone, { required: true });
    const notes = normalizeMultilineText(body.notes, 800);
    const items = normalizeOrderItems(body.items || []);
    const totalHnl = getOrderTotalHnl(items);
    const paymentMethod = normalizePaymentMethod(body.paymentMethod);

    if (!client) {
      throw new Error("Debes indicar el nombre del cliente.");
    }

    const now = new Date();
    const orderId = createPublicId("order");
    const trackingKey = createPublicId("track");
    const displayId = createDisplayId();
    const orderDate = getTegucigalpaDate(now);
    const orderTime = getTegucigalpaTime(now);

    let paymentStatus = "pending";
    let paymentProvider = "manual";
    let paypalOrderId = "";
    let paypalCaptureId = "";
    let paypalInternalOrderId = "";
    let paymentCurrency = "";
    let paymentAmount = 0;
    let paidAt: string | null = null;
    let existingIntentOrder: Record<string, unknown> | null = null;
    let intentId: number | null = null;

    if (paymentMethod === "paypal") {
      const paypalOrderCandidate = normalizeInlineText(body.paypalOrderId, 40);
      paypalOrderId = paypalOrderCandidate ? normalizePayPalOrderId(paypalOrderCandidate) : "";
      const internalOrderCandidate = normalizeInlineText(body.paypalInternalOrderId || body.internalOrderId, 120);
      paypalInternalOrderId = internalOrderCandidate ? normalizeInternalOrderId(internalOrderCandidate) : "";
      if (!paypalOrderId && !paypalInternalOrderId) {
        throw new Error("Faltan identificadores de pago PayPal.");
      }

      const intent = await getIntentForOrder(serviceClient, paypalOrderId, paypalInternalOrderId);
      intentId = Number(intent.id) || null;
      if (intent.submitted_order_id) {
        existingIntentOrder = await getOrderByClientOrderId(serviceClient, intent.submitted_order_id);
      }
      if (existingIntentOrder) {
        return json(
          { ok: true, order: mapOrderRow(existingIntentOrder), alreadySubmitted: true },
          corsHeaders,
          200
        );
      }

      const expectedTotal = Number(intent.total_hnl) || 0;
      if (Math.abs(expectedTotal - totalHnl) > 0.01) {
        throw new Error("El carrito no coincide con el pago confirmado en PayPal.");
      }
      if (!isSameCart(items as Array<Record<string, unknown>>, intent.cart)) {
        throw new Error("El detalle del carrito no coincide con el intento capturado.");
      }

      paymentStatus = "paid";
      paymentProvider = "paypal";
      paypalOrderId = normalizePayPalOrderId(intent.paypal_order_id || paypalOrderId);
      paypalInternalOrderId = normalizeInlineText(intent.internal_order_id || paypalInternalOrderId, 120);
      paypalCaptureId = normalizeInlineText(intent.capture_id, 120);
      paymentCurrency = normalizeInlineText(intent.currency, 12).toUpperCase();
      paymentAmount = Number(intent.total_charge) || 0;
      paidAt = extractPayPalPaidAt(intent.paypal_payload || null);

      const existingByCapture = await getOrderByCaptureId(serviceClient, paypalCaptureId);
      if (existingByCapture) {
        return json(
          { ok: true, order: mapOrderRow(existingByCapture), alreadySubmitted: true },
          corsHeaders,
          200
        );
      }
    }

    const insertPayload = {
      client_order_id: orderId,
      tracking_key: trackingKey,
      display_id: displayId,
      local_number: displayId,
      client,
      phone,
      notes,
      customer_notes_edited: false,
      customer_notes_edited_at: null,
      notes_updated_at: null,
      items,
      total_hnl: totalHnl,
      payment_method: paymentMethod,
      payment_status: paymentStatus,
      payment_provider: paymentProvider,
      paypal_internal_order_id: paypalInternalOrderId || null,
      paypal_order_id: paypalOrderId || null,
      paypal_capture_id: paypalCaptureId || null,
      payment_currency: paymentCurrency || null,
      payment_amount: paymentAmount,
      paid_at: paidAt,
      status: "Pendiente",
      order_time: orderTime,
      created_at_local: now.toISOString(),
      order_date: orderDate,
      delivered_at: null,
      rejected_at: null,
      source: "web",
      source_origin: requestOrigin || "",
    };

    const { data: insertedRows, error: insertError } = await serviceClient
      .from("orders")
      .insert(insertPayload)
      .select("*")
      .limit(1);

    if (insertError) {
      if (paymentMethod === "paypal" && paypalCaptureId) {
        const duplicateOrder = await getOrderByCaptureId(serviceClient, paypalCaptureId);
        if (duplicateOrder) {
          return json(
            { ok: true, order: mapOrderRow(duplicateOrder), alreadySubmitted: true },
            corsHeaders,
            200
          );
        }
      }
      throw new Error("No se pudo registrar la orden.");
    }

    const savedOrder = (insertedRows?.[0] || null) as Record<string, unknown> | null;
    if (!savedOrder) {
      throw new Error("No se pudo registrar la orden.");
    }

    if (paymentMethod === "paypal" && intentId) {
      await serviceClient
        .from("paypal_order_intents")
        .update({
          submitted_order_id: orderId,
          submitted_tracking_key: trackingKey,
          submitted_at: now.toISOString(),
        })
        .eq("id", intentId);
    }

    const orderLink = `https://bekyscake.com/crm?order=${encodeURIComponent(orderId)}`;
    await sendCrmPushNotification({
      title: "Nuevo pedido en Beky's Cake",
      body: `${client} - ${formatHnl(totalHnl)}`,
      link: orderLink,
      dataPayload: {
        type: "order",
        orderId,
      },
    }).catch((error) => {
      console.error("Push pedido (FCM) no enviado:", error);
    });

    return json({ ok: true, order: mapOrderRow(savedOrder) }, corsHeaders, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo registrar la orden.";
    return json({ ok: false, error: message }, corsHeaders, resolveErrorStatus(message));
  }
});
