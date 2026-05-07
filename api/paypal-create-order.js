const crypto = require("node:crypto");
const {
  assertHumanTiming,
  detectSpamTrap,
  enforceRequestRateLimit,
  getOrderTotalHnl,
  getPayPalAccessToken,
  getPayPalBaseUrl,
  normalizeChargeCurrency,
  normalizeOrderItems,
  resolveUsdRate,
  supabaseRest,
  toCurrencyAmount,
  withPublicApi,
} = require("./_lib/backend");

module.exports = withPublicApi(async ({ req, body }) => {
  await enforceRequestRateLimit(req, "paypal-create-order", 12);
  detectSpamTrap(body.website);
  assertHumanTiming(body.startedAt);

  const items = normalizeOrderItems(body.items || []);
  const totalHnl = getOrderTotalHnl(items);
  const currency = normalizeChargeCurrency(body.currency);
  const usdRateResult = await resolveUsdRate(currency);
  const amount = toCurrencyAmount(totalHnl, currency, usdRateResult.rate);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Monto invalido.");

  const baseUrl = getPayPalBaseUrl();
  const accessToken = await getPayPalAccessToken(baseUrl);
  const internalOrderId = `intent-${crypto.randomUUID()}`;
  const response = await fetch(`${baseUrl}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: internalOrderId,
          custom_id: internalOrderId,
          amount: {
            currency_code: currency,
            value: amount.toFixed(2),
          },
        },
      ],
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.id) {
    const detail = data?.details?.[0];
    throw new Error(detail?.description || "No se pudo crear la orden en PayPal.");
  }

  await supabaseRest("paypal_order_intents", {
    method: "POST",
    prefer: "return=minimal",
    body: {
      internal_order_id: internalOrderId,
      paypal_order_id: data.id,
      status: "created",
      currency,
      total_hnl: totalHnl,
      total_charge: amount,
      cart: items,
      customer: {
        client: String(body.client || "").trim().slice(0, 120),
        phone: String(body.phone || "").trim().slice(0, 40),
        notes: String(body.notes || "").trim().slice(0, 800),
        fxUsdRate: currency === "USD" ? usdRateResult.rate : null,
        fxRateSource: usdRateResult.source,
      },
      paypal_payload: data,
    },
  });

  return {
    ok: true,
    internalOrderId,
    paypalOrderId: data.id,
    currency,
    amount,
    totalHnl,
    usdRate: currency === "USD" ? usdRateResult.rate : null,
    usdRateSource: usdRateResult.source,
  };
}, { maxBodyBytes: 24 * 1024 });
