import { saveOrder, saveQuote, subscribeTrackingOrders, updateOrderNotes } from "./firebase-client.js";
const cartToggle = document.getElementById("cart-toggle");
const cartOverlay = document.getElementById("cart-overlay");
const cartClose = document.getElementById("cart-close");
const cartItemsList = document.getElementById("cart-items");
const cartTotalEl = document.getElementById("cart-total");
const cartCount = document.getElementById("cart-count");
const cartForm = document.getElementById("cart-checkout");
const cartMessage = document.getElementById("cart-message");
const cartNameInput = document.getElementById("cart-name");
const cartPhoneInput = document.getElementById("cart-phone");
const cartNotesInput = document.getElementById("cart-notes");
const cartToast = document.getElementById("cart-toast");
const paymentChoiceModal = document.getElementById("payment-choice-modal");
const paymentChoiceTotal = document.getElementById("payment-choice-total");
const paymentChoiceMessage = document.getElementById("payment-choice-message");
const payLaterButton = document.getElementById("pay-later-btn");
const payNowButton = document.getElementById("pay-now-btn");
const paypalCheckoutModal = document.getElementById("paypal-checkout-modal");
const paypalCheckoutTotal = document.getElementById("paypal-checkout-total");
const paypalButtonsContainer = document.getElementById("paypal-buttons");
const paypalStatusMessage = document.getElementById("paypal-status-message");
const paypalClientId = document.querySelector('meta[name="paypal-client-id"]')?.content.trim() || "";
const paypalCurrency = (
  document.querySelector('meta[name="paypal-currency"]')?.content.trim() || "USD"
).toUpperCase();
const paypalUsdRateMeta = document.querySelector('meta[name="paypal-usd-rate"]')?.content.trim() || "";
const paypalUsdRateParsed = Number(paypalUsdRateMeta);
const paypalUsdRate = Number.isFinite(paypalUsdRateParsed) && paypalUsdRateParsed > 0 ? paypalUsdRateParsed : null;
const backendApiUrlMeta = document.querySelector('meta[name="backend-api-url"]')?.content.trim().replace(/\/$/, "") || "";
const backendApiUrl =
  window.location.hostname.endsWith("github.io") && backendApiUrlMeta.startsWith("/") ? "" : backendApiUrlMeta;
const supabaseFunctionsUrl =
  document.querySelector('meta[name="supabase-functions-url"]')?.content.trim().replace(/\/$/, "") || "";
const supabaseAnonKey = document.querySelector('meta[name="supabase-anon-key"]')?.content.trim() || "";
const storageKey = "bekys_cart_orders";
const cartStateKey = "bekys_cart_state";
const cartContactKey = "bekys_cart_contact";
const quoteDraftKey = "bekys_quote_draft";
const orderDisplayKey = "bekys_order_display_seq";
const orderDisplayResetKey = "bekys_order_display_reset";
const trackedOrdersKey = "bekys_customer_tracking_orders";
const displayResetVersion = "2026-03-15-1";
const orderSuccess = document.getElementById("order-success");
const orderTrackerPrompt = document.getElementById("order-tracker-prompt");
const orderTrackerPromptAction = document.getElementById("order-tracker-prompt-action");
const orderTrackerPromptClose = document.getElementById("order-tracker-prompt-close");
const orderTrackerList = document.getElementById("order-tracker-list");
const orderTrackerSection = document.getElementById("order-status");
const tresLechesSlicePrice = document.getElementById("tres-leches-slice-price");
const customerOrderModal = document.getElementById("customer-order-modal");
const customerOrderNotesInput = document.getElementById("customer-order-notes-input");
const customerOrderNotesHelp = document.getElementById("customer-order-notes-help");
const customerOrderNotesBadge = document.getElementById("customer-order-notes-badge");
const customerOrderNotesReset = document.getElementById("customer-order-notes-reset");
const customerOrderNotesSave = document.getElementById("customer-order-notes-save");
const customerOrderNotesMessage = document.getElementById("customer-order-notes-message");
const tieredSliceProductKey = "tres_leches_slice";
let orderSubmitting = false;
let trackedOrderRefs = [];
let trackedOrders = [];
let unsubscribeTrackedOrders = null;
let openTrackedOrderKey = "";
let orderSuccessTimeoutId;
let orderSuccessHideTimeoutId;
let orderTrackerPromptHideTimeoutId;
let trackerHighlightTimeoutId;
let pendingTrackerPromptOrder = null;
let customerNotesSaving = false;
let customerNotesOriginalValue = "";
let checkoutDraft = null;
let checkoutSubmitButton = null;
let paypalSdkPromise = null;
let paypalButtonsRendered = false;
let paypalCheckoutBusy = false;
let cartInteractionStartedAt = 0;

function markCartInteractionStarted() {
  if (!cartInteractionStartedAt) {
    cartInteractionStartedAt = Date.now();
  }
  return cartInteractionStartedAt;
}

function getOrderTimeValue(order) {
  if (order?.createdAtLocal) {
    const time = Date.parse(order.createdAtLocal);
    if (!Number.isNaN(time)) return time;
  }
  if (order?.orderDate) {
    const time = Date.parse(order.orderDate);
    if (!Number.isNaN(time)) return time;
  }
  return 0;
}

function resetDisplaySequenceIfNeeded() {
  if (localStorage.getItem(orderDisplayResetKey) === displayResetVersion) return;
  let orders = [];
  try {
    orders = JSON.parse(localStorage.getItem(storageKey) || "[]");
  } catch {
    orders = [];
  }
  if (orders.length) {
    const ordered = [...orders].sort((a, b) => getOrderTimeValue(a) - getOrderTimeValue(b));
    ordered.forEach((order, index) => {
      const displayId = String(index).padStart(2, "0");
      order.displayId = displayId;
      order.localNumber = displayId;
      order.localIndex = index;
    });
    localStorage.setItem(storageKey, JSON.stringify(orders));
    localStorage.setItem(orderDisplayKey, String(orders.length));
  } else {
    localStorage.setItem(orderDisplayKey, "0");
  }
  localStorage.setItem(orderDisplayResetKey, displayResetVersion);
}

