/*
 * Arena Ledger -- multiplayer networking (game/net.js)
 * -----------------------------------------------------
 * Plain browser JS (no modules, no build step), intended to be loaded from
 * GitHub Pages by index.html, which should also load PeerJS from CDN:
 *   <script src="https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js"></script>
 *
 * This file NEVER touches chain state and NEVER handles keys/seeds. The game
 * calls these globals optionally and must keep working if the script or PeerJS
 * is absent: every method is safe/no-op and never throws an unhandled error.
 *
 * Public API (window.ArenaNet):
 *   join(roomId, localPlayer) -> Promise<boolean>
 *   broadcast(state)          -- state = {id,name,pos:[x,y,z],rot:[yaw,pitch],weapon,shooting}
 *   onState(cb)               -- cb(array of remote states)   -> returns unsubscribe fn
 *   sendHit(targetId, damage, weapon)
 *   onHit(cb)                 -- cb({fromId, damage, weapon})  -> returns unsubscribe fn
 *   leave()
 *   status()                  -- {connected, isHost, roomId, id, peers} (+ peerCount alias)
 *
 * Design notes:
 *  - One host per room. The host claims the deterministic PeerJS id
 *    "arena_<room>"; an "id-taken" error makes a newcomer fall back to a
 *    random-id guest that connects to that host. No listAllPeers required.
 *  - The host relays state/hit messages between guests and injects its own.
 *  - Outbound state is throttled to ~20 Hz; inbound delivery is coalesced to
 *    the same rate to keep the game loop cheap.
 *  - Duplicate player ids are de-duplicated (first-seen wins) and our own
 *    echo is never reported back as a remote player.
 *  - If the host link drops, a guest retries with backoff and can become host.
 */
