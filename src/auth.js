// ============================================================
// SkyHigh Executive — Auth & Cloud Save Module
// Firebase Authentication + Firestore
// Falls back gracefully to localStorage when Firebase is off.
// ============================================================
window.SkyHigh = window.SkyHigh || {};

window.SkyHigh.Auth = (() => {
  'use strict';

  let _app = null, _auth = null, _db = null;
  let _currentUser = null;  // { uid, username, email, teamId, role }
  let _teamListener = null; // Firestore unsubscribe fn

  // ── ROLE METADATA ────────────────────────────────────────
  const ROLES = {
    CEO:  { label: 'Chief Executive Officer',  icon: '👔', color: '#C8933A', desc: 'Sets strategy, makes final decisions on crises and board events.' },
    CMO:  { label: 'Chief Marketing Officer',  icon: '📣', color: '#3498DB', desc: 'Manages campaigns, brand prestige, and customer loyalty.' },
    CFO:  { label: 'Chief Financial Officer',  icon: '💰', color: '#27AE60', desc: 'Controls loans, fuel hedging, and quarterly financial planning.' },
    CHRO: { label: 'Chief HR Officer',          icon: '👥', color: '#9B59B6', desc: 'Handles crew training, hiring, and employee relations crises.' },
  };

  // ── FIREBASE INIT ─────────────────────────────────────────
  function _init() {
    if (!window.SkyHigh.FIREBASE_ENABLED) return false;
    if (_app) return true;
    try {
      if (!firebase.apps.length) {
        _app  = firebase.initializeApp(window.SkyHigh.FIREBASE_CONFIG);
      } else {
        _app = firebase.apps[0];
      }
      _auth = firebase.auth();
      _db   = firebase.firestore();
      return true;
    } catch(e) {
      console.warn('[Auth] Firebase init failed:', e);
      return false;
    }
  }

  // ── PUBLIC API ────────────────────────────────────────────
  const API = {

    isEnabled() { return !!window.SkyHigh.FIREBASE_ENABLED; },
    isLoggedIn() { return !!_currentUser; },
    getUser()    { return _currentUser; },
    getRoles()   { return ROLES; },

    // ── REGISTER ───────────────────────────────────────────
    async register(email, password, username) {
      if (!_init()) return { ok: false, reason: 'Firebase not configured' };
      if (!email || !password || !username) return { ok: false, reason: 'All fields required' };
      if (username.length < 3) return { ok: false, reason: 'Username must be 3+ characters' };
      if (password.length < 6) return { ok: false, reason: 'Password must be 6+ characters' };

      try {
        // Check username is unique
        const usernameSnap = await _db.collection('usernames').doc(username.toLowerCase()).get();
        if (usernameSnap.exists) return { ok: false, reason: 'Username already taken' };

        const cred = await _auth.createUserWithEmailAndPassword(email, password);
        await cred.user.updateProfile({ displayName: username });

        // Store username mapping + user profile
        await _db.collection('usernames').doc(username.toLowerCase()).set({ uid: cred.user.uid });
        await _db.collection('users').doc(cred.user.uid).set({
          uid:       cred.user.uid,
          username,
          email,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          teamId:    null,
          role:      null,
        });

        _currentUser = { uid: cred.user.uid, username, email, teamId: null, role: null };
        return { ok: true, user: _currentUser };
      } catch(e) {
        return { ok: false, reason: _friendlyError(e) };
      }
    },

    // ── LOGIN ──────────────────────────────────────────────
    async login(emailOrUsername, password) {
      if (!_init()) return { ok: false, reason: 'Firebase not configured' };

      let email = emailOrUsername;
      // If no @, treat as username → look up email
      if (!emailOrUsername.includes('@')) {
        try {
          const snap = await _db.collection('usernames').doc(emailOrUsername.toLowerCase()).get();
          if (!snap.exists) return { ok: false, reason: 'Username not found' };
          const userData = await _db.collection('users').doc(snap.data().uid).get();
          email = userData.data()?.email;
          if (!email) return { ok: false, reason: 'Account error — try logging in with email' };
        } catch(e) {
          return { ok: false, reason: 'Username lookup failed' };
        }
      }

      try {
        const cred = await _auth.signInWithEmailAndPassword(email, password);
        const userDoc = await _db.collection('users').doc(cred.user.uid).get();
        const data = userDoc.data() || {};
        _currentUser = {
          uid:      cred.user.uid,
          username: cred.user.displayName || data.username || email,
          email:    cred.user.email,
          teamId:   data.teamId || null,
          role:     data.role   || null,
        };
        return { ok: true, user: _currentUser };
      } catch(e) {
        return { ok: false, reason: _friendlyError(e) };
      }
    },

    // ── LOGOUT ─────────────────────────────────────────────
    async logout() {
      if (_teamListener) { _teamListener(); _teamListener = null; }
      if (_auth) await _auth.signOut();
      _currentUser = null;
    },

    // ── RESTORE SESSION ────────────────────────────────────
    async restoreSession() {
      if (!_init()) return null;
      return new Promise(resolve => {
        _auth.onAuthStateChanged(async user => {
          if (user) {
            const doc = await _db.collection('users').doc(user.uid).get();
            const data = doc.data() || {};
            _currentUser = {
              uid:      user.uid,
              username: user.displayName || data.username || user.email,
              email:    user.email,
              teamId:   data.teamId || null,
              role:     data.role   || null,
            };
            resolve(_currentUser);
          } else {
            resolve(null);
          }
        });
      });
    },

    // ── TEAM: CREATE ───────────────────────────────────────
    async createTeam(teamName) {
      if (!_currentUser) return { ok: false, reason: 'Not logged in' };
      if (!teamName?.trim()) return { ok: false, reason: 'Team name required' };

      const inviteCode = _genCode();
      const teamId = _db.collection('teams').doc().id;

      await _db.collection('teams').doc(teamId).set({
        teamId,
        teamName: teamName.trim(),
        inviteCode,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: _currentUser.uid,
        status: 'lobby',
        gameState: null,
        members: [{
          uid:      _currentUser.uid,
          username: _currentUser.username,
          role:     'CEO',
          online:   true,
          joinedAt: Date.now(),
        }],
      });

      // Update user profile
      await _db.collection('users').doc(_currentUser.uid).update({ teamId, role: 'CEO' });
      _currentUser.teamId = teamId;
      _currentUser.role   = 'CEO';

      return { ok: true, teamId, inviteCode };
    },

    // ── TEAM: JOIN BY INVITE CODE ──────────────────────────
    async joinTeam(inviteCode) {
      if (!_currentUser) return { ok: false, reason: 'Not logged in' };
      if (!inviteCode?.trim()) return { ok: false, reason: 'Enter an invite code' };

      const snap = await _db.collection('teams')
        .where('inviteCode', '==', inviteCode.trim().toUpperCase())
        .limit(1).get();

      if (snap.empty) return { ok: false, reason: 'Invite code not found' };

      const teamDoc = snap.docs[0];
      const team = teamDoc.data();

      if (team.members.length >= 5) return { ok: false, reason: 'Team is full (max 5 players)' };
      if (team.status === 'playing') return { ok: false, reason: 'Game already in progress' };
      if (team.members.find(m => m.uid === _currentUser.uid)) return { ok: true, teamId: team.teamId, alreadyMember: true };

      // Pick next available role
      const takenRoles = team.members.map(m => m.role);
      const allRoles = ['CEO', 'CMO', 'CFO', 'CHRO', 'COO'];
      const assignedRole = allRoles.find(r => !takenRoles.includes(r)) || 'COO';

      await _db.collection('teams').doc(team.teamId).update({
        members: firebase.firestore.FieldValue.arrayUnion({
          uid:      _currentUser.uid,
          username: _currentUser.username,
          role:     assignedRole,
          online:   true,
          joinedAt: Date.now(),
        }),
      });

      await _db.collection('users').doc(_currentUser.uid).update({ teamId: team.teamId, role: assignedRole });
      _currentUser.teamId = team.teamId;
      _currentUser.role   = assignedRole;

      return { ok: true, teamId: team.teamId };
    },

    // ── TEAM: CHANGE ROLE ──────────────────────────────────
    async changeRole(teamId, newRole) {
      if (!_currentUser) return { ok: false, reason: 'Not logged in' };

      const teamDoc = await _db.collection('teams').doc(teamId).get();
      const team = teamDoc.data();
      if (!team) return { ok: false, reason: 'Team not found' };

      // Check role not already taken
      if (team.members.find(m => m.role === newRole && m.uid !== _currentUser.uid))
        return { ok: false, reason: `${newRole} role is already taken` };

      // Update member's role in the array
      const updatedMembers = team.members.map(m =>
        m.uid === _currentUser.uid ? { ...m, role: newRole } : m
      );
      await _db.collection('teams').doc(teamId).update({ members: updatedMembers });
      await _db.collection('users').doc(_currentUser.uid).update({ role: newRole });
      _currentUser.role = newRole;

      return { ok: true };
    },

    // ── TEAM: LISTEN (real-time) ───────────────────────────
    listenTeam(teamId, callback) {
      if (!_db) return;
      if (_teamListener) _teamListener();
      _teamListener = _db.collection('teams').doc(teamId).onSnapshot(snap => {
        if (snap.exists) callback(snap.data());
      });
    },

    stopListenTeam() {
      if (_teamListener) { _teamListener(); _teamListener = null; }
    },

    // ── PRESENCE ──────────────────────────────────────────
    async setOnline(teamId, online) {
      if (!_db || !_currentUser || !teamId) return;
      try {
        const teamDoc = await _db.collection('teams').doc(teamId).get();
        const team = teamDoc.data();
        if (!team) return;
        const updatedMembers = team.members.map(m =>
          m.uid === _currentUser.uid ? { ...m, online } : m
        );
        await _db.collection('teams').doc(teamId).update({ members: updatedMembers });
      } catch(e) { /* ignore */ }
    },

    // ── CLOUD SAVE ─────────────────────────────────────────
    async cloudSave(gameState) {
      if (!_currentUser) return { ok: false, reason: 'Not logged in' };
      if (!_db) return { ok: false, reason: 'Firebase not available' };

      try {
        const saveData = {
          savedAt:   firebase.firestore.FieldValue.serverTimestamp(),
          savedBy:   _currentUser.username,
          round:     gameState.round,
          cash:      gameState.cash,
          routes:    gameState.routes?.length || 0,
          gameState: JSON.stringify(gameState), // stored as string to avoid Firestore nested limit
        };

        // Save to user's personal save
        await _db.collection('users').doc(_currentUser.uid)
          .collection('saves').doc('latest').set(saveData);

        // If in a team, also save to team
        if (_currentUser.teamId) {
          await _db.collection('teams').doc(_currentUser.teamId).update({
            gameState: saveData.gameState,
            lastSavedAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastSavedBy: _currentUser.username,
          });
        }

        return { ok: true };
      } catch(e) {
        return { ok: false, reason: e.message };
      }
    },

    // ── CLOUD LOAD ─────────────────────────────────────────
    async cloudLoad() {
      if (!_currentUser || !_db) return null;
      try {
        // Try team save first, then personal save
        if (_currentUser.teamId) {
          const teamDoc = await _db.collection('teams').doc(_currentUser.teamId).get();
          const teamData = teamDoc.data();
          if (teamData?.gameState) {
            return JSON.parse(teamData.gameState);
          }
        }
        const saveDoc = await _db.collection('users').doc(_currentUser.uid)
          .collection('saves').doc('latest').get();
        if (saveDoc.exists && saveDoc.data()?.gameState) {
          return JSON.parse(saveDoc.data().gameState);
        }
      } catch(e) {
        console.warn('[Auth] cloudLoad error:', e);
      }
      return null;
    },

    // ── SEARCH USERS ──────────────────────────────────────
    async searchUsername(query) {
      if (!_db || !query) return [];
      const q = query.toLowerCase();
      const snap = await _db.collection('users')
        .where('username', '>=', q)
        .where('username', '<=', q + '\uf8ff')
        .limit(8).get();
      return snap.docs.map(d => ({ uid: d.id, username: d.data().username }));
    },

    // ── GET TEAM ───────────────────────────────────────────
    async getTeam(teamId) {
      if (!_db || !teamId) return null;
      const doc = await _db.collection('teams').doc(teamId).get();
      return doc.exists ? doc.data() : null;
    },

    // ── LEAVE TEAM ─────────────────────────────────────────
    async leaveTeam() {
      if (!_currentUser?.teamId || !_db) return;
      const teamId = _currentUser.teamId;
      const teamDoc = await _db.collection('teams').doc(teamId).get();
      const team = teamDoc.data();
      if (!team) return;
      const updatedMembers = team.members.filter(m => m.uid !== _currentUser.uid);
      if (updatedMembers.length === 0) {
        await _db.collection('teams').doc(teamId).delete();
      } else {
        await _db.collection('teams').doc(teamId).update({ members: updatedMembers });
      }
      await _db.collection('users').doc(_currentUser.uid).update({ teamId: null, role: null });
      _currentUser.teamId = null;
      _currentUser.role   = null;
    },
  };

  // ── HELPERS ───────────────────────────────────────────────
  function _genCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code.slice(0,3) + '-' + code.slice(3);
  }

  function _friendlyError(e) {
    const map = {
      'auth/email-already-in-use': 'Email already registered',
      'auth/invalid-email':        'Invalid email address',
      'auth/wrong-password':       'Incorrect password',
      'auth/user-not-found':       'Account not found',
      'auth/weak-password':        'Password too weak (min 6 chars)',
      'auth/too-many-requests':    'Too many attempts — try later',
    };
    return map[e.code] || e.message || 'Unknown error';
  }

  return API;
})();