const i18n = {
  es: {
    nav_menu: "Nuestra carta",
    nav_orders: "Pedidos",
    nav_process: "Proceso",
    nav_experience: "Experiencia",
    nav_quote: "Solicitar cotización",
    hero_eyebrow: "Beky's Cake",
    hero_title: "Beky's Cake",
    hero_subtitle:
      "Beky's Cake es una pastelería en El Progreso, Yoro, Honduras, especializada en pasteles personalizados, porciones y pedidos para cumpleaños, bodas, eventos y regalos especiales. También nos encuentras como Bekys Cake.",
    hero_cta_primary: "Nuesta Carta",
    hero_cta_secondary: "Solicitar cotización",
    hero_stat_1: "eventos personalizados",
    hero_stat_2: "mesas de sabores disponibles",
    hero_stat_3: "ingredientes frescos y locales",
    local_eyebrow: "Pastelería en El Progreso",
    local_title: "Pasteles personalizados y repostería para eventos",
    local_subtitle:
      "Si buscas pastelerías en El Progreso, Beky's Cake prepara pasteles, porciones y postres para cumpleaños, bodas, eventos corporativos y regalos especiales en El Progreso, Yoro.",
    local_1_title: "Pastelería en El Progreso, Yoro",
    local_1_body: "Pasteles profesionales con diseño a medida y sabores tradicionales para toda ocasión.",
    local_2_title: "Pasteles personalizados para eventos",
    local_2_body: "Opciones para cumpleaños, bodas, aniversarios y eventos empresariales en El Progreso.",
    local_3_title: "Porciones y postres para mesas dulces",
    local_3_body: "Porciones listas para mesas corporativas, celebraciones y regalos con entrega coordinada.",
    menu_eyebrow: "Delicias firmadas",
    menu_title: "Especialidades de la casa Beky's Cake",
    menu_subtitle:
      "Pasteles y porciones de Beky's Cake que puedes personalizar por sabor, textura y decoración.",
    add_to_cart: "Agregar al carrito",
    product_tres_leches_title: "Pastel de tres leches",
    product_tres_leches_desc: "Bizcocho esponjoso, tres leches cremosas y decoración elegante.",
    product_chocoflan_title: "Pastel chocoflan",
    product_chocoflan_desc: "Capas de chocolate intenso con flan suave al caramelo.",
    product_pineapple_title: "Volteado de piña",
    product_pineapple_desc: "Piña caramelizada y especias equilibradas sobre base dorada.",
    product_milk_pie_title: "Pie de leche",
    product_milk_pie_desc: "Extrema suavidad, cobertura brillante y base crujiente.",
    product_tres_leches_slice_title: "Porciones de tres leches",
    product_tres_leches_slice_desc: "Presentación premium lista para mesas corporativas o detallitos.",
    product_tres_leches_slice_offer: "6 a 11 porciones: L 45 c/u · 12 porciones: L 500 · extras a L 42.",
    product_cheesecake_title: "Cheesecake",
    product_cheesecake_desc: "Textura aterciopelada con base especiada y coulis vibrante.",
    product_cheese_flan_title: "Flan de queso",
    product_cheese_flan_desc: "Equilibrio perfecto de queso crema con caramelo delicado.",
    process_eyebrow: "Nuestro método",
    process_title: "Transparencia en cada paso",
    process_subtitle:
      "Desde la solicitud hasta la entrega, coordinamos tiempos, temperatura y empaques para que el pastel llegue impecable.",
    process_1_title: "Consultoría personalizada",
    process_1_body: "Una llamada o nota por WhatsApp para afinar sabores, cantidades y decoraciones.",
    process_2_title: "Producción consciente",
    process_2_body: "Ingredientes locales supervisados diariamente y procesos documentados.",
    process_3_title: "Empaque seguro",
    process_3_body: "Protegemos tu pastel con empaque refrigerado y etiquetas claras.",
    process_4_title: "Entrega coordinada",
    process_4_body: "Confirmamos ruta, hora y coordinamos con tu equipo para evitar contratiempos.",
    exp_eyebrow: "Experiencia Beky's",
    exp_title: "Servicios Beky's Cake para bodas, empresas y snacks",
    exp_subtitle:
      "En Beky's Cake diseñamos momentos dulces. Puedes escoger un paquete corporativo, sorprender en tu boda o llevar el sabor a eventos sociales.",
    exp_1_title: "Eventos corporativos",
    exp_1_body: "Porciones individuales, branding en top, entrega puntual y facturación clara.",
    exp_2_title: "Bodas y celebraciones",
    exp_2_body: "Luces, sabores y múltiples alturas. Probamos muestras y acompañamos con florería amiga.",
    exp_3_title: "Pedidos express",
    exp_3_body: "Porciones listas para oficinas, cafés y tiendas; despacho coordinado el mismo día.",
    search_eyebrow: "Beky's Cake en Google",
    search_title: "Una opción local cuando buscan pastelerías en El Progreso",
    search_subtitle:
      "Mantuvimos a Beky's Cake como la marca principal y reforzamos que también sea relevante para quienes buscan una pastelería en El Progreso, pasteles personalizados o porciones para eventos.",
    search_1_title: "Beky's Cake y Bekys Cake",
    search_1_body:
      "La página prioriza el nombre Beky's Cake como marca principal y también refuerza la variante Bekys Cake para búsquedas sin apóstrofe.",
    search_2_title: "Pastelería en El Progreso",
    search_2_body:
      "El contenido deja claro que Beky's Cake es una pastelería en El Progreso, Yoro, Honduras, con pedidos para distintas celebraciones.",
    search_3_title: "Pasteles personalizados y eventos",
    search_3_body:
      "También reforzamos búsquedas relacionadas con pasteles personalizados, cumpleaños, bodas, eventos corporativos y postres por encargo.",
    faq_eyebrow: "Preguntas frecuentes",
    faq_title: "Beky's Cake y las búsquedas de pastelerías en El Progreso",
    faq_subtitle:
      "Estas respuestas ayudan a explicar mejor qué ofrece la pastelería y cómo hacer un pedido en El Progreso.",
    faq_1_title: "¿Beky's Cake es una pastelería en El Progreso?",
    faq_1_body:
      "Sí. Beky's Cake es una pastelería ubicada en El Progreso, Yoro, Honduras, con pasteles, porciones y pedidos personalizados para distintas celebraciones.",
    faq_2_title: "¿Hacen pasteles personalizados en El Progreso?",
    faq_2_body:
      "Sí. Preparamos pasteles para cumpleaños, bodas, aniversarios, celebraciones familiares y eventos empresariales.",
    faq_3_title: "¿Cómo puedo pedir en Beky's Cake?",
    faq_3_body:
      "Puedes usar el formulario de cotización del sitio y también contactarnos para coordinar sabores, cantidades, decoración y fecha de entrega.",
    faq_4_title: "¿También aparece como Bekys Cake sin apóstrofe?",
    faq_4_body:
      "Sí. Beky's Cake también se refuerza como Bekys Cake para que sea más fácil encontrar la pastelería aunque la persona escriba el nombre sin apóstrofe.",
    cta_eyebrow: "Listos para encargar",
    cta_title: "¿Listos para endulzar tu día?",
    cta_body: "Cuéntanos qué imaginas y te compartimos opciones, presupuestos y disponibilidad inmediata.",
    cta_primary: "Enviar solicitud",
    cta_secondary: "Panel CRM del representante",
    contact_title_1: "Contacto directo Beky's Cake",
    contact_body_1_extra:
      "Si buscas una pastelería en El Progreso para cumpleaños, bodas o eventos, escríbenos y con gusto te cotizamos.",
    contact_title_2: "Estamos en",
    contact_body_2: "El Progreso, Yoro, Honduras.",
    contact_title_3: "Horario",
    contact_body_3: "Lunes a sábado · 8:00 a 19:00 (cierre de pedidos 16:00).",
    quote_eyebrow: "Cotiza tu pastel",
    quote_title: "Cuéntanos qué necesitas",
    quote_subtitle: "Déjanos tus detalles, nos comunicamos contigo con opciones y tiempos disponibles.",
    quote_name_label: "Nombre completo",
    quote_name_ph: "Ana López",
    quote_email_label: "Correo electrónico",
    quote_email_ph: "contacto@empresa.com",
    quote_phone_label: "Teléfono",
    quote_phone_ph: "+504 1234 5678",
    quote_date_label: "Fecha estimada de entrega",
    quote_details_label: "¿Qué deseas?",
    quote_details_ph: "Cuéntanos sabores, números de invitados, etc.",
    quote_submit: "Solicitar cotización",
    cart_title: "Tu carrito de Beky's Cake",
    cart_subtitle: "Añade tus preferencias y confirma con tu nombre y teléfono.",
    cart_total: "Total",
    cart_name_label: "Nombre completo",
    cart_name_ph: "Ana López",
    cart_phone_label: "Teléfono",
    cart_phone_ph: "+504 1234 5678",
    cart_notes_label: "Comentario adicional",
    cart_notes_ph: "Indícanos dedicatoria, alergias, referencia de entrega o cualquier detalle importante.",
    cart_submit: "Confirmar pedido",
    payment_choice_eyebrow: "Pago",
    payment_choice_title: "¿Cómo quieres pagar?",
    payment_choice_subtitle: "Elige pagar ahora con PayPal o enviar tu pedido y pagar luego.",
    payment_choice_total: "Total de tu pedido",
    payment_choice_later: "Pagar luego",
    payment_choice_now: "Pagar con PayPal",
    payment_secure_note:
      "El pago se procesa en PayPal. Tu pedido solo queda pagado cuando PayPal confirma el cobro.",
    payment_choice_config_missing:
      "Falta configurar PayPal/Supabase. Puedes enviar el pedido con opción Pagar luego.",
    payment_paypal_eyebrow: "Pago seguro",
    payment_paypal_title: "Pagar con PayPal",
    payment_paypal_subtitle:
      "Al continuar se abrirá la ventana segura de PayPal para pagar con tu cuenta o tarjeta.",
    payment_paypal_secure_note:
      "PayPal abrirá su checkout seguro. No compartimos tus datos de tarjeta con Beky's Cake.",
    payment_usd_pending: "El equivalente en USD se calculará al abrir PayPal.",
    payment_paypal_loading: "Cargando PayPal…",
    payment_paypal_processing: "Procesando pago…",
    payment_paypal_cancelled: "Pago cancelado. Tu pedido no fue cobrado.",
    payment_paypal_error: "No se pudo procesar el pago. Intenta de nuevo.",
    payment_paypal_not_ready: "PayPal no está disponible en este momento.",
    payment_origin_not_allowed:
      "Este origen no esta autorizado. Abre el sitio desde tu dominio o localhost.",
    payment_local_server_required:
      "En computadora abre el sitio con http://localhost (no archivo local file://).",
    payment_close: "Cancelar",
    cart_empty: "Tu carrito está vacío.",
    cart_need_item: "Agrega al menos un producto.",
    cart_need_contact: "Completa nombre y teléfono.",
    quote_sending: "Enviando tu solicitud…",
    quote_sent: "Solicitud enviada. ¡Gracias!",
    quote_error: "No se pudo enviar la solicitud, intenta más tarde.",
    toast_added: "\"{name}\" agregado al carrito.",
    slice_offer_pack: "Descuento activo: tus porciones ahora van a L 45 c/u.",
    slice_offer_dozen: "Promo activa: 12 porciones por L 500.",
    slice_offer_extra: "Promo activa: docena por L 500 y extras a L 42 c/u.",
    slice_price_each: "{price} c/u",
    slice_price_dozen: "{price} la docena",
    slice_price_extra: "{base} + {extra} extra",
    slice_cart_discount_pack: "Descuento por cantidad aplicado.",
    slice_cart_discount_dozen: "Precio especial de docena aplicado.",
    slice_cart_discount_extra: "Docena especial + extras a L 42.",
    slice_toast_pack: "Descuento activado: de 6 a 11 porciones ahora quedan a L 45 c/u.",
    slice_toast_dozen: "Promo activada: 12 porciones por L 500. Desde la 13, cada extra suma L 42.",
    order_success: "Tu orden fue enviada con éxito.",
    order_success_paid: "Tu orden fue pagada y enviada con éxito.",
    order_success_pending: "Tu orden fue enviada con éxito. Pago pendiente.",
    order_error: "No se pudo registrar ahora, intenta más tarde.",
    tracker_prompt_text: "¿Quieres ver el estado de tu pedido?",
    tracker_prompt_button: "Ver pedido",
    tracker_prompt_close: "Cerrar aviso de pedido",
    tracker_eyebrow: "Pedido rápido",
    tracker_title: "Sigue el estado de tu pedido",
    tracker_subtitle: "Consulta aquí cómo va tu pedido y abre el detalle cuando quieras.",
    tracker_empty: "No hay pedidos recientes.",
    tracker_order_number: "Pedido #{id}",
    tracker_status_pending: "Pendiente",
    tracker_status_prep: "En preparación",
    tracker_status_ready: "Listo para entrega",
    tracker_status_delivered: "Entregado",
    tracker_status_rejected: "Rechazado",
    tracker_date_line: "Fecha: {date} · Hora: {time}",
    tracker_total_line: "Total: {total}",
    tracker_products_line: "{count} producto(s)",
    tracker_detail_button: "Ver lo que pedí",
    tracker_reset_note: "Este pedido se limpiará en {minutes} min {seconds}s cuando ya esté entregado.",
    tracker_ready_note: "Tu pedido ya está listo para cierre.",
    tracker_detail_eyebrow: "Pedido",
    tracker_detail_date: "Fecha",
    tracker_detail_total: "Total",
    tracker_detail_items: "Lo que pediste",
    tracker_detail_notes: "Notas",
    tracker_detail_edit_once_badge: "1 edición disponible",
    tracker_detail_edit_used_badge: "Edición utilizada",
    tracker_detail_edit_ph: "Actualiza tu comentario si necesitas corregir un detalle.",
    tracker_detail_edit_once_help: "Puedes corregir este comentario una sola vez desde aquí.",
    tracker_detail_edit_used_help: "Este comentario ya fue corregido una vez. Si necesitas otro cambio, escríbenos.",
    tracker_detail_reset: "Restablecer",
    tracker_detail_save: "Guardar comentario",
    tracker_detail_save_busy: "Guardando comentario…",
    tracker_detail_save_success: "Comentario actualizado correctamente.",
    tracker_detail_save_error: "No se pudo actualizar el comentario. Intenta de nuevo.",
    tracker_detail_close: "Cerrar",
    whatsapp_cta: "Cotiza por WhatsApp",
  },
  en: {
    nav_menu: "Menu",
    nav_orders: "Orders",
    nav_process: "Process",
    nav_experience: "Experience",
    nav_quote: "Get a quote",
    hero_eyebrow: "Beky's Cake",
    hero_title: "Beky's Cake",
    hero_subtitle:
      "Beky's Cake is a bakery in El Progreso, Yoro, Honduras, specializing in custom cakes, dessert portions, and orders for birthdays, weddings, events, and special gifts. You can also find us as Bekys Cake.",
    hero_cta_primary: "Our Menu",
    hero_cta_secondary: "Request a quote",
    hero_stat_1: "custom events",
    hero_stat_2: "flavor tables available",
    hero_stat_3: "fresh local ingredients",
    local_eyebrow: "Bakery in El Progreso",
    local_title: "Custom cakes and pastry for events",
    local_subtitle:
      "If you are looking for bakeries in El Progreso, Beky's Cake prepares cakes, portions, and desserts for birthdays, weddings, corporate events, and special gifts in El Progreso, Yoro.",
    local_1_title: "Bakery in El Progreso, Yoro",
    local_1_body: "Professional cakes with custom design and traditional flavors for every occasion.",
    local_2_title: "Custom cakes for events",
    local_2_body: "Options for birthdays, weddings, anniversaries, and business events in El Progreso.",
    local_3_title: "Dessert portions for sweet tables",
    local_3_body: "Ready-to-serve portions for corporate tables, celebrations, and gifts with coordinated delivery.",
    menu_eyebrow: "Signature sweets",
    menu_title: "Beky's Cake house specialties",
    menu_subtitle:
      "Beky's Cake portions and cakes you can customize by flavor, texture, and decoration.",
    add_to_cart: "Add to cart",
    product_tres_leches_title: "Tres leches cake",
    product_tres_leches_desc: "Fluffy sponge with three milks and an elegant finish.",
    product_chocoflan_title: "Chocoflan cake",
    product_chocoflan_desc: "Deep chocolate layers with a soft caramel flan.",
    product_pineapple_title: "Pineapple upside-down cake",
    product_pineapple_desc: "Caramelized pineapple and balanced spices on a golden base.",
    product_milk_pie_title: "Milk pie",
    product_milk_pie_desc: "Ultra-smooth filling, glossy top, and crisp crust.",
    product_tres_leches_slice_title: "Tres leches slices",
    product_tres_leches_slice_desc: "Premium portions ready for corporate tables or gifts.",
    product_tres_leches_slice_offer: "6 to 11 slices: L 45 each · 12 slices: L 500 · extras at L 42.",
    product_cheesecake_title: "Cheesecake",
    product_cheesecake_desc: "Velvety texture with a spiced crust and vibrant coulis.",
    product_cheese_flan_title: "Cheese flan",
    product_cheese_flan_desc: "Cream cheese balance with delicate caramel.",
    process_eyebrow: "Our method",
    process_title: "Transparency at every step",
    process_subtitle:
      "From request to delivery, we coordinate timing, temperature, and packaging so your cake arrives flawless.",
    process_1_title: "Personalized consult",
    process_1_body: "A quick call or WhatsApp note to refine flavors, quantities, and decoration.",
    process_2_title: "Mindful production",
    process_2_body: "Daily supervised local ingredients and documented processes.",
    process_3_title: "Secure packaging",
    process_3_body: "We protect your cake with chilled packaging and clear labeling.",
    process_4_title: "Coordinated delivery",
    process_4_body: "We confirm route and timing to avoid surprises.",
    exp_eyebrow: "Beky's experience",
    exp_title: "Beky's Cake services for weddings, companies, and snacks",
    exp_subtitle:
      "At Beky's Cake we design sweet moments. Choose a corporate package, surprise at your wedding, or bring flavor to social events.",
    exp_1_title: "Corporate events",
    exp_1_body: "Individual portions, top branding, on-time delivery, and clear invoicing.",
    exp_2_title: "Weddings & celebrations",
    exp_2_body: "Lights, flavors, multiple tiers. We do tastings and collaborate with florists.",
    exp_3_title: "Express orders",
    exp_3_body: "Ready-to-serve portions for offices, cafes, and stores; same-day dispatch.",
    search_eyebrow: "Beky's Cake on Google",
    search_title: "A local option when people search for bakeries in El Progreso",
    search_subtitle:
      "We kept Beky's Cake as the primary brand while also reinforcing relevance for people searching for a bakery in El Progreso, custom cakes, or dessert portions for events.",
    search_1_title: "Beky's Cake and Bekys Cake",
    search_1_body:
      "The page prioritizes the Beky's Cake name as the main brand and also reinforces the Bekys Cake variation for searches without an apostrophe.",
    search_2_title: "Bakery in El Progreso",
    search_2_body:
      "The content clearly states that Beky's Cake is a bakery in El Progreso, Yoro, Honduras, serving different kinds of celebrations.",
    search_3_title: "Custom cakes and events",
    search_3_body:
      "We also reinforce searches related to custom cakes, birthdays, weddings, corporate events, and made-to-order desserts.",
    faq_eyebrow: "Frequently asked questions",
    faq_title: "Beky's Cake and bakery searches in El Progreso",
    faq_subtitle:
      "These answers help explain what the bakery offers and how to place an order in El Progreso.",
    faq_1_title: "Is Beky's Cake a bakery in El Progreso?",
    faq_1_body:
      "Yes. Beky's Cake is a bakery located in El Progreso, Yoro, Honduras, offering cakes, dessert portions, and custom orders for different celebrations.",
    faq_2_title: "Do you make custom cakes in El Progreso?",
    faq_2_body:
      "Yes. We prepare cakes for birthdays, weddings, anniversaries, family celebrations, and business events.",
    faq_3_title: "How can I order from Beky's Cake?",
    faq_3_body:
      "You can use the quote form on the site and also contact us to coordinate flavors, quantities, decoration, and delivery date.",
    faq_4_title: "Can people also find it as Bekys Cake without the apostrophe?",
    faq_4_body:
      "Yes. Beky's Cake is also reinforced as Bekys Cake so the bakery is easier to find even when the name is typed without an apostrophe.",
    cta_eyebrow: "Ready to order",
    cta_title: "Ready to sweeten your day?",
    cta_body: "Tell us what you imagine and we will share options, budgets, and availability.",
    cta_primary: "Send request",
    cta_secondary: "Representative CRM",
    contact_title_1: "Beky's Cake contact",
    contact_body_1_extra:
      "If you are looking for a bakery in El Progreso for birthdays, weddings, or events, message us and we will gladly prepare a quote.",
    contact_title_2: "We are in",
    contact_body_2: "El Progreso, Yoro, Honduras.",
    contact_title_3: "Hours",
    contact_body_3: "Monday to Saturday · 8:00–19:00 (order cutoff 16:00).",
    quote_eyebrow: "Quote your cake",
    quote_title: "Tell us what you need",
    quote_subtitle: "Leave your details and we will contact you with options and timing.",
    quote_name_label: "Full name",
    quote_name_ph: "Ana Lopez",
    quote_email_label: "Email",
    quote_email_ph: "hello@company.com",
    quote_phone_label: "Phone",
    quote_phone_ph: "+504 1234 5678",
    quote_date_label: "Estimated delivery date",
    quote_details_label: "What do you want?",
    quote_details_ph: "Tell us flavors, guest count, etc.",
    quote_submit: "Request quote",
    cart_title: "Your Beky's Cake cart",
    cart_subtitle: "Add your preferences and confirm with your name and phone.",
    cart_total: "Total",
    cart_name_label: "Full name",
    cart_name_ph: "Ana Lopez",
    cart_phone_label: "Phone",
    cart_phone_ph: "+504 1234 5678",
    cart_notes_label: "Additional comments",
    cart_notes_ph: "Tell us about a dedication, allergies, delivery reference, or any important detail.",
    cart_submit: "Confirm order",
    payment_choice_eyebrow: "Payment",
    payment_choice_title: "How do you want to pay?",
    payment_choice_subtitle: "Choose Pay now with PayPal or send your order and pay later.",
    payment_choice_total: "Order total",
    payment_choice_later: "Pay later",
    payment_choice_now: "Pay with PayPal",
    payment_secure_note:
      "Payment is processed by PayPal. Your order is marked paid only after PayPal confirms the charge.",
    payment_choice_config_missing:
      "PayPal/Supabase setup is missing. You can still place the order with Pay later.",
    payment_paypal_eyebrow: "Secure checkout",
    payment_paypal_title: "Pay with PayPal",
    payment_paypal_subtitle:
      "A secure PayPal window will open so you can pay with your PayPal account or card.",
    payment_paypal_secure_note:
      "PayPal opens its secure checkout. Beky's Cake does not receive your card details.",
    payment_usd_pending: "USD equivalent will be calculated when PayPal opens.",
    payment_paypal_loading: "Loading PayPal…",
    payment_paypal_processing: "Processing payment…",
    payment_paypal_cancelled: "Payment cancelled. Your order was not charged.",
    payment_paypal_error: "We could not process the payment. Please try again.",
    payment_paypal_not_ready: "PayPal is not available right now.",
    payment_origin_not_allowed:
      "This origin is not authorized. Open the site from your domain or localhost.",
    payment_local_server_required:
      "On desktop, open the site with http://localhost (not as a local file).",
    payment_close: "Cancel",
    cart_empty: "Your cart is empty.",
    cart_need_item: "Add at least one product.",
    cart_need_contact: "Complete name and phone.",
    quote_sending: "Sending your request…",
    quote_sent: "Request sent. Thank you!",
    quote_error: "Could not send the request, try again later.",
    toast_added: "\"{name}\" added to cart.",
    slice_offer_pack: "Discount active: your slices now go for L 45 each.",
    slice_offer_dozen: "Promo active: 12 slices for L 500.",
    slice_offer_extra: "Promo active: dozen for L 500 and extras at L 42 each.",
    slice_price_each: "{price} each",
    slice_price_dozen: "{price} per dozen",
    slice_price_extra: "{base} + {extra} extra",
    slice_cart_discount_pack: "Volume discount applied.",
    slice_cart_discount_dozen: "Special dozen price applied.",
    slice_cart_discount_extra: "Special dozen + extras at L 42.",
    slice_toast_pack: "Discount activated: 6 to 11 slices now cost L 45 each.",
    slice_toast_dozen: "Promo activated: 12 slices for L 500. Starting with slice 13, each extra adds L 42.",
    order_success: "Your order was sent successfully.",
    order_success_paid: "Your order was paid and sent successfully.",
    order_success_pending: "Your order was sent successfully. Payment pending.",
    order_error: "Could not save now, try again later.",
    tracker_prompt_text: "Do you want to check your order status?",
    tracker_prompt_button: "View order",
    tracker_prompt_close: "Close order notice",
    tracker_eyebrow: "Quick order",
    tracker_title: "Track your order status",
    tracker_subtitle: "Check here how your order is going and open the detail whenever you want.",
    tracker_empty: "There are no recent orders.",
    tracker_order_number: "Order #{id}",
    tracker_status_pending: "Pending",
    tracker_status_prep: "In preparation",
    tracker_status_ready: "Ready for pickup",
    tracker_status_delivered: "Delivered",
    tracker_status_rejected: "Rejected",
    tracker_date_line: "Date: {date} · Time: {time}",
    tracker_total_line: "Total: {total}",
    tracker_products_line: "{count} item(s)",
    tracker_detail_button: "View what I ordered",
    tracker_reset_note: "This order will clear in {minutes} min {seconds}s once delivered.",
    tracker_ready_note: "Your order is ready for closeout.",
    tracker_detail_eyebrow: "Order",
    tracker_detail_date: "Date",
    tracker_detail_total: "Total",
    tracker_detail_items: "What you ordered",
    tracker_detail_notes: "Notes",
    tracker_detail_edit_once_badge: "1 edit available",
    tracker_detail_edit_used_badge: "Edit already used",
    tracker_detail_edit_ph: "Update your comment if you need to correct a detail.",
    tracker_detail_edit_once_help: "You can correct this comment only once from here.",
    tracker_detail_edit_used_help: "This comment has already been corrected once. Contact us if you need another change.",
    tracker_detail_reset: "Reset",
    tracker_detail_save: "Save comment",
    tracker_detail_save_busy: "Saving comment…",
    tracker_detail_save_success: "Comment updated successfully.",
    tracker_detail_save_error: "Could not update the comment. Please try again.",
    tracker_detail_close: "Close",
    whatsapp_cta: "Quote on WhatsApp",
  },
};

