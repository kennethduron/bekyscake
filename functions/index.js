const crypto = require("crypto");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const smtpUser = defineSecret("SMTP_USER");
const smtpPass = defineSecret("SMTP_PASS");
const orderAlertTo = defineSecret("ORDER_ALERT_TO");
const orderAlertFrom = defineSecret("ORDER_ALERT_FROM");

const siteUrl = process.env.SITE_URL || "https://bekyscake.com";
const crmUrl = process.env.CRM_URL || `${siteUrl}/crm`;
const iconUrl = `${siteUrl}/assets/bekys_icon.jpg`;
const timezone = "America/Tegucigalpa";
const rateLimitWindowMs = 10 * 60 * 1000;
const maxPublicRequestBodyBytes = 24 * 1024;
const minHumanSubmitMs = 1200;
const maxHumanSubmitMs = 3 * 60 * 60 * 1000;

const allowedOrigins = new Set([
  "https://bekyscake.com",
  "https://www.bekyscake.com",
  "https://bekyscake.web.app",
  "https://bekyscake.firebaseapp.com",
  "http://127.0.0.1:8080",
  "http://localhost:8080",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
]);

const productCatalog = Object.freeze({
  tres_leches_slice: { name: "Porciones de tres leches", price: 50, tiered: true },
  tres_leches: { name: "Pastel de tres leches", price: 580 },
  chocoflan: { name: "Pastel chocoflan", price: 700 },
  pineapple: { name: "Volteado de pina", price: 550 },
  milk_pie: { name: "Pie de leche", price: 400 },
  cheesecake: { name: "Cheesecake", price: 600 },
  cheese_flan: { name: "Flan de queso", price: 500 },
});

let transporterPromise = null;

function buildCrmOrderUrl(orderId = "") {
  if (!orderId) return crmUrl;
  try {
    const url = new URL(crmUrl);
    url.searchParams.set("order", orderId);
    return url.toString();
  } catch (error) {
    const separator = crmUrl.includes("?") ? "&" : "?";
    return `${crmUrl}${separator}order=${encodeURIComponent(orderId)}`;
  }
}

function formatHnl(value) {
  const number = Number(value) || 0;
  try {
    return new Intl.NumberFormat("es-HN", { style: "currency", currency: "HNL" }).format(number);
  } catch (error) {
    return `L ${number.toFixed(2)}`;
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeInlineText(value, max = 160) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
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
  if (digits.length < 8 || digits.length > 15) {
    throw new Error("Debes indicar un telefono valido.");
  }
  return normalized.slice(0, 24);
}

function normalizeEmail(value, { required = false } = {}) {
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

function normalizeDate(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error("La fecha indicada no es valida.");
  }
  return normalized;
}

function getRequestIp(req) {
  const forwarded = String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return forwarded || req.ip || "unknown";
}

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function getRefererOrigin(req) {
  try {
    const referer = String(req.headers.referer || "");
    return referer ? new URL(referer).origin : "";
  } catch (error) {
    return "";
  }
}

function getAllowedOrigin(req) {
  const origin = String(req.headers.origin || "").trim();
  if (allowedOrigins.has(origin)) return origin;
  const refererOrigin = getRefererOrigin(req);
  if (allowedOrigins.has(refererOrigin)) return refererOrigin;
  return "";
}

function setCorsHeaders(req, res) {
  const origin = getAllowedOrigin(req);
  if (origin) {
    res.set("Access-Control-Allow-Origin", origin);
  }
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Max-Age", "3600");
  res.set("Cache-Control", "no-store");
}

function sendJson(res, status, payload) {
  return res.status(status).json(payload);
}

function enforceRequestBodyLimit(req) {
  const contentLength = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(contentLength) && contentLength > maxPublicRequestBodyBytes) {
    throw new Error("payload-too-large");
  }
}

async function preparePublicRequest(req, res, action, maxRequests) {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return false;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Metodo no permitido." });
    return false;
  }

  if (!getAllowedOrigin(req)) {
    sendJson(res, 403, { ok: false, error: "Origen no autorizado." });
    return false;
  }

  try {
    enforceRequestBodyLimit(req);
  } catch (error) {
    sendJson(res, 413, { ok: false, error: "La solicitud es demasiado grande." });
    return false;
  }

  try {
    await enforceRateLimit(req, action, maxRequests);
  } catch (error) {
    sendJson(res, 429, { ok: false, error: "Demasiadas solicitudes. Intenta mas tarde." });
    return false;
  }

  return true;
}

