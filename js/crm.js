import {
  fetchOrders,
  fetchMetrics,
  fetchCalendarStatuses,
  fetchQuotes,
  subscribeOrders,
  subscribeQuotes,
  updateOrderStatus,
  updateOrderNotes,
  deleteOrder,
  deleteQuote,
  loginWithEmail,
  resolveUsernameToEmail,
  logout,
  observeAuthState,
  registerForOrderNotifications,
  refreshOrderNotificationRegistration,
  unregisterForOrderNotifications,
  listenForForegroundMessages,
} from "./firebase-client.js";

const localStorageKey = "bekys_cart_orders";
const orderDisplayKey = "bekys_order_display_seq";
const orderDisplayMapKey = "bekys_order_display_map";
const orderDisplayResetKey = "bekys_order_display_reset";
const displayResetVersion = "2026-03-15-1";
const useLocalOrders = false;
let remoteOrders = [];
let localOrders = [];
let calendarStatuses = {};
let metrics = { day: 0, week: 0, month: 0 };
let quotes = [];
let unsubscribeOrders = null;
let unsubscribeQuotes = null;
let dataLoaded = false;
let normalizedOrdersCache = [];
let selectedDate = null;
let orderIndex = new Map();
let openOrderId = null;
let calendarMonth = null;
let calendarYear = null;
let currentSummaryRange = "day";
let daySearchQuery = "";
let dedupeInProgress = false;
let lastDedupeAt = 0;
const notificationsTokenKey = "bekys_notifications_token";
const vapidPublicKey =
  document.querySelector('meta[name="firebase-vapid-key"]')?.content.trim() ||
  "REEMPLAZA_CON_TU_VAPID_KEY";
let ordersInitialized = false;
let quotesInitialized = false;
let knownOrderIds = new Set();
let knownQuoteIds = new Set();
let crmToastTimeout = null;
let crmToastHideTimeout = null;
let titleBlinkTimer = null;
let baseTitle = document.title;
let displayIdMap = {};
let pendingDeepLinkOrderId = "";
let notificationRefreshInProgress = false;
let lastNotificationRefreshAt = 0;
let orderNotesSaving = false;
let orderNotesSavingOrderId = "";
let orderNotesOriginalValue = "";
let orderNotesAutosaveTimer = null;
let orderNotesQueuedOrderId = "";
let orderNotesQueuedValue = "";
let orderNotesFlushAfterSave = false;
const orderNotesAutosaveDelay = 700;