let currentLang = "es";

function t(key, vars = {}) {
  const dict = i18n[currentLang] || i18n.es;
  let str = dict[key] || i18n.es[key] || key;
  Object.keys(vars).forEach((k) => {
    str = str.replace(new RegExp(`\\{${k}\\}`, "g"), vars[k]);
  });
  return str;
}

function formatPriceCompact(value) {
  const numeric = Number(value) || 0;
  return `L ${Number.isInteger(numeric) ? numeric : numeric.toFixed(2)}`;
}

function getCartItemProductKey(item) {
  const explicitKey = typeof item?.productKey === "string" ? item.productKey.trim() : "";
  if (explicitKey) return explicitKey;
  if (item?.descKey === "product_tres_leches_slice_desc") return tieredSliceProductKey;
  const rawName = String(item?.name || "").trim();
  if (!rawName) return "";
  const knownNames = [
    i18n.es.product_tres_leches_slice_title,
    i18n.en.product_tres_leches_slice_title,
    t("product_tres_leches_slice_title"),
  ];
  return knownNames.includes(rawName) ? tieredSliceProductKey : "";
}

function getCartItemDisplayName(item) {
  const productKey = getCartItemProductKey(item);
  if (productKey) {
    const translated = t(`product_${productKey}_title`);
    if (translated && translated !== `product_${productKey}_title`) return translated;
  }
  return resolveProductName(item?.name || "");
}

