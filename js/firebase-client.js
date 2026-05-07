import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported as isMessagingSupported,
  onMessage,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-messaging.js";

const apiFunctions = {
  resolveCrmIdentity: "resolve-crm-identity",
};

const backendApiUrlMeta = document.querySelector('meta[name="backend-api-url"]')?.content.trim().replace(/\/$/, "") || "";
const backendApiUrl =
  window.location.hostname.endsWith("github.io") && backendApiUrlMeta.startsWith("/") ? "" : backendApiUrlMeta;
const supabaseFunctionsUrl =
  document.querySelector('meta[name="supabase-functions-url"]')?.content.trim().replace(/\/$/, "") || "";
const supabaseAnonKey = document.querySelector('meta[name="supabase-anon-key"]')?.content.trim() || "";
const explicitSupabaseUrl = document.querySelector('meta[name="supabase-url"]')?.content.trim().replace(/\/$/, "") || "";
const derivedSupabaseUrl = supabaseFunctionsUrl
  ? supabaseFunctionsUrl.replace(/\/functions\/v1$/i, "")
  : "";
const supabaseUrl = explicitSupabaseUrl || derivedSupabaseUrl;
const firebaseConfig = {
  apiKey: "AIzaSyBqMMMVefJQPb17QD3Rka1I7iyObZnAFQM",
  authDomain: "bekyscake-add24.firebaseapp.com",
  projectId: "bekyscake-add24",
  storageBucket: "bekyscake-add24.firebasestorage.app",
  messagingSenderId: "373972343553",
  appId: "1:373972343553:web:96deb7b89318861aced900",
};
let messagingSupportPromise = null;
let messagingClientPromise = null;

function hasSupabasePublicApiConfig() {
  return Boolean(supabaseFunctionsUrl && supabaseAnonKey);
}

function hasSupabaseAuthConfig() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

const supabaseAuthClient = hasSupabaseAuthConfig()
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: "bekys_supabase_auth",
      },
    })
  : null;

function ensureSupabaseAuthClient() {
  if (!supabaseAuthClient) {
    throw new Error("Falta configurar Supabase URL + anon key en los meta tags.");
  }
  return supabaseAuthClient;
}

async function postSupabaseFunction(functionName, payload = {}, options = {}) {
  if (!hasSupabasePublicApiConfig()) {
    throw new Error("Falta configurar Supabase Functions en index.html / crm.html.");
  }

  const extraHeaders = options?.headers && typeof options.headers === "object" ? options.headers : {};
  const endpoint = `${supabaseFunctionsUrl}/${functionName}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseAnonKey,
      ...extraHeaders,
    },
    body: JSON.stringify(payload || {}),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `Supabase function failed: ${response.status}`);
  }

  return data || { ok: true };
}

async function postPublicBackendFunction(functionName, payload = {}) {
  if (!backendApiUrl) {
    return postSupabaseFunction(functionName, payload);
  }
  const response = await fetch(`${backendApiUrl}/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload || {}),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `Backend function failed: ${response.status}`);
  }

  return data || { ok: true };
}

async function getCurrentUserAccessToken() {
  try {
    const client = ensureSupabaseAuthClient();
    const { data, error } = await client.auth.getSession();
    if (error) {
      console.warn("No se pudo obtener la sesion de Supabase:", error.message || error);
      return "";
    }
    return String(data?.session?.access_token || "");
  } catch (error) {
    console.warn("No se pudo obtener token de Supabase Auth:", error);
    return "";
  }
}

