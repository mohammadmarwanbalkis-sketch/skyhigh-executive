// ============================================================
// SkyHigh Executive — Firebase Configuration
// ============================================================
// To use login, saves, and teams:
// 1. Go to https://console.firebase.google.com
// 2. Create a project → Add Web App → Copy the config below
// 3. Enable Authentication → Email/Password
// 4. Enable Firestore Database (start in test mode for dev)
// ============================================================
window.SkyHigh = window.SkyHigh || {};

window.SkyHigh.FIREBASE_CONFIG = {
  apiKey:            "AIzaSyPLACEHOLDER",
  authDomain:        "skyhigh-executive.firebaseapp.com",
  projectId:         "skyhigh-executive",
  storageBucket:     "skyhigh-executive.appspot.com",
  messagingSenderId: "000000000000",
  appId:             "1:000000000000:web:PLACEHOLDER",
};

// Set to true once you have a real Firebase project configured above
window.SkyHigh.FIREBASE_ENABLED = false;
