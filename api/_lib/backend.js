const crypto = require("node:crypto");

const productCatalog = {
  tres_leches_slice: { name: "Porciones de tres leches", price: 50, tiered: true },
  tres_leches: { name: "Pastel de tres leches", price: 580 },
  chocoflan: { name: "Pastel chocoflan", price: 700 },
  pineapple: { name: "Volteado de pina", price: 550 },
  milk_pie: { name: "Pie de leche", price: 400 },
  cheesecake: { name: "Cheesecake", price: 600 },
  cheese_flan: { name: "Flan de queso", price: 500 },
};

const defaultAllowedOrigins = [
  "https://bekyscake.com",
  "https://www.bekyscake.com",
  "https://bekyscake.web.app",
  "https://bekyscake.firebaseapp.com",
  "https://kennethduron.github.io",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://127.0.0.1:8080",
  "http://localhost:8080",
  "http://localhost:3000",
];

const localRateLimitStore = new Map();
let cachedGoogleAccessToken = "";
let cachedGoogleAccessTokenExp = 0;

function normalizeOrigin(rawOrigin) {
  const value = String(rawOrigin || "").trim();
  if (!value) return "";
  if (value === "*") return "*";
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function isLoopbackOrigin(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const host = String(url.hostname || "").trim().toLowerCase();
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  } catch {
    return false;
  }
}

