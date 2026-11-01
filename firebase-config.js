/**
 * TRAYVANTA - Firebase Configuration Module
 * 
 * Replace the placeholder values below with your Firebase Web App credentials
 * obtained from the Firebase Console (Project Settings > General > Your apps).
 * 
 * The system automatically detects whether valid credentials have been entered.
 * If credentials are not yet configured, the dashboard operates seamlessly in
 * "Local Session Standby" mode without crashing.
 */

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

/**
 * Checks if the Firebase configuration contains actual user credentials
 * rather than the placeholder strings.
 * @returns {boolean}
 */
export function isFirebaseConfigured() {
  return (
    Boolean(firebaseConfig.apiKey) &&
    firebaseConfig.apiKey !== "YOUR_API_KEY" &&
    Boolean(firebaseConfig.projectId) &&
    firebaseConfig.projectId !== "YOUR_PROJECT_ID"
  );
}
