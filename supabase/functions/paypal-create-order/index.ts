import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertHumanTiming,
  detectSpamTrap,
  enforceLocalRateLimit,
  ensureRequestBodyLimit,
  getClientIp,
  getClientUserAgent,
  getCorsHeaders,
  isAllowedOrigin,
  getOrderTotalHnl,
  getPayPalAccessToken,
  getPayPalBaseUrl,
  normalizeChargeCurrency,
  normalizeOrderItems,
  resolveUsdRate,
  sha256Hex,
  toCurrencyAmount,
} from "../_shared/paypal.ts";

type CreateOrderBody = {
  client?: string;
  phone?: string;
  notes?: string;
  website?: string;
  startedAt?: number | string;
  items?: Array<{ productKey?: string; quantity?: number }>;
  currency?: string;
};

const requestWindowMs = 10 * 60 * 1000;
const createOrderMaxRequests = 12;
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

function createInternalOrderId() {
  return `intent-${crypto.randomUUID()}`;
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

async function enforceRequestRateLimit(
  req: Request,
  serviceClient: ReturnType<typeof createServiceRoleClient>
) {
  const ip = getClientIp(req.headers);
  const userAgent = getClientUserAgent(req.headers);
  const fingerprint = `${ip}|${userAgent || "unknown"}`;
  const fingerprintHash = (await sha256Hex(fingerprint)).slice(0, 32);

  const localCheck = enforceLocalRateLimit(
    "paypal-create-order",
    fingerprintHash,
    createOrderMaxRequests,
    requestWindowMs
  );
  if (!localCheck.allowed) {
    throw new Error("Demasiadas solicitudes. Intenta mas tarde.");
  }

  if (!serviceClient) return;
  const { data, error } = await serviceClient
    .rpc("enforce_request_rate_limit", {
      p_action: "paypal-create-order",
      p_fingerprint_hash: fingerprintHash,
      p_bucket: localCheck.bucket,
      p_max_requests: createOrderMaxRequests,
      p_window_seconds: Math.ceil(requestWindowMs / 1000),
    })
    .single();

  if (error) {
    console.warn("Rate limit RPC paypal-create-order no disponible:", error.message);
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
    await enforceRequestRateLimit(req, serviceClient);

    const body = (await req.json().catch(() => ({}))) as CreateOrderBody;
    detectSpamTrap(body.website);
    assertHumanTiming(body.startedAt);

    const items = normalizeOrderItems(body.items || []);
    const totalHnl = getOrderTotalHnl(items);
    const currency = normalizeChargeCurrency(body.currency);
    const usdRateResult = await resolveUsdRate(currency);
    const usdRate = usdRateResult.rate;
    const amountValue = toCurrencyAmount(totalHnl, currency, usdRate);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      return json({ ok: false, error: "Monto invalido." }, corsHeaders, 400);
    }

    const baseUrl = getPayPalBaseUrl();
    const accessToken = await getPayPalAccessToken(baseUrl);
    const internalOrderId = createInternalOrderId();

    const createOrderResponse = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: internalOrderId,
            custom_id: internalOrderId,
            amount: {
              currency_code: currency,
              value: amountValue.toFixed(2),
            },
          },
        ],
      }),
    });

    const createOrderData = await createOrderResponse.json().catch(() => ({}));
    if (!createOrderResponse.ok || !createOrderData?.id) {
      const detail = createOrderData?.details?.[0];
      return json(
        {
          ok: false,
          error: detail?.description || "No se pudo crear la orden en PayPal.",
          debugId: createOrderData?.debug_id || "",
        },
        corsHeaders,
        400
      );
    }

    if (serviceClient) {
      await serviceClient.from("paypal_order_intents").insert({
        internal_order_id: internalOrderId,
        paypal_order_id: createOrderData.id,
        status: "created",
        currency,
        total_hnl: totalHnl,
        total_charge: amountValue,
        cart: items,
        customer: {
          client: String(body.client || "").trim().slice(0, 120),
          phone: String(body.phone || "").trim().slice(0, 40),
          notes: String(body.notes || "").trim().slice(0, 800),
          fxUsdRate: currency === "USD" ? usdRate : null,
          fxRateSource: usdRateResult.source,
        },
        paypal_payload: createOrderData,
      });
    }

    return json(
      {
        ok: true,
        internalOrderId,
        paypalOrderId: createOrderData.id,
        currency,
        amount: amountValue,
        totalHnl,
        usdRate: currency === "USD" ? usdRate : null,
        usdRateSource: usdRateResult.source,
      },
      corsHeaders
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo iniciar el pago.";
    return json({ ok: false, error: message }, corsHeaders, resolveErrorStatus(message));
  }
});