const i18n = {
  es: {
    crm_nav_site: "Sitio del cliente",
    crm_nav_dashboard: "Dashboard",
    crm_nav_orders: "Pedidos",
    crm_sign_out: "Cerrar sesión",
    crm_eyebrow: "Operaciones",
    crm_title: "Monitorea pedidos y métricas en tiempo real",
    crm_subtitle:
      "Panel diseñado para los representantes: calendario, pedidos recientes y estadísticas por día, semana y mes.",
    crm_cta_primary: "Ver métricas",
    crm_cta_secondary: "Reportar incidencia",
    crm_login_title: "Ingresar al CRM",
    crm_login_subtitle: "Utiliza tus credenciales de representante para acceder.",
    crm_login_email: "Usuario o correo",
    crm_login_password: "Contraseña",
    crm_login_submit: "Entrar",
    crm_panel_eyebrow: "Panel",
    crm_panel_title: "Resumen del día",
    crm_panel_subtitle:
      "Este módulo muestra datos preliminares; en cuanto conectes Supabase todo se actualizará automáticamente.",
    crm_metrics_title: "Métricas clave",
    crm_metrics_day: "Día",
    crm_metrics_week: "Semana",
    crm_metrics_month: "Mes",
    crm_metrics_orders: "pedidos",
    crm_metrics_refresh: "Actualizar",
    crm_metrics_sync: "Sincronizar",
    crm_calendar_title: "Calendario de ventas",
    crm_calendar_subtitle: "Selecciona fecha para revisar ventas entregadas y sus pedidos.",
    crm_calendar_orders: "{count} pedidos",
    crm_calendar_revenue: "{total} vendidos",
    crm_orders_title: "Pedidos recientes",
    crm_orders_empty: "Aún no hay pedidos registrados.",
    crm_day_title: "Resumen por fecha",
    crm_day_label: "Fecha",
    crm_day_orders: "Pedidos",
    crm_day_revenue: "Ingresos",
    crm_day_products_title: "Productos vendidos",
    crm_day_units: "unidades",
    crm_day_customers: "Clientes",
    crm_day_empty: "No hay pedidos para esta fecha.",
    crm_day_detail_title: "Detalle del día",
    crm_day_search_label: "Buscar pedidos",
    crm_day_search_ph: "Buscar por cliente, número o producto",
    crm_day_review: "Ver pedido",
    crm_day_hide: "Ocultar pedido",
    crm_modal_eyebrow: "Pedido",
    crm_modal_close: "Cerrar",
    crm_modal_next: "Siguiente estado",
    crm_action_deliver: "Entregar",
    crm_action_reject: "Rechazar",
    crm_action_delete: "Eliminar",
    crm_delete_eyebrow: "Pedido",
    crm_delete_title: "¿Eliminar pedido?",
    crm_delete_body: "Esta acción no se puede deshacer.",
    crm_delete_confirm: "Sí, eliminar",
    crm_delete_cancel: "Cancelar",
    crm_summary_title: "Resumen (Hoy)",
    crm_summary_subtitle: "Gestión operacional en tiempo real para representantes.",
    crm_summary_tab_day: "Hoy",
    crm_summary_tab_week: "Semana",
    crm_summary_tab_month: "Mes",
    crm_summary_ops: "Operación",
    crm_summary_sales: "Ventas",
    crm_summary_orders: "Pedidos",
    crm_summary_pending: "Pendientes",
    crm_summary_prep: "En preparación",
    crm_summary_ready: "Listos",
    crm_summary_delivered: "Entregados",
    crm_summary_reservations: "Reservas",
    crm_summary_revenue: "Ingresos",
    crm_summary_ticket: "Ticket promedio",
    crm_orders_eyebrow: "Gestión",
    crm_orders_heading: "Pedidos",
    crm_orders_subtitle: "Revisa y organiza tus pedidos por estado.",
    crm_filter_all: "Todos",
    crm_filter_pending: "Pendiente",
    crm_filter_prep: "En preparación",
    crm_filter_ready: "Listo",
    crm_filter_delivered: "Entregado",
    crm_filter_rejected: "Rechazado",
    crm_filter_search_ph: "Buscar cliente, teléfono o producto",
    crm_filter_status_all: "Todos los estados",
    crm_filter_status_pending: "Pendiente",
    crm_filter_status_confirmed: "Confirmado",
    crm_filter_status_baking: "En horno",
    crm_filter_status_packed: "Empaquetado",
    crm_filter_status_delivery: "En reparto",
    crm_filter_status_ready: "Listo",
    crm_filter_start_ph: "Desde",
    crm_filter_end_ph: "Hasta",
    crm_filter_clear: "Limpiar",
    crm_table_date: "Fecha",
    crm_table_time: "Hora",
    crm_table_customer: "Cliente",
    crm_table_phone: "Teléfono",
    crm_table_items: "Productos",
    crm_table_total: "Total",
    crm_table_status: "Estado",
    crm_detail_title: "Detalle del pedido",
    crm_detail_placeholder: "Selecciona un pedido para ver toda la información.",
    crm_track_eyebrow: "Seguimiento",
    crm_track_title: "Indicadores de entrega",
    crm_track_subtitle:
      "Sin pedidos activos todavía, los contadores se mantienen en cero hasta que recibas nuevos encargos.",
    crm_status_processing: "En proceso",
    crm_status_packed: "Empaquetado",
    crm_status_delivery: "En reparto",
    crm_status_ready: "Listos",
    crm_quotes_eyebrow: "Cotizaciones",
    crm_quotes_title: "Solicitudes recientes",
    crm_quotes_subtitle: "Revisa lo que tus clientes han pedido para planificar sabores, fechas y contactos.",
    crm_notifications_title: "Notificaciones",
    crm_notifications_body:
      "Recibe alertas en tu celular o computadora cuando haya nuevos pedidos o cotizaciones.",
    crm_notifications_enable: "Activar notificaciones",
    crm_notifications_disable: "Desactivar",
    crm_notifications_enabled: "Notificaciones activadas.",
    crm_notifications_disabled: "Notificaciones desactivadas.",
    crm_notifications_unsupported: "Este dispositivo no soporta notificaciones web.",
    crm_notifications_denied: "Permiso denegado. Activalo en el navegador.",
    crm_notifications_missing_key: "Configura la clave VAPID antes de activar.",
    crm_notifications_insecure: "Abre el CRM con https://bekyscake.com/crm para activar notificaciones.",
    crm_notifications_ios_install:
      "En iPhone, abre el CRM en Safari, agregalo a la pantalla de inicio y activa desde ahi.",
    crm_notifications_ios_reinstall:
      "En iPhone, elimina el icono anterior, vuelve a agregar el CRM a la pantalla de inicio y activa desde ahi.",
    crm_notifications_service_worker: "No se pudo preparar el servicio de notificaciones. Recarga e intenta de nuevo.",
    crm_notifications_token:
      "Firebase no devolvio un token. Recarga la pagina, confirma que el permiso este permitido e intenta de nuevo.",
    crm_notifications_invalid_vapid: "La clave Web Push de Firebase no coincide con este proyecto.",
    crm_notifications_register: "Se genero el token, pero no se pudo guardar en el CRM. Intenta iniciar sesion de nuevo.",
    crm_notifications_network: "No se pudo conectar para activar las notificaciones. Revisa tu internet.",
    crm_notifications_error: "No se pudieron activar las notificaciones.",
    crm_notifications_foreground: "Nuevo pedido recibido. Revisa el panel.",
    crm_alert_order: "Nuevo pedido: {client} · {total}",
    crm_alert_quote: "Nueva cotización: {name}",
    crm_quotes_empty_title: "No hay solicitudes nuevas",
    crm_quotes_empty_body: "Aún no se ha enviado ninguna cotización.",
    crm_quote_email: "Correo",
    crm_quote_phone: "Teléfono",
    crm_quote_event: "Fecha estimada",
    crm_quote_status: "Estado",
    crm_quote_sent: "Enviado",
    crm_quote_details: "Detalles",
    crm_quote_eyebrow: "Cotización",
    crm_quote_delete: "Eliminar",
    crm_quote_delete_confirm: "¿Seguro que deseas eliminar esta cotización?",
    crm_quote_delete_title: "¿Eliminar cotización?",
    crm_quote_delete_body: "Esta acción no se puede deshacer.",
    crm_footer: "© Beky's Cake 2026 · CRM operativo · Datos listos para enlazar con Supabase.",
    crm_auth_missing: "Completa ambos campos",
    crm_auth_checking: "Verificando credenciales...",
    crm_auth_invalid: "Usuario o correo y contraseña inválidos",
    crm_auth_welcome: "Bienvenido",
    crm_auth_user_not_found: "El usuario o correo no existe en el sistema",
    crm_auth_wrong_password: "La contraseña es incorrecta",
    crm_auth_invalid_email: "El usuario o correo no es válido",
    crm_auth_user_disabled: "El usuario está deshabilitado",
    crm_auth_too_many_requests: "Demasiados intentos. Intenta más tarde",
    crm_auth_unauthorized_domain: "Dominio no autorizado para iniciar sesión",
    crm_auth_network: "Error de red. Revisa tu conexión",
    crm_auth_unknown: "No se pudo iniciar sesión. Revisa tus datos",
    crm_detail_customer: "Cliente",
    crm_detail_phone: "Teléfono",
    crm_detail_date: "Fecha",
    crm_detail_time: "Hora",
    crm_detail_status: "Estado",
    crm_detail_total: "Total",
    crm_detail_items: "Productos",
    crm_detail_notes: "Notas",
    crm_detail_payment_status: "Estado de pago",
    crm_detail_payment_method: "Metodo de pago",
    crm_payment_paid: "Pagado",
    crm_payment_pending: "Pendiente",
    crm_payment_method_paypal: "PayPal",
    crm_payment_method_pay_later: "Pagar luego",
    crm_notes_unlimited_badge: "Edición libre",
    crm_notes_ph: "Actualiza las notas del cliente cuando sea necesario.",
    crm_notes_help: "",
    crm_notes_reset: "Restablecer",
    crm_notes_save: "Guardar notas",
    crm_notes_autosave_idle: "Guardado",
    crm_notes_autosave_pending: "Guardando...",
    crm_notes_save_busy: "Guardando...",
    crm_notes_save_success: "Guardado",
    crm_notes_save_error: "No se pudieron actualizar las notas. Intenta de nuevo.",
    crm_notes_save_toast: "Se ha guardado el cambio.",
    crm_detail_source: "Fuente",
    crm_table_empty: "No hay pedidos que coincidan con los filtros.",
    crm_sync_ready: "Sincronizado",
    crm_sync_saving: "Guardando...",
    crm_sync_error: "Error de sincronización",
    crm_sync_offline: "Sin conexión",
    crm_sync_loading: "Conectando...",
  },
  en: {
    crm_nav_site: "Client site",
    crm_nav_dashboard: "Dashboard",
    crm_nav_orders: "Orders",
    crm_sign_out: "Sign out",
    crm_eyebrow: "Operations",
    crm_title: "Monitor orders and metrics in real time",
    crm_subtitle:
      "Representative panel: calendar, recent orders, and daily/weekly/monthly stats.",
    crm_cta_primary: "View metrics",
    crm_cta_secondary: "Report issue",
    crm_login_title: "Sign in to CRM",
    crm_login_subtitle: "Use your representative credentials to access.",
    crm_login_email: "Username or email",
    crm_login_password: "Password",
    crm_login_submit: "Sign in",
    crm_panel_eyebrow: "Panel",
    crm_panel_title: "Today’s summary",
    crm_panel_subtitle:
      "This module shows preliminary data; once Supabase is connected it will update automatically.",
    crm_metrics_title: "Key metrics",
    crm_metrics_day: "Day",
    crm_metrics_week: "Week",
    crm_metrics_month: "Month",
    crm_metrics_orders: "orders",
    crm_metrics_refresh: "Refresh",
    crm_metrics_sync: "Sync",
    crm_calendar_title: "Sales calendar",
    crm_calendar_subtitle: "Select a date to review delivered sales and their orders.",
    crm_calendar_orders: "{count} orders",
    crm_calendar_revenue: "{total} sold",
    crm_orders_title: "Recent orders",
    crm_orders_empty: "No orders yet.",
    crm_day_title: "Date summary",
    crm_day_label: "Date",
    crm_day_orders: "Orders",
    crm_day_revenue: "Revenue",
    crm_day_products_title: "Products sold",
    crm_day_units: "units",
    crm_day_customers: "Customers",
    crm_day_empty: "No orders for this date.",
    crm_day_detail_title: "Day details",
    crm_day_search_label: "Search orders",
    crm_day_search_ph: "Search by customer, number, or item",
    crm_day_review: "View order",
    crm_day_hide: "Hide order",
    crm_modal_eyebrow: "Order",
    crm_modal_close: "Close",
    crm_modal_next: "Next status",
    crm_action_deliver: "Deliver",
    crm_action_reject: "Reject",
    crm_action_delete: "Delete",
    crm_delete_eyebrow: "Order",
    crm_delete_title: "Delete order?",
    crm_delete_body: "This action cannot be undone.",
    crm_delete_confirm: "Yes, delete",
    crm_delete_cancel: "Cancel",
    crm_summary_title: "Summary (Today)",
    crm_summary_subtitle: "Real-time operational management for representatives.",
    crm_summary_tab_day: "Today",
    crm_summary_tab_week: "Week",
    crm_summary_tab_month: "Month",
    crm_summary_ops: "Operations",
    crm_summary_sales: "Sales",
    crm_summary_orders: "Orders",
    crm_summary_pending: "Pending",
    crm_summary_prep: "In preparation",
    crm_summary_ready: "Ready",
    crm_summary_delivered: "Delivered",
    crm_summary_reservations: "Reservations",
    crm_summary_revenue: "Revenue",
    crm_summary_ticket: "Avg ticket",
    crm_orders_eyebrow: "Management",
    crm_orders_heading: "Orders",
    crm_orders_subtitle: "Review and organize orders by status.",
    crm_filter_all: "All",
    crm_filter_pending: "Pending",
    crm_filter_prep: "In preparation",
    crm_filter_ready: "Ready",
    crm_filter_delivered: "Delivered",
    crm_filter_rejected: "Rejected",
    crm_filter_search_ph: "Search customer, phone, or product",
    crm_filter_status_all: "All statuses",
    crm_filter_status_pending: "Pending",
    crm_filter_status_confirmed: "Confirmed",
    crm_filter_status_baking: "Baking",
    crm_filter_status_packed: "Packed",
    crm_filter_status_delivery: "Out for delivery",
    crm_filter_status_ready: "Ready",
    crm_filter_start_ph: "From",
    crm_filter_end_ph: "To",
    crm_filter_clear: "Clear",
    crm_table_date: "Date",
    crm_table_time: "Time",
    crm_table_customer: "Customer",
    crm_table_phone: "Phone",
    crm_table_items: "Items",
    crm_table_total: "Total",
    crm_table_status: "Status",
    crm_detail_title: "Order details",
    crm_detail_placeholder: "Select an order to view full details.",
    crm_track_eyebrow: "Tracking",
    crm_track_title: "Delivery indicators",
    crm_track_subtitle: "No active orders yet; counters stay at zero until new orders arrive.",
    crm_status_processing: "In progress",
    crm_status_packed: "Packed",
    crm_status_delivery: "Out for delivery",
    crm_status_ready: "Ready",
    crm_quotes_eyebrow: "Quotes",
    crm_quotes_title: "Recent requests",
    crm_quotes_subtitle: "Review client requests to plan flavors, dates, and contacts.",
    crm_notifications_title: "Notifications",
    crm_notifications_body:
      "Get alerts on your phone or computer whenever a new order or quote arrives.",
    crm_notifications_enable: "Enable notifications",
    crm_notifications_disable: "Disable",
    crm_notifications_enabled: "Notifications enabled.",
    crm_notifications_disabled: "Notifications disabled.",
    crm_notifications_unsupported: "This device does not support web notifications.",
    crm_notifications_denied: "Permission denied. Enable it in the browser.",
    crm_notifications_missing_key: "Configure the VAPID key before enabling.",
    crm_notifications_insecure: "Open the CRM with https://bekyscake.com/crm to enable notifications.",
    crm_notifications_ios_install:
      "On iPhone, open the CRM in Safari, add it to the home screen, then enable notifications there.",
    crm_notifications_ios_reinstall:
      "On iPhone, remove the old home screen icon, add the CRM again, then enable notifications there.",
    crm_notifications_service_worker: "The notification service could not be prepared. Reload and try again.",
    crm_notifications_token:
      "Firebase did not return a token. Reload the page, confirm permission is allowed, and try again.",
    crm_notifications_invalid_vapid: "The Firebase Web Push key does not match this project.",
    crm_notifications_register: "The token was generated, but it could not be saved in the CRM. Try signing in again.",
    crm_notifications_network: "Could not connect to enable notifications. Check your internet connection.",
    crm_notifications_error: "Notifications could not be enabled.",
    crm_notifications_foreground: "New order received. Check the panel.",
    crm_alert_order: "New order: {client} · {total}",
    crm_alert_quote: "New quote: {name}",
    crm_quotes_empty_title: "No new requests",
    crm_quotes_empty_body: "No quotes have been submitted yet.",
    crm_quote_email: "Email",
    crm_quote_phone: "Phone",
    crm_quote_event: "Estimated date",
    crm_quote_status: "Status",
    crm_quote_sent: "Submitted",
    crm_quote_details: "Details",
    crm_quote_eyebrow: "Quote",
    crm_quote_delete: "Delete",
    crm_quote_delete_confirm: "Are you sure you want to delete this quote?",
    crm_quote_delete_title: "Delete quote?",
    crm_quote_delete_body: "This action cannot be undone.",
    crm_footer: "© Beky's Cake 2026 · Live CRM · Data ready to connect with Supabase.",
    crm_auth_missing: "Complete both fields",
    crm_auth_checking: "Checking credentials...",
    crm_auth_invalid: "Invalid username or email or password",
    crm_auth_welcome: "Welcome",
    crm_auth_user_not_found: "Username or email not found",
    crm_auth_wrong_password: "Incorrect password",
    crm_auth_invalid_email: "Invalid username or email",
    crm_auth_user_disabled: "User is disabled",
    crm_auth_too_many_requests: "Too many attempts. Try later",
    crm_auth_unauthorized_domain: "Unauthorized domain for sign-in",
    crm_auth_network: "Network error. Check your connection",
    crm_auth_unknown: "Unable to sign in. Check your details",
    crm_detail_customer: "Customer",
    crm_detail_phone: "Phone",
    crm_detail_date: "Date",
    crm_detail_time: "Time",
    crm_detail_status: "Status",
    crm_detail_total: "Total",
    crm_detail_items: "Items",
    crm_detail_notes: "Notes",
    crm_detail_payment_status: "Payment status",
    crm_detail_payment_method: "Payment method",
    crm_payment_paid: "Paid",
    crm_payment_pending: "Pending",
    crm_payment_method_paypal: "PayPal",
    crm_payment_method_pay_later: "Pay later",
    crm_notes_unlimited_badge: "Unlimited edits",
    crm_notes_ph: "Update the customer's notes whenever needed.",
    crm_notes_help: "",
    crm_notes_reset: "Reset",
    crm_notes_save: "Save notes",
    crm_notes_autosave_idle: "Saved",
    crm_notes_autosave_pending: "Saving...",
    crm_notes_save_busy: "Saving...",
    crm_notes_save_success: "Saved",
    crm_notes_save_error: "Could not update the notes. Please try again.",
    crm_notes_save_toast: "Your change has been saved.",
    crm_detail_source: "Source",
    crm_table_empty: "No orders match the selected filters.",
    crm_sync_ready: "Synced",
    crm_sync_saving: "Saving...",
    crm_sync_error: "Sync error",
    crm_sync_offline: "Offline",
    crm_sync_loading: "Connecting...",
  },
};

let currentLang = "es";
let syncState = "offline";

