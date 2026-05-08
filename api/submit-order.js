const {
  assertHumanTiming,
  createDisplayId,
  createPublicId,
  detectSpamTrap,
  enforceRequestRateLimit,
  extractPayPalPaidAt,
  filterEq,
  formatHnl,
  getOrderTotalHnl,
  getTegucigalpaDate,
  getTegucigalpaTime,
  isSameCart,
  mapOrderRow,
  normalizeInlineText,
  normalizeInternalOrderId,
  normalizeMultilineText,
  normalizeOrderItems,
  normalizePaymentMethod,
  normalizePayPalOrderId,
  normalizePhone,
  sendCrmPushNotification,
  supabaseRest,
  withPublicApi,
} = require("./_lib/backend");

module.exports = withPublicApi(async ({ req, body, origin }) => {
  await enforceRequestRateLimit(req, "submit-order", 10);
  detectSpamTrap(body.website);
  assertHumanTiming(body.startedAt);

  const client = normalizeInlineText(body.client, 120);
  const phone = normalizePhone(body.phone, { required: true });
  const notes = normalizeMultilineText(body.notes, 800);
  const items = normalizeOrderItems(body.items || []);
  const totalHnl = getOrderTotalHnl(items);
  const paymentMethod = normalizePaymentMethod(body.paymentMethod);
  if (!client) throw new Error("Debes indicar el nombre del cliente.");

  const now = new Date();
  const orderId = createPublicId("order");
  const trackingKey = createPublicId("track");
  const displayId = createDisplayId();
  let paymentStatus = "pending";
  let paymentProvider = "manual";
  let paypalOrderId = "";
  let paypalCaptureId = "";
  let paypalInternalOrderId = "";
  let paymentCurrency = "";
  let paymentAmount = 0;
  let paidAt = null;
  let intentId = null;

  if (paymentMethod === "paypal") {
    const paypalOrderCandidate = normalizeInlineText(body.paypalOrderId, 40);
    paypalOrderId = paypalOrderCandidate ? normalizePayPalOrderId(paypalOrderCandidate) : "";
    const internalCandidate = normalizeInlineText(body.paypalInternalOrderId || body.internalOrderId, 120);
    paypalInternalOrderId = internalCandidate ? normalizeInternalOrderId(internalCandidate) : "";
    if (!paypalOrderId && !paypalInternalOrderId) throw new Error("Faltan identificadores de pago PayPal.");

    const intentFilter = paypalInternalOrderId
      ? filterEq("internal_order_id", paypalInternalOrderId)
      : filterEq("paypal_order_id", paypalOrderId);
    const intents = await supabaseRest(
      `paypal_order_intents?select=id,internal_order_id,paypal_order_id,status,currency,total_hnl,total_charge,capture_id,cart,paypal_payload,submitted_order_id,submitted_tracking_key&${intentFilter}&limit=1`
    );
    const intent = intents?.[0] || null;
    if (!intent) throw new Error("Orden PayPal no reconocida.");
    if (paypalOrderId && intent.paypal_order_id && intent.paypal_order_id !== paypalOrderId) {
      throw new Error("Orden PayPal no coincide con el intento registrado.");
    }
    if (String(intent.status || "").toLowerCase() !== "captured") {
      throw new Error("El pago PayPal aun no esta confirmado.");
    }
    if (!normalizeInlineText(intent.capture_id, 120)) throw new Error("No se encontro captureId valido en PayPal.");

    if (intent.submitted_order_id) {
      const existing = await supabaseRest(`orders?select=*&${filterEq("client_order_id", intent.submitted_order_id)}&limit=1`);
      if (existing?.[0]) return { ok: true, order: mapOrderRow(existing[0]), alreadySubmitted: true };
    }
    if (Math.abs((Number(intent.total_hnl) || 0) - totalHnl) > 0.01) {
      throw new Error("El carrito no coincide con el pago confirmado en PayPal.");
    }
    if (!isSameCart(items, intent.cart)) {
      throw new Error("El detalle del carrito no coincide con el intento capturado.");
    }

    paypalCaptureId = normalizeInlineText(intent.capture_id, 120);
    const duplicate = await supabaseRest(`orders?select=*&${filterEq("paypal_capture_id", paypalCaptureId)}&limit=1`);
    if (duplicate?.[0]) return { ok: true, order: mapOrderRow(duplicate[0]), alreadySubmitted: true };

    intentId = intent.id;
    paymentStatus = "paid";
    paymentProvider = "paypal";
    paypalOrderId = normalizePayPalOrderId(intent.paypal_order_id || paypalOrderId);
    paypalInternalOrderId = normalizeInlineText(intent.internal_order_id || paypalInternalOrderId, 120);
    paymentCurrency = normalizeInlineText(intent.currency, 12).toUpperCase();
    paymentAmount = Number(intent.total_charge) || 0;
    paidAt = extractPayPalPaidAt(intent.paypal_payload || null);
  }

  const inserted = await supabaseRest("orders?select=*", {
    method: "POST",
    prefer: "return=representation",
    body: {
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
      order_time: getTegucigalpaTime(now),
      created_at_local: now.toISOString(),
      order_date: getTegucigalpaDate(now),
      delivered_at: null,
      rejected_at: null,
      source: "web",
      source_origin: origin || "",
    },
  });
  const savedOrder = inserted?.[0];
  if (!savedOrder) throw new Error("No se pudo registrar la orden.");

  if (paymentMethod === "paypal" && intentId) {
    await supabaseRest(`paypal_order_intents?${filterEq("id", intentId)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        submitted_order_id: orderId,
        submitted_tracking_key: trackingKey,
        submitted_at: now.toISOString(),
      },
    });
  }

  const pushResult = await sendCrmPushNotification({
    title: "Nuevo pedido en Beky's Cake",
    body: `${client} - ${formatHnl(totalHnl)}`,
    link: `${process.env.CRM_URL || "https://bekyscake.com/crm"}?order=${encodeURIComponent(orderId)}`,
    dataPayload: { type: "order", orderId },
  }).catch((error) => console.error("Push pedido (FCM) no enviado:", error));

  return { ok: true, order: mapOrderRow(savedOrder) };
}, { maxBodyBytes: 24 * 1024 });