function getTresLechesSliceTier(quantity) {
  const safeQuantity = Math.max(1, Number(quantity) || 1);
  if (safeQuantity > 12) return "extra";
  if (safeQuantity === 12) return "dozen";
  if (safeQuantity >= 6) return "pack";
  return "base";
}

function getTresLechesSlicePricing(quantity) {
  const safeQuantity = Math.max(1, Number(quantity) || 1);
  const tier = getTresLechesSliceTier(safeQuantity);
  if (tier === "pack") {
    return {
      tier,
      unitPrice: 45,
      total: safeQuantity * 45,
      unitLabel: t("slice_price_each", { price: formatPriceCompact(45) }),
      note: t("slice_cart_discount_pack"),
      offer: t("slice_offer_pack"),
      catalogLabel: t("slice_price_each", { price: formatPriceCompact(45) }),
    };
  }
  if (tier === "dozen") {
    return {
      tier,
      unitPrice: 500 / 12,
      total: 500,
      unitLabel: t("slice_price_dozen", { price: formatPriceCompact(500) }),
      note: t("slice_cart_discount_dozen"),
      offer: t("slice_offer_dozen"),
      catalogLabel: t("slice_price_dozen", { price: formatPriceCompact(500) }),
    };
  }
  if (tier === "extra") {
    return {
      tier,
      unitPrice: 42,
      total: 500 + (safeQuantity - 12) * 42,
      unitLabel: t("slice_price_extra", {
        base: formatPriceCompact(500),
        extra: formatPriceCompact(42),
      }),
      note: t("slice_cart_discount_extra"),
      offer: t("slice_offer_extra"),
      catalogLabel: t("slice_price_extra", {
        base: formatPriceCompact(500),
        extra: formatPriceCompact(42),
      }),
    };
  }
  return {
    tier,
    unitPrice: 50,
    total: safeQuantity * 50,
    unitLabel: t("slice_price_each", { price: formatPriceCompact(50) }),
    note: "",
    offer: t("product_tres_leches_slice_offer"),
    catalogLabel: formatPriceCompact(50),
  };
}

function getCartItemPricing(item) {
  const quantity = Math.max(1, Number(item?.quantity) || 1);
  if (getCartItemProductKey(item) === tieredSliceProductKey) {
    return getTresLechesSlicePricing(quantity);
  }
  const unitPrice = Number(item?.price) || 0;
  return {
    tier: "base",
    unitPrice,
    total: quantity * unitPrice,
    unitLabel: `${formatPrice(unitPrice)} cada`,
    note: "",
    offer: "",
    catalogLabel: formatPriceCompact(unitPrice),
  };
}

function updateTresLechesSliceCard() {
  if (!tresLechesSlicePrice) return;
  const targetItem = cart.find((item) => getCartItemProductKey(item) === tieredSliceProductKey);
  const quantity = targetItem?.quantity || 1;
  const pricing = getTresLechesSlicePricing(quantity);
  const hasDiscount = pricing.tier !== "base";
  tresLechesSlicePrice.textContent = pricing.catalogLabel;
  tresLechesSlicePrice.classList.toggle("is-discounted", hasDiscount);
}

function getTierPricingToast(item, previousQuantity, nextQuantity) {
  if (getCartItemProductKey(item) !== tieredSliceProductKey) return "";
  if (nextQuantity <= previousQuantity) return "";
  const previousTier = getTresLechesSliceTier(previousQuantity || 1);
  const nextTier = getTresLechesSliceTier(nextQuantity);
  if (previousTier === nextTier) return "";
  if (nextTier === "pack") return t("slice_toast_pack");
  if (nextTier === "dozen") return t("slice_toast_dozen");
  return "";
}

function resolveProductName(rawName) {
  if (!rawName) return "";
  const translated = t(rawName);
  return translated !== rawName ? translated : rawName;
}

function getTrackedOrderRefs() {
  try {
    const stored = JSON.parse(localStorage.getItem(trackedOrdersKey) || "[]");
    if (!Array.isArray(stored)) return [];
    return stored
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        trackingKey: String(item.trackingKey || "").trim(),
        orderId: String(item.orderId || "").trim(),
        displayId: String(item.displayId || "").trim(),
      }))
      .filter((item) => item.trackingKey);
  } catch (error) {
    console.warn("No se pudo leer el tracking de pedidos", error);
    return [];
  }
}

function saveTrackedOrderRefs() {
  try {
    localStorage.setItem(trackedOrdersKey, JSON.stringify(trackedOrderRefs));
  } catch (error) {
    console.warn("No se pudo guardar el tracking de pedidos", error);
  }
}

function rememberTrackedOrder(orderPayload) {
  if (!orderPayload?.trackingKey) return;
  trackedOrderRefs = trackedOrderRefs.filter((item) => item.trackingKey !== orderPayload.trackingKey);
  trackedOrderRefs.unshift({
    trackingKey: orderPayload.trackingKey,
    orderId: orderPayload.clientOrderId || "",
    displayId: orderPayload.displayId || "",
  });
  trackedOrderRefs = trackedOrderRefs.slice(0, 8);
  saveTrackedOrderRefs();
}

function upsertTrackedOrderPreview(orderPayload) {
  if (!orderPayload?.trackingKey) return;
  const previewOrder = {
    trackingKey: orderPayload.trackingKey,
    orderId: orderPayload.clientOrderId || "",
    displayId: orderPayload.displayId || orderPayload.localNumber || "",
    client: orderPayload.client || "Cliente sin nombre",
    items: Array.isArray(orderPayload.items) ? orderPayload.items : [],
    total: Number(orderPayload.total) || 0,
    status: orderPayload.status || "Pendiente",
    time: orderPayload.time || "--:--",
    orderDate: orderPayload.orderDate || "",
    notes: orderPayload.notes || "",
    createdAt: orderPayload.createdAtLocal || new Date().toISOString(),
    updatedAt: orderPayload.createdAtLocal || new Date().toISOString(),
    deliveredAt: orderPayload.deliveredAt || null,
    rejectedAt: orderPayload.rejectedAt || null,
    customerNotesEdited: orderPayload.customerNotesEdited === true,
    customerNotesEditedAt: orderPayload.customerNotesEditedAt || null,
    notesUpdatedAt: orderPayload.notesUpdatedAt || null,
  };
  trackedOrders = trackedOrders.filter((item) => item.trackingKey !== previewOrder.trackingKey);
  trackedOrders.unshift(previewOrder);
  renderTrackedOrders();
}

function removeTrackedOrder(trackingKey) {
  const normalized = String(trackingKey || "").trim();
  if (!normalized) return;
  trackedOrderRefs = trackedOrderRefs.filter((item) => item.trackingKey !== normalized);
  trackedOrders = trackedOrders.filter((item) => item.trackingKey !== normalized);
  saveTrackedOrderRefs();
  if (openTrackedOrderKey === normalized) {
    closeCustomerOrderModal();
  }
}

function parseMaybeDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function mapTrackerStatus(status) {
  if (status === "Pendiente") return { className: "status-pending", label: t("tracker_status_pending") };
  if (["En preparación", "Confirmado", "En horno", "Empaquetado", "En reparto"].includes(status)) {
    return { className: "status-prep", label: t("tracker_status_prep") };
  }
  if (status === "Listo") return { className: "status-ready", label: t("tracker_status_ready") };
  if (status === "Entregado") return { className: "status-delivered", label: t("tracker_status_delivered") };
  if (status === "Rechazado" || status === "Cancelado") {
    return { className: "status-rejected", label: t("tracker_status_rejected") };
  }
  return { className: "status-pending", label: status || t("tracker_status_pending") };
}

function buildTrackedOrderItems(order) {
  if (!Array.isArray(order?.items) || !order.items.length) return [];
  return order.items.map((item) => {
    const quantity = Math.max(1, Number(item?.quantity) || 1);
    return `${quantity} x ${resolveProductName(item?.name || "Producto")}`;
  });
}

function buildTrackerResetNote(deliveredAt) {
  const deliveredDate = parseMaybeDate(deliveredAt);
  if (!deliveredDate) return t("tracker_ready_note");
  const remaining = Math.max(0, 180000 - (Date.now() - deliveredDate.getTime()));
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return t("tracker_reset_note", {
    minutes: String(minutes),
    seconds: String(seconds).padStart(2, "0"),
  });
}

function renderTrackedOrders() {
  if (!orderTrackerList) return;
  const ordered = [...trackedOrders].sort((a, b) => {
    const timeA = parseMaybeDate(a.updatedAt || a.createdAt)?.getTime() || 0;
    const timeB = parseMaybeDate(b.updatedAt || b.createdAt)?.getTime() || 0;
    return timeB - timeA;
  });

  orderTrackerList.innerHTML = "";
  if (!ordered.length) {
    const empty = document.createElement("p");
    empty.className = "tracker-empty";
    empty.textContent = t("tracker_empty");
    orderTrackerList.appendChild(empty);
    return;
  }

  ordered.forEach((order) => {
    const status = mapTrackerStatus(order.status);
    const itemLines = buildTrackedOrderItems(order);
    const article = document.createElement("article");
    article.className = "tracker-card";
    article.innerHTML = `
      <div class="tracker-card-header">
        <div class="tracker-card-meta">
          <h3>${t("tracker_order_number", { id: order.displayId || order.orderId || "--" })}</h3>
          <p class="tracker-order-line">${t("tracker_date_line", {
            date: order.orderDate || "--",
            time: order.time || "--:--",
          })}</p>
          <p class="tracker-time-line">${t("tracker_total_line", { total: formatPrice(Number(order.total) || 0) })}</p>
        </div>
        <span class="order-status ${status.className}">${status.label}</span>
      </div>
      <div class="tracker-summary">
        <p class="tracker-order-line">${t("tracker_products_line", { count: itemLines.length || 0 })}</p>
        ${order.status === "Entregado" ? `<p class="tracker-reset-note">${buildTrackerResetNote(order.deliveredAt)}</p>` : ""}
      </div>
      <div class="tracker-actions">
        <button class="btn ghost tracker-detail-btn" type="button" data-tracking-key="${order.trackingKey}">
          ${t("tracker_detail_button")}
        </button>
      </div>
    `;
    orderTrackerList.appendChild(article);
  });
}

function getOpenTrackedOrder() {
  if (!openTrackedOrderKey) return null;
  return trackedOrders.find((item) => item.trackingKey === openTrackedOrderKey) || null;
}

function setCustomerNotesMessage(key = "", tone = "info") {
  if (!customerOrderNotesMessage) return;
  customerOrderNotesMessage.dataset.tone = key ? tone : "";
  customerOrderNotesMessage.textContent = key ? t(key) : "";
}