async function postSupabaseCrmFunction(payload = {}) {
  const accessToken = await getCurrentUserAccessToken();
  if (!accessToken) {
    throw new Error("No autenticado.");
  }
  return postSupabaseFunction("crm-orders", payload, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

function createPollingSubscription(loader, onData, onError, intervalMs = 12000) {
  let active = true;
  let running = false;
  let timer = null;

  const tick = async () => {
    if (!active || running) return;
    running = true;
    try {
      const data = await loader();
      if (active) {
        onData?.(data);
      }
    } catch (error) {
      if (active) {
        onError?.(error);
      }
    } finally {
      running = false;
    }
  };

  tick();
  timer = window.setInterval(tick, Math.max(4000, Number(intervalMs) || 12000));

  return () => {
    active = false;
    if (timer) {
      clearInterval(timer);
    }
  };
}

function mapSupabaseAuthErrorCode(error) {
  const status = Number(error?.status || 0);
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "").toLowerCase();

  if (status === 429 || message.includes("too many") || message.includes("rate limit")) {
    return "auth/too-many-requests";
  }
  if (code.includes("network") || message.includes("network") || message.includes("fetch")) {
    return "auth/network-request-failed";
  }
  if (code.includes("invalid_email") || message.includes("invalid email")) {
    return "auth/invalid-email";
  }
  if (
    code.includes("invalid_credentials") ||
    message.includes("invalid login credentials") ||
    message.includes("invalid credentials")
  ) {
    return "auth/invalid-credential";
  }
  if (message.includes("user disabled")) {
    return "auth/user-disabled";
  }
  return "auth/unknown";
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeNotificationToken(value) {
  return String(value || "").trim();
}

function normalizeDeviceLabel(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function canUseBrowserNotifications() {
  return !getBrowserNotificationSupportIssue();
}

function isIosDevice() {
  if (typeof navigator === "undefined") return false;
  const platform = String(navigator.platform || "");
  const userAgent = String(navigator.userAgent || "");
  return /iPad|iPhone|iPod/i.test(userAgent) || (platform === "MacIntel" && Number(navigator.maxTouchPoints) > 1);
}

function isStandaloneWebApp() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return Boolean(
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.matchMedia?.("(display-mode: fullscreen)")?.matches ||
      navigator.standalone === true
  );
}

function getBrowserNotificationSupportIssue() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "unsupported";
  }
  const hostname = String(window.location?.hostname || "");
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  if (!window.isSecureContext && !isLocalhost) {
    return "insecure";
  }
  if (isIosDevice() && !isStandaloneWebApp()) {
    return "ios-install";
  }
  if (
    typeof Notification === "undefined" ||
    !("serviceWorker" in navigator) ||
    typeof PushManager === "undefined"
  ) {
    return "unsupported";
  }
  return "";
}

function getMessagingFailureReason(error, fallback = "token") {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || error || "").toLowerCase();
  const combined = `${code} ${message}`;

  if (combined.includes("permission-blocked") || combined.includes("permission denied")) {
    return "denied";
  }
  if (combined.includes("unsupported") || combined.includes("not supported")) {
    return "unsupported";
  }
  if (combined.includes("service-worker") || combined.includes("service worker")) {
    return "service-worker";
  }
  if (combined.includes("invalid-vapid") || combined.includes("vapid")) {
    return "invalid-vapid";
  }
  if (combined.includes("network") || combined.includes("fetch") || combined.includes("failed to fetch")) {
    return "network";
  }
  return fallback;
}

function getFirebaseApp() {
  if (getApps().length) {
    return getApp();
  }
  return initializeApp(firebaseConfig);
}

async function isMessagingAvailable() {
  const supportIssue = getBrowserNotificationSupportIssue();
  if (supportIssue) {
    return false;
  }
  if (!messagingSupportPromise) {
    messagingSupportPromise = isMessagingSupported().catch(() => false);
  }
  return Boolean(await messagingSupportPromise);
}

async function getMessagingClient() {
  if (!(await isMessagingAvailable())) {
    return null;
  }
  if (!messagingClientPromise) {
    messagingClientPromise = Promise.resolve(getMessaging(getFirebaseApp())).catch(() => null);
  }
  return messagingClientPromise;
}

async function getMessagingServiceWorkerRegistration() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  try {
    const current =
      (await navigator.serviceWorker.getRegistration("/")) ||
      (await navigator.serviceWorker.getRegistration());
    if (current) return current;
    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js", {
      scope: "/",
    });
    await navigator.serviceWorker.ready.catch(() => registration);
    return registration;
  } catch (error) {
    console.warn("No se pudo registrar Service Worker de Firebase Messaging:", error);
    return null;
  }
}

