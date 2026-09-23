/*
================================================================================
 PolyLing ライブ受信  polyling_live.js
 （polyling_motion_studio.html が <script src> で読む）
--------------------------------------------------------------------------------
 PolyLing の「ライブ受信」が画面向けに配信する WebSocket（既定 ws://localhost:12361/）を受ける。
 PolyLing は UDP でマッスルを受け取るたびに、つながっている画面へ送ってくる。
 こちらからは何も送らない（受信開始＝接続するだけ）。

 封筒（PolyLing の WebSocket 部品 com.haglib.net_duplexchannel の形式。RemoteHtmlClient.cs と同じ開き方）
   Text フレーム   : {type,id,items:[{type,mimeType,data,encoding}]}
                     items[].type … 0=Text 3=Json（data は JSON 文字列）、それ以外はバイナリ（encoding:'base64'）
   Binary フレーム : DuplexPacket（16 バイトの頭 'DPX\n'|ver|type|id|payloadLen|tagLen）+ tag + TypedPayload
 中身の振り分け
   JSON は中の type で handlers[type] を呼ぶ。今あるのは
     muscles … {type:'muscles', seq, time, muscles:{マッスル名:値}, rootT:[x,y,z], rootQ:[x,y,z,w]}
   バイナリは handlers.binary(Uint8Array) を呼ぶ（将来のモデル受信用。今は送られてこない）。

 使い方
   const live = PolyLingLive.create({ muscles: m => …, binary: bytes => … },
                                    { onState: s => …（'connecting' / 'on' / 'off'）, onLog: t => … });
   live.connect('ws://localhost:12361/');  live.disconnect();
================================================================================
*/
(function () {
  function b64ToBytes(b64) {
    const bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  // Text フレームの封筒 → { json:[文字列], bin:[Uint8Array] }
  function decodeTextEnvelope(str) {
    const out = { json: [], bin: [] };
    let root; try { root = JSON.parse(str); } catch (e) { return out; }
    const items = Array.isArray(root.items) ? root.items : null;
    if (!items) return out;
    for (const it of items) {
      const t = it.type | 0, raw = it.data != null ? String(it.data) : '';
      if (t === 0 || t === 3) out.json.push(raw);
      else out.bin.push(it.encoding === 'base64' ? b64ToBytes(raw) : new TextEncoder().encode(raw));
    }
    return out;
  }

  // Binary フレーム（DuplexPacket）→ { json:[文字列], bin:[Uint8Array] }
  function decodeBinaryPacket(buffer) {
    const out = { json: [], bin: [] };
    if (buffer.byteLength < 16) return out;
    const v = new DataView(buffer);
    if (v.getUint8(0) !== 0x44 || v.getUint8(1) !== 0x50 || v.getUint8(2) !== 0x58 || v.getUint8(3) !== 0x0A) return out;
    if (v.getUint8(4) !== 1) return out;
    const payloadLen = v.getUint32(10, true), tagLen = v.getUint16(14, true), start = 16 + tagLen;
    if (start + payloadLen > buffer.byteLength) return out;
    const bytes = new Uint8Array(buffer, start, payloadLen);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.byteLength < 4) return out;
    const count = dv.getInt32(0, true);
    let off = 4;
    for (let i = 0; i < count; i++) {
      if (off + 4 > bytes.byteLength) break;
      const size = dv.getInt32(off, true); off += 4;
      if (off + size > bytes.byteLength) break;
      const type = dv.getUint8(off), mimeLen = dv.getUint16(off + 1, true);
      const data = bytes.subarray(off + 3 + mimeLen, off + size);
      if (type === 0 || type === 3) out.json.push(new TextDecoder().decode(data));
      else out.bin.push(data.slice());
      off += size;
    }
    return out;
  }

  function create(handlers, opt) {
    opt = opt || {};
    const state = s => { if (opt.onState) opt.onState(s); };
    const log = t => { if (opt.onLog) opt.onLog(t); };
    let ws = null;

    function dispatch(env) {
      for (const j of env.json) {
        let m; try { m = JSON.parse(j); } catch (e) { continue; }
        const h = m && handlers[m.type];
        if (h) h(m);
      }
      if (handlers.binary) for (const b of env.bin) handlers.binary(b);
    }

    function connect(url) {
      disconnect();
      try { ws = new WebSocket(url); } catch (e) { log('URL が不正: ' + e.message); ws = null; state('off'); return; }
      ws.binaryType = 'arraybuffer';
      state('connecting');
      ws.onopen = () => { state('on'); log('受信開始'); };
      ws.onclose = () => { ws = null; state('off'); log('受信停止'); };
      ws.onerror = () => { log('接続できませんでした（PolyLing の受け入れ許可・配信ポートを確認）'); };
      ws.onmessage = ev => dispatch(ev.data instanceof ArrayBuffer ? decodeBinaryPacket(ev.data) : decodeTextEnvelope(ev.data));
    }

    function disconnect() {
      const w = ws; ws = null;
      if (w) { w.onclose = null; try { w.close(); } catch (e) {} state('off'); }
    }

    return { connect, disconnect, get connected() { return !!ws; } };
  }

  window.PolyLingLive = { create };
})();
