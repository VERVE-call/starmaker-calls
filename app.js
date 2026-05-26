import { initFirebase } from './firebase.js';
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
let pipSwapped = false;
let controlsTimer = null;
let ringtone = null;

const $ = id => document.getElementById(id);

function buildRingtone() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  let playing = false;
  let nodes = [];

  function playBeep() {
    if (!playing) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.05);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
    nodes.push(osc);
    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.frequency.value = 660;
      osc2.type = 'sine';
      gain2.gain.setValueAtTime(0, ctx.currentTime);
      gain2.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.05);
      gain2.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
      osc2.start(ctx.currentTime);
      osc2.stop(ctx.currentTime + 0.4);
      nodes.push(osc2);
    }, 300);
  }

  let interval = null;
  return {
    start() {
      if (ctx.state === 'suspended') ctx.resume();
      playing = true;
      playBeep();
      interval = setInterval(playBeep, 2000);
    },
    stop() {
      playing = false;
      clearInterval(interval);
      nodes.forEach(n => { try { n.stop(); } catch(_) {} });
      nodes = [];
    }
  };
}

function startRingtone() {
  try {
    if (!ringtone) ringtone = buildRingtone();
    ringtone.start();
  } catch(_) {}
}

function stopRingtone() {
  try { ringtone?.stop(); } catch(_) {}
}

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
  setTimeout(() => t.classList.remove('show'), 2800);
}

function startCallTimer() {
  callSeconds = 0;
  $('call-timer').textContent = '';
  callTimerInterval = setInterval(() => {
    callSeconds++;
    const m = String(Math.floor(callSeconds / 60)).padStart(2, '0');
    const s = String(callSeconds % 60).padStart(2, '0');
    $('call-timer').textContent = `${m}:${s}`;
  }, 1000);
}

function stopCallTimer() {
  clearInterval(callTimerInterval);
  $('call-timer').textContent = '';
}

function setCallStatus(text, connected = false) {
  $('call-status-label').textContent = text;
  const dot = $('call-status-dot');
  connected ? dot.classList.add('connected') : dot.classList.remove('connected');
}

function showControls() {
  clearTimeout(controlsTimer);
  $('call-controls-bar').classList.remove('hidden');
  controlsTimer = setTimeout(() => {
    $('call-controls-bar').classList.add('hidden');
  }, 4000);
}

function initPipDrag() {
  const pip = $('local-pip');
  let dragging = false;
  let startX, startY, origLeft, origBottom;
  let moved = false;

  pip.addEventListener('touchstart', e => {
    if (pip.classList.contains('pip-large')) return;
    const t = e.touches[0];
    dragging = true;
    moved = false;
    startX = t.clientX;
    startY = t.clientY;
    const rect = pip.getBoundingClientRect();
    origLeft = rect.left;
    origBottom = window.innerHeight - rect.bottom;
    pip.style.transition = 'none';
  }, { passive: true });

  window.addEventListener('touchmove', e => {
    if (!dragging) return;
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved = true;
    let newLeft = origLeft + dx;
    let newBottom = origBottom - dy;
    newLeft = Math.max(8, Math.min(window.innerWidth - pip.offsetWidth - 8, newLeft));
    newBottom = Math.max(8, Math.min(window.innerHeight - pip.offsetHeight - 8, newBottom));
    pip.style.left = newLeft + 'px';
    pip.style.right = 'auto';
    pip.style.bottom = newBottom + 'px';
    pip.style.top = 'auto';
  }, { passive: true });

  window.addEventListener('touchend', () => { dragging = false; });

  pip.addEventListener('click', () => {
    if (moved) { moved = false; return; }
    pipSwapped = !pipSwapped;
    pip.classList.toggle('pip-large', pipSwapped);
    $('remote-video-container').style.zIndex = pipSwapped ? '2' : '1';
    pip.style.zIndex = pipSwapped ? '2' : '10';
    if (!pipSwapped) {
      pip.style.left = '';
      pip.style.right = '16px';
      pip.style.bottom = '120px';
      pip.style.top = 'auto';
      pip.style.transition = '';
    }
  });
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
  if (!raw || isNaN(id) || raw.length !== 6) { showToast('Enter a valid 6-digit ID'); return; }
  if (id === currentUserData?.callingId) { showToast("That's your own ID!"); return; }
  $('btn-call').disabled = true;
  const target = await getUserByCallingId(id);
  if (!target) { showToast('User not found'); $('btn-call').disabled = false; return; }
  resetCallUI();
  $('call-peer-name').textContent = target.displayName || 'Unknown';
  $('remote-user-name').textContent = target.displayName || 'Connecting…';
  showScreen('call');
  setCallStatus('Calling…');
  showControls();
  const { error } = await startCall(
    currentUser.uid, target.uid, currentUserData.callingId,
    $('local-video-container'), $('remote-video-container'),
    {
      onConnected: () => {
        setCallStatus('Connected', true);
        startCallTimer();
        $('remote-placeholder').style.display = 'none';
      },
      onEnded: () => handleCallEnded()
    }
  );
  $('btn-call').disabled = false;
  if (error) { showToast(error); showScreen('home'); }
});