export async function fetchOrders() {
  try {
    const response = await postSupabaseCrmFunction({ action: "list_orders" });
    return Array.isArray(response?.orders) ? response.orders : [];
  } catch (error) {
    console.warn("Supabase ordenes:", error);
    return [];
  }
}

export async function fetchMetrics() {
  try {
    const response = await postSupabaseCrmFunction({ action: "fetch_metrics" });
    return response?.metrics || null;
  } catch (error) {
    console.warn("Supabase métricas:", error);
  }
  return null;
}

export async function fetchCalendarStatuses() {
  try {
    const response = await postSupabaseCrmFunction({ action: "fetch_calendar" });
    return response?.calendar || null;
  } catch (error) {
    console.warn("Supabase calendario:", error);
  }
  return null;
}

export async function saveOrder(payload) {
  try {
    const response = await postPublicBackendFunction("submit-order", {
      client: String(payload?.client || "").trim(),
      phone: String(payload?.phone || "").trim(),
      notes: String(payload?.notes || "").trim(),
      website: String(payload?.website || "").trim(),
      startedAt: payload?.startedAt || 0,
      items: Array.isArray(payload?.items) ? payload.items : [],
      paymentMethod: String(payload?.paymentMethod || "").trim(),
      paypalOrderId: String(payload?.paypalOrderId || "").trim(),
      paypalInternalOrderId: String(payload?.paypalInternalOrderId || payload?.internalOrderId || "").trim(),
    });
    return response?.order || null;
  } catch (error) {
    console.warn("Supabase guardar pedido:", error);
    return null;
  }
}

export async function saveQuote(payload) {
  try {
    await postPublicBackendFunction("submit-quote", {
      name: String(payload?.name || "").trim(),
      email: String(payload?.email || "").trim().toLowerCase(),
      phone: String(payload?.phone || "").trim(),
      event_date: String(payload?.event_date || "").trim(),
      details: String(payload?.details || "").trim(),
      website: String(payload?.website || "").trim(),
      startedAt: payload?.startedAt || 0,
    });
    return true;
  } catch (error) {
    console.warn("Supabase guardar cotización:", error);
    return false;
  }
}

export async function deleteQuote(quoteId) {
  try {
    await postSupabaseCrmFunction({
      action: "delete_quote",
      quoteId: String(quoteId || "").trim(),
    });
    return true;
  } catch (error) {
    console.warn("Supabase eliminar cotización:", error);
    return false;
  }
}

export async function fetchQuotes() {
  try {
    const response = await postSupabaseCrmFunction({ action: "list_quotes" });
    return Array.isArray(response?.quotes) ? response.quotes : [];
  } catch (error) {
    console.warn("Supabase cotizaciones:", error);
    return [];
  }
}

export function subscribeOrders(onData, onError) {
  return createPollingSubscription(
    async () => {
      const response = await postSupabaseCrmFunction({ action: "list_orders" });
      return Array.isArray(response?.orders) ? response.orders : [];
    },
    (orders) => onData?.(orders),
    (error) => {
      console.warn("Supabase ordenes realtime:", error);
      onError?.(error);
    },
    10000
  );
}

export function subscribeQuotes(onData, onError) {
  return createPollingSubscription(
    async () => {
      const response = await postSupabaseCrmFunction({ action: "list_quotes" });
      return Array.isArray(response?.quotes) ? response.quotes : [];
    },
    (items) => onData?.(items),
    (error) => {
      console.warn("Supabase cotizaciones realtime:", error);
      onError?.(error);
    },
    12000
  );
}

export function subscribeTrackingOrders(trackingKeys, onData, onError) {
  const keys = Array.isArray(trackingKeys)
    ? [...new Set(trackingKeys.map((key) => String(key || "").trim()).filter(Boolean))]
    : [];
  if (!keys.length) {
    onData?.([]);
    return () => {};
  }

  return createPollingSubscription(
    async () => {
      const response = await postPublicBackendFunction("customer-track-orders", { trackingKeys: keys });
      return Array.isArray(response?.items) ? response.items : [];
    },
    (items) => onData?.(items),
    (error) => {
      console.warn("Supabase tracking realtime:", error);
      onError?.(error);
    },
    12000
  );
}

