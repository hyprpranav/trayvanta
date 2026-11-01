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
  apiKey: "AIzaSyBIfHaamcSGNIQLUH2-ThM_r0uJCIWbiL8",
  authDomain: "trayvanta.firebaseapp.com",
  projectId: "trayvanta",
  storageBucket: "trayvanta.firebasestorage.app",
  messagingSenderId: "333464902909",
  appId: "1:333464902909:web:c9f51516656d50b082f294"
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
