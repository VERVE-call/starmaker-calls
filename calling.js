import {
  doc, setDoc, onSnapshot, updateDoc, deleteDoc, getDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './firebase.js';

const AGORA_APP_ID = '0810267927b4400490af954557a44417';

export const agoraState = {
  client: null,
  localAudioTrack: null,
  localVideoTrack: null
};

let activeCallId = null;
let callDocUnsub = null;
let callbacks = {};
let callEnded = false;

function getAgoraRTC() {
  return window.AgoraRTC;
}

async function initAgoraClient() {
  const AgoraRTC = getAgoraRTC();
  if (!AgoraRTC) throw new Error('Agora SDK not loaded');
  const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
  return client;
}

async function cleanupCall() {
  if (callDocUnsub) { callDocUnsub(); callDocUnsub = null; }
  if (agoraState.localAudioTrack) {
    agoraState.localAudioTrack.stop();
    agoraState.localAudioTrack.close();
    agoraState.localAudioTrack = null;
  }
  if (agoraState.localVideoTrack) {
    agoraState.localVideoTrack.stop();
    agoraState.localVideoTrack.close();
    agoraState.localVideoTrack = null;
  }
  if (agoraState.client) {
    try { await agoraState.client.leave(); } catch (_) {}
    agoraState.client = null;
  }
  activeCallId = null;
  callEnded = false;
}

export async function startCall(callerId, receiverId, callerNumericId, localContainer, remoteContainer, cbs) {
  callbacks = cbs;
  callEnded = false;
  await cleanupCall();

  try {
    const callId = `${callerId}_${Date.now()}`;
    activeCallId = callId;

    const AgoraRTC = getAgoraRTC();
    const client = await initAgoraClient();
    agoraState.client = client;

    const channelName = `ch${callId.replace(/[^a-zA-Z0-9]/g, '').substring(0, 20)}`;
    const callerUid = callerNumericId;

    client.on('user-published', async (user, mediaType) => {
      await client.subscribe(user, mediaType);
      if (mediaType === 'video') {
        user.videoTrack.play(remoteContainer);
        callbacks.onConnected?.();
      }
      if (mediaType === 'audio') {
        user.audioTrack?.play();
      }
    });

    client.on('user-left', () => {
      if (!callEnded) { callEnded = true; callbacks.onEnded?.(); }
    });

    await client.join(AGORA_APP_ID, channelName, null, callerUid);

    const [audioTrack, videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks(
      { AEC: true, AGC: true, ANS: true },
      { encoderConfig: { width: 640, height: 480, frameRate: 24, bitrateMin: 400, bitrateMax: 1000 } }
    );

    agoraState.localAudioTrack = audioTrack;
    agoraState.localVideoTrack = videoTrack;

    videoTrack.play(localContainer);
    await client.publish([audioTrack, videoTrack]);

    const callRef = doc(db, 'calls', callId);
    await setDoc(callRef, {
      callId,
      callerId,
      receiverId,
      channelName,
      callerUid,
      status: 'ringing',
      createdAt: Date.now()
    });

    const incomingRef = doc(db, 'calls', `incoming_${receiverId}`);
    await setDoc(incomingRef, {
      callId,
      callerId,
      receiverId,
      channelName,
      callerUid,
      status: 'ringing',
      createdAt: Date.now()
    });

    callDocUnsub = onSnapshot(callRef, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      if ((data.status === 'rejected' || data.status === 'ended') && !callEnded) {
        callEnded = true;
        cleanupCall();
        callbacks.onEnded?.();
      }
    });

    return {};
  } catch (e) {
    await cleanupCall();
    return { error: e.message || 'Failed to start call' };
  }
}

export function listenForIncomingCall(uid, callback) {
  const ref = doc(db, 'calls', `incoming_${uid}`);
  return onSnapshot(ref, async (snap) => {
    if (!snap.exists()) { callback(null); return; }
    const data = snap.data();
    if (data.status === 'ringing' && data.receiverId === uid) {
      activeCallId = data.callId;
      callback(data);
    }
  });
}

export async function acceptCall(localContainer, remoteContainer, cbs) {
  callbacks = cbs;
  callEnded = false;

  try {
    if (!activeCallId) throw new Error('No incoming call found');

    const callRef = doc(db, 'calls', activeCallId);
    const snap = await getDoc(callRef);
    if (!snap.exists()) throw new Error('Call no longer exists');

    const callData = snap.data();
    const { channelName, receiverId } = callData;

    await updateDoc(callRef, { status: 'active' });

    const AgoraRTC = getAgoraRTC();
    const client = await initAgoraClient();
    agoraState.client = client;

    const receiverSnap = await getDoc(doc(db, 'users', receiverId));
    const receiverData = receiverSnap.data();
    const receiverUid = receiverData?.callingId;

    client.on('user-published', async (user, mediaType) => {
      await client.subscribe(user, mediaType);
      if (mediaType === 'video') {
        user.videoTrack.play(remoteContainer);
        callbacks.onConnected?.();
      }
      if (mediaType === 'audio') {
        user.audioTrack?.play();
      }
    });

    client.on('user-left', () => {
      if (!callEnded) { callEnded = true; callbacks.onEnded?.(); }
    });

    await client.join(AGORA_APP_ID, channelName, null, receiverUid);

    const [audioTrack, videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks(
      { AEC: true, AGC: true, ANS: true },
      { encoderConfig: { width: 640, height: 480, frameRate: 24, bitrateMin: 400, bitrateMax: 1000 } }
    );

    agoraState.localAudioTrack = audioTrack;
    agoraState.localVideoTrack = videoTrack;

    videoTrack.play(localContainer);
    await client.publish([audioTrack, videoTrack]);

    callDocUnsub = onSnapshot(callRef, (s) => {
      if (!s.exists()) return;
      if (s.data().status === 'ended' && !callEnded) {
        callEnded = true;
        cleanupCall();
        callbacks.onEnded?.();
      }
    });

    try { await deleteDoc(doc(db, 'calls', `incoming_${receiverId}`)); } catch (_) {}

    return {};
  } catch (e) {
    await cleanupCall();
    return { error: e.message || 'Failed to accept call' };
  }
}

export async function rejectCall() {
  if (activeCallId) {
    try { await updateDoc(doc(db, 'calls', activeCallId), { status: 'rejected' }); } catch (_) {}
  }
  await cleanupCall();
}

export async function endCall() {
  callEnded = true;
  if (activeCallId) {
    try { await updateDoc(doc(db, 'calls', activeCallId), { status: 'ended' }); } catch (_) {}
  }
  await cleanupCall();
}
