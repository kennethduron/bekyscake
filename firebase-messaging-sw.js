/* global firebase, clients */
importScripts("https://www.gstatic.com/firebasejs/12.7.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.7.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBqMMMVefJQPb17QD3Rka1I7iyObZnAFQM",
  authDomain: "bekyscake-add24.firebaseapp.com",
  projectId: "bekyscake-add24",
  storageBucket: "bekyscake-add24.firebasestorage.app",
  messagingSenderId: "373972343553",
  appId: "1:373972343553:web:96deb7b89318861aced900",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || "Nuevo pedido";
  const body = payload?.notification?.body || "Revisa el CRM para ver detalles.";
  const icon = payload?.notification?.icon || "/assets/bekys_icon.png";
  const badge = payload?.notification?.badge || "/assets/bekys_icon.png";
  const link =
    payload?.fcmOptions?.link ||
    payload?.webpush?.fcm_options?.link ||
    payload?.data?.link ||
    `${self.location.origin}/crm`;

  self.registration.showNotification(title, {
    body,
    icon,
    badge,
    tag: payload?.data?.orderId || payload?.data?.quoteId || "bekys-crm-alert",
    renotify: true,
    requireInteraction: true,
    data: { link },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawTarget = event.notification?.data?.link || `${self.location.origin}/crm`;
  const targetUrl = new URL(rawTarget, self.location.origin);

  event.waitUntil((async () => {
    const windowClients = await clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    const crmClient = windowClients.find((client) => {
      try {
        const clientUrl = new URL(client.url);
        return (
          clientUrl.origin === targetUrl.origin &&
          (clientUrl.pathname === "/crm" || clientUrl.pathname === "/crm.html")
        );
      } catch {
        return false;
      }
    });

    if (crmClient) {
      if ("navigate" in crmClient) {
        await crmClient.navigate(targetUrl.href).catch(() => null);
      }
      return crmClient.focus();
    }

    return clients.openWindow(targetUrl.href);
  })());
});
