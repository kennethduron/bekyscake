import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type PushPayloadValue = string | number | boolean | null | undefined;
type PushPayloadMap = Record<string, PushPayloadValue>;

type SendCrmPushArgs = {
  title: string;
  body: string;
  link?: string;
  dataPayload?: PushPayloadMap;
  iconUrl?: string;
  badgeUrl?: string;
};

type TokenRow = {
  token?: string;
};

type ServiceAccountConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
};

type FcmLegacyResult = {
  error?: string;
};

type FcmLegacyResponse = {
  success?: number;
  results?: FcmLegacyResult[];
};

const defaultCrmUrl = "https://bekyscake.com/crm";
const defaultIconUrl = "https://bekyscake.com/assets/bekys_icon.png";
const maxTokensPerRequest = 1000;
const oauthScope = "https://www.googleapis.com/auth/firebase.messaging";
const oauthTokenUri = "https://oauth2.googleapis.com/token";
const textEncoder = new TextEncoder();

let cachedGoogleAccessToken = "";
let cachedGoogleAccessTokenExp = 0;

function createServiceRoleClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRole) return null;
  return createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false },
  });
}

function normalizeText(value: unknown, max = 280) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function toStringPayload(dataPayload: PushPayloadMap = {}) {
  const normalized: Record<string, string> = {};
  Object.entries(dataPayload).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    const safeKey = normalizeText(key, 60);
    if (!safeKey) return;
    const safeValue = normalizeText(value, 500);
    if (!safeValue) return;
    normalized[safeKey] = safeValue;
  });
  return normalized;
}

function chunkTokens(tokens: string[], chunkSize = maxTokensPerRequest) {
  const chunks: string[][] = [];
  for (let index = 0; index < tokens.length; index += chunkSize) {
    chunks.push(tokens.slice(index, index + chunkSize));
  }
  return chunks;
}

function toBase64Url(input: string | Uint8Array) {
  const bytes = typeof input === "string" ? textEncoder.encode(input) : input;
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToUint8Array(pem: string) {
  const cleaned = String(pem || "")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  if (!cleaned) {
    throw new Error("Private key de Firebase vacia.");
  }
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function createSignedJwt(serviceAccount: ServiceAccountConfig) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
  };
  const payload = {
    iss: serviceAccount.clientEmail,
    scope: oauthScope,
    aud: serviceAccount.tokenUri,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };

  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const keyData = pemToUint8Array(serviceAccount.privateKey);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData.buffer,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    textEncoder.encode(unsignedToken)
  );
  const encodedSignature = toBase64Url(new Uint8Array(signature));
  return `${unsignedToken}.${encodedSignature}`;
}

function loadServiceAccountConfig(): ServiceAccountConfig | null {
  const raw =
    Deno.env.get("FCM_SERVICE_ACCOUNT_JSON") ||
    Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") ||
    Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") ||
    "";
  if (!raw.trim()) return null;

  try {
    const parsed = JSON.parse(raw);
    const projectId = normalizeText(parsed?.project_id || parsed?.projectId, 200);
    const clientEmail = normalizeText(parsed?.client_email || parsed?.clientEmail, 300);
    const privateKey = String(parsed?.private_key || parsed?.privateKey || "").replace(/\\n/g, "\n").trim();
    const tokenUri = normalizeText(parsed?.token_uri || parsed?.tokenUri || oauthTokenUri, 300);
    if (!projectId || !clientEmail || !privateKey) {
      return null;
    }
    return {
      projectId,
      clientEmail,
      privateKey,
      tokenUri: tokenUri || oauthTokenUri,
    };
  } catch (error) {
    console.error("No se pudo parsear FCM_SERVICE_ACCOUNT_JSON:", error);
    return null;
  }
}