function syncCustomerNotesEditor(order) {
  if (!customerOrderNotesInput || !customerOrderNotesHelp || !customerOrderNotesBadge) return;
  const activeOrder = order || getOpenTrackedOrder();
  const alreadyEdited = Boolean(activeOrder?.customerNotesEdited);
  const currentValue = customerOrderNotesInput.value.trim();
  const baseline = customerNotesOriginalValue.trim();
  const isDirty = currentValue !== baseline;

  customerOrderNotesInput.readOnly = alreadyEdited || customerNotesSaving;
  customerOrderNotesInput.disabled = customerNotesSaving;
  customerOrderNotesBadge.textContent = alreadyEdited
    ? t("tracker_detail_edit_used_badge")
    : t("tracker_detail_edit_once_badge");
  customerOrderNotesHelp.textContent = alreadyEdited
    ? t("tracker_detail_edit_used_help")
    : t("tracker_detail_edit_once_help");

  if (customerOrderNotesSave) {
    customerOrderNotesSave.disabled = customerNotesSaving || alreadyEdited || !isDirty;
  }
  if (customerOrderNotesReset) {
    customerOrderNotesReset.disabled = customerNotesSaving || !isDirty;
  }
}

function updateTrackedOrderNotesLocally(trackingKey, notes, extra = {}) {
  trackedOrders = trackedOrders.map((item) =>
    item?.trackingKey === trackingKey ? { ...item, notes, ...extra } : item
  );
  renderTrackedOrders();
}

async function handleCustomerNotesSave() {
  const order = getOpenTrackedOrder();
  if (!order || !customerOrderNotesInput) return;
  const nextNotes = customerOrderNotesInput.value.trim();
  const previousNotes = String(order.notes || "").trim();
  if (nextNotes === customerNotesOriginalValue.trim()) return;

  customerNotesSaving = true;
  setCustomerNotesMessage("tracker_detail_save_busy", "info");
  syncCustomerNotesEditor(order);

  updateTrackedOrderNotesLocally(order.trackingKey, nextNotes, {
    customerNotesEdited: true,
    customerNotesEditedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    notesUpdatedAt: new Date().toISOString(),
  });

  const saved = await updateOrderNotes({
    orderId: order.orderId || order.id || "",
    trackingKey: order.trackingKey,
    notes: nextNotes,
    mode: "customer",
  });

  customerNotesSaving = false;
  if (!saved) {
    updateTrackedOrderNotesLocally(order.trackingKey, previousNotes, {
      customerNotesEdited: Boolean(order.customerNotesEdited),
      customerNotesEditedAt: order.customerNotesEditedAt || null,
      updatedAt: order.updatedAt || null,
      notesUpdatedAt: order.notesUpdatedAt || null,
    });
    customerOrderNotesInput.value = previousNotes;
    setCustomerNotesMessage("tracker_detail_save_error", "error");
    syncCustomerNotesEditor(getOpenTrackedOrder() || order);
    return;
  }

  customerNotesOriginalValue = nextNotes;
  setCustomerNotesMessage("tracker_detail_save_success", "success");
  syncCustomerNotesEditor(getOpenTrackedOrder() || order);
}

function openCustomerOrderModal(trackingKey) {
  const order = trackedOrders.find((item) => item.trackingKey === trackingKey);
  if (!order || !customerOrderModal) return;
  openTrackedOrderKey = trackingKey;
  const status = mapTrackerStatus(order.status);
  const title = document.getElementById("customer-order-title");
  const statusBadge = document.getElementById("customer-order-status");
  const dateEl = document.getElementById("customer-order-date");
  const totalEl = document.getElementById("customer-order-total");
  const itemsEl = document.getElementById("customer-order-items");

  if (title) title.textContent = `#${order.displayId || order.orderId || "--"}`;
  if (statusBadge) {
    statusBadge.className = `order-status ${status.className}`;
    statusBadge.textContent = status.label;
  }
  if (dateEl) dateEl.textContent = `${order.orderDate || "--"} ${order.time || ""}`.trim();
  if (totalEl) totalEl.textContent = formatPrice(Number(order.total) || 0);
  if (itemsEl) {
    itemsEl.innerHTML = buildTrackedOrderItems(order).map((item) => `<li>${item}</li>`).join("");
  }
  if (customerOrderNotesInput) {
    customerNotesOriginalValue = String(order.notes || "").trim();
    customerOrderNotesInput.value = customerNotesOriginalValue;
  }
  customerNotesSaving = false;
  setCustomerNotesMessage();
  syncCustomerNotesEditor(order);
  customerOrderModal.classList.remove("hidden");
  customerOrderModal.setAttribute("aria-hidden", "false");
}

function closeCustomerOrderModal() {
  if (!customerOrderModal) return;
  openTrackedOrderKey = "";
  customerNotesSaving = false;
  customerNotesOriginalValue = "";
  setCustomerNotesMessage();
  customerOrderModal.classList.add("hidden");
  customerOrderModal.setAttribute("aria-hidden", "true");
}

function showOrderTrackerPrompt(orderPayload) {
  if (!orderTrackerPrompt || !orderPayload?.trackingKey) return;
  clearTimeout(orderTrackerPromptHideTimeoutId);
  pendingTrackerPromptOrder = orderPayload;
  orderTrackerPrompt.dataset.trackingKey = orderPayload.trackingKey;
  orderTrackerPrompt.classList.remove("hidden");
  requestAnimationFrame(() => {
    orderTrackerPrompt.classList.add("show");
  });
}

function hideOrderTrackerPrompt(clearPending = true) {
  if (clearPending) pendingTrackerPromptOrder = null;
  if (!orderTrackerPrompt) return;
  clearTimeout(orderTrackerPromptHideTimeoutId);
  orderTrackerPrompt.classList.remove("show");
  orderTrackerPromptHideTimeoutId = window.setTimeout(() => {
    if (orderTrackerPrompt.classList.contains("show")) return;
    orderTrackerPrompt.classList.add("hidden");
    orderTrackerPrompt.dataset.trackingKey = "";
  }, 220);
}

function maybeShowOrderTrackerPrompt() {
  if (!pendingTrackerPromptOrder?.trackingKey) return;
  const successVisible = Boolean(
    orderSuccess &&
      (orderSuccess.classList.contains("show") || orderSuccess.classList.contains("is-exiting"))
  );
  if (successVisible) return;
  showOrderTrackerPrompt(pendingTrackerPromptOrder);
}

function hideOrderSuccessMessage() {
  if (!orderSuccess) {
    maybeShowOrderTrackerPrompt();
    return;
  }
  clearTimeout(orderSuccessTimeoutId);
  clearTimeout(orderSuccessHideTimeoutId);
  if (orderSuccess.classList.contains("hidden")) {
    maybeShowOrderTrackerPrompt();
    return;
  }
  orderSuccess.classList.remove("show");
  orderSuccess.classList.add("is-exiting");
  orderSuccessHideTimeoutId = window.setTimeout(() => {
    orderSuccess.classList.remove("is-exiting");
    orderSuccess.classList.add("hidden");
    maybeShowOrderTrackerPrompt();
  }, 320);
}

function highlightTrackedOrdersSection() {
  if (!orderTrackerSection) return;
  clearTimeout(trackerHighlightTimeoutId);
  orderTrackerSection.classList.add("is-highlighted");
  trackerHighlightTimeoutId = window.setTimeout(() => {
    orderTrackerSection.classList.remove("is-highlighted");
  }, 2200);
}

function scrollToTrackedOrders() {
  if (!orderTrackerSection) return;
  const navHeight = document.querySelector(".nav")?.offsetHeight || 82;
  const targetTop = orderTrackerSection.getBoundingClientRect().top + window.scrollY - navHeight - 18;
  window.scrollTo({
    top: Math.max(0, targetTop),
    behavior: "smooth",
  });
  highlightTrackedOrdersSection();
}

function purgeExpiredTrackedOrders() {
  const now = Date.now();
  const expired = trackedOrders.filter((order) => {
    if (order.status === "Entregado") {
      const deliveredAt = parseMaybeDate(order.deliveredAt);
      if (!deliveredAt) return false;
      return now - deliveredAt.getTime() >= 180000;
    }
    if (order.status === "Rechazado" || order.status === "Cancelado") {
      const rejectedAt = parseMaybeDate(order.rejectedAt || order.updatedAt);
      if (!rejectedAt) return false;
      return now - rejectedAt.getTime() >= 180000;
    }
    return false;
  });
  if (!expired.length) return false;
  expired.forEach((order) => removeTrackedOrder(order.trackingKey));
  return true;
}

function syncTrackedOrdersSubscription() {
  const keys = trackedOrderRefs.map((item) => item.trackingKey);
  const optimisticTrackedOrders = trackedOrders.filter((item) => keys.includes(item?.trackingKey));
  unsubscribeTrackedOrders?.();
  trackedOrders = optimisticTrackedOrders;
  if (!keys.length) {
    renderTrackedOrders();
    return;
  }
  renderTrackedOrders();
  unsubscribeTrackedOrders = subscribeTrackingOrders(
    keys,
    (items) => {
      const nextItems = Array.isArray(items) ? items : [];
      const incomingKeys = new Set(nextItems.map((item) => item.trackingKey));
      const optimisticFallback = trackedOrders.filter(
        (item) => item?.trackingKey && !incomingKeys.has(item.trackingKey)
      );
      trackedOrders = [...nextItems, ...optimisticFallback];
      if (purgeExpiredTrackedOrders()) {
        syncTrackedOrdersSubscription();
        return;
      }
      renderTrackedOrders();
      if (openTrackedOrderKey && customerOrderModal && !customerOrderModal.classList.contains("hidden")) {
        if (getOpenTrackedOrder()) {
          openCustomerOrderModal(openTrackedOrderKey);
        } else {
          closeCustomerOrderModal();
        }
      }
    },
    () => {
      renderTrackedOrders();
    }
  );
}

function applyTranslations(lang) {
  currentLang = lang;
  document.documentElement.setAttribute("lang", lang);
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key) el.setAttribute("placeholder", t(key));
  });
  document.querySelectorAll("[data-product-key]").forEach((card) => {
    const key = card.getAttribute("data-product-key");
    if (!key) return;
    card.dataset.name = t(`product_${key}_title`);
  });
  renderCart();
  updateTresLechesSliceCard();
  if (openTrackedOrderKey && customerOrderModal && !customerOrderModal.classList.contains("hidden")) {
    openCustomerOrderModal(openTrackedOrderKey);
  }
}

let cart = [];
let toastTimeout;

function saveCartState() {
  try {
    localStorage.setItem(cartStateKey, JSON.stringify(cart));
  } catch (error) {
    console.warn("No se pudo guardar el carrito", error);
  }
}

function loadCartState() {
  try {
    const stored = JSON.parse(localStorage.getItem(cartStateKey) || "null");
    if (!Array.isArray(stored)) return;
    cart = stored
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        name: typeof item.name === "string" ? item.name : "",
        price: Number(item.price) || 0,
        quantity: Math.max(1, Number(item.quantity) || 1),
        image: typeof item.image === "string" ? item.image : "",
        descKey: typeof item.descKey === "string" ? item.descKey : "",
        productKey: typeof item.productKey === "string" ? item.productKey : getCartItemProductKey(item),
      }))
      .filter((item) => item.name);
  } catch (error) {
    console.warn("No se pudo leer el carrito guardado", error);
  }
}

function saveCartContact() {
  if (!cartNameInput || !cartPhoneInput || !cartNotesInput) return;
  const payload = {
    name: cartNameInput.value.trim(),
    phone: cartPhoneInput.value.trim(),
    notes: cartNotesInput.value.trim(),
  };
  try {
    localStorage.setItem(cartContactKey, JSON.stringify(payload));
  } catch (error) {
    console.warn("No se pudo guardar el contacto del carrito", error);
  }
}

