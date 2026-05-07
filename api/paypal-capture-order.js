const {
  enforceRequestRateLimit,
  filterEq,
  getPayPalAccessToken,
  getPayPalBaseUrl,
  normalizeInlineText,
  normalizePayPalOrderId,
  supabaseRest,
  withPublicApi,
} = require("./_lib/backend");

module.exports = withPublicApi(async ({ req, body }) => {
  await enforceRequestRateLimit(req, "paypal-capture-order", 20);

  const paypalOrderId = normalizePayPalOrderId(body.paypalOrderId);
  const internalOrderId = normalizeInlineText(body.internalOrderId, 120);
  const intentFilter = internalOrderId
    ? filterEq("internal_order_id", internalOrderId)
    : filterEq("paypal_order_id", paypalOrderId);
  const intents = await supabaseRest(`paypal_order_intents?select=id,status,internal_order_id,paypal_order_id&${intentFilter}&limit=1`);
  const intent = intents?.[0] || null;
  if (!intent) throw new Error("Orden no reconocida.");
  if (String(intent.status || "").toLowerCase() === "captured") {
    return { ok: true, status: "COMPLETED", paypalOrderId, alreadyCaptured: true };
  }

  const baseUrl = getPayPalBaseUrl();
  const accessToken = await getPayPalAccessToken(baseUrl);
  const response = await fetch(`${baseUrl}/v2/checkout/orders/${paypalOrderId}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.details?.[0];
    throw new Error(detail?.description || "No se pudo capturar el pago en PayPal.");
  }

  const capture = data?.purchase_units?.[0]?.payments?.captures?.[0] || {};
  const captureId = String(capture?.id || "");
  const payerEmail = String(data?.payer?.email_address || "");
  await supabaseRest(`paypal_order_intents?${filterEq("id", intent.id)}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: {
      status: "captured",
      capture_id: captureId,
      payer_email: payerEmail,
      paypal_payload: data,
    },
  });

  return {
    ok: true,
    status: data?.status || "",
    paypalOrderId,
    captureId,
    amount: Number(capture?.amount?.value || 0),
    currency: String(capture?.amount?.currency_code || ""),
    payerEmail,
  };
}, { maxBodyBytes: 16 * 1024 });