function isVercelPreviewOrigin(origin) {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === "vercel.app" || host.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

function readAllowedOriginsFromEnv() {
  const single = String(process.env.PAYMENT_ALLOWED_ORIGIN || "").trim();
  const list = String(process.env.PAYMENT_ALLOWED_ORIGINS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const candidates = [single, ...list].filter(Boolean);
  const normalized = (candidates.length ? candidates : defaultAllowedOrigins)
    .map((entry) => normalizeOrigin(entry))
    .filter(Boolean);
  const unique = [...new Set(normalized)];
  return {
    wildcard: unique.includes("*"),
    origins: unique.filter((entry) => entry !== "*"),
  };
}

function isAllowedOrigin(origin = "") {
  if (!origin) return true;
  const config = readAllowedOriginsFromEnv();
  if (config.wildcard) return true;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (isLoopbackOrigin(normalized) || isVercelPreviewOrigin(normalized)) return true;
  return config.origins.includes(normalized);
}

function resolveCorsOrigin(origin = "") {
  const normalized = normalizeOrigin(origin);
  if (normalized && isAllowedOrigin(normalized)) return normalized;
  const config = readAllowedOriginsFromEnv();
  if (config.wildcard) return "*";
  return config.origins[0] || "*";
}

function sendJson(res, origin, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", resolveCorsOrigin(origin));
  res.setHeader("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Vary", "Origin");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function handleOptions(req, res) {
  if (req.method !== "OPTIONS") return false;
  sendJson(res, req.headers.origin || "", 200, { ok: true });
  return true;
}

async function readJsonBody(req, maxBytes = 20 * 1024) {
  const contentLength = Number(req.headers["content-length"] || "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("La solicitud es demasiado grande.");
  }
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("La solicitud es demasiado grande.");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function detectSpamTrap(value) {
  if (String(value || "").trim()) throw new Error("Solicitud rechazada.");
}

function assertHumanTiming(startedAtRaw, options = {}) {
  const normalized = Number(startedAtRaw);
  if (!Number.isFinite(normalized) || normalized <= 0) return;
  const elapsed = Date.now() - normalized;
  const minMs = Number.isFinite(options.minMs) ? Number(options.minMs) : 1200;
  const maxMs = Number.isFinite(options.maxMs) ? Number(options.maxMs) : 3 * 60 * 60 * 1000;
  if (elapsed < minMs) throw new Error("Confirmacion demasiado rapida. Intenta nuevamente.");
  if (elapsed > maxMs) throw new Error("La sesion expiro. Recarga la pagina e intenta de nuevo.");
}

function getClientIp(headers) {
  const forwarded = String(headers["x-forwarded-for"] || "").split(",")[0].trim();
  return String(headers["cf-connecting-ip"] || headers["x-real-ip"] || forwarded || "unknown").trim();
}

function getClientUserAgent(headers) {
  return String(headers["user-agent"] || "").trim().slice(0, 240);
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function enforceLocalRateLimit(action, fingerprintHash, maxRequests, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  if (Math.random() < 0.02) {
    for (const [key, value] of localRateLimitStore.entries()) {
      if (value.expireAt <= now) localRateLimitStore.delete(key);
    }
  }
  const bucket = Math.floor(now / windowMs);
  const key = `${action}:${fingerprintHash}:${bucket}`;
  const current = localRateLimitStore.get(key);
  const count = (current?.count || 0) + 1;
  localRateLimitStore.set(key, { count, expireAt: now + windowMs });
  return { allowed: count <= maxRequests, count, bucket };
}

function getSupabaseConfig() {
  const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!supabaseUrl || !serviceRole) {
    throw new Error("Falta configuracion segura de Supabase en Vercel.");
  }
  return { supabaseUrl, serviceRole };
}

async function supabaseRest(path, { method = "GET", body, prefer = "" } = {}) {
  const { supabaseUrl, serviceRole } = getSupabaseConfig();
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Supabase REST ${response.status}`);
  }
  return data;
}

function filterEq(column, value) {
  return `${encodeURIComponent(column)}=eq.${encodeURIComponent(String(value || ""))}`;
}

function filterIn(column, values) {
  const safe = values.map((value) => `"${String(value || "").replace(/"/g, '\\"')}"`).join(",");
  return `${encodeURIComponent(column)}=in.(${encodeURIComponent(safe)})`;
}

async function enforceRequestRateLimit(req, action, maxRequests, windowMs = 10 * 60 * 1000) {
  const fingerprint = `${getClientIp(req.headers)}|${getClientUserAgent(req.headers) || "unknown"}`;
  const fingerprintHash = sha256Hex(fingerprint).slice(0, 32);
  const localCheck = enforceLocalRateLimit(action, fingerprintHash, maxRequests, windowMs);
  if (!localCheck.allowed) throw new Error("Demasiadas solicitudes. Intenta mas tarde.");

  try {
    const data = await supabaseRest("rpc/enforce_request_rate_limit", {
      method: "POST",
      body: {
        p_action: action,
        p_fingerprint_hash: fingerprintHash,
        p_bucket: localCheck.bucket,
        p_max_requests: maxRequests,
        p_window_seconds: Math.ceil(windowMs / 1000),
      },
    });
    const result = Array.isArray(data) ? data[0] : data;
    if (result && result.allowed === false) {
      throw new Error("Demasiadas solicitudes. Intenta mas tarde.");
    }
  } catch (error) {
    if (String(error?.message || "").includes("Demasiadas")) throw error;
    console.warn(`Rate limit RPC ${action} no disponible:`, error?.message || error);
  }
}

function normalizeInlineText(value, max = 160) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeMultilineText(value, max = 1200) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function normalizePhone(value, { required = false } = {}) {
  const raw = String(value || "").trim();
  if (!raw) {
    if (required) throw new Error("Debes indicar un telefono valido.");
    return "";
  }
  const normalized = raw.replace(/[^\d+]/g, "");
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) throw new Error("Debes indicar un telefono valido.");
  return normalized.slice(0, 24);
}

function normalizeEmail(value, { required = false } = {}) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    if (required) throw new Error("Debes indicar un correo valido.");
    return "";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Debes indicar un correo valido.");
  }
  return normalized.slice(0, 160);
}

function normalizeDate(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error("La fecha indicada no es valida.");
  return normalized;
}

function normalizePaymentMethod(value) {
  return String(value || "").trim().toLowerCase() === "paypal" ? "paypal" : "pay_later";
}

function normalizePayPalOrderId(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{10,40}$/.test(normalized)) throw new Error("paypalOrderId invalido.");
  return normalized;
}

function normalizeInternalOrderId(value) {
  const normalized = normalizeInlineText(value, 120);
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(normalized)) throw new Error("internalOrderId invalido.");
  return normalized;
}

function getSlicePricing(quantity) {
  const safe = Math.max(1, Number(quantity) || 1);
  if (safe > 12) return { unitPrice: 42, total: 500 + (safe - 12) * 42 };
  if (safe === 12) return { unitPrice: Number((500 / 12).toFixed(2)), total: 500 };
  if (safe >= 6) return { unitPrice: 45, total: safe * 45 };
  return { unitPrice: 50, total: safe * 50 };
}