function loadCartContact() {
  if (!cartNameInput || !cartPhoneInput || !cartNotesInput) return;
  try {
    const stored = JSON.parse(localStorage.getItem(cartContactKey) || "null");
    if (!stored || typeof stored !== "object") return;
    if (typeof stored.name === "string") cartNameInput.value = stored.name;
    if (typeof stored.phone === "string") cartPhoneInput.value = stored.phone;
    if (typeof stored.notes === "string") cartNotesInput.value = stored.notes;
    if (cartNameInput.value || cartPhoneInput.value || cartNotesInput.value) {
      markCartInteractionStarted();
    }
  } catch (error) {
    console.warn("No se pudo leer el contacto del carrito", error);
  }
}

function saveQuoteDraft(form) {
  if (!form) return;
  const payload = {
    name: form.querySelector('input[name="name"]')?.value.trim() || "",
    email: form.querySelector('input[name="email"]')?.value.trim() || "",
    phone: form.querySelector('input[name="phone"]')?.value.trim() || "",
    event_date: form.querySelector('input[name="event_date"]')?.value || "",
    details: form.querySelector('textarea[name="details"]')?.value.trim() || "",
  };
  try {
    localStorage.setItem(quoteDraftKey, JSON.stringify(payload));
  } catch (error) {
    console.warn("No se pudo guardar el borrador de cotización", error);
  }
}

function loadQuoteDraft(form) {
  if (!form) return;
  try {
    const stored = JSON.parse(localStorage.getItem(quoteDraftKey) || "null");
    if (!stored || typeof stored !== "object") return;
    const nameInput = form.querySelector('input[name="name"]');
    const emailInput = form.querySelector('input[name="email"]');
    const phoneInput = form.querySelector('input[name="phone"]');
    const dateInput = form.querySelector('input[name="event_date"]');
    const detailsInput = form.querySelector('textarea[name="details"]');
    if (nameInput && typeof stored.name === "string") nameInput.value = stored.name;
    if (emailInput && typeof stored.email === "string") emailInput.value = stored.email;
    if (phoneInput && typeof stored.phone === "string") phoneInput.value = stored.phone;
    if (dateInput && typeof stored.event_date === "string") dateInput.value = stored.event_date;
    if (detailsInput && typeof stored.details === "string") detailsInput.value = stored.details;
  } catch (error) {
    console.warn("No se pudo leer el borrador de cotización", error);
  }
}

function formatPrice(value) {
  return `L ${value.toFixed(2)}`;
}

function formatUsdPrice(value) {
  return `USD ${value.toFixed(2)}`;
}

function convertHnlToUsd(valueHnl, usdRate) {
  return Number((valueHnl * usdRate).toFixed(2));
}

function formatCheckoutTotal(totalHnl, options = {}) {
  const safeTotalHnl = Number(totalHnl) || 0;
  const currency = String(options.currency || paypalCurrency || "USD").toUpperCase();
  const chargeAmountRaw = Number(options.chargeAmount);
  const hasChargeAmount = Number.isFinite(chargeAmountRaw) && chargeAmountRaw > 0;
  if (currency === "HNL") {
    return formatPrice(safeTotalHnl);
  }
  if (hasChargeAmount) {
    const usdAmount = Number(chargeAmountRaw.toFixed(2));
    return `${formatPrice(safeTotalHnl)} (${formatUsdPrice(usdAmount)})`;
  }
  if (paypalUsdRate) {
    const approxAmount = convertHnlToUsd(safeTotalHnl, paypalUsdRate);
    return `${formatPrice(safeTotalHnl)} (~ ${formatUsdPrice(approxAmount)})`;
  }
  return `${formatPrice(safeTotalHnl)} (${t("payment_usd_pending")})`;
}

function renderCheckoutTotals(draft) {
  if (!draft) return;
  const chargeAmount = Number(draft?.paypalMeta?.amount);
  const currency = (draft?.paypalMeta?.currency || paypalCurrency || "USD").toUpperCase();
  const totalLabel = formatCheckoutTotal(Number(draft.total) || 0, {
    currency,
    chargeAmount,
  });
  if (paymentChoiceTotal) paymentChoiceTotal.textContent = totalLabel;
  if (paypalCheckoutTotal) paypalCheckoutTotal.textContent = totalLabel;
}

function updateCartCount() {
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  cartCount.textContent = totalItems;
}

function totalCartValue() {
  return cart.reduce((sum, item) => sum + getCartItemPricing(item).total, 0);
}

function updateCartItemButtons() {
  cartItemsList.querySelectorAll("[data-action]").forEach((button) => {
    const { action, name } = button.dataset;
    button.addEventListener("click", () => {
      if (action === "increase") {
        adjustQuantity(name, 1);
      } else if (action === "decrease") {
        adjustQuantity(name, -1);
      } else if (action === "remove") {
        removeItem(name);
      }
    });
  });
}

function renderCart() {
  cartItemsList.innerHTML = "";
  cartOverlay?.classList.toggle("cart-overlay--empty", cart.length === 0);
  if (cart.length === 0) {
    const empty = document.createElement("li");
    empty.innerHTML = `<p>${t("cart_empty")}</p>`;
    cartItemsList.appendChild(empty);
  } else {
    cart.forEach((item) => {
      const li = document.createElement("li");
      const displayName = getCartItemDisplayName(item);
      const pricing = getCartItemPricing(item);
      const imageMarkup = item.image
        ? `<img class="cart-item-thumb" src="${item.image}" alt="${displayName}" loading="lazy" />`
        : `<div class="cart-item-thumb placeholder" aria-hidden="true"></div>`;
      const discountMarkup = pricing.note ? `<span class="cart-item-discount">${pricing.note}</span>` : "";
      li.innerHTML = `
        <div class="cart-item-row">
          ${imageMarkup}
          <div class="cart-item-meta">
            <p class="cart-item-name">${displayName}</p>
            <span class="cart-item-price">${pricing.unitLabel}</span>
            ${discountMarkup}
          </div>
          <span class="cart-item-price">${formatPrice(pricing.total)}</span>
        </div>
        <div class="cart-item-actions">
          <button class="qty-btn" data-action="decrease" data-name="${item.name}">−</button>
          <span class="qty-badge">${item.quantity}</span>
          <button class="qty-btn" data-action="increase" data-name="${item.name}">+</button>
          <button class="btn ghost remove-btn" data-action="remove" data-name="${item.name}">
            <span aria-hidden="true" class="remove-icon">🗑</span>
            <span class="sr-only">Eliminar ${displayName}</span>
          </button>
        </div>
      `;
      cartItemsList.appendChild(li);
    });
    updateCartItemButtons();
  }
  cartTotalEl.textContent = formatPrice(totalCartValue());
  updateCartCount();
  saveCartState();
  updateTresLechesSliceCard();
}

function adjustQuantity(name, delta) {
  const target = cart.find((item) => item.name === name);
  if (!target) return;
  const previousQuantity = target.quantity;
  target.quantity += delta;
  const pricingToast = delta > 0 ? getTierPricingToast(target, previousQuantity, target.quantity) : "";
  if (target.quantity <= 0) {
    removeItem(name);
  } else {
    renderCart();
    if (pricingToast) showCartToast(pricingToast);
  }
}

function removeItem(name) {
  cart = cart.filter((item) => item.name !== name);
  renderCart();
}

function addToCart(card, trigger) {
  const baseName = card.dataset.name;
  const key = card.dataset.productKey;
  const nameKey = key ? `product_${key}_title` : baseName;
  const name = key ? t(nameKey) : resolveProductName(nameKey);
  const descKey = key ? `product_${key}_desc` : "";
  const price = Number(card.dataset.price) || 0;
  const image = card.dataset.image || "";
  const existing = cart.find((item) => {
    if (key && getCartItemProductKey(item) === key) return true;
    return item.name === name;
  });
  let pricingToast = "";
  if (existing) {
    const previousQuantity = existing.quantity;
    existing.quantity += 1;
    if (!existing.image && image) existing.image = image;
    if (!existing.descKey && descKey) existing.descKey = descKey;
    if (!existing.productKey && key) existing.productKey = key;
    pricingToast = getTierPricingToast(existing, previousQuantity, existing.quantity);
  } else {
    cart.push({ name, price, quantity: 1, image, descKey, productKey: key || "" });
  }
  renderCart();
  cartToggle?.focus();
  showCartToast(pricingToast || t("toast_added", { name }), trigger || card);
}

function openCart() {
  if (!cartOverlay) return;
  clearTimeout(cartOverlay._closeTimer);
  cartOverlay.classList.remove("hidden");
  cartMessage.textContent = "";
  document.body.classList.add("cart-open");
  requestAnimationFrame(() => {
    cartOverlay.classList.add("is-open");
  });
}

function closeCart() {
  if (!cartOverlay) return;
  cartOverlay.classList.remove("is-open");
  document.body.classList.remove("cart-open");
  cartOverlay._closeTimer = setTimeout(() => {
    cartOverlay.classList.add("hidden");
  }, 300);
}

function positionCartToast(originElement) {
  if (!cartToast) return;
  const originRect = originElement?.getBoundingClientRect?.();
  const targetRect = cartToggle?.getBoundingClientRect?.();
  const toastWidth = cartToast.offsetWidth || 260;
  const toastHeight = cartToast.offsetHeight || 56;
  const margin = 12;

  let originX = margin;
  let originY = margin;
  if (originRect) {
    originX = originRect.left + originRect.width / 2 - toastWidth / 2;
    originY = originRect.top - toastHeight - 14;
    if (originY < margin) {
      originY = Math.min(window.innerHeight - toastHeight - margin, originRect.bottom + 14);
    }
  }

  let targetX = window.innerWidth - toastWidth - 24;
  let targetY = window.innerHeight - toastHeight - 110;
  if (targetRect) {
    targetX = targetRect.left + targetRect.width / 2 - toastWidth / 2;
    targetY = targetRect.top + targetRect.height / 2 - toastHeight / 2;
  }

  const maxX = Math.max(margin, window.innerWidth - toastWidth - margin);
  const maxY = Math.max(margin, window.innerHeight - toastHeight - margin);
  originX = Math.min(Math.max(margin, originX), maxX);
  originY = Math.min(Math.max(margin, originY), maxY);
  targetX = Math.min(Math.max(margin, targetX), maxX);
  targetY = Math.min(Math.max(margin, targetY), maxY);

  cartToast.style.setProperty("--toast-origin-x", `${originX}px`);
  cartToast.style.setProperty("--toast-origin-y", `${originY}px`);
  cartToast.style.setProperty("--toast-target-x", `${targetX}px`);
  cartToast.style.setProperty("--toast-target-y", `${targetY}px`);
}

function showCartToast(message, originElement) {
  if (!cartToast) return;
  clearTimeout(toastTimeout);
  cartToast.textContent = message;
  cartToast.classList.remove("hidden");
  cartToast.classList.remove("show");
  void cartToast.offsetWidth;
  positionCartToast(originElement);
  cartToast.classList.add("show");
  toastTimeout = setTimeout(() => {
    cartToast.classList.remove("show");
    cartToast.classList.add("hidden");
  }, 3200);
}

