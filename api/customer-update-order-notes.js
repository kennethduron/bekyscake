const {
  enforceRequestRateLimit,
  filterEq,
  normalizeInlineText,
  normalizeMultilineText,
  supabaseRest,
  withPublicApi,
} = require("./_lib/backend");

module.exports = withPublicApi(async ({ req, body }) => {
  await enforceRequestRateLimit(req, "customer-update-order-notes", 20);
  const trackingKey = normalizeInlineText(body.trackingKey, 120);
  const orderId = normalizeInlineText(body.orderId, 120);
  const notes = normalizeMultilineText(body.notes, 800);
  if (!trackingKey) throw new Error("trackingKey requerido.");

  const extra = orderId ? `&${filterEq("client_order_id", orderId)}` : "";
  const rows = await supabaseRest(
    `orders?select=client_order_id,tracking_key,customer_notes_edited&${filterEq("tracking_key", trackingKey)}${extra}&limit=1`
  );
  const row = rows?.[0] || null;
  if (!row) throw new Error("Pedido no encontrado.");
  if (row.customer_notes_edited === true) throw new Error("La nota del pedido ya fue editada anteriormente.");

  const nowIso = new Date().toISOString();
  await supabaseRest(`orders?${filterEq("tracking_key", trackingKey)}&${filterEq("client_order_id", row.client_order_id)}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: {
      notes,
      customer_notes_edited: true,
      customer_notes_edited_at: nowIso,
      notes_updated_at: nowIso,
      updated_at: nowIso,
    },
  });
  return { ok: true };
}, { maxBodyBytes: 16 * 1024 });
