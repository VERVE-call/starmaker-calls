import {
  doc, getDoc, setDoc, query, collection, where, getDocs, runTransaction
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './firebase.js';

export async function getOrCreateUser(firebaseUser) {
  const ref = doc(db, 'users', firebaseUser.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();

  const callingId = await generateUniqueCallingId();
  const userData = {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    displayName: firebaseUser.displayName || firebaseUser.email.split('@')[0],
    callingId
  };

  await runTransaction(db, async (tx) => {
    const idRef = doc(db, 'callingIds', String(callingId));
    tx.set(ref, userData);
    tx.set(idRef, { uid: firebaseUser.uid, callingId });
  });

  return userData;
}

async function generateUniqueCallingId() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const id = Math.floor(100000 + Math.random() * 900000);
    const idSnap = await getDoc(doc(db, 'callingIds', String(id)));
    if (!idSnap.exists()) return id;
  }
  throw new Error('Could not generate a unique calling ID. Please try again.');
}

export async function getUserByCallingId(callingId) {
  const idSnap = await getDoc(doc(db, 'callingIds', String(callingId)));
  if (!idSnap.exists()) return null;
  const { uid } = idSnap.data();
  return getUserById(uid);
}

export async function getUserById(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : null;
}