function initHeroCarousel() {
  const hero = document.querySelector(".hero");
  const heroBg = hero?.querySelector(".hero-bg");
  if (!hero || !heroBg) return;
  const heroVersion = "20260315";
  const images = [
    "assets/carrusel3.jpg",
    "assets/carrusel.jpg",
    "assets/carrusel1.avif",
    "assets/carrusel2.webp",
  ].map((src) => `${src}?v=${heroVersion}`);
  if (!images.length) return;
  let index = 0;
  const slideDurationMs = 6000;
  const transitionMs = 900;
  const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  const secondaryLayer = heroBg.cloneNode(false);
  secondaryLayer.classList.remove("is-visible", "is-zooming");
  hero.insertBefore(secondaryLayer, hero.querySelector(".hero-overlay"));

  let activeLayer = heroBg;
  let inactiveLayer = secondaryLayer;

  const restartKenBurns = (layer) => {
    if (prefersReduced) {
      layer.classList.remove("is-zooming");
      return;
    }
    layer.classList.remove("is-zooming");
    void layer.offsetWidth;
    layer.classList.add("is-zooming");
  };

  const setBackground = (url, immediate = false) => {
    if (immediate) {
      activeLayer.style.backgroundImage = `url('${url}')`;
      activeLayer.classList.add("is-visible");
      restartKenBurns(activeLayer);
      return;
    }

    inactiveLayer.style.backgroundImage = `url('${url}')`;
    inactiveLayer.classList.add("is-visible");
    restartKenBurns(inactiveLayer);

    activeLayer.classList.remove("is-visible");
    const previousLayer = activeLayer;
    activeLayer = inactiveLayer;
    inactiveLayer = previousLayer;

    window.setTimeout(() => {
      inactiveLayer.classList.remove("is-zooming");
    }, transitionMs);
  };

  setBackground(images[index], true);
  if (prefersReduced) return;

  window.setInterval(() => {
    index = (index + 1) % images.length;
    setBackground(images[index]);
  }, slideDurationMs);
}

function persistOrder(payload) {
  const stored = JSON.parse(localStorage.getItem(storageKey) || "[]");
  stored.unshift(payload);
  localStorage.setItem(storageKey, JSON.stringify(stored));
}

function clearCart() {
  cart = [];
  renderCart();
}

function setCheckoutSubmittingState(isSubmitting) {
  orderSubmitting = isSubmitting;
  checkoutSubmitButton = checkoutSubmitButton || cartForm?.querySelector("button[type=\"submit\"]");
  if (checkoutSubmitButton) checkoutSubmitButton.disabled = isSubmitting;
}

function setInlineMessage(element, text = "", tone = "info") {
  if (!element) return;
  element.textContent = text;
  if (tone) {
    element.dataset.tone = tone;
  } else {
    delete element.dataset.tone;
  }
}

function openModal(modalElement) {
  if (!modalElement) return;
  modalElement.classList.remove("hidden");
  modalElement.setAttribute("aria-hidden", "false");
}

function closeModal(modalElement) {
  if (!modalElement) return;
  modalElement.classList.add("hidden");
  modalElement.setAttribute("aria-hidden", "true");
}

function buildCheckoutDraft(name, phone, notes) {
  const items = cart.map((item) => ({
    quantity: Math.max(1, Number(item?.quantity) || 1),
    productKey: getCartItemProductKey(item),
  }));
  return {
    client: name,
    phone,
    notes,
    website: cartForm?.querySelector('input[name="website"]')?.value.trim() || "",
    startedAt: markCartInteractionStarted(),
    items,
    total: totalCartValue(),
    paypalMeta: null,
  };
}

function showOrderSubmissionSuccess(messageKey = "order_success") {
  const message = t(messageKey);
  const successCopy = orderSuccess?.querySelector("p");
  if (successCopy) successCopy.textContent = message;
  if (orderSuccess) {
    clearTimeout(orderSuccessHideTimeoutId);
    orderSuccess.classList.remove("hidden", "is-exiting", "show");
    void orderSuccess.offsetWidth;
    orderSuccess.classList.remove("hidden");
    orderSuccess.classList.add("show");
    clearTimeout(orderSuccessTimeoutId);
    orderSuccessTimeoutId = window.setTimeout(() => {
      hideOrderSuccessMessage();
    }, 3200);
    return;
  }
  showCartToast(message);
}

function resetCheckoutFlow({ clearDraft = true } = {}) {
  paypalCheckoutBusy = false;
  paypalButtonsRendered = false;
  if (paypalButtonsContainer) paypalButtonsContainer.innerHTML = "";
  setInlineMessage(paymentChoiceMessage, "");
  setInlineMessage(paypalStatusMessage, "");
  closeModal(paymentChoiceModal);
  closeModal(paypalCheckoutModal);
  if (clearDraft) checkoutDraft = null;
  setCheckoutSubmittingState(false);
}

async function finalizeOrderSubmission(orderPayload, successMessageKey = "order_success") {
  pendingTrackerPromptOrder = null;
  hideOrderTrackerPrompt();
  const savedOrder = await saveOrder(orderPayload);
  if (!savedOrder) {
    throw new Error("No se pudo guardar la orden en el backend");
  }
  persistOrder(savedOrder);
  rememberTrackedOrder(savedOrder);
  upsertTrackedOrderPreview(savedOrder);
  pendingTrackerPromptOrder = savedOrder;
  syncTrackedOrdersSubscription();
  maybeShowOrderTrackerPrompt();

  clearCart();
  cartForm?.reset();
  if (cartNameInput) cartNameInput.value = "";
  if (cartPhoneInput) cartPhoneInput.value = "";
  if (cartNotesInput) cartNotesInput.value = "";
  cartInteractionStartedAt = 0;
  localStorage.removeItem(cartContactKey);
  if (cartMessage) {
    cartMessage.textContent = "";
    cartMessage.classList.remove("error", "success");
  }
  closeCart();
  showOrderSubmissionSuccess(successMessageKey);
}

function hasPayNowConfig() {
  return Boolean(paypalClientId && (backendApiUrl || (supabaseFunctionsUrl && supabaseAnonKey)) && paymentChoiceModal && paypalCheckoutModal);
}

function isDesktopFileProtocol() {
  return typeof window !== "undefined" && window.location?.protocol === "file:";
}

function resolveCheckoutErrorKey(error, fallbackKey = "order_error") {
  const message = String(error?.message || "").toLowerCase();
  if (isDesktopFileProtocol()) return "payment_local_server_required";
  if (message.includes("origen no autorizado")) return "payment_origin_not_allowed";
  if (message.includes("failed to fetch") || message.includes("networkerror")) {
    return "payment_paypal_not_ready";
  }
  return fallbackKey;
}

async function postSupabaseFunction(functionName, payload = {}) {
  const endpoint = `${supabaseFunctionsUrl}/${functionName}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `Supabase function failed: ${response.status}`);
  }
  return data;
}

async function postBackendFunction(functionName, payload = {}) {
  if (!backendApiUrl) {
    return postSupabaseFunction(functionName, payload);
  }
  const endpoint = `${backendApiUrl}/${functionName}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `Backend function failed: ${response.status}`);
  }
  return data;
}

async function createPayPalOrder(draft) {
  return postBackendFunction("paypal-create-order", {
    client: draft.client,
    phone: draft.phone,
    notes: draft.notes,
    website: draft.website,
    startedAt: draft.startedAt,
    items: draft.items,
    currency: paypalCurrency,
  });
}

async function capturePayPalOrder({ paypalOrderId, internalOrderId = "" }) {
  return postBackendFunction("paypal-capture-order", {
    paypalOrderId,
    internalOrderId,
  });
}

async function ensurePayPalSdkLoaded() {
  if (window.paypal?.Buttons) return window.paypal;
  if (paypalSdkPromise) return paypalSdkPromise;
  paypalSdkPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById("paypal-sdk-js");
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(window.paypal));
      existingScript.addEventListener("error", () => reject(new Error("No se pudo cargar PayPal.")));
      return;
    }
    const script = document.createElement("script");
    script.id = "paypal-sdk-js";
    const sdkUrl = new URL("https://www.paypal.com/sdk/js");
    sdkUrl.searchParams.set("client-id", paypalClientId);
    sdkUrl.searchParams.set("currency", paypalCurrency);
    sdkUrl.searchParams.set("intent", "capture");
    sdkUrl.searchParams.set("components", "buttons");
    script.src = sdkUrl.toString();
    script.async = true;
    script.onload = () => resolve(window.paypal);
    script.onerror = () => reject(new Error("No se pudo cargar PayPal."));
    document.head.appendChild(script);
  });
  return paypalSdkPromise;
}

async function renderPayPalButtons(draft) {
  if (!paypalButtonsContainer) throw new Error("Falta el contenedor de botones PayPal.");
  if (!window.paypal?.Buttons) throw new Error("PayPal no está disponible.");
  paypalButtonsContainer.innerHTML = "";
  const buttons = window.paypal.Buttons({
    style: {
      layout: "vertical",
      color: "gold",
      shape: "rect",
      label: "paypal",
    },
    createOrder: async () => {
      const orderData = await createPayPalOrder(draft);
      draft.paypalMeta = {
        internalOrderId: orderData?.internalOrderId || "",
        paypalOrderId: orderData?.paypalOrderId || orderData?.id || "",
        amount: Number(orderData?.amount) || draft.total,
        currency: orderData?.currency || paypalCurrency,
        usdRate: Number(orderData?.usdRate) || 0,
        usdRateSource: String(orderData?.usdRateSource || ""),
      };
      renderCheckoutTotals(draft);
      const paypalOrderId = draft.paypalMeta.paypalOrderId;
      if (!paypalOrderId) {
        throw new Error("PayPal no devolvió un order id.");
      }
      return paypalOrderId;
    },
    onApprove: async (data) => {
      if (paypalCheckoutBusy) return;
      paypalCheckoutBusy = true;
      setInlineMessage(paypalStatusMessage, t("payment_paypal_processing"), "info");
      try {
        const captureData = await capturePayPalOrder({
          paypalOrderId: data.orderID,
          internalOrderId: draft?.paypalMeta?.internalOrderId || "",
        });
        await finalizeOrderSubmission(
          {
            client: draft.client,
            phone: draft.phone,
            notes: draft.notes,
            website: draft.website,
            startedAt: draft.startedAt,
            items: draft.items,
            paymentMethod: "paypal",
            paypalOrderId: data.orderID || "",
            paypalInternalOrderId: draft?.paypalMeta?.internalOrderId || "",
          },
          "order_success_paid"
        );
        resetCheckoutFlow({ clearDraft: true });
      } catch (error) {
        console.error(error);
        pendingTrackerPromptOrder = null;
        hideOrderTrackerPrompt();
        setInlineMessage(paypalStatusMessage, t("payment_paypal_error"), "error");
        showCartToast(t("order_error"));
        setCheckoutSubmittingState(false);
      } finally {
        paypalCheckoutBusy = false;
      }
    },
    onCancel: () => {
      setInlineMessage(paypalStatusMessage, t("payment_paypal_cancelled"), "info");
      setCheckoutSubmittingState(false);
    },
    onError: (error) => {
      console.error(error);
      setInlineMessage(paypalStatusMessage, t("payment_paypal_error"), "error");
      setCheckoutSubmittingState(false);
    },
  });

  if (!buttons?.isEligible()) {
    throw new Error(t("payment_paypal_not_ready"));
  }
  await buttons.render(paypalButtonsContainer);
  paypalButtonsRendered = true;
}

