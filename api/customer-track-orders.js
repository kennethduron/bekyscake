const {
  enforceRequestRateLimit,
  filterIn,
  mapTrackingRow,
  normalizeInlineText,
  supabaseRest,
  withPublicApi,
} = require("./_lib/backend");

module.exports = withPublicApi(async ({ req, body }) => {
  await enforceRequestRateLimit(req, "customer-track-orders", 60);
  const keys = Array.isArray(body.trackingKeys)
    ? [...new Set(body.trackingKeys.map((value) => normalizeInlineText(value, 120)).filter(Boolean))]
    : [];
  if (!keys.length) return { ok: true, items: [] };
  if (keys.length > 20) throw new Error("Se supero el limite de tracking keys.");

  const rows = await supabaseRest(`orders?select=*&${filterIn("tracking_key", keys)}&limit=50`);
  return { ok: true, items: (rows || []).map((row) => mapTrackingRow(row || {})) };
}, { maxBodyBytes: 18 * 1024 });
