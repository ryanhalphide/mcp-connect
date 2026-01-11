/**
 * Service Worker for MCP Connect
 * Handles push notifications and offline capabilities
 */

const CACHE_NAME = 'mcp-connect-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/workflows.html',
  '/analytics.html',
  '/css/workflows.css',
  '/css/mobile.css',
  '/css/animations.css',
  '/js/workflow-canvas.js',
  '/js/sse-client.js',
  '/js/touch-gestures.js'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
  // Activate immediately
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // Take control immediately
  return self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip API requests
  if (event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Cache hit - return response
        if (response) {
          return response;
        }

        // Clone the request
        const fetchRequest = event.request.clone();

        return fetch(fetchRequest).then((response) => {
          // Check if valid response
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          // Clone the response
          const responseToCache = response.clone();

          caches.open(CACHE_NAME)
            .then((cache) => {
              cache.put(event.request, responseToCache);
            });

          return response;
        }).catch(() => {
          // Return offline page if available
          return caches.match('/offline.html');
        });
      })
  );
});

// Push notification event
self.addEventListener('push', (event) => {
  let data = {};

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'MCP Connect', body: event.data.text() };
    }
  }

  const title = data.title || 'MCP Connect';
  const options = {
    body: data.body || 'New notification',
    icon: data.icon || '/favicon.ico',
    badge: '/badge.png',
    tag: data.tag || 'default',
    data: data.data || {},
    actions: data.actions || [
      { action: 'view', title: 'View' },
      { action: 'dismiss', title: 'Dismiss' }
    ],
    vibrate: [200, 100, 200],
    requireInteraction: data.requireInteraction || false
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'view') {
    // Open the app
    event.waitUntil(
      clients.openWindow(event.notification.data.url || '/')
    );
  } else if (event.action === 'dismiss') {
    // Just close the notification
    return;
  } else {
    // Default action - open the app
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
          // Focus existing window if available
          for (const client of clientList) {
            if (client.url.includes(self.location.origin) && 'focus' in client) {
              return client.focus();
            }
          }
          // Open new window
          if (clients.openWindow) {
            return clients.openWindow(event.notification.data.url || '/');
          }
        })
    );
  }
});

// Background sync event (for offline actions)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-workflows') {
    event.waitUntil(syncWorkflows());
  }
});

async function syncWorkflows() {
  try {
    // Get pending workflow executions from IndexedDB
    const pending = await getPendingWorkflows();

    for (const workflow of pending) {
      try {
        const response = await fetch('/api/workflows/execute', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${workflow.apiKey}`
          },
          body: JSON.stringify(workflow.data)
        });

        if (response.ok) {
          // Remove from pending queue
          await removePendingWorkflow(workflow.id);

          // Show success notification
          self.registration.showNotification('Workflow Synced', {
            body: `${workflow.data.name} executed successfully`,
            icon: '/favicon.ico',
            tag: 'sync-success'
          });
        }
      } catch (error) {
        console.error('Failed to sync workflow:', error);
      }
    }
  } catch (error) {
    console.error('Sync failed:', error);
  }
}

// Helper functions for IndexedDB (simplified)
async function getPendingWorkflows() {
  // Placeholder - would use IndexedDB in production
  return [];
}

async function removePendingWorkflow(id) {
  // Placeholder - would use IndexedDB in production
  return;
}

// Message event - handle messages from clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CACHE_URLS') {
    event.waitUntil(
      caches.open(CACHE_NAME)
        .then((cache) => cache.addAll(event.data.urls))
    );
  }
});
