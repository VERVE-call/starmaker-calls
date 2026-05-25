import { initFirebase, auth, db } from './firebase.js';
import { loginUser, registerUser, logoutUser, onAuthChange } from './auth.js';
import { getOrCreateUser, getUserByCallingId, getUserById } from './users.js';
import { startCall, listenForIncomingCall, acceptCall, rejectCall, endCall, agoraState } from './calling.js';

initFirebase();

let currentUser = null;
let currentUserData = null;
let incomingCallUnsub = null;
let callTimerInterval = null;
let callSeconds = 0;
let micMuted = false;
let camOff = false;

const $ = id => document.getElementById(id);

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.style.display = '';
  });
  const target = $(`screen-${name}`);
  target.style.display = 'flex';
  requestAnimationFrame(() => target.classList.add('active'));
}

function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}

function startCallTimer() {
  callSeconds = 0;
  callTimerInterval = setInterval(() => {
    callSeconds++;
    const m = String(Math.floor(callSeconds / 60)).padStart(2, '0');
    const s = String(callSeconds % 60).padStart(2, '0');
    $('call-timer').textContent = `${m}:${s}`;
  }, 1000);
}

function stopCallTimer() {
  clearInterval(callTimerInterval);
  $('call-timer').textContent = '00:00';
}

function setCallStatus(text, connected = false) {
  $('call-status-label').textContent = text;
  const dot = $('call-status-dot');
  if (connected) dot.classList.add('connected');
  else dot.classList.remove('connected');
}

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    $(`tab-${btn.dataset.tab}`).classList.add('active');
    $('auth-error').textContent = '';
  });
});

$('btn-login').addEventListener('click', async () => {
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  $('auth-error').textContent = '';
  $('btn-login').disabled = true;
  const { error } = await loginUser(email, password);
  $('btn-login').disabled = false;
  if (error) $('auth-error').textContent = error;
});

$('btn-register').addEventListener('click', async () => {
  const name = $('reg-name').value.trim();
  const email = $('reg-email').value.trim();
  const password = $('reg-password').value;
  $('auth-error').textContent = '';
  if (!name) { $('auth-error').textContent = 'Display name is required'; return; }
  $('btn-register').disabled = true;
  const { error } = await registerUser(email, password, name);
  $('btn-register').disabled = false;
  if (error) $('auth-error').textContent = error;
});

$('btn-logout').addEventListener('click', async () => {
  if (incomingCallUnsub) incomingCallUnsub();
  await logoutUser();
});

$('btn-copy-id').addEventListener('click', () => {
  if (currentUserData?.callingId) {
    navigator.clipboard.writeText(String(currentUserData.callingId)).catch(() => {});
    showToast('Calling ID copied!');
  }
});

$('btn-call').addEventListener('click', async () => {
  const raw = $('dial-input').value.trim();
  const id = parseInt(raw, 10);
  if (!raw || isNaN(id) || raw.length !== 6) {
    showToast('Enter a valid 6-digit ID');
    return;
  }
  if (id === currentUserData?.callingId) {
    showToast("That's your own ID!");
    return;
  }
  $('btn-call').disabled = true;
  const target = await getUserByCallingId(id);
  if (!target) {
    showToast('User not found');
    $('btn-call').disabled = false;
    return;
  }
  showScreen('call');
  $('remote-placeholder').style.display = 'flex';
  $('remote-user-name').textContent = target.displayName || 'Calling…';
  setCallStatus('Calling…');
  const { error } = await startCall(currentUser.uid, target.uid, currentUserData.callingId, $('local-video-container'), $('remote-video-container'), {
    onConnected: () => { setCallStatus('Connected', true); startCallTimer(); $('remote-placeholder').style.display = 'none'; },
    onEnded: () => handleCallEnded(),
    onError: (e) => { showToast(e); handleCallEnded(); }
  });
  $('btn-call').disabled = false;
  if (error) { showToast(error); showScreen('home'); }
});

$('btn-accept').addEventListener('click', async () => {
  $('incoming-banner').classList.add('hidden');
  showScreen('call');
  $('remote-placeholder').style.display = 'flex';
  setCallStatus('Connecting…');
  const { error } = await acceptCall($('local-video-container'), $('remote-video-container'), {
    onConnected: () => { setCallStatus('Connected', true); startCallTimer(); $('remote-placeholder').style.display = 'none'; },
    onEnded: () => handleCallEnded(),
    onError: (e) => { showToast(e); handleCallEnded(); }
  });
  if (error) { showToast(error); showScreen('home'); }
});

$('btn-reject').addEventListener('click', async () => {
  $('incoming-banner').classList.add('hidden');
  await rejectCall();
});

$('btn-end-call').addEventListener('click', async () => {
  await endCall();
  handleCallEnded();
});

$('btn-toggle-mic').addEventListener('click', () => {
  micMuted = !micMuted;
  agoraState.localAudioTrack?.setEnabled(!micMuted);
  $('btn-toggle-mic').classList.toggle('muted', micMuted);
  $('btn-toggle-mic').textContent = micMuted ? '🔇' : '🎤';
});

$('btn-toggle-cam').addEventListener('click', () => {
  camOff = !camOff;
  agoraState.localVideoTrack?.setEnabled(!camOff);
  $('btn-toggle-cam').classList.toggle('muted', camOff);
  $('btn-toggle-cam').textContent = camOff ? '🚫' : '📷';
});

function handleCallEnded() {
  stopCallTimer();
  setCallStatus('Connecting…');
  micMuted = false;
  camOff = false;
  $('btn-toggle-mic').textContent = '🎤';
  $('btn-toggle-mic').classList.remove('muted');
  $('btn-toggle-cam').textContent = '📷';
  $('btn-toggle-cam').classList.remove('muted');
  $('remote-placeholder').style.display = 'flex';
  $('dial-input').value = '';
  showScreen('home');
}

onAuthChange(async (user) => {
  if (user) {
    currentUser = user;
    const userData = await getOrCreateUser(user);
    currentUserData = userData;
    $('home-display-name').textContent = userData.displayName || user.email;
    $('home-calling-id').textContent = `ID: ${userData.callingId}`;
    $('my-id-display').textContent = String(userData.callingId);
    showScreen('home');
    if (incomingCallUnsub) incomingCallUnsub();
    incomingCallUnsub = listenForIncomingCall(user.uid, async (callDoc) => {
      if (!callDoc) return;
      const caller = await getUserById(callDoc.callerId);
      $('incoming-caller-name').textContent = caller?.displayName || 'Unknown';
      $('remote-user-name').textContent = caller?.displayName || 'Unknown';
      $('incoming-banner').classList.remove('hidden');
    });
  } else {
    currentUser = null;
    currentUserData = null;
    if (incomingCallUnsub) incomingCallUnsub();
    $('incoming-banner').classList.add('hidden');
    showScreen('auth');
  }
});