function normalizeOrderItems(items) {
  if (!Array.isArray(items) || !items.length) throw new Error("Debes agregar al menos un producto.");
  if (items.length > 20) throw new Error("La orden supera el limite permitido.");
  return items.map((entry) => {
    const productKey = String(entry?.productKey || "").trim();
    const product = productCatalog[productKey];
    if (!product) throw new Error("Producto no permitido.");
    const quantity = Math.max(1, Math.min(99, Number(entry?.quantity) || 1));
    const pricing = product.tiered
      ? getSlicePricing(quantity)
      : { unitPrice: product.price, total: quantity * product.price };
    return {
      productKey,
      name: product.name,
      quantity,
      unitPriceHnl: pricing.unitPrice,
      totalHnl: pricing.total,
    };
  });
}

function getOrderTotalHnl(items) {
  return items.reduce((sum, item) => sum + (Number(item.totalHnl) || 0), 0);
}

function getPayPalBaseUrl() {
  return String(process.env.PAYPAL_ENV || "sandbox").trim().toLowerCase() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function getPayPalAccessToken(baseUrl) {
  const clientId = String(process.env.PAYPAL_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.PAYPAL_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) throw new Error("Faltan secretos PAYPAL_CLIENT_ID o PAYPAL_CLIENT_SECRET.");
  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || "No se pudo autenticar con PayPal.");
  }
  return String(data.access_token);
}

function normalizeChargeCurrency(rawCurrency) {
  const fromEnv = String(process.env.PAYPAL_CURRENCY || "").trim();
  return String(rawCurrency || fromEnv || "USD").trim().toUpperCase() || "USD";
}

function normalizeUsdRate() {
  const rate = Number(process.env.PAYPAL_USD_RATE || "0.0405");
  return Number.isFinite(rate) && rate > 0 ? rate : 0.0405;
}

function shouldUseAutoUsdRate() {
  const raw = String(process.env.PAYPAL_USD_RATE_AUTO || "true").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(raw);
}

function extractUsdRate(payload) {
  const candidates = [
    payload?.rates?.USD,
    payload?.conversion_rates?.USD,
    payload?.data?.USD,
    payload?.data?.rates?.USD,
    payload?.USD,
  ];
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

async function resolveUsdRate(currency) {
  if (currency === "HNL") return { rate: 1, source: "currency_hnl" };
  const fallbackRate = normalizeUsdRate();
  if (!shouldUseAutoUsdRate()) return { rate: fallbackRate, source: "env_fixed" };
  const timeoutMs = Math.max(1000, Number(process.env.PAYPAL_USD_RATE_API_TIMEOUT_MS || "5000") || 5000);
  const apiUrl = String(process.env.PAYPAL_USD_RATE_API_URL || "https://open.er-api.com/v6/latest/HNL").trim();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(apiUrl, { headers: { Accept: "application/json" }, signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`FX provider HTTP ${response.status}`);
    const liveRate = extractUsdRate(await response.json().catch(() => ({})));
    if (!liveRate) throw new Error("FX provider payload without USD rate.");
    return { rate: liveRate, source: "live_api" };
  } catch {
    return { rate: fallbackRate, source: "env_fallback" };
  }
}

function toCurrencyAmount(totalHnl, currency, usdRate) {
  return Number((currency === "HNL" ? totalHnl : totalHnl * usdRate).toFixed(2));
}

function mapOrderRow(row = {}) {
  const createdAtLocal = row.created_at_local || row.created_at || new Date().toISOString();
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
    createdAtLocal: String(createdAtLocal),
    orderDate: String(row.order_date || ""),
    deliveredAt: row.delivered_at ? String(row.delivered_at) : null,
    rejectedAt: row.rejected_at ? String(row.rejected_at) : null,
  };
}

