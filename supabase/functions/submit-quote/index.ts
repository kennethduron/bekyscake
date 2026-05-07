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
  sha256Hex,
} from "../_shared/paypal.ts";
import { sendCrmPushNotification } from "../_shared/push.ts";

type SubmitQuoteBody = {
  name?: string;
  email?: string;
  phone?: string;
  event_date?: string;
  details?: string;
  website?: string;
  startedAt?: number | string;
};

const requestWindowMs = 10 * 60 * 1000;
const submitQuoteMaxRequests = 8;
const maxBodyBytes = 20 * 1024;

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

function normalizeEmail(value: unknown, { required = false } = {}) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    if (required) throw new Error("Debes indicar un correo valido.");
    return "";
  }
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(normalized)) {
    throw new Error("Debes indicar un correo valido.");
  }
  return normalized.slice(0, 160);
}

function normalizeDate(value: unknown) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error("La fecha indicada no es valida.");
  }
  return normalized;
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
    "submit-quote",
    fingerprintHash,
    submitQuoteMaxRequests,
    requestWindowMs
  );
  if (!localCheck.allowed) {
    throw new Error("Demasiadas solicitudes. Intenta mas tarde.");
  }

  if (!serviceClient) return;
  const { data, error } = await serviceClient
    .rpc("enforce_request_rate_limit", {
      p_action: "submit-quote",
      p_fingerprint_hash: fingerprintHash,
      p_bucket: localCheck.bucket,
      p_max_requests: submitQuoteMaxRequests,
      p_window_seconds: Math.ceil(requestWindowMs / 1000),
    })
    .single();

  if (error) {
    console.warn("Rate limit RPC submit-quote no disponible:", error.message);
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

    const body = (await req.json().catch(() => ({}))) as SubmitQuoteBody;
    detectSpamTrap(body.website);
    assertHumanTiming(body.startedAt);

    const name = normalizeInlineText(body.name, 120);
    const email = normalizeEmail(body.email, { required: true });
    const phone = normalizePhone(body.phone);
    const eventDate = normalizeDate(body.event_date);
    const details = normalizeMultilineText(body.details, 1500);

    if (!name) {
      throw new Error("Debes indicar tu nombre.");
    }
    if (!details) {
      throw new Error("Debes contarnos que necesitas.");
    }

    const { data: insertedRows, error } = await serviceClient
      .from("quotes")
      .insert({
        name,
        email,
        phone,
        event_date: eventDate,
        details,
        status: "Nueva",
        source: "web",
        source_origin: requestOrigin || "",
      })
      .select("id")
      .limit(1);

    if (error) {
      throw new Error("No se pudo registrar la cotizacion.");
    }

    const quoteId = String(insertedRows?.[0]?.id || "");
    await sendCrmPushNotification({
      title: "Nueva cotizacion",
      body: `${name} - ${phone || "Sin telefono"}`,
      link: "https://bekyscake.com/crm",
      dataPayload: {
        type: "quote",
        quoteId,
      },
    }).catch((pushError) => {
      console.error("Push cotizacion (FCM) no enviado:", pushError);
    });

    return json({ ok: true }, corsHeaders, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo registrar la cotizacion.";
    return json({ ok: false, error: message }, corsHeaders, resolveErrorStatus(message));
  }
});