function fixMojibake(value) {
  if (typeof value !== "string") return value;
  if (!/[ÃÂâ�]/.test(value)) return value;

  const cp1252Map = {
    "€": 0x80,
    "‚": 0x82,
    "ƒ": 0x83,
    "„": 0x84,
    "…": 0x85,
    "†": 0x86,
    "‡": 0x87,
    "ˆ": 0x88,
    "‰": 0x89,
    "Š": 0x8a,
    "‹": 0x8b,
    "Œ": 0x8c,
    "Ž": 0x8e,
    "‘": 0x91,
    "’": 0x92,
    "“": 0x93,
    "”": 0x94,
    "•": 0x95,
    "–": 0x96,
    "—": 0x97,
    "˜": 0x98,
    "™": 0x99,
    "š": 0x9a,
    "›": 0x9b,
    "œ": 0x9c,
    "ž": 0x9e,
    "Ÿ": 0x9f,
  };

  const decodeOnce = (input) => {
    const bytes = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i];
      const code = input.charCodeAt(i);
      if (code <= 0xff) {
        bytes[i] = code;
      } else if (cp1252Map[ch] !== undefined) {
        bytes[i] = cp1252Map[ch];
      } else {
        bytes[i] = 0x3f;
      }
    }
    return new TextDecoder("utf-8").decode(bytes);
  };

  let fixed = value;
  for (let i = 0; i < 2; i += 1) {
    if (!/[ÃÂâ]/.test(fixed)) break;
    fixed = decodeOnce(fixed);
  }
  return fixed;
}

function t(key) {
  const dict = i18n[currentLang] || i18n.es;
  const raw = dict[key] || i18n.es[key] || key;
  return fixMojibake(raw);
}

function tWithVars(key, vars = {}) {
  let str = t(key);
  Object.keys(vars).forEach((k) => {
    str = str.replace(new RegExp(`\\{${k}\\}`, "g"), vars[k]);
  });
  return str;
}

function formatCalendarOrderCount(count) {
  const total = Math.max(0, Number(count) || 0);
  if (!total) return "-";
  const label = currentLang === "es"
    ? (total === 1 ? "pedido" : "pedidos")
    : (total === 1 ? "order" : "orders");
  return `
    <span class="order-count-number">${total}</span>
    <span class="order-count-label">${label}</span>
  `;
}

function getRequestedOrderId() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("order")?.trim() || "";
  } catch (error) {
    return "";
  }
}

function syncOrderUrl(orderId = "") {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  if (orderId) {
    url.searchParams.set("order", orderId);
  } else {
    url.searchParams.delete("order");
  }
  window.history.replaceState({}, "", url);
  pendingDeepLinkOrderId = orderId;
}

function tryOpenDeepLinkedOrder() {
  const crmBody = document.getElementById("crm-body");
  if (!pendingDeepLinkOrderId || crmBody?.classList.contains("locked")) return false;
  const order = orderIndex.get(pendingDeepLinkOrderId);
  if (!order) return false;
  openOrderModal(order.id, { syncUrl: false });
  return true;
}

function applyTranslations(lang) {
  currentLang = lang;
  document.documentElement.setAttribute("lang", lang);
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key) return;
    const translated = t(key);
    if (translated !== key) {
      el.textContent = translated;
    }
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key) el.setAttribute("placeholder", t(key));
  });
  setSyncStatus(syncState);
  if (openOrderId && !document.getElementById("order-modal")?.classList.contains("hidden")) {
    openOrderModal(openOrderId, { syncUrl: false });
  }
}

function setSyncStatus(state) {
  syncState = state;
  const syncEl = document.getElementById("sync-status");
  const syncText = document.getElementById("sync-status-text");
  if (!syncEl || !syncText) return;
  syncEl.dataset.state = state;
  let key = "crm_sync_ready";
  if (state === "saving") key = "crm_sync_saving";
  if (state === "error") key = "crm_sync_error";
  if (state === "offline") key = "crm_sync_offline";
  if (state === "loading") key = "crm_sync_loading";
  syncText.textContent = t(key);
}

let notificationsEnableBtn = null;
let notificationsDisableBtn = null;
let notificationsMessageEl = null;
let crmToastEl = null;
let detachForegroundMessages = null;

function setNotificationMessage(text, tone = "info") {
  if (!notificationsMessageEl) return;
  notificationsMessageEl.textContent = text || "";
  notificationsMessageEl.classList.remove("success", "error");
  if (tone === "success") notificationsMessageEl.classList.add("success");
  if (tone === "error") notificationsMessageEl.classList.add("error");
}

function updateNotificationButtons(enabled) {
  if (!notificationsEnableBtn || !notificationsDisableBtn) return;
  notificationsEnableBtn.classList.toggle("hidden", enabled);
  notificationsDisableBtn.classList.toggle("hidden", !enabled);
}

function getNotificationErrorMessage(reason) {
  if (reason === "unsupported") return t("crm_notifications_unsupported");
  if (reason === "denied") return t("crm_notifications_denied");
  if (reason === "missing-vapid") return t("crm_notifications_missing_key");
  if (reason === "insecure") return t("crm_notifications_insecure");
  if (reason === "ios-install") return t("crm_notifications_ios_install");
  if (reason === "ios-reinstall") return t("crm_notifications_ios_reinstall");
  if (reason === "service-worker") return t("crm_notifications_service_worker");
  if (reason === "token") return t("crm_notifications_token");
  if (reason === "invalid-vapid") return t("crm_notifications_invalid_vapid");
  if (reason === "register") return t("crm_notifications_register");
  if (reason === "network") return t("crm_notifications_network");
  return t("crm_notifications_error");
}

async function ensureForegroundMessagesListener() {
  if (detachForegroundMessages) return;
  detachForegroundMessages = await listenForForegroundMessages((payload) => {
    const title = payload?.notification?.title || "";
    const body = payload?.notification?.body || "";
    const message = title
      ? `${title}${body ? ` - ${body}` : ""}`
      : t("crm_notifications_foreground");
    setNotificationMessage(message, "success");
  });
}

async function refreshStoredNotificationRegistration() {
  const storedToken = localStorage.getItem(notificationsTokenKey);
  if (!storedToken || notificationRefreshInProgress) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const now = Date.now();
  if (now - lastNotificationRefreshAt < 5 * 60 * 1000) return;

  notificationRefreshInProgress = true;
  lastNotificationRefreshAt = now;
  try {
    const result = await refreshOrderNotificationRegistration({
      vapidKey: vapidPublicKey,
      deviceLabel: typeof navigator !== "undefined" ? navigator.platform || "web" : "web",
    });
    if (result?.ok && result.token) {
      localStorage.setItem(notificationsTokenKey, result.token);
      updateNotificationButtons(true);
      void ensureForegroundMessagesListener();
    }
  } catch (error) {
    console.warn("No se pudo refrescar el registro de notificaciones:", error);
  } finally {
    notificationRefreshInProgress = false;
  }
}

function showCrmToast(message) {
  if (!crmToastEl) return;
  clearTimeout(crmToastTimeout);
  clearTimeout(crmToastHideTimeout);
  crmToastEl.textContent = message;
  crmToastEl.classList.remove("hidden");
  requestAnimationFrame(() => {
    crmToastEl.classList.add("show");
  });
  crmToastTimeout = setTimeout(() => {
    crmToastEl.classList.remove("show");
    crmToastHideTimeout = setTimeout(() => {
      crmToastEl.classList.add("hidden");
    }, 320);
  }, 6000);
}

function playBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.value = 0.04;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    setTimeout(() => {
      oscillator.stop();
      ctx.close();
    }, 180);
  } catch (error) {
    // Ignore audio errors (browser may require user gesture).
  }
}

function flashTitle(message) {
  clearInterval(titleBlinkTimer);
  baseTitle = baseTitle || document.title;
  let showAlt = false;
  titleBlinkTimer = setInterval(() => {
    document.title = showAlt ? baseTitle : message;
    showAlt = !showAlt;
  }, 900);
  setTimeout(() => {
    clearInterval(titleBlinkTimer);
    document.title = baseTitle;
  }, 7000);
}

function notifyInApp(message) {
  showCrmToast(message);
  flashTitle(message);
  playBeep();
}

function handleNewOrders(orders) {
  const list = Array.isArray(orders) ? orders : [];
  if (!ordersInitialized) {
    knownOrderIds = new Set(list.map((order) => order?.id).filter(Boolean));
    ordersInitialized = true;
    return;
  }
  const newOnes = list.filter((order) => order?.id && !knownOrderIds.has(order.id));
  newOnes.forEach((order) => knownOrderIds.add(order.id));
  if (newOnes.length) {
    const first = newOnes[0];
    const client = first.client || "Cliente";
    const total = formatCurrency(first.total);
    const message = tWithVars("crm_alert_order", { client, total });
    notifyInApp(message);
  }
}

function handleNewQuotes(items) {
  const list = Array.isArray(items) ? items : [];
  if (!quotesInitialized) {
    knownQuoteIds = new Set(list.map((quote) => quote?.id).filter(Boolean));
    quotesInitialized = true;
    return;
  }
  const newOnes = list.filter((quote) => quote?.id && !knownQuoteIds.has(quote.id));
  newOnes.forEach((quote) => knownQuoteIds.add(quote.id));
  if (newOnes.length) {
    const first = newOnes[0];
    const name = first.name || "Cliente";
    const message = tWithVars("crm_alert_quote", { name });
    notifyInApp(message);
  }
}

async function enableNotifications() {
  if (!notificationsEnableBtn) return;
  notificationsEnableBtn.disabled = true;
  setNotificationMessage("");
  try {
    const result = await registerForOrderNotifications({
      vapidKey: vapidPublicKey,
      deviceLabel: typeof navigator !== "undefined" ? navigator.platform || "web" : "web",
    });
    if (result?.ok && result.token) {
      localStorage.setItem(notificationsTokenKey, result.token);
      updateNotificationButtons(true);
      setNotificationMessage(t("crm_notifications_enabled"), "success");
      void ensureForegroundMessagesListener();
      return;
    }
    updateNotificationButtons(false);
    setNotificationMessage(getNotificationErrorMessage(result?.reason), "error");
  } catch (error) {
    console.warn("No se pudieron activar las notificaciones:", error);
    updateNotificationButtons(false);
    setNotificationMessage(t("crm_notifications_error"), "error");
  } finally {
    notificationsEnableBtn.disabled = false;
  }
}

async function disableNotifications() {
  if (!notificationsDisableBtn) return;
  notificationsDisableBtn.disabled = true;
  const token = localStorage.getItem(notificationsTokenKey);
  if (token) {
    await unregisterForOrderNotifications(token);
  }
  if (detachForegroundMessages) {
    detachForegroundMessages();
    detachForegroundMessages = null;
  }
  localStorage.removeItem(notificationsTokenKey);
  updateNotificationButtons(false);
  setNotificationMessage(t("crm_notifications_disabled"), "info");
  notificationsDisableBtn.disabled = false;
}

function initNotifications() {
  notificationsEnableBtn = document.getElementById("enable-notifications");
  notificationsDisableBtn = document.getElementById("disable-notifications");
  notificationsMessageEl = document.getElementById("notification-message");
  crmToastEl = document.getElementById("crm-toast");
  if (!notificationsEnableBtn || !notificationsDisableBtn) return;
  const storedToken = localStorage.getItem(notificationsTokenKey);
  updateNotificationButtons(Boolean(storedToken));
  notificationsEnableBtn.addEventListener("click", enableNotifications);
  notificationsDisableBtn.addEventListener("click", disableNotifications);
  if (storedToken) {
    void ensureForegroundMessagesListener();
  }
}