function mapTrackingRow(row = {}) {
  return {
    ...mapOrderRow(row),
    id: String(row.tracking_key || ""),
    createdAt: row.created_at ? String(row.created_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  };
}

function createPublicId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function createDisplayId() {
  return `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`.slice(-6);
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

function formatHnl(value) {
  return `L ${(Number(value) || 0).toFixed(2)}`;
}

function extractPayPalPaidAt(payload) {
  const capture = payload?.purchase_units?.[0]?.payments?.captures?.[0] || {};
  const createTime = normalizeInlineText(capture.create_time, 80);
  const parsed = Date.parse(createTime);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

function normalizeIntentCart(cartRaw) {
  if (!Array.isArray(cartRaw)) return [];
  return cartRaw.map((item) => ({
    productKey: normalizeInlineText(item?.productKey, 60),
    quantity: Number(item?.quantity) || 0,
    totalHnl: Number(item?.totalHnl) || 0,
  }));
}

function isSameCart(items, intentCartRaw) {
  const intentItems = normalizeIntentCart(intentCartRaw);
  if (items.length !== intentItems.length) return false;
  return items.every((item, index) => {
    const expected = intentItems[index];
    return (
      normalizeInlineText(item.productKey, 60) === expected.productKey &&
      Number(item.quantity) === expected.quantity &&
      Math.abs((Number(item.totalHnl) || 0) - expected.totalHnl) <= 0.01
    );
  });
}

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function loadServiceAccountConfig() {
  const raw =
    process.env.FCM_SERVICE_ACCOUNT_JSON ||
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    "";
  if (!String(raw).trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    const projectId = normalizeInlineText(parsed.project_id || parsed.projectId, 200);
    const clientEmail = normalizeInlineText(parsed.client_email || parsed.clientEmail, 300);
    const privateKey = String(parsed.private_key || parsed.privateKey || "").replace(/\\n/g, "\n").trim();
    const tokenUri = normalizeInlineText(parsed.token_uri || parsed.tokenUri || "https://oauth2.googleapis.com/token", 300);
    if (!projectId || !clientEmail || !privateKey) return null;
    return { projectId, clientEmail, privateKey, tokenUri };
  } catch (error) {
    console.error("No se pudo parsear FCM_SERVICE_ACCOUNT_JSON:", error);
    return null;
  }
}

async function getGoogleAccessToken(serviceAccount) {
  const now = Date.now();
  if (cachedGoogleAccessToken && now < cachedGoogleAccessTokenExp - 60_000) return cachedGoogleAccessToken;
  const nowSeconds = Math.floor(now / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iss: serviceAccount.clientEmail,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: serviceAccount.tokenUri,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    })
  );
  const unsigned = `${header}.${payload}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).end().sign(serviceAccount.privateKey).toString("base64url");
  const assertion = `${unsigned}.${signature}`;
  const response = await fetch(serviceAccount.tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || "Google OAuth no devolvio access_token.");
  }
  cachedGoogleAccessToken = String(data.access_token);
  cachedGoogleAccessTokenExp = now + (Number(data.expires_in) || 3600) * 1000;
  return cachedGoogleAccessToken;
}

async function fetchEnabledFcmTokens() {
  const rows = await supabaseRest("crm_notification_tokens?select=token&enabled=eq.true&limit=2000");
  const tokens = [...new Set((rows || []).map((row) => normalizeInlineText(row.token, 4000)).filter(Boolean))];
  console.log(`[push] tokens activos encontrados: ${tokens.length}`);
  return tokens;
}

function isInvalidFcmTokenError(text) {
  const upper = String(text || "").toUpperCase();
  return upper.includes("UNREGISTERED") || upper.includes("INVALID_ARGUMENT") || upper.includes("REQUESTED ENTITY WAS NOT FOUND");
}

async function removeInvalidFcmTokens(tokens) {
  for (const token of [...new Set(tokens)]) {
    try {
      await supabaseRest(`crm_notification_tokens?${filterEq("token", token)}`, { method: "DELETE" });
    } catch (error) {
      console.warn("No se pudo limpiar token FCM invalido:", error?.message || error);
    }
  }
}

async function sendCrmPushNotification({ title, body, link, dataPayload = {} }) {
  const normalizedTitle = normalizeInlineText(title, 120);
  const normalizedBody = normalizeInlineText(body, 240);
  const result = { configured: false, tokenCount: 0, sent: 0, invalid: 0, errors: [] };
  if (!normalizedTitle || !normalizedBody) {
    console.warn("[push] omitido: titulo o cuerpo vacio.");
    result.errors.push("empty-message");
    return result;
  }
  const serviceAccount = loadServiceAccountConfig();
  if (!serviceAccount) {
    console.warn("[push] omitido: configura FCM_SERVICE_ACCOUNT_JSON en Vercel.");
    result.errors.push("missing-fcm-service-account");
    return result;
  }
  result.configured = true;
  const tokens = await fetchEnabledFcmTokens();
  result.tokenCount = tokens.length;
  if (!tokens.length) {
    console.warn("[push] omitido: no hay tokens FCM activos en crm_notification_tokens.");
    result.errors.push("no-active-tokens");
    return result;
  }
  const accessToken = await getGoogleAccessToken(serviceAccount);
  const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(serviceAccount.projectId)}/messages:send`;
  const invalidTokens = [];
  const safeLink = normalizeInlineText(link || process.env.CRM_URL || "https://bekyscake.com/crm", 600);
  const icon = normalizeInlineText(process.env.FCM_ICON_URL || "https://bekyscake.com/assets/bekys_icon.png", 600);
  const tag = normalizeInlineText(dataPayload.orderId || dataPayload.quoteId || "bekys-crm-alert", 160);
  for (const token of tokens) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: normalizedTitle, body: normalizedBody },
          data: Object.fromEntries(
            Object.entries({ link: safeLink, ...dataPayload })
              .map(([key, value]) => [normalizeInlineText(key, 60), normalizeInlineText(value, 500)])
              .filter(([key, value]) => key && value)
          ),
          webpush: {
            headers: {
              TTL: "2419200",
              Urgency: "high",
            },
            notification: {
              title: normalizedTitle,
              body: normalizedBody,
              icon,
              badge: icon,
              tag,
              renotify: true,
              requireInteraction: true,
              data: { link: safeLink },
            },
            fcm_options: { link: safeLink },
          },
        },
      }),
    });
    if (response.ok) {
      console.log("[push] FCM enviado correctamente a 1 token.");
      result.sent += 1;
      continue;
    }
    const errorText = await response.text().catch(() => "");
    if (isInvalidFcmTokenError(errorText)) {
      invalidTokens.push(token);
      result.invalid += 1;
    } else {
      const message = `fcm-${response.status}`;
      result.errors.push(message);
      console.error(`Push FCM fallo (${response.status}):`, errorText.slice(0, 220));
    }
  }
  if (invalidTokens.length) await removeInvalidFcmTokens(invalidTokens);
  return result;
}