export async function updateOrderStatus(orderId, status) {
  try {
    await postSupabaseCrmFunction({
      action: "update_order_status",
      orderId: String(orderId || "").trim(),
      status: String(status || "").trim(),
    });
    return true;
  } catch (error) {
    console.warn("Supabase actualizar estado:", error);
    return false;
  }
}

export async function updateOrderNotes({ orderId, trackingKey = "", notes = "", mode = "crm" } = {}) {
  try {
    if (mode === "customer") {
      await postPublicBackendFunction("customer-update-order-notes", {
        orderId: String(orderId || "").trim(),
        trackingKey: String(trackingKey || "").trim(),
        notes: String(notes || ""),
      });
      return true;
    }

    if (!orderId) return false;
    await postSupabaseCrmFunction({
      action: "update_order_notes",
      orderId: String(orderId || "").trim(),
      notes: String(notes || ""),
    });
    return true;
  } catch (error) {
    console.warn("Supabase actualizar notas:", error);
    return false;
  }
}

export async function deleteOrder(orderId) {
  try {
    await postSupabaseCrmFunction({
      action: "delete_order",
      orderId: String(orderId || "").trim(),
    });
    return true;
  } catch (error) {
    console.warn("Supabase eliminar pedido:", error);
    return false;
  }
}

export async function registerForOrderNotifications({ vapidKey, deviceLabel = "" } = {}) {
  const normalizedVapid = String(vapidKey || "").trim();
  if (!normalizedVapid || normalizedVapid.includes("REEMPLAZA_CON_TU_VAPID_KEY")) {
    return { ok: false, reason: "missing-vapid" };
  }
  const supportIssue = getBrowserNotificationSupportIssue();
  if (supportIssue) {
    return { ok: false, reason: supportIssue };
  }
  if (Notification.permission === "denied") {
    return { ok: false, reason: "denied" };
  }

  const permission = await Notification.requestPermission().catch((error) => {
    console.warn("No se pudo pedir permiso de notificaciones:", error);
    return "denied";
  });
  if (permission !== "granted") {
    return { ok: false, reason: "denied" };
  }

  const messaging = await getMessagingClient();
  if (!messaging) {
    return { ok: false, reason: "unsupported" };
  }
  const serviceWorkerRegistration = await getMessagingServiceWorkerRegistration();
  if (!serviceWorkerRegistration) {
    return { ok: false, reason: "service-worker" };
  }

  let existingSubscription = null;
  try {
    existingSubscription = await serviceWorkerRegistration.pushManager?.getSubscription?.();
  } catch (error) {
    console.warn("No se pudo revisar suscripcion push existente:", error);
  }

  let token = "";
  try {
    token = normalizeNotificationToken(await getToken(messaging, {
      vapidKey: normalizedVapid,
      serviceWorkerRegistration,
    }));
  } catch (error) {
    console.warn("No se pudo obtener token push de Firebase Messaging:", error);
    return { ok: false, reason: getMessagingFailureReason(error, "token") };
  }
  if (!token) {
    console.warn("Firebase Messaging no devolvio token.", {
      permission: Notification.permission,
      hasServiceWorkerRegistration: Boolean(serviceWorkerRegistration),
      serviceWorkerScope: serviceWorkerRegistration?.scope || "",
      hasPushSubscription: Boolean(existingSubscription),
      pushEndpoint: existingSubscription?.endpoint || "",
      platform: typeof navigator !== "undefined" ? navigator.platform || "" : "",
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent || "" : "",
      standalone: isStandaloneWebApp(),
      secureContext: typeof window !== "undefined" ? Boolean(window.isSecureContext) : false,
    });
    if (isIosDevice() && isStandaloneWebApp()) {
      return { ok: false, reason: "ios-reinstall" };
    }
    return { ok: false, reason: "token" };
  }
  try {
    await postSupabaseCrmFunction({
      action: "register_notification_token",
      token,
      deviceLabel: normalizeDeviceLabel(deviceLabel || navigator?.platform || "web"),
    });
  } catch (error) {
    console.warn("No se pudo registrar token push en CRM:", error);
    return { ok: false, reason: getMessagingFailureReason(error, "register") };
  }
  return {
    ok: true,
    token,
  };
}

