/**
 * Amplitude Analytics Helper
 * Provides utility functions for tracking events with Amplitude
 */

declare global {
  interface Window {
    amplitude?: any;
  }
}

export const AmplitudeEvents = {
  // Page Views
  PAGE_VIEW_LOADING: 'page_view_loading',
  PAGE_VIEW_SETUP: 'page_view_setup',
  
  // Setup Flow
  SETUP_LOGIN_SHOWN: 'setup_login_shown',
  SETUP_LOGIN_SUCCESS: 'setup_login_success',
  SETUP_LOGIN_FAILED: 'setup_login_failed',
  SETUP_STEP_VIEWED: 'setup_step_viewed',
  SETUP_PROVIDER_SELECTED: 'setup_provider_selected',
  SETUP_AUTH_METHOD_SELECTED: 'setup_auth_method_selected',
  SETUP_CHANNEL_ADDED: 'setup_channel_added',
  SETUP_STARTED: 'setup_started',
  SETUP_COMPLETED: 'setup_completed',
  SETUP_FAILED: 'setup_failed',
  
  // Post-Setup Actions
  SETUP_DOCTOR_RAN: 'setup_doctor_ran',
  SETUP_PAIRING_OPENED: 'setup_pairing_opened',
  SETUP_PAIRING_APPROVED: 'setup_pairing_approved',
  SETUP_PAIRING_FAILED: 'setup_pairing_failed',
  SETUP_RESET: 'setup_reset',
  
  // Navigation
  GATEWAY_UI_OPENED: 'gateway_ui_opened',
} as const;

export type AmplitudeEventName = typeof AmplitudeEvents[keyof typeof AmplitudeEvents];

/**
 * Track an event to Amplitude
 */
export function trackAmplitudeEvent(eventName: AmplitudeEventName, properties?: Record<string, any>): void {
  if (typeof window === 'undefined' || !window.amplitude) {
    console.warn('Amplitude not initialized');
    return;
  }

  try {
    window.amplitude.track(eventName, properties);
  } catch (error) {
    console.error('Failed to track Amplitude event:', error);
  }
}

/**
 * Set user properties in Amplitude
 */
export function setAmplitudeUserProperties(properties: Record<string, any>): void {
  if (typeof window === 'undefined' || !window.amplitude) {
    console.warn('Amplitude not initialized');
    return;
  }

  try {
    const identifyEvent = new window.amplitude.Identify();
    Object.entries(properties).forEach(([key, value]) => {
      identifyEvent.set(key, value);
    });
    window.amplitude.identify(identifyEvent);
  } catch (error) {
    console.error('Failed to set Amplitude user properties:', error);
  }
}