async function getGoogleAccessToken(serviceAccount: ServiceAccountConfig) {
  const now = Date.now();
  if (cachedGoogleAccessToken && now < cachedGoogleAccessTokenExp - 60_000) {
    return cachedGoogleAccessToken;
  }

  const assertion = await createSignedJwt(serviceAccount);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const response = await fetch(serviceAccount.tokenUri || oauthTokenUri, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Google OAuth error ${response.status}: ${text.slice(0, 220)}`);
  }

  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
  };
  const token = String(payload?.access_token || "").trim();
  const expiresIn = Number(payload?.expires_in) || 3600;
  if (!token) {
    throw new Error("Google OAuth no devolvio access_token.");
  }

  cachedGoogleAccessToken = token;
  cachedGoogleAccessTokenExp = now + expiresIn * 1000;
  return token;
}

function isInvalidTokenByV1Error(errorText = "") {
  const message = String(errorText || "").toUpperCase();
  return (
    message.includes("UNREGISTERED") ||
    message.includes("INVALID_ARGUMENT") ||
    message.includes("INVALID REGISTRATION TOKEN") ||
    message.includes("REQUESTED ENTITY WAS NOT FOUND")
  );
}

async function fetchEnabledTokens() {
  const client = createServiceRoleClient();
  if (!client) return [] as string[];

  const { data, error } = await client
    .from("crm_notification_tokens")
    .select("token")
    .eq("enabled", true)
    .limit(2000);

  if (error) {
    console.warn("Push omitido: no se pudieron leer tokens CRM:", error.message);
    return [] as string[];
  }

  return [...new Set((data || []).map((row) => normalizeText((row as TokenRow)?.token, 4000)).filter(Boolean))];
}

async function removeInvalidTokens(tokens: string[]) {
  if (!tokens.length) return;
  const client = createServiceRoleClient();
  if (!client) return;
  const unique = [...new Set(tokens.map((token) => normalizeText(token, 4000)).filter(Boolean))];
  if (!unique.length) return;
  const { error } = await client.from("crm_notification_tokens").delete().in("token", unique);
  if (error) {
    console.warn("No se pudieron limpiar tokens push invalidos:", error.message);
  }
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
) {
  let index = 0;
  const size = Math.max(1, Number(limit) || 1);
  const runners = Array.from({ length: Math.min(size, items.length) }).map(async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  });
  await Promise.all(runners);
}

async function sendViaHttpV1(args: {
  tokens: string[];
  title: string;
  body: string;
  link: string;
  iconUrl: string;
  badgeUrl: string;
  dataPayload: Record<string, string>;
  serviceAccount: ServiceAccountConfig;
}) {
  const invalidTokens: string[] = [];
  const accessToken = await getGoogleAccessToken(args.serviceAccount);
  const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(
    args.serviceAccount.projectId
  )}/messages:send`;

  await runWithConcurrency(args.tokens, 20, async (token) => {
    const payload = {
      message: {
        token,
        notification: {
          title: args.title,
          body: args.body,
        },
        data: {
          link: args.link,
          ...args.dataPayload,
        },
        webpush: {
          notification: {
            title: args.title,
            body: args.body,
            icon: args.iconUrl,
            badge: args.badgeUrl,
          },
          fcm_options: {
            link: args.link,
          },
        },
      },
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) return;
    const errorText = await response.text().catch(() => "");
    if (isInvalidTokenByV1Error(errorText)) {
      invalidTokens.push(token);
      return;
    }
    console.error(`Push FCM v1 fallo (${response.status}) token ${token.slice(0, 18)}...`, errorText);
  });

  return invalidTokens;
}

function isInvalidTokenError(code = "") {
  return code === "NotRegistered" || code === "InvalidRegistration";
}

async function sendLegacyFcmBatch({
  serverKey,
  tokens,
  title,
  body,
  link,
  iconUrl,
  badgeUrl,
  dataPayload,
}: {
  serverKey: string;
  tokens: string[];
  title: string;
  body: string;
  link: string;
  iconUrl: string;
  badgeUrl: string;
  dataPayload: Record<string, string>;
}) {
  const response = await fetch("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: {
      Authorization: `key=${serverKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      registration_ids: tokens,
      priority: "high",
      notification: {
        title,
        body,
        icon: iconUrl,
        badge: badgeUrl,
        click_action: link,
      },
      data: {
        link,
        ...dataPayload,
      },
      webpush: {
        fcm_options: {
          link,
        },
        notification: {
          title,
          body,
          icon: iconUrl,
          badge: badgeUrl,
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`FCM HTTP ${response.status}: ${text.slice(0, 220)}`);
  }

  const payload = (await response.json().catch(() => ({}))) as FcmLegacyResponse;
  const invalidTokens: string[] = [];
  const results = Array.isArray(payload.results) ? payload.results : [];
  results.forEach((result, index) => {
    const errorCode = normalizeText(result?.error || "", 120);
    if (!isInvalidTokenError(errorCode)) return;
    const token = normalizeText(tokens[index], 4000);
    if (token) invalidTokens.push(token);
  });

  return invalidTokens;
}

export async function sendCrmPushNotification({
  title,
  body,
  link = defaultCrmUrl,
  dataPayload = {},
  iconUrl = defaultIconUrl,
  badgeUrl = defaultIconUrl,
}: SendCrmPushArgs) {
  const normalizedTitle = normalizeText(title, 120);
  const normalizedBody = normalizeText(body, 240);
  const normalizedLink = normalizeText(link, 600) || defaultCrmUrl;
  if (!normalizedTitle || !normalizedBody) return;

  const tokens = await fetchEnabledTokens();
  if (!tokens.length) return;

  const payloadData = toStringPayload(dataPayload);
  const normalizedIcon = normalizeText(iconUrl, 600) || defaultIconUrl;
  const normalizedBadge = normalizeText(badgeUrl, 600) || defaultIconUrl;

  const serviceAccount = loadServiceAccountConfig();
  if (serviceAccount) {
    try {
      const invalidTokens = await sendViaHttpV1({
        tokens,
        title: normalizedTitle,
        body: normalizedBody,
        link: normalizedLink,
        iconUrl: normalizedIcon,
        badgeUrl: normalizedBadge,
        dataPayload: payloadData,
        serviceAccount,
      });
      if (invalidTokens.length) {
        await removeInvalidTokens(invalidTokens);
      }
      return;
    } catch (error) {
      console.error("Fallo push FCM HTTP v1:", error);
    }
  }

  const serverKey = String(
    Deno.env.get("FIREBASE_SERVER_KEY") || Deno.env.get("FCM_SERVER_KEY") || ""
  ).trim();
  if (!serverKey) {
    console.warn(
      "Push omitido: configura FCM_SERVICE_ACCOUNT_JSON (recomendado) o FIREBASE_SERVER_KEY (legacy)."
    );
    return;
  }

  const batches = chunkTokens(tokens);
  const invalidTokens: string[] = [];
  for (const batch of batches) {
    try {
      invalidTokens.push(
        ...(await sendLegacyFcmBatch({
          serverKey,
          tokens: batch,
          title: normalizedTitle,
          body: normalizedBody,
          link: normalizedLink,
          iconUrl: normalizedIcon,
          badgeUrl: normalizedBadge,
          dataPayload: payloadData,
        }))
      );
    } catch (error) {
      console.error("No se pudo enviar push FCM legacy:", error);
    }
  }
  if (invalidTokens.length) {
    await removeInvalidTokens(invalidTokens);
  }
}