(function (global) {
  'use strict';

  var SEND_HZ = 20;
  var SEND_INTERVAL = 1000 / SEND_HZ; // 50ms

  var peer = null;
  var roomId = null;
  var hostId = null;
  var isHost = false;
  var localId = null;      // local player id (localPlayer.id, else peer id)
  var localPlayer = null;  // last known local state, used as initial "hello"
  var joining = false;

  var hostConn = null;     // guest -> host connection
  var guestConns = {};     // host: peerId -> connection
  var remoteStates = {};   // peerId -> latest state from that peer

  var stateCbs = [];
  var hitCbs = [];

  var lastSent = 0;
  var sendTimer = null;
  var pendingState = null;
  var deliverTimer = null;
  var reconnectTimer = null;
  var reconnectAttempts = 0;
  var pendingJoinFinish = null; // finish() of the in-flight join(), if any

  // ---------------------------------------------------------------- helpers
  function getPeerCtor() {
    return (global && global.Peer) || (typeof window !== 'undefined' && window.Peer) || null;
  }

  function makeHostId(room) {
    var clean = String(room == null ? 'default' : room).replace(/[^a-zA-Z0-9_-]/g, '_');
    return 'arena_' + clean;
  }

  function connList() {
    var out = [];
    if (isHost) {
      for (var k in guestConns) if (Object.prototype.hasOwnProperty.call(guestConns, k)) out.push(guestConns[k]);
    } else if (hostConn) {
      out.push(hostConn);
    }
    return out;
  }

  function safeSend(conn, msg) {
    if (conn && conn.open) {
      try { conn.send(msg); } catch (e) { /* closing connection is harmless */ }
    }
  }

  function sendToAll(msg) {
    var conns = connList();
    for (var i = 0; i < conns.length; i++) safeSend(conns[i], msg);
  }

  // De-duplicate by player id (first seen wins) and drop our own echo.
  function remoteArray() {
    var seen = {};
    var out = [];
    for (var pid in remoteStates) {
      if (!Object.prototype.hasOwnProperty.call(remoteStates, pid)) continue;
      var s = remoteStates[pid];
      if (!s || !s.id || s.id === localId) continue;
      if (seen[s.id]) continue;
      seen[s.id] = true;
      out.push(s);
    }
    return out;
  }

  function scheduleDelivery() {
    if (deliverTimer) return;
    deliverTimer = setTimeout(function () {
      deliverTimer = null;
      var arr = remoteArray();
      for (var i = 0; i < stateCbs.length; i++) {
        try { stateCbs[i](arr); } catch (e) { /* bad game callback must not break us */ }
      }
    }, SEND_INTERVAL);
  }

  // -------------------------------------------------------------- hit logic
  function deliverHit(hit) {
    for (var i = 0; i < hitCbs.length; i++) {
      try { hitCbs[i](hit); } catch (e) { /* ignore consumer errors */ }
    }
  }

  function peerIdForStateId(stateId) {
    if (stateId === localId) return null; // that's us
    for (var pid in remoteStates) {
      if (!Object.prototype.hasOwnProperty.call(remoteStates, pid)) continue;
      var s = remoteStates[pid];
      if (s && s.id === stateId) return pid;
    }
    return null;
  }

  // Guests send hits to the host; the host routes to the victim (or self).
  function routeHit(msg, fromPeerId) {
    var target = msg.targetId;
    if (isHost) {
      if (target === localId) {
        deliverHit({ fromId: msg.fromId, damage: msg.damage, weapon: msg.weapon });
        return;
      }
      var targetPid = peerIdForStateId(target);
      if (targetPid && guestConns[targetPid]) {
        safeSend(guestConns[targetPid], msg);
      } else {
        // Unknown target: best-effort fan-out so the victim still receives it.
        for (var pid in guestConns) {
          if (Object.prototype.hasOwnProperty.call(guestConns, pid) && pid !== fromPeerId) {
            safeSend(guestConns[pid], msg);
          }
        }
      }
    } else {
      deliverHit({ fromId: msg.fromId, damage: msg.damage, weapon: msg.weapon });
    }
  }

  // ----------------------------------------------------------- state logic
  function sendStateNow() {
    lastSent = Date.now();
    var st = pendingState || localPlayer;
    if (!st) return;
    sendToAll({ t: 'state', state: st });
  }

  function broadcast(state) {
    if (!state) return;
    pendingState = state;
    var now = Date.now();
    var elapsed = now - lastSent;
    if (elapsed >= SEND_INTERVAL) {
      sendStateNow();
    } else if (!sendTimer) {
      sendTimer = setTimeout(function () {
        sendTimer = null;
        sendStateNow();
      }, SEND_INTERVAL - elapsed);
    }
  }

  function handleState(msg, fromPeerId) {
    var st = msg && msg.state;
    if (!st || !st.id || st.id === localId) return;
    remoteStates[fromPeerId] = st;
    if (isHost) {
      // Relay to every other guest, and tell the sender about the host itself.
      for (var pid in guestConns) {
        if (!Object.prototype.hasOwnProperty.call(guestConns, pid)) continue;
        if (pid !== fromPeerId) safeSend(guestConns[pid], msg);
      }
      var mine = pendingState || localPlayer;
      if (mine && guestConns[fromPeerId]) safeSend(guestConns[fromPeerId], { t: 'state', state: mine });
    }
    scheduleDelivery();
  }

  // ------------------------------------------------------------ wire conns
  function wireConnection(conn, peerId, isHostLink) {
    conn.on('open', function () {
      var mine = pendingState || localPlayer;
      if (mine) safeSend(conn, { t: 'state', state: mine });
    });

    conn.on('data', function (data) {
      if (!data || typeof data !== 'object') return;
      if (data.t === 'state') {
        handleState(data, peerId);
      } else if (data.t === 'hit') {
        if (isHost) {
          routeHit(data, peerId);
        } else if (!data.targetId || data.targetId === localId) {
          routeHit(data, peerId); // routed hit from the host
        }
      }
    });

    conn.on('close', function () {
      if (isHostLink) {
        hostConn = null;
        delete remoteStates[peerId];
        scheduleDelivery();
        maybeReconnect();
      } else if (guestConns[peerId] === conn) {
        delete guestConns[peerId];
        delete remoteStates[peerId];
        scheduleDelivery();
      }
    });

    conn.on('error', function () { /* transient; the close handler cleans up */ });
  }

  function maybeReconnect() {
    if (joining || !roomId || reconnectTimer) return;
    if (reconnectAttempts >= 5) return;
    reconnectAttempts++;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      join(roomId, localPlayer).catch(function () { /* join never rejects */ });
    }, 1000 * reconnectAttempts);
  }

  // ------------------------------------------------------------ join/leave
  function becomeGuest(finish) {
    var Peer = getPeerCtor();
    if (peer) { try { peer.destroy(); } catch (e) {} }
    peer = new Peer(); // random id
    var settled = false;
    function done(ok) {
      if (settled) return;
      settled = true;
      finish(ok);
    }
    peer.on('open', function (id) {
      if (!localId) localId = id;
      hostConn = peer.connect(hostId, { reliable: true });
      wireConnection(hostConn, hostId, true);
      // Resolve only once the host link is actually usable, so status() is
      // accurate immediately after join() resolves.
      if (!hostConn) { done(false); return; }
      if (hostConn.open) { done(true); return; }
      hostConn.on('open', function () { done(true); });
      hostConn.on('error', function () { done(false); });
    });
    peer.on('error', function () {
      done(false);
      maybeReconnect();
    });
  }

  function join(room, player) {
    leave(); // tear down any previous session

    var Peer = getPeerCtor();
    roomId = room;
    localPlayer = player || null;
    localId = (player && player.id) ? player.id : null;
    hostId = makeHostId(roomId);
    joining = true;
    reconnectAttempts = 0;

    // Graceful degradation: no PeerJS -> not connected, resolve(false).
    if (!Peer) {
      joining = false;
      return Promise.resolve(false);
    }

    return new Promise(function (resolve) {
      var settled = false;
      function finish(result) {
        if (settled) return;
        settled = true;
        joining = false;
        if (pendingJoinFinish === finish) pendingJoinFinish = null;
        resolve(!!result);
      }
      pendingJoinFinish = finish;

      peer = new Peer(hostId); // attempt to claim the deterministic host id
      peer.on('open', function (id) {
        isHost = true;
        if (!localId) localId = id;
        guestConns = {};
        finish(true);
      });
      peer.on('connection', function (conn) {
        var pid = conn.peer;
        guestConns[pid] = conn;
        wireConnection(conn, pid, false);
      });
      peer.on('error', function (err) {
        if (err && err.type === 'id-taken') {
          isHost = false;
          becomeGuest(finish); // someone already hosts: join as a guest
          return;
        }
        finish(false);
      });
    });
  }

  function leave() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; }
    if (deliverTimer) { clearTimeout(deliverTimer); deliverTimer = null; }
    pendingState = null;
    lastSent = 0;

    for (var k in guestConns) {
      if (Object.prototype.hasOwnProperty.call(guestConns, k)) {
        try { guestConns[k].close(); } catch (e) {}
      }
    }
    guestConns = {};
    if (hostConn) { try { hostConn.close(); } catch (e) {} }
    hostConn = null;
    if (peer) { try { peer.destroy(); } catch (e) {} }
    peer = null;

    isHost = false;
    joining = false;
    reconnectAttempts = 0;
    remoteStates = {};
    roomId = null;
    hostId = null;
    localId = null;
    localPlayer = null;

    if (pendingJoinFinish) {
      var f = pendingJoinFinish;
      pendingJoinFinish = null;
      f(false);
    }
  }

  function status() {
    var connected = false;
    if (peer && !peer.destroyed) connected = isHost || !!(hostConn && hostConn.open);
    var n = 0;
    if (isHost) {
      for (var k in guestConns) if (Object.prototype.hasOwnProperty.call(guestConns, k)) n++;
    } else if (hostConn) {
      n = 1;
    }
    return {
      connected: connected,
      isHost: isHost,
      roomId: roomId,
      id: localId,
      peers: n,
      peerCount: n
    };
  }

  // ------------------------------------------------------------------ export
  global.ArenaNet = {
    join: join,
    broadcast: broadcast,
    onState: function (cb) {
      if (typeof cb === 'function') stateCbs.push(cb);
      return function () {
        var i = stateCbs.indexOf(cb);
        if (i >= 0) stateCbs.splice(i, 1);
      };
    },
    sendHit: function (targetId, damage, weapon) {
      if (!peer) return;
      var msg = { t: 'hit', fromId: localId, targetId: targetId, damage: damage, weapon: weapon };
      if (isHost) routeHit(msg, null);
      else if (hostConn) safeSend(hostConn, msg);
    },
    onHit: function (cb) {
      if (typeof cb === 'function') hitCbs.push(cb);
      return function () {
        var i = hitCbs.indexOf(cb);
        if (i >= 0) hitCbs.splice(i, 1);
      };
    },
    leave: leave,
    status: status
  };
})(typeof window !== 'undefined' ? window : this);