export async function refreshOrderNotificationRegistration({ vapidKey, deviceLabel = "" } = {}) {
  const normalizedVapid = String(vapidKey || "").trim();
  if (!normalizedVapid || normalizedVapid.includes("REEMPLAZA_CON_TU_VAPID_KEY")) {
    return { ok: false, reason: "missing-vapid" };
  }
  const supportIssue = getBrowserNotificationSupportIssue();
  if (supportIssue) {
    return { ok: false, reason: supportIssue };
  }
  if (Notification.permission !== "granted") {
    return { ok: false, reason: Notification.permission === "denied" ? "denied" : "permission-required" };
  }

  const messaging = await getMessagingClient();
  if (!messaging) {
    return { ok: false, reason: "unsupported" };
  }
  const serviceWorkerRegistration = await getMessagingServiceWorkerRegistration();
  if (!serviceWorkerRegistration) {
    return { ok: false, reason: "service-worker" };
  }

  let token = "";
  try {
    token = normalizeNotificationToken(await getToken(messaging, {
      vapidKey: normalizedVapid,
      serviceWorkerRegistration,
    }));
  } catch (error) {
    console.warn("No se pudo refrescar token push de Firebase Messaging:", error);
    return { ok: false, reason: getMessagingFailureReason(error, "token") };
  }
  if (!token) return { ok: false, reason: "token" };

  try {
    await postSupabaseCrmFunction({
      action: "register_notification_token",
      token,
      deviceLabel: normalizeDeviceLabel(deviceLabel || navigator?.platform || "web"),
    });
  } catch (error) {
    console.warn("No se pudo refrescar token push en CRM:", error);
    return { ok: false, reason: getMessagingFailureReason(error, "register") };
  }
  return { ok: true, token };
}

export async function unregisterForOrderNotifications(token) {
  const normalizedToken = normalizeNotificationToken(token);
  if (!normalizedToken) return true;
  const messaging = await getMessagingClient();
  if (messaging) {
    await deleteToken(messaging).catch(() => {});
  }
  try {
    await postSupabaseCrmFunction({
      action: "unregister_notification_token",
      token: normalizedToken,
    });
  } catch (error) {
    console.warn("No se pudo desactivar token push en CRM:", error);
    return false;
  }
  return true;
}

export async function listenForForegroundMessages(callback) {
  const messaging = await getMessagingClient();
  if (!messaging) {
    return () => {};
  }
  return onMessage(messaging, (payload) => {
    callback?.(payload);
  });
}

export async function loginWithEmail(email, password) {
  const client = ensureSupabaseAuthClient();
  const normalizedEmail = normalizeEmail(email);
  const normalizedPassword = String(password || "");
  const { data, error } = await client.auth.signInWithPassword({
    email: normalizedEmail,
    password: normalizedPassword,
  });
  if (error) {
    const authError = new Error(error.message || "No se pudo iniciar sesión.");
    authError.code = mapSupabaseAuthErrorCode(error);
    throw authError;
  }
  return data;
}

export async function resolveUsernameToEmail(identifier) {
  const trimmed = String(identifier || "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("@")) {
    return normalizeEmail(trimmed);
  }

  try {
    const response = await postSupabaseFunction(apiFunctions.resolveCrmIdentity, {
      identifier: trimmed,
    });
    const email = normalizeEmail(response?.email);
    return email || null;
  } catch (error) {
    console.warn("Supabase resolver usuario:", error);
    return null;
  }
}

export async function logout() {
  const client = ensureSupabaseAuthClient();
  const { error } = await client.auth.signOut();
  if (error) {
    throw error;
  }
  return true;
}

export function observeAuthState(callback) {
  const client = ensureSupabaseAuthClient();
  let active = true;
  client.auth
    .getSession()
    .then(({ data }) => {
      if (active) {
        callback?.(data?.session?.user || null);
      }
    })
    .catch(() => {
      if (active) {
        callback?.(null);
      }
    });

  const {
    data: { subscription },
  } = client.auth.onAuthStateChange((_event, session) => {
    if (!active) return;
    callback?.(session?.user || null);
  });

  return () => {
    active = false;
    subscription?.unsubscribe();
  };
}