const statusBuckets = {
  "En horno": "processing",
  "En preparación": "processing",
  Confirmado: "processing",
  Empaquetado: "packed",
  "En reparto": "delivery",
  Listo: "ready",
  Entregado: "delivered",
  Pendiente: "processing",
};

const statusGroups = {
  pending: ["Pendiente"],
  prep: ["Confirmado", "En horno", "En preparación", "Empaquetado", "En reparto"],
  ready: ["Listo"],
  delivered: ["Entregado"],
};

const getAllOrders = () => [...localOrders, ...remoteOrders];

function formatCurrency(value) {
  const locale = currentLang === "es" ? "es-HN" : "en-US";
  return new Intl.NumberFormat(locale, { style: "currency", currency: "HNL" }).format(value || 0);
}

function safeDateString(date) {
  if (!date) return "";
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKeyFromDate(date) {
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Tegucigalpa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  if (map.year && map.month && map.day) {
    return `${map.year}-${map.month}-${map.day}`;
  }
  return safeDateString(date);
}

function getTodayKey() {
  return dateKeyFromDate(new Date());
}

function parseDate(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function getOrderDate(order) {
  if (order?.createdAt?.toDate) return order.createdAt.toDate();
  if (order?.createdAt instanceof Date) return order.createdAt;
  if (typeof order?.createdAt === "string") return parseDate(order.createdAt);
  if (typeof order?.createdAt === "number") return new Date(order.createdAt);
  if (order?.createdAtLocal) return parseDate(order.createdAtLocal);
  if (order?.orderDate) return parseDate(order.orderDate);
  if (order?.date) return parseDate(order.date);
  return null;
}

function buildItemsList(order) {
  if (Array.isArray(order.items) && order.items.length) {
    return order.items;
  }
  if (order.item) {
    return [{ name: order.item, quantity: order.quantity || 1, price: order.price || 0 }];
  }
  return [];
}

function normalizeItemName(name) {
  if (!name) return "";
  const translated = t(name);
  if (translated !== name) return fixMojibake(translated);
  if (name.startsWith("product_") && name.endsWith("_title")) {
    const core = name.replace(/^product_/, "").replace(/_title$/, "");
    const title = core
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
    return fixMojibake(title);
  }
  return fixMojibake(name);
}

function computeItemsTotal(items) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0);
}

