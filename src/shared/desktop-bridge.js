// Capture the bridge once: losing a desktop connection never selects demo behavior.
export const desktopBridge = typeof window === 'undefined' ? undefined : window.arra;