async function enforceRateLimit(req, action, maxRequests) {
  const ip = getRequestIp(req);
  const bucket = Math.floor(Date.now() / rateLimitWindowMs);
  const ipHash = hashValue(ip).slice(0, 24);
  const docId = `${action}-${ipHash}-${bucket}`;
  const ref = db.collection("_rate_limits").doc(docId);

  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const current = snap.exists ? Number(snap.data()?.count) || 0 : 0;
    if (current >= maxRequests) {
      throw new Error("rate-limit");
    }
    transaction.set(
      ref,
      {
        action,
        count: current + 1,
        ipHash,
        bucket,
        updatedAt: FieldValue.serverTimestamp(),
        expireAt: Timestamp.fromMillis(Date.now() + rateLimitWindowMs * 2),
      },
      { merge: true }
    );
  });
}

function detectSpamTrap(value) {
  if (String(value || "").trim()) {
    throw new Error("Solicitud rechazada.");
  }
}

function assertHumanTiming(startedAtRaw) {
  const startedAt = Number(startedAtRaw);
  if (!Number.isFinite(startedAt) || startedAt <= 0) return;

  const elapsed = Date.now() - startedAt;
  if (elapsed < minHumanSubmitMs) {
    throw new Error("Confirmacion demasiado rapida. Intenta nuevamente.");
  }
  if (elapsed > maxHumanSubmitMs) {
    throw new Error("La sesion expiro. Recarga la pagina e intenta de nuevo.");
  }
}

function getTegucigalpaDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function getTegucigalpaTime(date = new Date()) {
  return new Intl.DateTimeFormat("es-HN", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function generatePublicId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function generateDisplayId() {
  return String(Date.now()).slice(-6);
}

function getSlicePricing(quantity) {
  const safeQuantity = Math.max(1, Number(quantity) || 1);
  if (safeQuantity > 12) {
    return {
      unitPrice: 42,
      total: 500 + (safeQuantity - 12) * 42,
      note: "Docena especial + extras a L 42.",
    };
  }
  if (safeQuantity === 12) {
    return {
      unitPrice: Number((500 / 12).toFixed(2)),
      total: 500,
      note: "Precio especial de docena aplicado.",
    };
  }
  if (safeQuantity >= 6) {
    return {
      unitPrice: 45,
      total: safeQuantity * 45,
      note: "Descuento por cantidad aplicado.",
    };
  }
  return {
    unitPrice: 50,
    total: safeQuantity * 50,
    note: "",
  };
}

function getPricingForItem(productKey, quantity) {
  const product = productCatalog[productKey];
  if (!product) {
    throw new Error("Producto no permitido.");
  }
  if (product.tiered) {
    return getSlicePricing(quantity);
  }
  return {
    unitPrice: product.price,
    total: Math.max(1, Number(quantity) || 1) * product.price,
    note: "",
  };
}

function normalizeOrderItems(items) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error("Debes agregar al menos un producto.");
  }
  if (items.length > 20) {
    throw new Error("La orden supera el limite permitido.");
  }

  return items.map((item) => {
    const productKey = normalizeInlineText(item?.productKey || "", 40);
    if (!productCatalog[productKey]) {
      throw new Error("Producto no permitido.");
    }
    const quantity = Math.max(1, Math.min(99, Number(item?.quantity) || 1));
    const pricing = getPricingForItem(productKey, quantity);
    return {
      productKey,
      name: productCatalog[productKey].name,
      quantity,
      price: pricing.unitPrice,
      itemTotal: pricing.total,
      pricingNote: pricing.note,
    };
  });
}

function normalizePaymentPayload(body = {}) {
  const paymentMethodRaw = normalizeInlineText(body.paymentMethod || "", 24).toLowerCase();
  const paymentMethod = paymentMethodRaw === "paypal" ? "paypal" : "pay_later";
  const paymentStatusRaw = normalizeInlineText(body.paymentStatus || "", 24).toLowerCase();
  const paymentStatus =
    paymentStatusRaw === "paid" || (paymentMethod === "paypal" && !paymentStatusRaw) ? "paid" : "pending";
  const paymentProviderRaw = normalizeInlineText(body.paymentProvider || "", 32).toLowerCase();
  const paymentProvider = paymentProviderRaw || (paymentMethod === "paypal" ? "paypal" : "manual");
  const paypalOrderId = normalizeInlineText(body.paypalOrderId || "", 120);
  const paypalCaptureId = normalizeInlineText(body.paypalCaptureId || "", 120);
  const paymentCurrency = normalizeInlineText(body.paymentCurrency || "", 12).toUpperCase();
  const paymentAmount = Math.max(0, Number(body.paymentAmount) || 0);
  const paidAt =
    paymentStatus === "paid" ? normalizeInlineText(body.paidAt || new Date().toISOString(), 80) : null;
  return {
    paymentMethod,
    paymentStatus,
    paymentProvider,
    paypalOrderId,
    paypalCaptureId,
    paymentCurrency,
    paymentAmount,
    paidAt,
  };
}