function resolveErrorStatus(message) {
  const normalized = String(message || "").toLowerCase();
  if (normalized.includes("origen no autorizado")) return 403;
  if (normalized.includes("demasiadas solicitudes")) return 429;
  if (normalized.includes("demasiado grande")) return 413;
  if (normalized.includes("no reconocida") || normalized.includes("no encontrado")) return 404;
  if (normalized.includes("ya fue usado") || normalized.includes("ya registrado") || normalized.includes("ya fue editada")) return 409;
  return 400;
}

function withPublicApi(handler, { maxBodyBytes = 20 * 1024 } = {}) {
  return async function publicApi(req, res) {
    const origin = req.headers.origin || "";
    if (handleOptions(req, res)) return;
    if (req.method !== "POST") return sendJson(res, origin, 405, { ok: false, error: "Metodo no permitido." });
    if (!isAllowedOrigin(origin)) return sendJson(res, origin, 403, { ok: false, error: "Origen no autorizado." });
    try {
      const body = await readJsonBody(req, maxBodyBytes);
      const payload = await handler({ req, body, origin });
      return sendJson(res, origin, 200, payload || { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo completar la solicitud.";
      return sendJson(res, origin, resolveErrorStatus(message), { ok: false, error: message });
    }
  };
}

module.exports = {
  assertHumanTiming,
  createDisplayId,
  createPublicId,
  detectSpamTrap,
  enforceRequestRateLimit,
  extractPayPalPaidAt,
  filterEq,
  filterIn,
  formatHnl,
  getOrderTotalHnl,
  getPayPalAccessToken,
  getPayPalBaseUrl,
  getTegucigalpaDate,
  getTegucigalpaTime,
  isSameCart,
  mapOrderRow,
  mapTrackingRow,
  normalizeChargeCurrency,
  normalizeDate,
  normalizeEmail,
  normalizeInlineText,
  normalizeInternalOrderId,
  normalizeMultilineText,
  normalizeOrderItems,
  normalizePaymentMethod,
  normalizePayPalOrderId,
  normalizePhone,
  resolveUsdRate,
  sendCrmPushNotification,
  supabaseRest,
  toCurrencyAmount,
  withPublicApi,
};
