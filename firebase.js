import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyDsnLAh_C28Og_1ahcUd8IbHK9-rYVKvA4",
  authDomain: "starmaker-calls.firebaseapp.com",
  projectId: "starmaker-calls",
  storageBucket: "starmaker-calls.firebasestorage.app",
  messagingSenderId: "762728734680",
  appId: "1:762728734680:web:af856825d3ee09a304dcad"
};

let app, _auth, _db;

export function initFirebase() {
  app = initializeApp(firebaseConfig);
  _auth = getAuth(app);
  _db = getFirestore(app);
}

export { _auth as auth, _db as db };