$('btn-accept').addEventListener('click', async () => {
  stopRingtone();
  resetCallUI();
  showScreen('call');
  setCallStatus('Connecting…');
  showControls();
  const { error } = await acceptCall(
    $('local-video-container'), $('remote-video-container'),
    {
      onConnected: () => {
        setCallStatus('Connected', true);
        startCallTimer();
        $('remote-placeholder').style.display = 'none';
      },
      onEnded: () => handleCallEnded()
    }
  );
  if (error) { showToast(error); showScreen('home'); }
});

$('btn-reject').addEventListener('click', async () => {
  stopRingtone();
  showScreen('home');
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
  $('btn-toggle-mic').querySelector('.ctrl-icon').textContent = micMuted ? '🔇' : '🎤';
  $('btn-toggle-mic').querySelector('.ctrl-label').textContent = micMuted ? 'Unmute' : 'Mute';
  showControls();
});

$('btn-toggle-cam').addEventListener('click', () => {
  camOff = !camOff;
  agoraState.localVideoTrack?.setEnabled(!camOff);
  $('btn-toggle-cam').classList.toggle('muted', camOff);
  $('btn-toggle-cam').querySelector('.ctrl-icon').textContent = camOff ? '🚫' : '📷';
  $('btn-toggle-cam').querySelector('.ctrl-label').textContent = camOff ? 'Show' : 'Camera';
  showControls();
});

$('btn-flip-cam').addEventListener('click', async () => {
  if (!agoraState.localVideoTrack) return;
  try {
    const devices = await window.AgoraRTC.getCameras();
    if (devices.length < 2) { showToast('No second camera found'); return; }
    const currentLabel = agoraState.localVideoTrack._deviceName || '';
    const other = devices.find(d => d.label !== currentLabel) || devices[0];
    await agoraState.localVideoTrack.setDevice(other.deviceId);
  } catch (e) { showToast('Could not flip camera'); }
  showControls();
});

$('screen-call').addEventListener('click', (e) => {
  if (e.target.closest('.ctrl-btn') || e.target.closest('.pip-window')) return;
  showControls();
});

function resetCallUI() {
  pipSwapped = false;
  micMuted = false;
  camOff = false;
  const pip = $('local-pip');
  pip.classList.remove('pip-large');
  pip.style.cssText = 'right: 16px; bottom: 120px;';
  $('remote-video-container').style.zIndex = '1';
  $('remote-placeholder').style.display = 'flex';
  $('btn-toggle-mic').querySelector('.ctrl-icon').textContent = '🎤';
  $('btn-toggle-mic').querySelector('.ctrl-label').textContent = 'Mute';
  $('btn-toggle-mic').classList.remove('muted');
  $('btn-toggle-cam').querySelector('.ctrl-icon').textContent = '📷';
  $('btn-toggle-cam').querySelector('.ctrl-label').textContent = 'Camera';
  $('btn-toggle-cam').classList.remove('muted');
}

function handleCallEnded() {
  stopRingtone();
  stopCallTimer();
  setCallStatus('Connecting…');
  resetCallUI();
  $('dial-input').value = '';
  showScreen('home');
}

initPipDrag();

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
      if (!callDoc) {
        stopRingtone();
        return;
      }
      const caller = await getUserById(callDoc.callerId);
      const name = caller?.displayName || 'Unknown';
      $('incoming-name-big').textContent = name;
      $('call-peer-name').textContent = name;
      $('remote-user-name').textContent = name;
      showScreen('incoming');
      startRingtone();
    });
  } else {
    currentUser = null;
    currentUserData = null;
    if (incomingCallUnsub) incomingCallUnsub();
    stopRingtone();
    showScreen('auth');
  }
});