function getOrderTimeValue(order) {
  if (order?.createdAt) return order.createdAt.getTime();
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

function maybeResetDisplaySequence() {
  if (localStorage.getItem(orderDisplayResetKey) === displayResetVersion) return;
  try {
    localStorage.removeItem(orderDisplayMapKey);
    localStorage.setItem(orderDisplayKey, "0");
  } catch (error) {
    console.warn("Error al reiniciar contador:", error);
  }
  displayIdMap = {};
  localStorage.setItem(orderDisplayResetKey, displayResetVersion);
}

function loadDisplayIdMap() {
  if (Object.keys(displayIdMap).length) return;
  try {
    const raw = localStorage.getItem(orderDisplayMapKey);
    displayIdMap = raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.warn("Error al leer mapa de ordenes:", error);
    displayIdMap = {};
  }
}

function saveDisplayIdMap() {
  try {
    localStorage.setItem(orderDisplayMapKey, JSON.stringify(displayIdMap));
  } catch (error) {
    console.warn("Error al guardar mapa de ordenes:", error);
  }
}

function allocateDisplayId(usedIds) {
  let nextIndex = Number.parseInt(localStorage.getItem(orderDisplayKey), 10);
  if (!Number.isFinite(nextIndex)) nextIndex = 0;
  let candidate = String(nextIndex).padStart(2, "0");
  while (usedIds.has(candidate)) {
    nextIndex += 1;
    candidate = String(nextIndex).padStart(2, "0");
  }
  localStorage.setItem(orderDisplayKey, String(nextIndex + 1));
  return candidate;
}

function buildOrderFingerprint(order, mode = "strict") {
  if (mode !== "loose") {
    if (order?.clientOrderId) return `client:${order.clientOrderId}`;
    if (order?.createdAtLocal) return `local:${order.createdAtLocal}`;
  }
  if (mode === "loose" && order?.createdAtLocal) return `local:${order.createdAtLocal}`;
  const itemsKey = (order.items || [])
    .map((item) => `${normalizeItemName(item.name)}:${item.quantity || 0}:${item.price || 0}`)
    .join("|");
  return `fallback:${order.client || ""}|${order.phone || ""}|${order.orderDate || ""}|${
    order.time || ""
  }|${order.total || 0}|${itemsKey}`;
}

function normalizePaymentStatus(status) {
  return String(status || "").trim().toLowerCase() === "paid" ? "paid" : "pending";
}

function normalizePaymentMethod(method) {
  return String(method || "").trim().toLowerCase() === "paypal" ? "paypal" : "pay_later";
}

function getPaymentStatusLabel(paymentStatus) {
  return paymentStatus === "paid" ? t("crm_payment_paid") : t("crm_payment_pending");
}

function getPaymentMethodLabel(paymentMethod) {
  return paymentMethod === "paypal"
    ? t("crm_payment_method_paypal")
    : t("crm_payment_method_pay_later");
}

function getPaymentStatusClass(paymentStatus) {
  return paymentStatus === "paid" ? "status-paid" : "status-payment-pending";
}

function normalizeOrder(order, source = "remote") {
  const createdAtDate = getOrderDate(order);
  const items = buildItemsList(order).map((item) => ({ ...item, name: fixMojibake(item.name || "") }));
  const total = typeof order.total === "number" ? order.total : computeItemsTotal(items);
  const createdDateKey = createdAtDate ? dateKeyFromDate(createdAtDate) : "";
  const localDateKey = order.createdAtLocal ? dateKeyFromDate(new Date(order.createdAtLocal)) : "";
  const orderDate = localDateKey || order.orderDate || createdDateKey;
  const createdAtLocal = order.createdAtLocal || "";
  const paymentStatus = normalizePaymentStatus(order.paymentStatus);
  const paymentMethod = normalizePaymentMethod(order.paymentMethod);
  const timeLabel =
    order.time ||
    (createdAtDate
      ? createdAtDate.toLocaleTimeString("es-HN", { hour: "2-digit", minute: "2-digit" })
      : "--:--");
  const displayId =
    order.displayId ||
    order.localNumber ||
    (source === "local"
      ? String(order?.localIndex ?? 0).padStart(2, "0")
      : order.id);
  return {
    id: order.id || `${source}-${Math.random().toString(36).slice(2, 9)}`,
    displayId: displayId || order.id || `${source}-${Math.random().toString(36).slice(2, 9)}`,
    client: fixMojibake(order.client || "") || "Cliente sin nombre",
    phone: fixMojibake(order.phone || ""),
    items,
    status: order.status || "Pendiente",
    total,
    time: timeLabel,
    orderDate,
    createdAtLocal,
    createdAt: createdAtDate,
    clientOrderId: order.clientOrderId || "",
    trackingKey: order.trackingKey || "",
    notes: fixMojibake(order.notes || ""),
    customerNotesEdited: order.customerNotesEdited === true,
    paymentStatus,
    paymentMethod,
    source,
  };
}

function describeOrder(order) {
  if (order.items.length) {
    return order.items
      .map((item) => `${item.quantity}x ${normalizeItemName(item.name)}`)
      .join(" - ");
  }
  return normalizeItemName(order.item) || "Pedido";
}

function buildDisplayItems(order) {
  if (order.items.length) {
    return order.items
      .map((item) => `${item.quantity || 1}x ${normalizeItemName(item.name)}`)
      .filter(Boolean);
  }
  const fallback = describeOrder(order);
  return String(fallback)
    .split(/\s*(?:-|\u00B7)\s*/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function rebuildOrders() {
  maybeResetDisplaySequence();
  loadDisplayIdMap();
  let remoteNormalized = remoteOrders.map((order) => normalizeOrder(order, "remote"));
  const seenRemote = new Set();
  remoteNormalized = remoteNormalized.filter((order) => {
    const fingerprint = buildOrderFingerprint(order, "loose");
    if (seenRemote.has(fingerprint)) return false;
    seenRemote.add(fingerprint);
    return true;
  });
  const allowLocalOrders = useLocalOrders && remoteNormalized.length === 0;
  const localNormalized = allowLocalOrders ? localOrders.map((order) => normalizeOrder(order, "local")) : [];
  const remoteFingerprints = new Set(
    remoteNormalized.map((order) => buildOrderFingerprint(order, "strict"))
  );
  const localFiltered = localNormalized.filter((order) => {
    const fingerprint = buildOrderFingerprint(order, "strict");
    return !remoteFingerprints.has(fingerprint);
  });
  normalizedOrdersCache = [...localFiltered, ...remoteNormalized].sort((a, b) => {
    const timeA = a.createdAt ? a.createdAt.getTime() : 0;
    const timeB = b.createdAt ? b.createdAt.getTime() : 0;
    return timeB - timeA;
  });
  const chronological = [...normalizedOrdersCache].sort(
    (a, b) => getOrderTimeValue(a) - getOrderTimeValue(b)
  );
  chronological.forEach((order, index) => {
    const displayId = String(index).padStart(2, "0");
    order.displayId = displayId;
    if (order.id) displayIdMap[order.id] = displayId;
  });
  localStorage.setItem(orderDisplayKey, String(chronological.length));
  saveDisplayIdMap();
  orderIndex = new Map(normalizedOrdersCache.map((order) => [order.id, order]));
  renderOrders();
  refreshMetrics();
  buildCalendar();
  updateStatusTotals();
  renderOrderCards();
  renderDailySummary(selectedDate || safeDateString(new Date()));
  updateSummary(currentSummaryRange);
  tryOpenDeepLinkedOrder();
}

async function dedupeRemoteOrders() {
  if (dedupeInProgress || !remoteOrders.length) return;
  const now = Date.now();
  if (now - lastDedupeAt < 10000) return;

  const groups = new Map();
  remoteOrders.forEach((order) => {
    const normalized = normalizeOrder(order, "remote");
    const fingerprint = buildOrderFingerprint(normalized, "loose");
    if (!groups.has(fingerprint)) groups.set(fingerprint, []);
    groups.get(fingerprint).push({
      order,
      time: normalized.createdAt ? normalized.createdAt.getTime() : 0,
    });
  });

  const toDelete = [];
  groups.forEach((list) => {
    if (list.length <= 1) return;
    list.sort((a, b) => b.time - a.time);
    list.slice(1).forEach((entry) => toDelete.push(entry.order));
  });

  if (!toDelete.length) {
    lastDedupeAt = now;
    return;
  }

  dedupeInProgress = true;
  try {
    await Promise.allSettled(toDelete.map((order) => deleteOrder(order.id)));
  } finally {
    dedupeInProgress = false;
    lastDedupeAt = Date.now();
  }
}

function renderOrders() {
  const list = document.getElementById("order-list");
  if (!list) return;
  list.innerHTML = "";
  if (normalizedOrdersCache.length === 0) {
    const empty = document.createElement("li");
    empty.className = "order-empty";
    empty.textContent = t("crm_orders_empty");
    list.appendChild(empty);
    return;
  }
  normalizedOrdersCache.slice(0, 8).forEach((order) => {
    const li = document.createElement("li");
    const description = describeOrder(order);
    const paymentLabel = getPaymentStatusLabel(normalizePaymentStatus(order.paymentStatus));
    const footer = `${order.time} · ${order.status || "Pendiente"} · ${paymentLabel}`;
    li.innerHTML = `<strong>${order.client}</strong><br/><span>${description}</span><br/><small>${footer}</small>`;
    list.appendChild(li);
  });
}

function refreshMetrics() {
  const dayEl = document.getElementById("metric-day");
  const weekEl = document.getElementById("metric-week");
  const monthEl = document.getElementById("metric-month");
  if (!dayEl || !weekEl || !monthEl) return;

  const today = new Date();
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const weekStart = new Date(dayStart);
  const mondayOffset = (dayStart.getDay() + 6) % 7;
  weekStart.setDate(dayStart.getDate() - mondayOffset);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);

  const counts = normalizedOrdersCache.reduce(
    (acc, order) => {
      if (!order.createdAt) return acc;
      const time = order.createdAt.getTime();
      if (time >= dayStart.getTime() && time < dayStart.getTime() + 86400000) acc.day += 1;
      if (time >= weekStart.getTime() && time < weekEnd.getTime()) acc.week += 1;
      if (time >= monthStart.getTime() && time < monthEnd.getTime()) acc.month += 1;
      return acc;
    },
    { day: 0, week: 0, month: 0 }
  );

  const hasDatedOrders = normalizedOrdersCache.some((order) => order.createdAt);
  dayEl.textContent = hasDatedOrders ? counts.day : metrics.day || 0;
  weekEl.textContent = hasDatedOrders ? counts.week : metrics.week || 0;
  monthEl.textContent = hasDatedOrders ? counts.month : metrics.month || 0;
}

function buildCalendar() {
  const calendar = document.getElementById("calendar");
  if (!calendar) return;
  const todayKey = getTodayKey();
  const todayDate = parseDate(todayKey) || new Date();
  const year = calendarYear ?? todayDate.getFullYear();
  const month = calendarMonth ?? todayDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();

  const dayLabels =
    currentLang === "es"
      ? ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
      : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const dayStats = {};
  const deliveredOrders = normalizedOrdersCache.filter(isDeliveredOrder);
  deliveredOrders.forEach((order) => {
    if (!order.orderDate) return;
    const orderDate = parseDate(order.orderDate);
    if (!orderDate) return;
    if (orderDate.getFullYear() !== year || orderDate.getMonth() !== month) return;
    const key = safeDateString(orderDate);
    if (!dayStats[key]) dayStats[key] = { count: 0, total: 0 };
    dayStats[key].count += 1;
    dayStats[key].total += order.total || 0;
  });

  const totals = Object.values(dayStats).map((stat) => stat.total);
  const maxTotal = totals.length ? Math.max(...totals) : 0;
  const highThreshold = maxTotal * 0.66;
  const mediumThreshold = maxTotal * 0.33;

  const heading = document.createElement("div");
  heading.className = "calendar-grid calendar-grid--weekdays";
  dayLabels.forEach((day) => {
    const cell = document.createElement("div");
    cell.className = "calendar-day calendar-weekday";
    cell.textContent = day;
    heading.appendChild(cell);
  });

  const grid = document.createElement("div");
  grid.className = "calendar-grid calendar-grid--days";

  const mondayFirstOffset = (firstDay + 6) % 7;
  for (let i = 0; i < mondayFirstOffset; i += 1) {
    const filler = document.createElement("div");
    filler.className = "calendar-day calendar-cell";
    grid.appendChild(filler);
  }

  const selectedKey = selectedDate || todayKey;
  for (let date = 1; date <= lastDate; date += 1) {
    const cell = document.createElement("div");
    cell.className = "calendar-day calendar-cell";
    const cellDate = new Date(year, month, date);
    const dateKey = safeDateString(cellDate);
    cell.dataset.date = dateKey;
    const stats = dayStats[dateKey];
    const status = calendarStatuses[date] || calendarStatuses[String(date)];
    if (status) cell.classList.add(status);
    if (stats) cell.classList.add("has-orders");
    if (dateKey === selectedKey) cell.classList.add("is-selected");
    if (stats && maxTotal > 0) {
      if (stats.total >= highThreshold) cell.classList.add("level-high");
      else if (stats.total >= mediumThreshold) cell.classList.add("level-medium");
      else cell.classList.add("level-low");
    }
    cell.innerHTML = `
      <button type="button">
        <span class="day-number">${date}</span>
        <span class="order-count">${stats ? formatCalendarOrderCount(stats.count) : "-"}</span>
      </button>
    `;
    grid.appendChild(cell);
  }

  calendar.innerHTML = "";
  calendar.appendChild(heading);
  calendar.appendChild(grid);

  const monthLabel = document.getElementById("calendar-month-label");
  if (monthLabel) {
    const formatter = new Intl.DateTimeFormat(currentLang === "es" ? "es-HN" : "en-US", {
      month: "long",
      year: "numeric",
    });
    const label = formatter.format(new Date(year, month, 1));
    monthLabel.textContent = currentLang === "es" ? label.replace(/^\w/, (c) => c.toUpperCase()) : label;
  }
}

function updateStatusTotals() {
  const processingEl = document.getElementById("status-processing");
  const packedEl = document.getElementById("status-packed");
  const deliveryEl = document.getElementById("status-delivery");
  const readyEl = document.getElementById("status-ready");
  if (!processingEl || !packedEl || !deliveryEl || !readyEl) {
    return;
  }
  const tallies = {
    processing: 0,
    packed: 0,
    delivery: 0,
    ready: 0,
  };
  normalizedOrdersCache.forEach((order) => {
    const key = statusBuckets[order.status] || "processing";
    tallies[key] += 1;
  });
  processingEl.textContent = `${tallies.processing} pedidos`;
  packedEl.textContent = `${tallies.packed} pedidos`;
  deliveryEl.textContent = `${tallies.delivery} pedidos`;
  readyEl.textContent = `${tallies.ready} pedidos`;
}

function renderQuotes() {
  const list = document.getElementById("quote-list");
  if (!list) return;
  list.innerHTML = "";
  if (quotes.length === 0) {
    const empty = document.createElement("li");
    empty.className = "quote-card";
    empty.innerHTML = `<strong>${t("crm_quotes_empty_title")}</strong><span>${t("crm_quotes_empty_body")}</span>`;
    list.appendChild(empty);
    return;
  }
  const formatQuoteDate = (quote) => {
    const raw =
      quote?.createdAt?.toDate?.() ||
      (quote?.createdAt instanceof Date ? quote.createdAt : null) ||
      (quote?.createdAt ? new Date(quote.createdAt) : null);
    if (!raw || Number.isNaN(raw.getTime())) return "";
    const locale = currentLang === "es" ? "es-HN" : "en-US";
    return raw.toLocaleString(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  quotes.slice(0, 6).forEach((quote) => {
    const li = document.createElement("li");
    li.className = "quote-card";
    const submitted = formatQuoteDate(quote);
    const email = quote.email || "—";
    const phone = quote.phone || "—";
    const eventDate = quote.event_date || "—";
    const details = quote.details || "—";
    const status = quote.status || "—";
    li.innerHTML = `
      <div class="quote-head">
        <strong>${quote.name || "Sin nombre"}</strong>
        ${submitted ? `<span class="quote-created">${t("crm_quote_sent")}: ${submitted}</span>` : ""}
      </div>
      <div class="quote-meta">
        <div>
          <span class="quote-label">${t("crm_quote_email")}</span>
          <span class="quote-value">${email}</span>
        </div>
        <div>
          <span class="quote-label">${t("crm_quote_phone")}</span>
          <span class="quote-value">${phone}</span>
        </div>
        <div>
          <span class="quote-label">${t("crm_quote_event")}</span>
          <span class="quote-value">${eventDate}</span>
        </div>
        <div>
          <span class="quote-label">${t("crm_quote_status")}</span>
          <span class="quote-value">${status}</span>
        </div>
      </div>
      <div class="quote-details">
        <span class="quote-label">${t("crm_quote_details")}</span>
        <p>${details}</p>
      </div>
      <div class="quote-actions">
        <button class="btn ghost danger compact quote-delete" type="button" data-quote-id="${quote.id}">
          ${t("crm_quote_delete")}
        </button>
      </div>
    `;
    list.appendChild(li);
  });
}

function renderDailySummary(dateKey) {
  const dayOrders = normalizedOrdersCache.filter(
    (order) => order.orderDate === dateKey && isDeliveredOrder(order)
  );
  const query = daySearchQuery.trim().toLowerCase();
  const filteredOrders = query
    ? dayOrders.filter((order) => {
        const haystack = [
          order.client,
          order.phone,
          order.id,
          describeOrder(order),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
    : dayOrders;

  const countEl = document.getElementById("day-orders");
  const revenueEl = document.getElementById("day-revenue");
  const list = document.getElementById("daily-orders");
  const productsList = document.getElementById("day-products");
  const detailTitle = document.getElementById("day-detail-title");
  const summaryLine = document.getElementById("day-summary-line");
  if (!countEl || !list) return;

  const total = dayOrders.reduce((sum, order) => sum + (order.total || 0), 0);
  countEl.textContent = `${dayOrders.length}`;
  if (revenueEl) {
    revenueEl.textContent = formatCurrency(total);
  }

  if (detailTitle) {
    const parsed = parseDate(dateKey);
    const formatter = new Intl.DateTimeFormat(currentLang === "es" ? "es-HN" : "en-US", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    detailTitle.textContent = parsed
      ? `${t("crm_day_detail_title")}: ${formatter.format(parsed)}`
      : t("crm_day_detail_title");
  }

  if (summaryLine) {
    summaryLine.textContent = `${t("crm_day_orders")}: ${dayOrders.length} · ${t("crm_day_revenue")}: ${formatCurrency(
      total
    )}`;
  }

  if (productsList) {
    const productMap = new Map();
    dayOrders.forEach((order) => {
      const items = order.items.length ? order.items : buildItemsList(order);
      items.forEach((item) => {
        const name = normalizeItemName(item.name || "");
        const qty = Number(item.quantity) || 0;
        const price = Number(item.price) || 0;
        if (!name) return;
        const current = productMap.get(name) || { qty: 0, revenue: 0 };
        productMap.set(name, {
          qty: current.qty + qty,
          revenue: current.revenue + qty * price,
        });
      });
    });

    const rows = Array.from(productMap.entries()).sort((a, b) => b[1].qty - a[1].qty);
    productsList.innerHTML = "";
    if (rows.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = t("crm_day_empty");
      productsList.appendChild(empty);
    } else {
      rows.forEach(([name, info]) => {
        const li = document.createElement("li");
        li.innerHTML = `
          <span>${name} (${info.qty} ${t("crm_day_units")})</span>
          <strong>${formatCurrency(info.revenue)}</strong>
        `;
        productsList.appendChild(li);
      });
    }
  }

  list.innerHTML = "";
  if (filteredOrders.length === 0) {
    const empty = document.createElement("li");
    empty.className = "order-empty";
    empty.textContent = t("crm_day_empty");
    list.appendChild(empty);
    return;
  }
  filteredOrders.forEach((order) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="day-order-header">
        <div>
          <strong>${order.client}</strong>
          <div class="day-order-meta">#${order.displayId || order.id}</div>
        </div>
        <button class="btn ghost day-order-action" type="button" data-order-id="${order.id}">
          ${t("crm_day_review")}
        </button>
      </div>
      <small>${order.time} · ${formatCurrency(order.total)}</small>
    `;
    list.appendChild(li);
  });
}

function formatRangeLabel(range, start, end) {
  const formatter = new Intl.DateTimeFormat(currentLang === "es" ? "es-HN" : "en-US", {
    day: "numeric",
    month: "short",
  });
  if (range === "day") {
    return currentLang === "es" ? `Resumen (Hoy)` : "Summary (Today)";
  }
  const startLabel = formatter.format(start);
  const endLabel = formatter.format(end);
  if (range === "week") {
    return currentLang === "es"
      ? `Resumen (Semana: ${startLabel} - ${endLabel})`
      : `Summary (Week: ${startLabel} - ${endLabel})`;
  }
  return currentLang === "es"
    ? `Resumen (Mes: ${startLabel} - ${endLabel})`
    : `Summary (Month: ${startLabel} - ${endLabel})`;
}

function getRangeDates(range) {
  const today = new Date();
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (range === "day") {
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayStart.getDate() + 1);
    return { start: dayStart, end: dayEnd };
  }
  if (range === "week") {
    const mondayOffset = (dayStart.getDay() + 6) % 7;
    const weekStart = new Date(dayStart);
    weekStart.setDate(dayStart.getDate() - mondayOffset);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    return { start: weekStart, end: weekEnd };
  }
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return { start: monthStart, end: monthEnd };
}

function updateSummary(range = "day") {
  const summaryRangeLabel = document.getElementById("summary-range-label");
  const summaryMeta = document.getElementById("summary-meta");
  const { start, end } = getRangeDates(range);
  const ordersInRange = normalizedOrdersCache.filter((order) => {
    if (!order.createdAt) return false;
    const time = order.createdAt.getTime();
    return time >= start.getTime() && time < end.getTime();
  });
  const reservationsInRange = quotes.filter((quote) => {
    const quoteDate =
      quote?.createdAt?.toDate?.() ||
      (quote?.createdAt ? new Date(quote.createdAt) : null);
    if (!quoteDate || Number.isNaN(quoteDate.getTime())) return false;
    return quoteDate.getTime() >= start.getTime() && quoteDate.getTime() < end.getTime();
  }).length;
  const countByStatus = (statuses) =>
    ordersInRange.filter((order) => statuses.includes(order.status)).length;

  const totalOrders = ordersInRange.length;
  const pending = countByStatus(statusGroups.pending);
  const prep = countByStatus(statusGroups.prep);
  const ready = countByStatus(statusGroups.ready);
  const delivered = countByStatus(statusGroups.delivered);
  const reservations = quotes.length ? reservationsInRange : 0;
  const revenue = ordersInRange.reduce((sum, order) => sum + (order.total || 0), 0);
  const ticket = totalOrders > 0 ? revenue / totalOrders : 0;

  document.getElementById("summary-orders").textContent = `${totalOrders}`;
  document.getElementById("summary-pending").textContent = `${pending}`;
  document.getElementById("summary-prep").textContent = `${prep}`;
  document.getElementById("summary-ready").textContent = `${ready}`;
  document.getElementById("summary-delivered").textContent = `${delivered}`;
  document.getElementById("summary-reservations").textContent = `${reservations}`;
  document.getElementById("summary-revenue").textContent = formatCurrency(revenue);
  document.getElementById("summary-ticket").textContent = formatCurrency(ticket);

  if (summaryRangeLabel) {
    const displayEnd = new Date(end.getTime() - 1);
    summaryRangeLabel.textContent = formatRangeLabel(range, start, displayEnd);
  }

  if (summaryMeta) {
    summaryMeta.textContent = summaryMeta.dataset.user || "ops@bekyscake.com · Rol: agent";
  }
}

let orderFilter = "all";

function mapOrderStatus(status) {
  if (!status) return "pending";
  if (status === "Pendiente") return "pending";
  if (["Confirmado", "En horno", "En preparación", "Empaquetado", "En reparto"].includes(status)) return "prep";
  if (status === "Listo") return "ready";
  if (status === "Entregado") return "delivered";
  if (status === "Rechazado" || status === "Cancelado") return "rejected";
  return "pending";
}


function isDeliveredOrder(order) {
  return mapOrderStatus(order.status) === "delivered";
}
function renderOrderCards() {
  const container = document.getElementById("orders-cards");
  if (!container) return;
  const filtered =
    orderFilter === "all"
      ? normalizedOrdersCache
      : normalizedOrdersCache.filter((order) => mapOrderStatus(order.status) === orderFilter);

  container.innerHTML = "";
  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "order-empty";
    empty.textContent = t("crm_orders_empty");
    container.appendChild(empty);
    return;
  }

  filtered.forEach((order) => {
    const card = document.createElement("article");
    card.className = "order-card";
    card.dataset.orderId = order.id;
    const metaLine = `Hora: ${order.time || "--:--"} - ${formatCurrency(order.total)}`;
    const orderStatusClass = `status-${mapOrderStatus(order.status)}`;
    const paymentStatus = normalizePaymentStatus(order.paymentStatus);
    const paymentStatusClass = getPaymentStatusClass(paymentStatus);
    const paymentLabel = getPaymentStatusLabel(paymentStatus);
    card.innerHTML = `
      <div class="order-card-header">
        <div class="order-id">#${order.displayId || order.id}</div>
        <div class="order-badges">
          <span class="order-status ${orderStatusClass}">${order.status || "Pendiente"}</span>
          <span class="order-status ${paymentStatusClass}">${paymentLabel}</span>
        </div>
      </div>
      <div class="order-client">${t("crm_detail_customer")}: ${order.client}</div>
      <div class="order-meta">
        <span>${metaLine}</span>
        <span>${t("crm_detail_payment_method")}: ${getPaymentMethodLabel(normalizePaymentMethod(order.paymentMethod))}</span>
      </div>
      <div class="order-actions">
        <button class="btn ghost order-review" type="button" data-order-id="${order.id}">
          ${t("crm_day_review")}
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

function updateOrderStatusCache(orderId, status) {
  const updateList = (list) => {
    const index = list.findIndex((order) => order.id === orderId);
    if (index === -1) return false;
    list[index] = { ...list[index], status };
    return true;
  };

  const updatedLocal = updateList(localOrders);
  const updatedRemote = updateList(remoteOrders);
  if (updatedLocal) {
    localStorage.setItem(localStorageKey, JSON.stringify(localOrders));
  }
  return updatedLocal || updatedRemote;
}

function updateOrderNotesCache(orderId, notes) {
  const updateList = (list) => {
    const index = list.findIndex((order) => order.id === orderId);
    if (index === -1) return false;
    list[index] = {
      ...list[index],
      notes,
      updatedAt: new Date().toISOString(),
      notesUpdatedAt: new Date().toISOString(),
    };
    return true;
  };

  const updatedLocal = updateList(localOrders);
  const updatedRemote = updateList(remoteOrders);
  if (updatedLocal && useLocalOrders) {
    localStorage.setItem(localStorageKey, JSON.stringify(localOrders));
  }
  return updatedLocal || updatedRemote;
}

function syncOrderNotesEditor() {
  const input = document.getElementById("order-modal-notes-input");
  const help = document.getElementById("order-modal-notes-help");
  const badge = document.getElementById("order-modal-notes-badge");
  if (!input || !help || !badge) return;

  const helpText = t("crm_notes_help");
  help.textContent = helpText;
  help.hidden = !helpText;
  badge.textContent = t("crm_notes_unlimited_badge");
}

function clearOrderNotesAutosaveTimer() {
  if (!orderNotesAutosaveTimer) return;
  clearTimeout(orderNotesAutosaveTimer);
  orderNotesAutosaveTimer = null;
}

function setOrderNotesMessageState(key, tone = "info", state = "idle") {
  const message = document.getElementById("order-modal-notes-message");
  const text = document.getElementById("order-modal-notes-message-text");
  if (!message || !text) return;
  message.dataset.tone = tone;
  message.dataset.state = state;
  text.textContent = t(key);
}

function queueOrderNotesAutosave(orderId, value, options = {}) {
  if (!orderId) return;
  const { immediate = false } = options;
  orderNotesQueuedOrderId = orderId;
  orderNotesQueuedValue = value ?? "";
  clearOrderNotesAutosaveTimer();

  if (orderNotesQueuedValue.trim() === orderNotesOriginalValue.trim()) {
    if (!orderNotesSaving || orderNotesSavingOrderId !== orderId) {
      setOrderNotesMessageState("crm_notes_autosave_idle", "info", "idle");
    }
    syncOrderNotesEditor();
    return;
  }

  if (!orderNotesSaving || orderNotesSavingOrderId !== orderId) {
    setOrderNotesMessageState("crm_notes_autosave_pending", "info", "pending");
  }
  syncOrderNotesEditor();

  if (immediate) {
    void flushQueuedOrderNotesSave();
    return;
  }

  orderNotesAutosaveTimer = setTimeout(() => {
    orderNotesAutosaveTimer = null;
    void flushQueuedOrderNotesSave();
  }, orderNotesAutosaveDelay);
}

function flushOpenOrderNotesDraft() {
  const notesInput = document.getElementById("order-modal-notes-input");
  if (!openOrderId || !notesInput) {
    clearOrderNotesAutosaveTimer();
    return;
  }
  queueOrderNotesAutosave(openOrderId, notesInput.value, { immediate: true });
}

async function flushQueuedOrderNotesSave() {
  clearOrderNotesAutosaveTimer();
  const orderId = orderNotesQueuedOrderId || openOrderId;
  if (!orderId) return;
  await handleOrderNotesSave(orderId, orderNotesQueuedValue);
}

function getNextStatus(status) {
  if (status === "Pendiente") return "En preparación";
  if (status === "En preparación") return "Listo";
  if (status === "Listo") return "Entregado";
  return null;
}

function updateModalStatusBadge(badgeEl, status) {
  if (!badgeEl) return;
  const statusClass = `status-${mapOrderStatus(status)}`;
  badgeEl.className = `order-status ${statusClass}`;
  badgeEl.textContent = status || "Pendiente";
}

function openOrderModal(orderId, options = {}) {
  const modal = document.getElementById("order-modal");
  if (!modal) return;
  const isRefreshingSameOrder = !modal.classList.contains("hidden") && openOrderId === orderId;
  const currentNotesInput = document.getElementById("order-modal-notes-input");
  const currentDraftNotes = isRefreshingSameOrder && currentNotesInput ? currentNotesInput.value : "";
  if (!isRefreshingSameOrder && !modal.classList.contains("hidden") && openOrderId && currentNotesInput) {
    queueOrderNotesAutosave(openOrderId, currentNotesInput.value, { immediate: true });
  }
  const order = orderIndex.get(orderId);
  if (!order) return;

  const { syncUrl = true } = options;
  openOrderId = orderId;
  const nextStatus = getNextStatus(order.status);

  const title = document.getElementById("order-modal-title");
  const statusBadge = document.getElementById("order-modal-status");
  const client = document.getElementById("order-modal-client");
  const phone = document.getElementById("order-modal-phone");
  const total = document.getElementById("order-modal-total");
  const date = document.getElementById("order-modal-date");
  const paymentStatusEl = document.getElementById("order-modal-payment-status");
  const paymentMethodEl = document.getElementById("order-modal-payment-method");
  const items = document.getElementById("order-modal-items");
  const notesInput = document.getElementById("order-modal-notes-input");
  const nextBtn = document.getElementById("order-next-status");
  const rejectBtn = document.getElementById("order-reject");
  const deleteBtn = document.getElementById("order-delete");

  if (title) title.textContent = `#${order.displayId || order.id}`;
  if (client) client.textContent = fixMojibake(order.client || "") || "--";
  if (phone) phone.textContent = fixMojibake(order.phone || "") || "--";
  if (total) total.textContent = formatCurrency(order.total);
  if (date) date.textContent = `${order.orderDate || "--"} ${order.time || ""}`.trim();
  const paymentStatus = normalizePaymentStatus(order.paymentStatus);
  const paymentMethod = normalizePaymentMethod(order.paymentMethod);
  if (paymentStatusEl) {
    paymentStatusEl.textContent = getPaymentStatusLabel(paymentStatus);
    paymentStatusEl.className = `order-status ${getPaymentStatusClass(paymentStatus)}`;
  }
  if (paymentMethodEl) {
    paymentMethodEl.textContent = getPaymentMethodLabel(paymentMethod);
  }
  updateModalStatusBadge(statusBadge, order.status || "Pendiente");

  if (items) {
    const list = buildDisplayItems(order);
    items.innerHTML = list.map((text) => `<li>${text}</li>`).join("");
  }

  if (notesInput) {
    const nextOriginalValue = fixMojibake(order.notes || "");
    const preserveDraft = isRefreshingSameOrder && currentDraftNotes.trim() !== orderNotesOriginalValue.trim();
    orderNotesOriginalValue = nextOriginalValue;
    notesInput.value = preserveDraft ? currentDraftNotes : nextOriginalValue;
    orderNotesQueuedOrderId = orderId;
    orderNotesQueuedValue = notesInput.value;
  }
  clearOrderNotesAutosaveTimer();
  if (orderNotesSaving && orderNotesSavingOrderId === orderId) {
    setOrderNotesMessageState("crm_notes_save_busy", "info", "saving");
  } else if (notesInput && notesInput.value.trim() !== orderNotesOriginalValue.trim()) {
    setOrderNotesMessageState("crm_notes_autosave_pending", "info", "pending");
  } else {
    setOrderNotesMessageState("crm_notes_autosave_idle", "info", "idle");
  }
  syncOrderNotesEditor();

  if (nextBtn) {
    nextBtn.dataset.orderId = orderId;
    nextBtn.dataset.nextStatus = nextStatus || "";
    nextBtn.disabled = !nextStatus;
  }
  if (rejectBtn) {
    rejectBtn.dataset.orderId = orderId;
    rejectBtn.disabled = order.status === "Rechazado";
  }
  if (deleteBtn) {
    const isRejected = mapOrderStatus(order.status) === "rejected";
    deleteBtn.dataset.orderId = orderId;
    deleteBtn.classList.toggle("hidden", !isRejected);
  }

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  if (syncUrl) syncOrderUrl(orderId);
}

function closeOrderModal(options = {}) {
  const modal = document.getElementById("order-modal");
  if (!modal) return;
  const { clearUrl = true } = options;
  flushOpenOrderNotesDraft();
  clearOrderNotesAutosaveTimer();
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  openOrderId = null;
  if (clearUrl) syncOrderUrl("");
}

function openDeleteConfirm(orderId) {
  const modal = document.getElementById("confirm-delete-modal");
  if (!modal) return;
  modal.dataset.orderId = orderId;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeDeleteConfirm() {
  const modal = document.getElementById("confirm-delete-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  delete modal.dataset.orderId;
}

function openQuoteDeleteConfirm(quoteId) {
  const modal = document.getElementById("confirm-quote-delete-modal");
  if (!modal) return;
  modal.dataset.quoteId = quoteId;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeQuoteDeleteConfirm() {
  const modal = document.getElementById("confirm-quote-delete-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  delete modal.dataset.quoteId;
}

function removeOrderFromLists(orderId) {
  let removed = false;
  if (Array.isArray(remoteOrders)) {
    const nextRemote = remoteOrders.filter((order) => {
      if (order?.id === orderId) {
        removed = true;
        return false;
      }
      return true;
    });
    remoteOrders = nextRemote;
  }
  if (Array.isArray(localOrders)) {
    const nextLocal = localOrders.filter((order) => {
      if (order?.id === orderId) {
        removed = true;
        return false;
      }
      return true;
    });
    localOrders = nextLocal;
    if (useLocalOrders) {
      localStorage.setItem(localStorageKey, JSON.stringify(localOrders));
    }
  }
  return removed;
}

async function handleDeleteOrder(orderId) {
  const order = orderIndex.get(orderId);
  if (!order) return;
  setSyncStatus("saving");
  removeOrderFromLists(orderId);
  rebuildOrders();
  closeDeleteConfirm();
  closeOrderModal();

  if (order.source === "remote") {
    const ok = await deleteOrder(orderId);
    if (!ok) {
      setSyncStatus("error");
      loadRemoteData();
      return;
    }
  }
  setSyncStatus("ready");
}

async function handleDeleteQuote(quoteId) {
  if (!quoteId) return;
  closeQuoteDeleteConfirm();
  setSyncStatus("saving");
  quotes = quotes.filter((quote) => quote.id !== quoteId);
  renderQuotes();
  updateSummary(currentSummaryRange);

  const ok = await deleteQuote(quoteId);
  if (!ok) {
    setSyncStatus("error");
    loadRemoteData();
    return;
  }
  setSyncStatus("ready");
}

async function handleStatusChange(orderId, status) {
  const order = orderIndex.get(orderId);
  if (!order || !status) return;
  if (order.status === status) return;

  const previousStatus = order.status;
  setSyncStatus("saving");
  updateOrderStatusCache(orderId, status);
  rebuildOrders();

  if (order.source === "remote") {
    const ok = await updateOrderStatus(orderId, status);
    if (!ok) {
      updateOrderStatusCache(orderId, previousStatus);
      rebuildOrders();
      setSyncStatus("error");
      return;
    }
    setSyncStatus("ready");
  }
  if (!document.getElementById("order-modal")?.classList.contains("hidden")) {
    openOrderModal(orderId);
  }
}

async function handleOrderNotesSave(orderId, rawNotes = null) {
  const order = orderIndex.get(orderId);
  const notesInput = document.getElementById("order-modal-notes-input");
  if (!order) return false;

  const isCurrentOrder = openOrderId === orderId && !document.getElementById("order-modal")?.classList.contains("hidden");
  const nextNotes = String(rawNotes ?? notesInput?.value ?? "").trim();
  const previousNotes = isCurrentOrder ? orderNotesOriginalValue.trim() : fixMojibake(order.notes || "").trim();
  if (nextNotes === previousNotes) {
    if (isCurrentOrder) {
      setOrderNotesMessageState("crm_notes_autosave_idle", "info", "idle");
      syncOrderNotesEditor();
    }
    return true;
  }
  if (orderNotesSaving) {
    orderNotesFlushAfterSave = true;
    return false;
  }

  orderNotesSaving = true;
  orderNotesSavingOrderId = orderId;
  if (isCurrentOrder) {
    setOrderNotesMessageState("crm_notes_save_busy", "info", "saving");
    syncOrderNotesEditor();
  }
  setSyncStatus("saving");
  updateOrderNotesCache(orderId, nextNotes);
  rebuildOrders();

  const saved = await updateOrderNotes({
    orderId,
    trackingKey: order.trackingKey || "",
    notes: nextNotes,
    mode: "crm",
  });

  orderNotesSaving = false;
  orderNotesSavingOrderId = "";
  const stillViewingOrder =
    openOrderId === orderId && !document.getElementById("order-modal")?.classList.contains("hidden");
  if (!saved) {
    updateOrderNotesCache(orderId, previousNotes);
    rebuildOrders();
    if (stillViewingOrder) {
      if (notesInput && notesInput.value.trim() === nextNotes) {
        notesInput.value = previousNotes;
      }
      setOrderNotesMessageState("crm_notes_save_error", "error", "error");
      syncOrderNotesEditor();
    }
    setSyncStatus("error");
    if (orderNotesFlushAfterSave) {
      orderNotesFlushAfterSave = false;
      void flushQueuedOrderNotesSave();
    }
    return false;
  }

  if (stillViewingOrder) {
    orderNotesOriginalValue = nextNotes;
    if (notesInput && notesInput.value.trim() !== orderNotesOriginalValue.trim()) {
      setOrderNotesMessageState("crm_notes_autosave_pending", "info", "pending");
    } else {
      setOrderNotesMessageState("crm_notes_save_success", "success", "saved");
    }
    syncOrderNotesEditor();
  }
  setSyncStatus("ready");
  rebuildOrders();
  if (orderNotesFlushAfterSave) {
    orderNotesFlushAfterSave = false;
    void flushQueuedOrderNotesSave();
  } else if (stillViewingOrder && notesInput && notesInput.value.trim() !== orderNotesOriginalValue.trim()) {
    queueOrderNotesAutosave(orderId, notesInput.value);
  }
  return true;
}

function bindOrderCardInteractions() {
  const container = document.getElementById("orders-cards");
  if (!container || container.dataset.bound) return;
  container.dataset.bound = "true";

  container.addEventListener("click", (event) => {
    const reviewBtn = event.target.closest(".order-review");
    if (reviewBtn) {
      openOrderModal(reviewBtn.dataset.orderId);
      return;
    }
  });
}

function bindDayOrderActions() {
  document.addEventListener("click", (event) => {
    const dayBtn = event.target.closest(".day-order-action");
    if (!dayBtn) return;
    const orderId = dayBtn.dataset.orderId;
    if (!orderId) return;
    openOrderModal(orderId);
  });
}

function bindQuoteActions() {
  const list = document.getElementById("quote-list");
  if (!list || list.dataset.bound) return;
  list.dataset.bound = "true";
  list.addEventListener("click", (event) => {
    const deleteBtn = event.target.closest(".quote-delete");
    if (!deleteBtn) return;
    const quoteId = deleteBtn.dataset.quoteId;
    if (!quoteId) return;
    openQuoteDeleteConfirm(quoteId);
  });
}

function bindOrderFilters() {
  const pills = document.querySelectorAll(".filter-pill");
  if (!pills.length) return;
  pills.forEach((pill) => {
    pill.addEventListener("click", () => {
      pills.forEach((btn) => btn.classList.remove("active"));
      pill.classList.add("active");
      orderFilter = pill.dataset.status || "all";
      renderOrderCards();
    });
  });
}

function bindCalendarInteractions() {
  const calendar = document.getElementById("calendar");
  if (!calendar) return;

  const setDate = (dateKey) => {
    selectedDate = dateKey;
    buildCalendar();
    renderDailySummary(dateKey);
  };

  calendar.addEventListener("click", (event) => {
    const cell = event.target.closest(".calendar-day[data-date]");
    if (!cell) return;
    setDate(cell.dataset.date);
  });

  calendar.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const cell = event.target.closest(".calendar-day[data-date]");
    if (!cell) return;
    event.preventDefault();
    setDate(cell.dataset.date);
  });

}

function loadLocalOrders() {
  if (!useLocalOrders) {
    localOrders = [];
    return;
  }
  const raw = localStorage.getItem(localStorageKey);
  if (!raw) {
    localOrders = [];
    return;
  }
  try {
    localOrders = JSON.parse(raw);
    ensureLocalOrderIds();
  } catch (error) {
    console.warn("Error al leer pedidos locales:", error);
    localOrders = [];
  }
}

function ensureLocalOrderIds() {
  let updated = false;
  localOrders = localOrders.map((order, index) => {
    const localNumber = order?.localNumber || order?.displayId || String(index).padStart(2, "0");
    const withNumber = { ...order, localNumber, localIndex: index };
    if (order?.id) return withNumber;
    updated = true;
    const base = order?.createdAtLocal || order?.orderDate || Date.now();
    const safeBase = String(base).replace(/[^0-9]/g, "");
    return { ...withNumber, id: `local-${safeBase || "order"}-${index}` };
  });
  if (updated) {
    localStorage.setItem(localStorageKey, JSON.stringify(localOrders));
  }
}

async function loadRemoteData() {
  try {
    const [remote, remoteMetrics, remoteCalendar, remoteQuotes] = await Promise.all([
      fetchOrders().catch(() => []),
      fetchMetrics().catch(() => null),
      fetchCalendarStatuses().catch(() => null),
      fetchQuotes().catch(() => []),
    ]);

    if (remote?.length) {
      remoteOrders = remote;
    }
    if (remoteQuotes?.length) {
      quotes = remoteQuotes;
    }
    if (remoteMetrics) {
      metrics = { ...metrics, ...remoteMetrics };
    }
    if (remoteCalendar) {
      calendarStatuses = remoteCalendar;
    }

    rebuildOrders();
    renderQuotes();
  } catch (error) {
    console.warn("No se pudieron cargar datos remotos:", error);
  }
}

function startRealtimeListeners() {
  if (!unsubscribeOrders) {
    setSyncStatus("loading");
    unsubscribeOrders = subscribeOrders(
      (orders) => {
        remoteOrders = Array.isArray(orders) ? orders : [];
        handleNewOrders(remoteOrders);
        rebuildOrders();
        dedupeRemoteOrders();
        setSyncStatus("ready");
      },
      (error) => {
        console.warn("Realtime orders error:", error);
        setSyncStatus("error");
      }
    );
  }
  if (!unsubscribeQuotes) {
    unsubscribeQuotes = subscribeQuotes(
      (items) => {
        quotes = Array.isArray(items) ? items : [];
        handleNewQuotes(quotes);
        renderQuotes();
        updateSummary(currentSummaryRange);
      },
      (error) => {
        console.warn("Realtime quotes error:", error);
      }
    );
  }
}

function stopRealtimeListeners() {
  if (unsubscribeOrders) {
    unsubscribeOrders();
    unsubscribeOrders = null;
  }
  if (unsubscribeQuotes) {
    unsubscribeQuotes();
    unsubscribeQuotes = null;
  }
}

function showAuthMessage(message, tone = "info") {
  const authMessage = document.getElementById("auth-message");
  if (!authMessage) return;
  authMessage.textContent = message;
  authMessage.dataset.tone = tone;
}

function getAuthErrorMessage(error) {
  const code = error?.code || "";
  if (code === "auth/user-not-found") return t("crm_auth_invalid");
  if (code === "auth/wrong-password") return t("crm_auth_wrong_password");
  if (code === "auth/invalid-email") return t("crm_auth_invalid");
  if (code === "auth/user-disabled") return t("crm_auth_user_disabled");
  if (code === "auth/too-many-requests") return t("crm_auth_too_many_requests");
  if (code === "auth/unauthorized-domain") return t("crm_auth_unauthorized_domain");
  if (code === "auth/network-request-failed") return t("crm_auth_network");
  if (code === "auth/invalid-credential") return t("crm_auth_invalid");
  return t("crm_auth_unknown");
}

function lockDashboard() {
  document.getElementById("auth-panel")?.classList.remove("hidden");
  document.getElementById("crm-body")?.classList.add("locked");
  document.getElementById("sign-out")?.classList.add("hidden");
  document.getElementById("crm-nav-links")?.classList.add("hidden");
  document.getElementById("crm-nav-links")?.classList.remove("show");
  document.body.classList.remove("menu-open");
  setSyncStatus("offline");
  stopRealtimeListeners();
}

function unlockDashboard() {
  document.getElementById("auth-panel")?.classList.add("hidden");
  document.getElementById("crm-body")?.classList.remove("locked");
  document.getElementById("sign-out")?.classList.remove("hidden");
  document.getElementById("crm-nav-links")?.classList.remove("hidden");
  document.getElementById("crm-nav-links")?.classList.remove("show");
  document.body.classList.remove("menu-open");
  setSyncStatus("loading");
  startRealtimeListeners();
  void refreshStoredNotificationRegistration();
  if (!dataLoaded) {
    dataLoaded = true;
    loadRemoteData();
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("login-form");
  const signOutButton = document.getElementById("sign-out");
  const refreshBtn = document.getElementById("refresh-metrics");
  const syncBtn = document.getElementById("sync-data");
  const prevBtn = document.getElementById("calendar-prev");
  const nextBtn = document.getElementById("calendar-next");
  const daySearch = document.getElementById("day-search");
  const orderModal = document.getElementById("order-modal");
  const modalNextBtn = document.getElementById("order-next-status");
  const modalRejectBtn = document.getElementById("order-reject");
  const modalDeleteBtn = document.getElementById("order-delete");
  const modalNotesInput = document.getElementById("order-modal-notes-input");
  const confirmDeleteModal = document.getElementById("confirm-delete-modal");
  const confirmDeleteYes = document.getElementById("confirm-delete-yes");
  const confirmDeleteCancel = document.getElementById("confirm-delete-cancel");
  const confirmQuoteDeleteModal = document.getElementById("confirm-quote-delete-modal");
  const confirmQuoteDeleteYes = document.getElementById("confirm-quote-delete-yes");
  const confirmQuoteDeleteCancel = document.getElementById("confirm-quote-delete-cancel");
  const navLinks = document.getElementById("crm-nav-links");

  const today = new Date();
  const todayKey = getTodayKey();
  const todayDate = parseDate(todayKey) || new Date();
  pendingDeepLinkOrderId = getRequestedOrderId();
  selectedDate = todayKey;
  calendarMonth = todayDate.getMonth();
  calendarYear = todayDate.getFullYear();

  loadLocalOrders();
  rebuildOrders();
  renderQuotes();
  bindOrderFilters();
  bindOrderCardInteractions();
  bindDayOrderActions();
  bindQuoteActions();
  bindCalendarInteractions();
  initNotifications();

  daySearch?.addEventListener("input", (event) => {
    daySearchQuery = event.target.value;
    renderDailySummary(selectedDate || safeDateString(new Date()));
  });

  orderModal?.addEventListener("click", (event) => {
    const closeTarget = event.target.closest("[data-close=\"true\"]");
    if (closeTarget) {
      closeOrderModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeOrderModal();
  });

  modalNextBtn?.addEventListener("click", () => {
    const orderId = modalNextBtn.dataset.orderId;
    const nextStatus = modalNextBtn.dataset.nextStatus;
    if (orderId && nextStatus) {
      handleStatusChange(orderId, nextStatus);
    }
  });

  modalRejectBtn?.addEventListener("click", () => {
    const orderId = modalRejectBtn.dataset.orderId;
    if (orderId) {
      handleStatusChange(orderId, "Rechazado");
    }
  });
  modalDeleteBtn?.addEventListener("click", () => {
    const orderId = modalDeleteBtn.dataset.orderId;
    if (orderId) {
      openDeleteConfirm(orderId);
    }
  });
  modalNotesInput?.addEventListener("input", () => {
    syncOrderNotesEditor();
    if (openOrderId) {
      queueOrderNotesAutosave(openOrderId, modalNotesInput.value);
    }
  });
  modalNotesInput?.addEventListener("blur", () => {
    if (openOrderId) {
      queueOrderNotesAutosave(openOrderId, modalNotesInput.value, { immediate: true });
    }
  });

  confirmDeleteModal?.addEventListener("click", (event) => {
    const closeTarget = event.target.closest("[data-close=\"true\"]");
    if (closeTarget) {
      closeDeleteConfirm();
    }
  });
  confirmDeleteCancel?.addEventListener("click", () => {
    closeDeleteConfirm();
  });
  confirmDeleteYes?.addEventListener("click", () => {
    const orderId = confirmDeleteModal?.dataset.orderId;
    if (orderId) {
      handleDeleteOrder(orderId);
    }
  });

  confirmQuoteDeleteModal?.addEventListener("click", (event) => {
    const closeTarget = event.target.closest("[data-close=\"true\"]");
    if (closeTarget) {
      closeQuoteDeleteConfirm();
    }
  });
  confirmQuoteDeleteCancel?.addEventListener("click", () => {
    closeQuoteDeleteConfirm();
  });
  confirmQuoteDeleteYes?.addEventListener("click", () => {
    const quoteId = confirmQuoteDeleteModal?.dataset.quoteId;
    if (quoteId) {
      handleDeleteQuote(quoteId);
    }
  });

  observeAuthState((user) => {
    if (user) {
      unlockDashboard();
      showAuthMessage("", "info");
      const summaryMeta = document.getElementById("summary-meta");
      if (summaryMeta && user.email) {
        summaryMeta.dataset.user = `${user.email} · Rol: agent`;
        summaryMeta.textContent = summaryMeta.dataset.user;
      }
    } else {
      lockDashboard();
    }
  });

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
      rebuildOrders();
      renderQuotes();
    });
  }

  const shiftMonth = (delta) => {
    const base = new Date(calendarYear, calendarMonth + delta, 1);
    calendarMonth = base.getMonth();
    calendarYear = base.getFullYear();
    buildCalendar();
  };
  prevBtn?.addEventListener("click", () => shiftMonth(-1));
  nextBtn?.addEventListener("click", () => shiftMonth(1));

  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const identifier = document.getElementById("auth-identifier")?.value.trim();
    const password = document.getElementById("auth-password")?.value.trim();
    if (!identifier || !password) {
      showAuthMessage(t("crm_auth_missing"), "error");
      return;
    }
    showAuthMessage(t("crm_auth_checking"), "info");
    try {
      const email = await resolveUsernameToEmail(identifier);
      if (!email) {
        showAuthMessage(t("crm_auth_invalid"), "error");
        return;
      }
      await loginWithEmail(email, password);
      showAuthMessage(t("crm_auth_welcome"), "success");
    } catch (error) {
      console.error(error);
      showAuthMessage(getAuthErrorMessage(error), "error");
    }
  });

  signOutButton?.addEventListener("click", async () => {
    try {
      await logout();
    } catch (err) {
      console.error("Error al cerrar sesión", err);
    }
  });

  refreshBtn?.addEventListener("click", () => {
    rebuildOrders();
  });

  syncBtn?.addEventListener("click", () => {
    loadRemoteData();
  });

  document.querySelectorAll(".summary-tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".summary-tab").forEach((tab) => tab.classList.remove("active"));
      button.classList.add("active");
      currentSummaryRange = button.dataset.range || "day";
      updateSummary(currentSummaryRange);
    });
  });

  if (useLocalOrders) {
    window.addEventListener("storage", (event) => {
      if (event.key === localStorageKey) {
        loadLocalOrders();
        rebuildOrders();
      }
    });
  }

  window.addEventListener("quote-added", () => {
    if (dataLoaded) {
      loadRemoteData();
    }
  });
});
