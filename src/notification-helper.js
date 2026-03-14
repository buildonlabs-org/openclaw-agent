/**
 * Notification Helper for OpenClaw Agent
 * Sends notifications to the launcher frontend via webhook
 */

// Environment variables set by launcher
const LAUNCHER_WEBHOOK_URL = process.env.LAUNCHER_WEBHOOK_URL?.trim();
const LAUNCHER_AGENT_TOKEN = process.env.LAUNCHER_AGENT_TOKEN?.trim();

// Configuration
const RATE_LIMIT = 100; // Max notifications per hour
const TIMEOUT_MS = 5000; // Webhook request timeout

// Rate limiting state
const rateLimiter = {
  count: 0,
  windowStart: Date.now(),
  windowMs: 60 * 60 * 1000, // 1 hour
};

/**
 * Check if rate limit has been exceeded
 */
function isRateLimited() {
  const now = Date.now();
  
  // Reset counter if window has passed
  if (now - rateLimiter.windowStart > rateLimiter.windowMs) {
    rateLimiter.count = 0;
    rateLimiter.windowStart = now;
  }
  
  return rateLimiter.count >= RATE_LIMIT;
}

/**
 * Send notification to launcher webhook
 * @param {string} type - Notification type: "cron", "task", "error", "info"
 * @param {string} title - Notification title (max 200 chars)
 * @param {string} message - Notification message (max 1000 chars)
 * @param {object} data - Optional data object
 * @returns {Promise<boolean>} Success status
 */
async function sendNotification(type, title, message, data = null) {
  // Skip if webhook not configured
  if (!LAUNCHER_WEBHOOK_URL || !LAUNCHER_AGENT_TOKEN) {
    return false;
  }

  // Check rate limit
  if (isRateLimited()) {
    console.warn('[notification] rate limit exceeded, skipping notification');
    return false;
  }

  try {
    // Truncate title and message to limits
    const truncatedTitle = title.slice(0, 200);
    const truncatedMessage = message.slice(0, 1000);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(LAUNCHER_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Token': LAUNCHER_AGENT_TOKEN,
      },
      body: JSON.stringify({
        type,
        title: truncatedTitle,
        message: truncatedMessage,
        data,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    rateLimiter.count++;

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error(`[notification] webhook failed: ${response.status} ${errorText}`);
      return false;
    }

    return true;
  } catch (error) {
    // Don't crash on notification failures
    if (error.name === 'AbortError') {
      console.warn('[notification] webhook timeout');
    } else {
      console.error('[notification] webhook error:', error.message);
    }
    return false;
  }
}

/**
 * Send cron job notification
 * @param {string} jobName - Name of the cron job
 * @param {string} message - Result message
 * @param {object} data - Optional data (e.g., { recordsProcessed: 100, duration: 5 })
 */
export async function notifyCronJob(jobName, message, data = null) {
  return sendNotification('cron', jobName, message, data);
}

/**
 * Send task completion notification
 * @param {string} taskName - Name of the task
 * @param {string} message - Result message
 * @param {object} data - Optional data
 */
export async function notifyTaskComplete(taskName, message, data = null) {
  return sendNotification('task', taskName, message, data);
}

/**
 * Send error notification
 * @param {string} title - Error title
 * @param {Error|string} error - Error object or message
 * @param {object} data - Optional context data
 */
export async function notifyError(title, error, data = null) {
  const message = error instanceof Error ? error.message : String(error);
  return sendNotification('error', title, message, data);
}

/**
 * Send info notification
 * @param {string} title - Info title
 * @param {string} message - Info message
 * @param {object} data - Optional data
 */
export async function notifyInfo(title, message, data = null) {
  return sendNotification('info', title, message, data);
}

/**
 * Wrap an async function to automatically send success/error notifications
 * @param {string} taskName - Name to display in notifications
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Wrapped function
 */
export function withNotification(taskName, fn) {
  return async (...args) => {
    const startTime = Date.now();
    try {
      const result = await fn(...args);
      const duration = Math.round((Date.now() - startTime) / 1000);
      
      const data = typeof result === 'object' && result !== null ? result : { duration };
      if (!data.duration) data.duration = duration;
      
      await notifyCronJob(
        taskName,
        `Completed successfully in ${duration}s`,
        data
      );
      
      return result;
    } catch (error) {
      const duration = Math.round((Date.now() - startTime) / 1000);
      await notifyError(
        `${taskName} Failed`,
        error,
        { duration, error: error.message }
      );
      throw error;
    }
  };
}

/**
 * Check if notification system is configured
 */
export function isNotificationConfigured() {
  return !!(LAUNCHER_WEBHOOK_URL && LAUNCHER_AGENT_TOKEN);
}

/**
 * Get rate limit status
 */
export function getRateLimitStatus() {
  const now = Date.now();
  const windowRemaining = rateLimiter.windowMs - (now - rateLimiter.windowStart);
  return {
    count: rateLimiter.count,
    limit: RATE_LIMIT,
    remaining: RATE_LIMIT - rateLimiter.count,
    windowRemaining: Math.max(0, windowRemaining),
  };
}

// Log configuration status on import
if (isNotificationConfigured()) {
  console.log('[notification] webhook configured and ready');
} else {
  console.log('[notification] webhook not configured (set LAUNCHER_WEBHOOK_URL and LAUNCHER_AGENT_TOKEN)');
}