async function handlePayLaterSelection() {
  if (!checkoutDraft || paypalCheckoutBusy) return;
  if (isDesktopFileProtocol()) {
    const message = t("payment_local_server_required");
    setInlineMessage(paymentChoiceMessage, message, "error");
    showCartToast(message);
    setCheckoutSubmittingState(false);
    return;
  }
  setInlineMessage(paymentChoiceMessage, "");
  try {
    await finalizeOrderSubmission(
      {
        client: checkoutDraft.client,
        phone: checkoutDraft.phone,
        notes: checkoutDraft.notes,
        website: checkoutDraft.website,
        startedAt: checkoutDraft.startedAt,
        items: checkoutDraft.items,
        paymentMethod: "pay_later",
      },
      "order_success_pending"
    );
    resetCheckoutFlow({ clearDraft: true });
  } catch (error) {
    console.error(error);
    pendingTrackerPromptOrder = null;
    hideOrderTrackerPrompt();
    const errorKey = resolveCheckoutErrorKey(error, "order_error");
    const message = t(errorKey);
    setInlineMessage(paymentChoiceMessage, message, "error");
    showCartToast(message);
    setCheckoutSubmittingState(false);
  }
}

async function handlePayNowSelection() {
  if (!checkoutDraft || paypalCheckoutBusy) return;
  if (isDesktopFileProtocol()) {
    setInlineMessage(paymentChoiceMessage, t("payment_local_server_required"), "error");
    setCheckoutSubmittingState(false);
    return;
  }
  if (!hasPayNowConfig()) {
    setInlineMessage(paymentChoiceMessage, t("payment_choice_config_missing"), "error");
    return;
  }
  closeModal(paymentChoiceModal);
  openModal(paypalCheckoutModal);
  renderCheckoutTotals(checkoutDraft);
  setInlineMessage(paypalStatusMessage, t("payment_paypal_loading"), "info");
  try {
    await ensurePayPalSdkLoaded();
    await renderPayPalButtons(checkoutDraft);
    setInlineMessage(paypalStatusMessage, "");
  } catch (error) {
    console.error(error);
    const errorKey = resolveCheckoutErrorKey(error, "payment_paypal_not_ready");
    setInlineMessage(paypalStatusMessage, t(errorKey), "error");
    setCheckoutSubmittingState(false);
  }
}

async function handleOrderSubmit(event) {
  event.preventDefault();
  if (cart.length === 0) {
    cartMessage.textContent = t("cart_need_item");
    cartMessage.classList.remove("success");
    cartMessage.classList.add("error");
    return;
  }
  const name = cartNameInput.value.trim();
  const phone = cartPhoneInput.value.trim();
  const notes = cartNotesInput?.value.trim() || "";
  if (!name || !phone) {
    cartMessage.textContent = t("cart_need_contact");
    cartMessage.classList.add("error");
    cartMessage.classList.remove("success");
    return;
  }
  if (orderSubmitting) return;
  pendingTrackerPromptOrder = null;
  hideOrderTrackerPrompt();
  checkoutDraft = buildCheckoutDraft(name, phone, notes);
  setCheckoutSubmittingState(true);
  setInlineMessage(paymentChoiceMessage, "");
  setInlineMessage(paypalStatusMessage, "");
  renderCheckoutTotals(checkoutDraft);
  if (paymentChoiceModal) {
    if (payNowButton) payNowButton.disabled = !hasPayNowConfig();
    if (!hasPayNowConfig()) {
      setInlineMessage(paymentChoiceMessage, t("payment_choice_config_missing"), "info");
    }
    openModal(paymentChoiceModal);
    return;
  }
  await handlePayLaterSelection();
}

window.addEventListener("DOMContentLoaded", () => {
  resetDisplaySequenceIfNeeded();
  document.querySelectorAll(".add-to-cart").forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest(".card");
      if (card) addToCart(card, button);
    });
  });
  cartToggle?.addEventListener("click", openCart);
  const menuToggle = document.getElementById("menu-toggle");
  const navLinks = document.getElementById("nav-links");
  const closeNav = () => {
    navLinks?.classList.remove("show");
    menuToggle?.classList.remove("open");
    document.body.classList.remove("menu-open");
  };
  menuToggle?.addEventListener("click", () => {
    navLinks?.classList.toggle("show");
    menuToggle.classList.toggle("open");
    document.body.classList.toggle("menu-open");
  });
  document.addEventListener("click", (event) => {
    if (!navLinks?.classList.contains("show")) return;
    const clickedInside =
      navLinks.contains(event.target) || menuToggle?.contains(event.target);
    if (!clickedInside) {
      closeNav();
    }
  });
  orderSuccess?.addEventListener("click", () => {
    hideOrderSuccessMessage();
  });
  orderTrackerPromptAction?.addEventListener("click", () => {
    scrollToTrackedOrders();
    hideOrderTrackerPrompt();
  });
  orderTrackerPromptClose?.addEventListener("click", () => {
    hideOrderTrackerPrompt();
  });
  customerOrderNotesInput?.addEventListener("input", () => {
    syncCustomerNotesEditor();
  });
  customerOrderNotesReset?.addEventListener("click", () => {
    if (!customerOrderNotesInput) return;
    customerOrderNotesInput.value = customerNotesOriginalValue;
    setCustomerNotesMessage();
    syncCustomerNotesEditor();
  });
  customerOrderNotesSave?.addEventListener("click", () => {
    handleCustomerNotesSave();
  });
  customerOrderModal?.addEventListener("click", (event) => {
    const closeTarget = event.target.closest("[data-close=\"true\"]");
    if (closeTarget) closeCustomerOrderModal();
  });
  document.addEventListener("click", (event) => {
    const detailBtn = event.target.closest(".tracker-detail-btn");
    if (!detailBtn) return;
    openCustomerOrderModal(detailBtn.dataset.trackingKey || "");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (paypalCheckoutModal && !paypalCheckoutModal.classList.contains("hidden") && !paypalCheckoutBusy) {
        resetCheckoutFlow({ clearDraft: true });
        return;
      }
      if (paymentChoiceModal && !paymentChoiceModal.classList.contains("hidden")) {
        resetCheckoutFlow({ clearDraft: true });
        return;
      }
      closeCustomerOrderModal();
    }
  });
  payLaterButton?.addEventListener("click", () => {
    handlePayLaterSelection();
  });
  payNowButton?.addEventListener("click", () => {
    handlePayNowSelection();
  });
  paymentChoiceModal?.addEventListener("click", (event) => {
    const closeTarget = event.target.closest("[data-close-payment-choice=\"true\"]");
    if (!closeTarget) return;
    resetCheckoutFlow({ clearDraft: true });
  });
  paypalCheckoutModal?.addEventListener("click", (event) => {
    const closeTarget = event.target.closest("[data-close-paypal-modal=\"true\"]");
    if (!closeTarget || paypalCheckoutBusy) return;
    resetCheckoutFlow({ clearDraft: true });
  });
  cartClose?.addEventListener("click", closeCart);
  cartOverlay?.addEventListener("click", (event) => {
    if (event.target === cartOverlay) closeCart();
  });
  cartForm?.addEventListener("submit", handleOrderSubmit);
  navLinks?.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      if (navLinks.classList.contains("show")) {
        closeNav();
      }
    });
  });
  const quoteForm = document.getElementById("quote-form");
  const quoteMessage = document.getElementById("quote-message");
  if (quoteForm && !quoteForm.dataset.startedAt) {
    quoteForm.dataset.startedAt = String(Date.now());
  }
  initHeroCarousel();
  loadCartState();
  loadCartContact();
  trackedOrderRefs = getTrackedOrderRefs();
  syncTrackedOrdersSubscription();
  loadQuoteDraft(quoteForm);
  const handleCartInput = () => {
    markCartInteractionStarted();
    saveCartContact();
  };
  cartNameInput?.addEventListener("input", handleCartInput);
  cartPhoneInput?.addEventListener("input", handleCartInput);
  cartNotesInput?.addEventListener("input", handleCartInput);
  quoteForm?.addEventListener("input", () => saveQuoteDraft(quoteForm));
  quoteForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    quoteMessage.classList.remove("success", "error");
    quoteMessage.textContent = t("quote_sending");
    const formData = new FormData(quoteForm);
    const payload = {
      name: formData.get("name")?.toString() || "",
      email: formData.get("email")?.toString() || "",
      phone: formData.get("phone")?.toString() || "",
      event_date: formData.get("event_date")?.toString() || "",
      details: formData.get("details")?.toString() || "",
      website: formData.get("website")?.toString() || "",
      startedAt: Number(quoteForm?.dataset.startedAt || Date.now()),
    };
    const saved = await saveQuote(payload);
    if (saved) {
      quoteMessage.textContent = t("quote_sent");
      quoteMessage.classList.add("success");
      quoteForm.reset();
      quoteForm.dataset.startedAt = String(Date.now());
      localStorage.removeItem(quoteDraftKey);
      quoteForm.querySelector("input[name=\"name\"]")?.focus();
      window.dispatchEvent(new CustomEvent("quote-added", { detail: payload }));
    } else {
      quoteMessage.textContent = t("quote_error");
      quoteMessage.classList.add("error");
    }
  });
  renderCart();
  renderTrackedOrders();
  setInterval(() => {
    if (purgeExpiredTrackedOrders()) {
      syncTrackedOrdersSubscription();
      return;
    }
    renderTrackedOrders();
  }, 1000);

  const headerTimeEl = document.getElementById("current-time");
  const tempEl = document.getElementById("current-temp");
  const refreshHeaderTime = () => {
    if (!headerTimeEl) return;
    const time = new Date();
    const formatted = time.toLocaleTimeString("es-HN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      second: "2-digit",
      timeZone: "America/Tegucigalpa",
    });
    headerTimeEl.textContent = `${formatted} · El Progreso`;
    if (tempEl) {
      tempEl.textContent = "29°C";
    }
  };
  refreshHeaderTime();
  setInterval(refreshHeaderTime, 1000);
  const langToggle = document.getElementById("lang-toggle");
  const savedLang = localStorage.getItem("bekys_lang") || "es";
  applyTranslations(savedLang);
  if (langToggle) {
    langToggle.textContent = savedLang.toUpperCase();
    langToggle.addEventListener("click", () => {
      const nextLang = currentLang === "es" ? "en" : "es";
      localStorage.setItem("bekys_lang", nextLang);
      applyTranslations(nextLang);
      langToggle.textContent = nextLang.toUpperCase();
      renderTrackedOrders();
    });
  }

  const revealTargets = document.querySelectorAll(
    ".hero-content, .hero-media, .section-heading, .cards .card, .steps article, .experience-grid article, .order-tracker-section, .quote, .contact"
  );
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!prefersReduced && "IntersectionObserver" in window) {
    const revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" }
    );
    revealTargets.forEach((element, index) => {
      element.classList.add("reveal");
      element.style.setProperty("--reveal-delay", `${Math.min(index * 60, 240)}ms`);
      revealObserver.observe(element);
    });
  } else {
    revealTargets.forEach((element) => {
      element.classList.add("reveal", "is-visible");
    });
  }
});

const scrollLinks = document.querySelectorAll('a[href^="#"]');
scrollLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const targetId = link.getAttribute("href");
    const target = document.querySelector(targetId);
    if (target) {
      const headerHeight = document.querySelector(".nav")?.offsetHeight || 80;
      const offset = target.offsetTop - headerHeight - 16;
      window.scrollTo({ top: offset, behavior: "smooth" });
    }
  });
});

