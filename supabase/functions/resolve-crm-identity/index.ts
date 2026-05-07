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

type ResolveIdentityBody = {
  identifier?: string;
};

const requestWindowMs = 10 * 60 * 1000;
const maxRequests = 60;
const maxBodyBytes = 6 * 1024;

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
  if (normalized.includes("origen no autorizado")) return 403;
  if (normalized.includes("demasiadas solicitudes")) return 429;
  if (normalized.includes("demasiado grande")) return 413;
  return 400;
}

function normalizeEmail(raw: unknown) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .slice(0, 160);
}

function normalizeIdentifier(raw: unknown) {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .slice(0, 120);
}

function normalizeUsername(raw: unknown) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 40);
}

async function enforceRequestRateLimit(req: Request, serviceClient: ServiceRoleClient) {
  const ip = getClientIp(req.headers);
  const userAgent = getClientUserAgent(req.headers);
  const fingerprint = `${ip}|${userAgent || "unknown"}`;
  const fingerprintHash = (await sha256Hex(fingerprint)).slice(0, 32);

  const localCheck = enforceLocalRateLimit(
    "resolve-crm-identity",
    fingerprintHash,
    maxRequests,
    requestWindowMs
  );
  if (!localCheck.allowed) {
    throw new Error("Demasiadas solicitudes. Intenta mas tarde.");
  }

  const { data, error } = await serviceClient
    .rpc("enforce_request_rate_limit", {
      p_action: "resolve-crm-identity",
      p_fingerprint_hash: fingerprintHash,
      p_bucket: localCheck.bucket,
      p_max_requests: maxRequests,
      p_window_seconds: Math.ceil(requestWindowMs / 1000),
    })
    .single();

  if (error) {
    console.warn("Rate limit RPC resolve-crm-identity no disponible:", error.message);
    return;
  }

  if (!data?.allowed) {
    throw new Error("Demasiadas solicitudes. Intenta mas tarde.");
  }
}

async function resolveUsernameToEmail(serviceClient: ServiceRoleClient, usernameRaw: unknown) {
  const username = normalizeUsername(usernameRaw);
  if (!username) return "";

  const { data, error } = await serviceClient
    .from("crm_users")
    .select("email")
    .eq("username", username)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("No se pudo validar el usuario.");
  }

  return normalizeEmail(data?.email);
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

    const body = (await req.json().catch(() => ({}))) as ResolveIdentityBody;
    const identifier = normalizeIdentifier(body?.identifier);
    if (!identifier) {
      throw new Error("Usuario o correo requerido.");
    }

    if (identifier.includes("@")) {
      return json({ ok: true, email: normalizeEmail(identifier) }, corsHeaders, 200);
    }

    const email = await resolveUsernameToEmail(serviceClient, identifier);
    return json({ ok: true, email: email || null }, corsHeaders, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo completar la solicitud.";
    return json({ ok: false, error: message }, corsHeaders, resolveErrorStatus(message));
  }
});