function normalizeOrderPayload(body = {}) {
  detectSpamTrap(body.website);
  assertHumanTiming(body.startedAt);

  const client = normalizeInlineText(body.client, 120);
  const phone = normalizePhone(body.phone, { required: true });
  const notes = normalizeMultilineText(body.notes, 800);
  const items = normalizeOrderItems(body.items);
  const total = items.reduce((sum, item) => sum + (Number(item.itemTotal) || 0), 0);
  const payment = normalizePaymentPayload(body);

  if (!client) {
    throw new Error("Debes indicar el nombre del cliente.");
  }

  return {
    client,
    phone,
    notes,
    items,
    total,
    ...payment,
  };
}

function normalizeQuotePayload(body = {}) {
  detectSpamTrap(body.website);
  assertHumanTiming(body.startedAt);

  const name = normalizeInlineText(body.name, 120);
  const email = normalizeEmail(body.email, { required: true });
  const phone = normalizePhone(body.phone, { required: false });
  const eventDate = normalizeDate(body.event_date);
  const details = normalizeMultilineText(body.details, 1500);

  if (!name) {
    throw new Error("Debes indicar tu nombre.");
  }

  if (!details) {
    throw new Error("Debes contarnos que necesitas.");
  }

  return {
    name,
    email,
    phone,
    event_date: eventDate,
    details,
    status: "Nueva",
  };
}

async function findUserEmail(identifier) {
  const trimmed = String(identifier || "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("@")) {
    return normalizeEmail(trimmed, { required: true });
  }

  const normalized = trimmed.toLowerCase().slice(0, 120);
  const directSnap = await db.collection("users").doc(normalized).get().catch(() => null);
  if (directSnap?.exists) {
    return normalizeEmail(directSnap.data()?.email || "", { required: true });
  }

  const querySnap = await db
    .collection("users")
    .where("username", "==", normalized)
    .limit(1)
    .get()
    .catch(() => null);

  if (!querySnap || querySnap.empty) return null;
  return normalizeEmail(querySnap.docs[0]?.data()?.email || "", { required: true });
}

async function sendNotification({ title, body, dataPayload = {}, link = crmUrl }) {
  const tokensSnap = await db.collection("notification_tokens").where("enabled", "==", true).limit(500).get();
  const tokens = tokensSnap.docs.map((doc) => doc.id);
  if (!tokens.length) return;

  const response = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: {
      title,
      body,
      icon: iconUrl,
    },
    webpush: {
      notification: {
        icon: iconUrl,
        badge: iconUrl,
      },
      fcmOptions: {
        link,
      },
    },
    data: {
      link,
      ...dataPayload,
    },
  });

  const invalidTokens = [];
  response.responses.forEach((result, index) => {
    if (result.success) return;
    const code = result.error?.code || "";
    if (
      code === "messaging/registration-token-not-registered" ||
      code === "messaging/invalid-registration-token"
    ) {
      invalidTokens.push(tokens[index]);
    }
  });

  if (!invalidTokens.length) return;

  const batch = db.batch();
  invalidTokens.forEach((token) => {
    batch.delete(db.collection("notification_tokens").doc(token));
  });
  await batch.commit();
}

function getMailSettings() {
  const user = smtpUser.value();
  const pass = smtpPass.value();
  const to = orderAlertTo.value();
  const from = orderAlertFrom.value() || user;
  if (!user || !pass || !to) return null;
  return { user, pass, to, from };
}

function getTransporter(settings) {
  if (!settings) return null;
  if (!transporterPromise) {
    transporterPromise = Promise.resolve(
      nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: settings.user,
          pass: settings.pass,
        },
      })
    );
  }
  return transporterPromise;
}

function formatItems(items = []) {
  if (!Array.isArray(items) || !items.length) return "Sin detalle de productos";
  return items
    .map((item) => {
      const name = item?.name || "Producto";
      const qty = Number(item?.quantity) || Number(item?.qty) || 1;
      const price = formatHnl(item?.itemTotal || item?.price);
      return `${qty} x ${name} (${price})`;
    })
    .join("\n");
}

