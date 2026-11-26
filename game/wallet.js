/*
 * Arena Ledger -- Adena wallet integration (game/wallet.js)
 * ---------------------------------------------------------
 * Plain browser JS (no modules, no build step). Loaded from GitHub Pages.
 *
 * This file NEVER requests, stores, or handles private keys or seed phrases.
 * It only talks to the Adena browser extension injected as window.adena, plus
 * a read-only public RPC query for balance. The game calls these globals
 * optionally and must keep working if this script or Adena is absent: every
 * method resolves with a UI-friendly result object instead of throwing an
 * unhandled rejection.
 *
 * Public API (window.ArenaWallet):
 *   connect()                       -> Promise<{address, ok, error?}>
 *   address()                       -> current address or null
 *   enter(matchId, pkgPath?)        -> Promise<tx result>  (2-token entry fee)
 *   reportKill(matchId, victimAddress, pkgPath?) -> Promise<tx result>
 *   balance()                       -> Promise<number> (0 on any failure)
 *   onReward(cb)                    -> cb({amount, from, txHash, estimated?})
 *                                      -> returns unsubscribe fn
 *
 * --------------------------------------------------------------------------
 * CAVEAT on onReward: Gno's RPC has no push event stream and tx_search cannot
 * reliably filter by event attribute (transactions are indexed by hash, not by
 * attribute). Exact reward-event parsing is therefore UNAVAILABLE. onReward
 * derives payouts on a best-effort basis from (a) events returned by the
 * ReportKill DoContract result and (b) an optional 15s tx_search poll. It can
 * miss or delay payouts, and when no amount can be parsed it emits amount: 0
 * with estimated: true. Treat the value as a hint; the authoritative amount is
 * the realm's own on-chain state. Amounts are raw on-chain integers (ugnot);
 * divide by 1e6 to display GNOT if the realm reports ugnot.
 * --------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  // >>> Realm package path (contract pending testnet approval). <<<
  var REALM_PKG_PATH = 'gno.land/r/g16aehkv63k62ege7z7c7g5zc58mljklvtdkxd3u/arena';

  var RPC = 'https://rpc.onyx.testnets.gno.land:443';
  var SITE_NAME = 'Arena Ledger';
  var GAS_FEE = 1;
  var GAS_WANTED = 3000000;

  var currentAddress = null;
  var rewardCbs = [];
  var seenTx = {};
  var pollTimer = null;
  var pollFails = 0;

  // --------------------------------------------------------------- helpers
  function getAdena() {
    return (global && global.adena) || (typeof window !== 'undefined' && window.adena) || null;
  }

  function friendlyError(e) {
    if (e == null) return 'Unknown wallet error.';
    if (typeof e === 'string') return e;
    if (typeof e === 'object') {
      if (e.message) return String(e.message);
      if (e.description) return String(e.description);
      if (e.error) return friendlyError(e.error);
    }
    return String(e);
  }

  function extractAddress(acct) {
    if (!acct) return null;
    if (typeof acct === 'string') return acct || null;
    if (typeof acct !== 'object') return null;
    var cands = [
      acct.address, acct.addr,
      acct.account && acct.account.address,
      acct.result && acct.result.address,
      acct.data && acct.data.address
    ];
    for (var i = 0; i < cands.length; i++) {
      if (typeof cands[i] === 'string' && cands[i].length > 0) return cands[i];
    }
    return null;
  }

  function fetchJSON(url) {
    return new Promise(function (resolve, reject) {
      if (typeof fetch !== 'function') { reject(new Error('fetch is unavailable')); return; }
      var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { controller.abort(); }, 6000) : null;
      function done(err, value) {
        if (timer) clearTimeout(timer);
        if (err) reject(err); else resolve(value);
      }
      fetch(url, controller ? { signal: controller.signal } : undefined)
        .then(function (r) {
          if (!r.ok) throw new Error('RPC HTTP ' + r.status);
          return r.json();
        })
        .then(function (j) { done(null, j); }, function (e) { done(e); });
    });
  }

  // UTF-8 string -> hex for the abci_query `data` parameter (0x-prefixed).
  function utf8Hex(str) {
    var bytes;
    if (typeof TextEncoder !== 'undefined') {
      bytes = new TextEncoder().encode(str);
    } else {
      var s = unescape(encodeURIComponent(str)); // eslint-disable-line no-undef
      bytes = [];
      for (var i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i) & 0xff);
    }
    var out = '';
    for (var j = 0; j < bytes.length; j++) {
      var h = bytes[j].toString(16);
      out += h.length === 1 ? '0' + h : h;
    }
    return out;
  }

  // --------------------------------------------------------- tx normalization
  function extractTxHash(res) {
    if (!res || typeof res !== 'object') return null;
    var cands = [res.txHash, res.txhash, res.tx_hash, res.hash];
    if (res.response) cands.push(res.response.txHash, res.response.txhash, res.response.hash);
    if (res.result) cands.push(res.result.txHash, res.result.txhash);
    for (var i = 0; i < cands.length; i++) {
      if (typeof cands[i] === 'string' && cands[i].length > 0) return cands[i];
    }
    return null;
  }

  function normalizeTx(res) {
    if (res == null) {
      return { ok: false, error: 'No response from wallet. The transaction may have been cancelled.' };
    }
    if (typeof res !== 'object') {
      return { ok: false, error: 'Unexpected response from wallet.' };
    }
    var err = res.error || res.Error || (res.response && res.response.Error);
    if (err) return { ok: false, error: friendlyError(err) };
    var code = res.code != null ? res.code : (res.response && res.response.code);
    if (code != null && Number(code) !== 0) {
      var log = res.raw_log || res.log || (res.response && res.response.Log) || 'Transaction failed on chain.';
      return { ok: false, error: friendlyError(log), code: Number(code) };
    }
    return { ok: true, txHash: extractTxHash(res), raw: res };
  }

  // -------------------------------------------------------- reward extraction
  function eventNodes(res) {
    var nodes = [];
    if (!res || typeof res !== 'object') return nodes;
    if (res.response && res.response.Events) nodes.push(res.response.Events);
    if (res.Events) nodes.push(res.Events);
    if (res.events) nodes.push(res.events);
    if (res.response && res.response.Log) nodes.push(res.response.Log);
    if (res.raw_log) nodes.push(res.raw_log);
    if (res.log) nodes.push(res.log);
    return nodes;
  }

  function parseNumeric(v) {
    if (typeof v === 'number') return isFinite(v) && v > 0 ? v : null;
    if (typeof v === 'string') {
      var m = v.match(/^[^0-9]*(\d+)/);
      if (m) {
        var n = Number(m[1]);
        return isFinite(n) && n > 0 ? n : null;
      }
    }
    return null;
  }

  // Best-effort search for an amount inside Gno tx events/attributes.
  function scanForAmount(node, depth) {
    if (node == null || depth > 8) return null;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) {
        var r = scanForAmount(node[i], depth + 1);
        if (r != null) return r;
      }
      return null;
    }
    if (typeof node === 'object') {
      if (typeof node.key === 'string' && /amount|reward|payout|value/i.test(node.key)) {
        var a = parseNumeric(node.value != null ? node.value : node.Value);
        if (a != null) return a;
      }
      var keys = Object.keys(node);
      for (var k = 0; k < keys.length; k++) {
        if (/amount|reward|payout/i.test(keys[k])) {
          var b = parseNumeric(node[keys[k]]);
          if (b != null) return b;
        }
      }
      for (var j = 0; j < keys.length; j++) {
        var c = scanForAmount(node[keys[j]], depth + 1);
        if (c != null) return c;
      }
    }
    return null;
  }

  function amountFromResult(res) {
    var nodes = eventNodes(res);
    for (var i = 0; i < nodes.length; i++) {
      var a = scanForAmount(nodes[i], 0);
      if (a != null) return a;
    }
    return null;
  }

  function emitReward(payload) {
    for (var i = 0; i < rewardCbs.length; i++) {
      try { rewardCbs[i](payload); } catch (e) { /* ignore game callback errors */ }
    }
  }

  // Contract amounts are millitokens (1 token = 1000 mtok).
  function formatMTok(mtok) {
    var neg = mtok < 0, n = Math.abs(mtok);
    var whole = Math.floor(n / 1000), frac = n % 1000;
    var s = String(whole);
    if (frac) {
      var f = String(frac);
      while (f.length < 3) f = '0' + f;
      f = f.replace(/0+$/, '');
      s += '.' + f;
    }
    return (neg ? '-' : '') + s;
  }

  // The authoritative reward is the change in the realm's own balance
  // ledger, not tx events (Gno RPC cannot filter events by attribute).
  function waitForBalanceIncrease(before, tries) {
    if (tries <= 0) return Promise.resolve(null);
    return balance().then(function (now) {
      if (now > before) return now - before;
      return new Promise(function (resolve) {
        setTimeout(function () { resolve(waitForBalanceIncrease(before, tries - 1)); }, 2000);
      });
    }).catch(function () { return null; });
  }

  function handleKillReward(res, out, args) {
    var victim = args.length > 1 ? args[1] : null;
    var amount = amountFromResult(res);
    var estimated = amount == null;
    emitReward({
      amount: estimated ? 0 : amount / 1000,
      mtok: estimated ? 0 : amount,
      amountText: estimated ? '0' : formatMTok(amount),
      from: victim,
      txHash: out.txHash || null,
      estimated: estimated
    });
  }

  // ---------------------------------------------------------- reward polling
  // Best-effort only: see CAVEAT above. Fails silently and stops after 3 errors.
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(pollRecent, 15000);
  }

  function pollRecent() {
    if (!currentAddress) return;
    var q = encodeURIComponent("message.sender='" + currentAddress + "'");
    var url = RPC + '/tx_search?query=' + q + '&per_page=20&order_by=%22desc%22';
    fetchJSON(url).then(function (j) {
      pollFails = 0;
      var txs = (j.result && j.result.txs) || [];
      for (var i = 0; i < txs.length; i++) {
        var tx = txs[i];
        var hash = tx.hash || tx.txhash || null;
        if (!hash || seenTx[hash]) continue;
        seenTx[hash] = true;
        var nodes = [];
        if (tx.tx_result && tx.tx_result.events) nodes.push(tx.tx_result.events);
        if (tx.events) nodes.push(tx.events);
        for (var n = 0; n < nodes.length; n++) {
          var amount = scanForAmount(nodes[n], 0);
          if (amount != null) {
            emitReward({ amount: amount, from: null, txHash: hash, estimated: false });
            break;
          }
        }
      }
    }).catch(function () {
      pollFails++;
      if (pollFails >= 3 && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    });
  }

  // ----------------------------------------------------------- realm calling
  function callRealm(func, args, pkgPath, send) {
    var a = getAdena();
    if (!a || typeof a.DoContract !== 'function') {
      return Promise.resolve({ ok: false, error: 'Adena wallet not available. Install it and connect first.' });
    }
    if (!currentAddress) {
      return Promise.resolve({ ok: false, error: 'Wallet not connected. Call ArenaWallet.connect() first.' });
    }
    var message = {
      type: '/vm.m_call',
      value: {
        caller: currentAddress,
        func: func,
        send: send || '',
        pkg_path: pkgPath || REALM_PKG_PATH,
        args: args
      }
    };
    try {
      return Promise.resolve(a.DoContract({
        messages: [message],
        gasFee: GAS_FEE,
        gasWanted: GAS_WANTED
      })).then(function (res) {
        var out = normalizeTx(res);
        return out;
      }).catch(function (e) {
        return { ok: false, error: friendlyError(e) };
      });
    } catch (e) {
      return Promise.resolve({ ok: false, error: friendlyError(e) });
    }
  }

  function connect() {
    var a = getAdena();
    if (!a) {
      return Promise.resolve({
        address: null,
        ok: false,
        error: 'Adena wallet not detected. Install it at https://adena.app and reload.'
      });
    }
    try {
      return Promise.resolve()
        .then(function () {
          return typeof a.AddEstablish === 'function' ? a.AddEstablish(SITE_NAME) : null;
        })
        .then(function () {
          if (typeof a.GetAccount !== 'function') throw new Error('Adena GetAccount is unavailable.');
          return a.GetAccount();
        })
        .then(function (acct) {
          var addr = extractAddress(acct);
          currentAddress = addr || null;
          if (!addr) return { address: null, ok: false, error: 'The wallet did not return an account address.' };
          return { address: addr, ok: true };
        })
        .catch(function (e) {
          return { address: null, ok: false, error: friendlyError(e) };
        });
    } catch (e) {
      return Promise.resolve({ address: null, ok: false, error: friendlyError(e) });
    }
  }

  // Evaluate one read-only getter on the realm. Response is base64 text
  // like '("42" int64)'; the first integer is the value in millitokens.
  function qevalNumber(expr) {
    var url = RPC + '/abci_query?path=%22vm/qeval%22&data=0x' + utf8Hex(expr);
    return fetchJSON(url).then(function (j) {
      var resp = j.result && j.result.response;
      if (!resp) throw new Error('No abci_query response');
      var rb = resp.ResponseBase || resp;
      if (rb.Error) throw new Error(String(rb.Error));
      if (!rb.Data) throw new Error('Empty qeval result');
      var text;
      try { text = atob(rb.Data); } catch (e) { throw new Error('Bad base64 result'); }
      var m = text.match(/(\d+)/);
      if (!m) throw new Error('Unparseable qeval result');
      var n = Number(m[1]);
      return isFinite(n) ? n : 0;
    });
  }

  function readAddressGetter(name) {
    var addr = currentAddress;
    if (!addr) return Promise.resolve(0);
    var q = String.fromCharCode(34); // a double quote, without escaping ambiguity
    return qevalNumber(REALM_PKG_PATH + '.' + name + '(' + q + addr + q + ')')
      .catch(function () { return 0; });
  }

  function balance() { return readAddressGetter('Balance'); }

  // --------------------------------------------------------------- export
  global.ArenaWallet = {
    PKG_PATH: REALM_PKG_PATH,
    RPC: RPC,
    connect: connect,
    address: function () { return currentAddress; },
    enter: function (matchId, pkgPath) {
      return callRealm('Enter', [], pkgPath).then(function (r) {
        if (r.ok) r.message = 'Entered match ' + matchId + ' (entry fee paid).';
        return r;
      });
    },
    reportKill: function (matchId, victimAddress, pkgPath) {
      var victim = victimAddress == null ? '' : String(victimAddress);
      return balance().then(function (before) {
        return callRealm('ReportKill', [victim], pkgPath).then(function (r) {
          if (!r.ok) return r;
          return waitForBalanceIncrease(before, 10).then(function (delta) {
            if (delta && delta > 0) {
              emitReward({
                amount: delta / 1000,
                mtok: delta,
                amountText: formatMTok(delta),
                from: victim,
                txHash: r.txHash || null,
                estimated: false
              });
            } else {
              handleKillReward(r.raw || {}, r, [victim]);
            }
            return r;
          });
        });
      });
    },
    buy: function (amountGnot, pkgPath) {
      var ugnot = Math.round(Number(amountGnot) * 1000000);
      if (!(ugnot > 0)) {
        return Promise.resolve({ ok: false, error: 'Buy amount must be greater than zero.' });
      }
      return callRealm('Buy', [], pkgPath, String(ugnot) + 'ugnot');
    },
    withdraw: function (mtok, pkgPath) {
      var amount = Math.floor(Number(mtok));
      if (!(amount > 0)) {
        return Promise.resolve({ ok: false, error: 'Withdraw amount must be greater than zero.' });
      }
      return callRealm('Withdraw', [String(amount)], pkgPath);
    },
    backing: function () {
      return qevalNumber(REALM_PKG_PATH + '.Backing()').catch(function () { return 0; });
    },
    faucet: function (pkgPath) {
      return callRealm('Faucet', [], pkgPath);
    },
    claim: function (pkgPath) {
      return callRealm('Claim', [], pkgPath);
    },
    pending: function () { return readAddressGetter('Pending'); },
    balanceTokens: function () {
      return balance().then(function (mtok) { return mtok / 1000; });
    },
    status: function () {
      return Promise.all([
        balance(),
        readAddressGetter('Pending'),
        qevalNumber(REALM_PKG_PATH + '.Backing()').catch(function () { return 0; })
      ]).then(function (v) {
        return {
          address: currentAddress,
          balanceMTok: v[0], balanceTokens: v[0] / 1000,
          pendingMTok: v[1], pendingTokens: v[1] / 1000,
          backingMTok: v[2], backingTokens: v[2] / 1000,
          balanceText: formatMTok(v[0]), pendingText: formatMTok(v[1])
        };
      });
    },
    balance: balance,
    onReward: function (cb) {
      if (typeof cb === 'function' && rewardCbs.indexOf(cb) < 0) {
        rewardCbs.push(cb);
        startPolling();
      }
      return function () {
        var i = rewardCbs.indexOf(cb);
        if (i >= 0) rewardCbs.splice(i, 1);
        if (rewardCbs.length === 0 && pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      };
    }
  };
})(typeof window !== 'undefined' ? window : this);
