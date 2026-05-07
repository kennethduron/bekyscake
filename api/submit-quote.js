const {
  assertHumanTiming,
  detectSpamTrap,
  enforceRequestRateLimit,
  normalizeDate,
  normalizeEmail,
  normalizeInlineText,
  normalizeMultilineText,
  normalizePhone,
  sendCrmPushNotification,
  supabaseRest,
  withPublicApi,
} = require("./_lib/backend");

module.exports = withPublicApi(async ({ req, body, origin }) => {
  await enforceRequestRateLimit(req, "submit-quote", 8);
  detectSpamTrap(body.website);
  assertHumanTiming(body.startedAt);

  const name = normalizeInlineText(body.name, 120);
  const email = normalizeEmail(body.email, { required: true });
  const phone = normalizePhone(body.phone);
  const eventDate = normalizeDate(body.event_date);
  const details = normalizeMultilineText(body.details, 1500);
  if (!name) throw new Error("Debes indicar tu nombre.");
  if (!details) throw new Error("Debes contarnos que necesitas.");

  const rows = await supabaseRest("quotes?select=id", {
    method: "POST",
    prefer: "return=representation",
    body: {
      name,
      email,
      phone,
      event_date: eventDate,
      details,
      status: "Nueva",
      source: "web",
      source_origin: origin || "",
    },
  });
  const quoteId = String(rows?.[0]?.id || "");

  await sendCrmPushNotification({
    title: "Nueva cotizacion",
    body: `${name} - ${phone || "Sin telefono"}`,
    link: process.env.CRM_URL || "https://bekyscake.com/crm",
    dataPayload: { type: "quote", quoteId },
  }).catch((error) => console.error("Push cotizacion (FCM) no enviado:", error));

  return { ok: true };
}, { maxBodyBytes: 20 * 1024 });
