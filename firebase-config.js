/* ludus/firebase-config.js — fill this in to enable ONLINE multiplayer.
 *
 * 1. Create a Firebase project (https://console.firebase.google.com).
 * 2. Add a Web App; enable Realtime Database (test mode is fine to start).
 * 3. Paste the config below. databaseURL is required for Realtime DB.
 *
 * Local play vs the bot and hotseat work WITHOUT any of this — online mode
 * simply stays disabled until a valid config (with databaseURL) is present.
 */
window.LUDUS_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBoWXONT4fF-Oqnj95oEJ4v7djN839sUok",
  authDomain: "ludus-alera.firebaseapp.com",
  databaseURL: "https://ludus-alera-default-rtdb.firebaseio.com",
  projectId: "ludus-alera",
  storageBucket: "ludus-alera.firebasestorage.app",
  messagingSenderId: "208415489645",
  appId: "1:208415489645:web:ef266583dee64a48a04964",
  measurementId: "G-VFR4SVWQ79"
};
