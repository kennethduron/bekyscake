const productCatalog: Record<string, { name: string; price: number; tiered?: boolean }> = {
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
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://127.0.0.1:8080",
  "http://localhost:8080",
];
const localRateLimitStore = new Map<string, { count: number; expireAt: number }>();

function normalizeOrigin(rawOrigin: string) {
  const value = String(rawOrigin || "").trim();
  if (!value) return "";
  if (value === "*") return "*";
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function isLoopbackOrigin(origin: string) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const host = String(url.hostname || "").trim().toLowerCase();
    const protocol = String(url.protocol || "").trim().toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") return false;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

function readAllowedOriginsFromEnv() {
  const single = String(Deno.env.get("PAYMENT_ALLOWED_ORIGIN") || "").trim();
  const list = String(Deno.env.get("PAYMENT_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const envCandidates = [single, ...list].filter(Boolean);
  const candidates = (envCandidates.length ? envCandidates : defaultAllowedOrigins).filter(Boolean);
  const normalized = candidates
    .map((entry) => normalizeOrigin(entry))
    .filter(Boolean);

  const unique = Array.from(new Set(normalized));
  const wildcard = unique.includes("*");
  return {
    wildcard,
    origins: unique.filter((entry) => entry !== "*"),
  };
}

function resolveCorsOrigin(requestOrigin: string) {
  const config = readAllowedOriginsFromEnv();
  const normalizedRequest = normalizeOrigin(requestOrigin);

  if (config.wildcard || (!config.origins.length && !normalizedRequest)) return "*";
  if (normalizedRequest && isLoopbackOrigin(normalizedRequest)) return normalizedRequest;
  if (config.wildcard || !config.origins.length) return normalizedRequest || "*";
  if (normalizedRequest && config.origins.includes(normalizedRequest)) return normalizedRequest;
  return config.origins[0];
}

export function getCorsHeaders(requestOrigin = ""): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": resolveCorsOrigin(requestOrigin),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
}

export function isAllowedOrigin(requestOrigin = "") {
  const config = readAllowedOriginsFromEnv();
  if (config.wildcard) return true;
  if (!config.origins.length) return true;
  const normalizedRequest = normalizeOrigin(requestOrigin);
  if (normalizedRequest && isLoopbackOrigin(normalizedRequest)) return true;
  return Boolean(normalizedRequest && config.origins.includes(normalizedRequest));
}

export function ensureRequestBodyLimit(req: Request, maxBytes = 20 * 1024) {
  const contentLength = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("La solicitud es demasiado grande.");
  }
}

export function detectSpamTrap(value: unknown) {
  if (String(value || "").trim()) {
    throw new Error("Solicitud rechazada.");
  }
}

export function assertHumanTiming(
  startedAtRaw: unknown,
  options: { minMs?: number; maxMs?: number } = {}
) {
  const normalized = Number(startedAtRaw);
  if (!Number.isFinite(normalized) || normalized <= 0) return;

  const now = Date.now();
  const elapsed = now - normalized;
  const minMs = Number.isFinite(options.minMs) ? Number(options.minMs) : 1200;
  const maxMs = Number.isFinite(options.maxMs) ? Number(options.maxMs) : 3 * 60 * 60 * 1000;

  if (elapsed < minMs) {
    throw new Error("Confirmacion demasiado rapida. Intenta nuevamente.");
  }
  if (elapsed > maxMs) {
    throw new Error("La sesion expiro. Recarga la pagina e intenta de nuevo.");
  }
}

export function getClientIp(headers: Headers) {
  const candidates = [
    headers.get("cf-connecting-ip") || "",
    headers.get("x-real-ip") || "",
    (headers.get("x-forwarded-for") || "").split(",")[0]?.trim() || "",
  ];
  return candidates.find((entry) => entry) || "unknown";
}

export function getClientUserAgent(headers: Headers) {
  return String(headers.get("user-agent") || "")
    .trim()
    .slice(0, 240);
}

export async function sha256Hex(value: string) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function enforceLocalRateLimit(
  action: string,
  fingerprintHash: string,
  maxRequests: number,
  windowMs = 10 * 60 * 1000
) {
  const now = Date.now();
  if (Math.random() < 0.02) {
    for (const [key, value] of localRateLimitStore.entries()) {
      if (value.expireAt <= now) {
        localRateLimitStore.delete(key);
      }
    }
  }

  const bucket = Math.floor(now / windowMs);
  const key = `${action}:${fingerprintHash}:${bucket}`;
  const current = localRateLimitStore.get(key);
  const count = (current?.count || 0) + 1;
  const expireAt = now + windowMs;
  localRateLimitStore.set(key, { count, expireAt });
  return {
    allowed: count <= maxRequests,
    currentCount: count,
    bucket,
  };
}

export type NormalizedOrderItem = {
  productKey: string;
  name: string;
  quantity: number;
  unitPriceHnl: number;
  totalHnl: number;
};

function getSlicePricing(quantity: number) {
  const safe = Math.max(1, Number(quantity) || 1);
  if (safe > 12) {
    return {
      unitPrice: 42,
      total: 500 + (safe - 12) * 42,
    };
  }
  if (safe === 12) {
    return {
      unitPrice: Number((500 / 12).toFixed(2)),
      total: 500,
    };
  }
  if (safe >= 6) {
    return {
      unitPrice: 45,
      total: safe * 45,
    };
  }
  return {
    unitPrice: 50,
    total: safe * 50,
  };
}

function getItemPricing(productKey: string, quantity: number) {
  const product = productCatalog[productKey];
  if (!product) {
    throw new Error("Producto no permitido.");
  }
  if (product.tiered) {
    return getSlicePricing(quantity);
  }
  const safeQuantity = Math.max(1, Number(quantity) || 1);
  return {
    unitPrice: product.price,
    total: safeQuantity * product.price,
  };
}

export function normalizeOrderItems(items: unknown): NormalizedOrderItem[] {
  if (!Array.isArray(items) || !items.length) {
    throw new Error("Debes agregar al menos un producto.");
  }
  if (items.length > 20) {
    throw new Error("La orden supera el limite permitido.");
  }

  return items.map((entry) => {
    const productKey = String((entry as { productKey?: string })?.productKey || "").trim();
    const quantity = Math.max(
      1,
      Math.min(99, Number((entry as { quantity?: number })?.quantity) || 1)
    );
    const pricing = getItemPricing(productKey, quantity);
    return {
      productKey,
      name: productCatalog[productKey].name,
      quantity,
      unitPriceHnl: pricing.unitPrice,
      totalHnl: pricing.total,
    };
  });
}

export function getOrderTotalHnl(items: NormalizedOrderItem[]) {
  return items.reduce((sum, item) => sum + (Number(item.totalHnl) || 0), 0);
}

export function getPayPalBaseUrl() {
  const env = String(Deno.env.get("PAYPAL_ENV") || "sandbox")
    .trim()
    .toLowerCase();
  return env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

export async function getPayPalAccessToken(baseUrl: string) {
  const clientId = Deno.env.get("PAYPAL_CLIENT_ID")?.trim() || "";
  const clientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET")?.trim() || "";
  if (!clientId || !clientSecret) {
    throw new Error("Faltan secretos PAYPAL_CLIENT_ID o PAYPAL_CLIENT_SECRET.");
  }
  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
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

export function normalizeChargeCurrency(rawCurrency: unknown) {
  const fromEnv = Deno.env.get("PAYPAL_CURRENCY")?.trim() || "";
  const normalized = String(rawCurrency || fromEnv || "USD").trim().toUpperCase();
  return normalized || "USD";
}

export function normalizeUsdRate() {
  const rate = Number(Deno.env.get("PAYPAL_USD_RATE") || "0.0405");
  if (!Number.isFinite(rate) || rate <= 0) return 0.0405;
  return rate;
}

function parsePositiveRate(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function extractUsdRateFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  const candidates = [
    (data.rates as Record<string, unknown> | undefined)?.USD,
    (data.conversion_rates as Record<string, unknown> | undefined)?.USD,
    (data.data as Record<string, unknown> | undefined)?.USD,
    ((data.data as Record<string, unknown> | undefined)?.rates as Record<string, unknown> | undefined)?.USD,
    data.USD,
  ];
  for (const candidate of candidates) {
    const parsed = parsePositiveRate(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function shouldUseAutoUsdRate() {
  const raw = String(Deno.env.get("PAYPAL_USD_RATE_AUTO") || "true")
    .trim()
    .toLowerCase();
  return !["0", "false", "no", "off"].includes(raw);
}

export type UsdRateResult = {
  rate: number;
  source: string;
};

export async function resolveUsdRate(currency: string): Promise<UsdRateResult> {
  if (currency === "HNL") {
    return {
      rate: 1,
      source: "currency_hnl",
    };
  }

  const fallbackRate = normalizeUsdRate();
  if (!shouldUseAutoUsdRate()) {
    return {
      rate: fallbackRate,
      source: "env_fixed",
    };
  }

  const timeoutMsRaw = Number(Deno.env.get("PAYPAL_USD_RATE_API_TIMEOUT_MS") || "5000");
  const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw >= 1000 ? Math.floor(timeoutMsRaw) : 5000;
  const apiUrl = String(Deno.env.get("PAYPAL_USD_RATE_API_URL") || "https://open.er-api.com/v6/latest/HNL").trim();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(apiUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) {
      throw new Error(`FX provider HTTP ${response.status}`);
    }
    const payload = await response.json().catch(() => ({}));
    const liveRate = extractUsdRateFromPayload(payload);
    if (!liveRate) {
      throw new Error("FX provider payload without USD rate.");
    }
    return {
      rate: liveRate,
      source: "live_api",
    };
  } catch {
    return {
      rate: fallbackRate,
      source: "env_fallback",
    };
  }
}

export function toCurrencyAmount(totalHnl: number, currency: string, usdRate: number) {
  if (currency === "HNL") {
    return Number(totalHnl.toFixed(2));
  }
  const converted = totalHnl * usdRate;
  return Number(converted.toFixed(2));
}