async function sendOrderEmail(orderId, data) {
  const settings = getMailSettings();
  if (!settings) {
    console.log("Correo de orden omitido: faltan secretos SMTP_USER, SMTP_PASS o ORDER_ALERT_TO");
    return;
  }

  const transporter = await getTransporter(settings);
  const orderUrl = buildCrmOrderUrl(orderId);
  const client = data?.client || "Cliente sin nombre";
  const phone = data?.phone || "Sin telefono";
  const total = formatHnl(data?.total);
  const itemsText = formatItems(data?.items);
  const subject = `Nueva orden en Bekys Cake - ${client}`;
  const notes = data?.notes || "Sin notas adicionales";
  const createdAt = data?.createdAtLocal || data?.orderDate || "Fecha no disponible";
  const text = [
    "Acaba de caer una nueva orden en Bekys Cake.",
    "",
    `Cliente: ${client}`,
    `Telefono: ${phone}`,
    `Total: ${total}`,
    `Fecha: ${createdAt}`,
    `Orden ID: ${orderId}`,
    "",
    "Productos:",
    itemsText,
    "",
    `Notas: ${notes}`,
    "",
    `Ver pedido en CRM: ${orderUrl}`,
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#2b1d1a;">
      <h2 style="margin:0 0 16px;">Nueva orden en Bekys Cake</h2>
      <p>Acaba de caer una nueva orden y ya puedes revisarla en el CRM.</p>
      <p><strong>Cliente:</strong> ${escapeHtml(client)}</p>
      <p><strong>Telefono:</strong> ${escapeHtml(phone)}</p>
      <p><strong>Total:</strong> ${escapeHtml(total)}</p>
      <p><strong>Fecha:</strong> ${escapeHtml(createdAt)}</p>
      <p><strong>Orden ID:</strong> ${escapeHtml(orderId)}</p>
      <p><strong>Productos:</strong></p>
      <pre style="white-space:pre-wrap;background:#fff4ea;padding:12px;border-radius:12px;">${escapeHtml(itemsText)}</pre>
      <p><strong>Notas:</strong> ${escapeHtml(notes)}</p>
      <p>
        <a href="${orderUrl}" style="display:inline-block;padding:12px 18px;background:#4b2a1a;color:#fff;text-decoration:none;border-radius:999px;">
          Abrir pedido en CRM
        </a>
      </p>
      <p>Si el boton no abre, usa este enlace:<br><a href="${orderUrl}">${orderUrl}</a></p>
    </div>
  `;

  await transporter.sendMail({
    from: settings.from,
    to: settings.to,
    subject,
    text,
    html,
  });
}

exports.submitOrder = onRequest(async (req, res) => {
  if (!(await preparePublicRequest(req, res, "submit-order-disabled", 6))) return;
  sendJson(res, 410, {
    ok: false,
    error: "Endpoint deshabilitado. Usa Supabase Edge Function submit-order.",
  });
});

exports.submitQuote = onRequest(async (req, res) => {
  if (!(await preparePublicRequest(req, res, "submit-quote-disabled", 6))) return;
  sendJson(res, 410, {
    ok: false,
    error: "Endpoint deshabilitado. Usa Supabase Edge Function submit-quote.",
  });
});

exports.resolveCrmIdentity = onRequest(async (req, res) => {
  if (!(await preparePublicRequest(req, res, "resolve-crm-identity", 30))) return;

  try {
    const identifier = normalizeInlineText(req.body?.identifier, 120);
    if (!identifier) {
      sendJson(res, 200, { ok: true, email: null });
      return;
    }
    const email = await findUserEmail(identifier).catch(() => null);
    sendJson(res, 200, { ok: true, email: email || null });
  } catch (error) {
    sendJson(res, 200, { ok: true, email: null });
  }
});

exports.notifyOnOrderCreated = onDocumentCreated(
  {
    document: "orders/{orderId}",
    secrets: [smtpUser, smtpPass, orderAlertTo, orderAlertFrom],
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const title = "Nuevo pedido en Beky's Cake";
    const body = `${data.client || "Cliente"} - ${formatHnl(data.total)}`;
    const orderId = event.params.orderId || "";
    const orderUrl = buildCrmOrderUrl(orderId);

    const results = await Promise.allSettled([
      sendNotification({
        title,
        body,
        link: orderUrl,
        dataPayload: { orderId, type: "order" },
      }),
      sendOrderEmail(orderId, data),
    ]);

    results.forEach((result, index) => {
      if (result.status === "fulfilled") return;
      const label = index === 0 ? "push" : "email";
      console.error(`Fallo el envio de ${label} para la orden ${orderId}`, result.reason);
    });
  }
);

exports.notifyOnQuoteCreated = onDocumentCreated("quotes/{quoteId}", async (event) => {
  const data = event.data?.data();
  if (!data) return;

  const title = "Nueva cotizacion";
  const body = `${data.name || "Cliente"} - ${data.phone || "Sin telefono"}`;

  await sendNotification({
    title,
    body,
    dataPayload: { quoteId: event.params.quoteId || "", type: "quote" },
  });
});
