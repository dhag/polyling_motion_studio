/*
================================================================================
 PolyLing モーションのキー列の評価  plmotion_curve.js
 （timeline.html と plmotion_vrma.js が使う。DOM を使わないので Node でもそのまま動く）
--------------------------------------------------------------------------------
 規則の正本は PolyLing 本体の C#
   Packages/com.haglib.polyling/Runtime/Poly_Ling_Main/Motion/MotionCurveMath.cs
 ここはそれを JS に写したもの。規則を変えるときは C# を先に変え、ここを合わせる。

 ■ 評価の規則
   1. 時刻をラップモードで先頭～末尾キーの範囲へ写す。
        Clamp / ClampForever / Once / Default / null … 端のキーで止める
        Loop     … 周期的に繰り返す（周期は先頭キー～末尾キー）
        PingPong … 往復する
   2. 時刻を挟む 2 キー k0, k1 を探す。
   3. k0 の rightTangentMode か k1 の leftTangentMode が Constant なら k0 の値（階段）。
   4. k0 と k1 のどちらも接線（tan）を持たないなら線形補間。回転は Slerp。
   5. それ以外は k0 の出側の傾き m0 と k1 の入側の傾き m1 を求め、3 次曲線で補間する。
        重みが両側とも 1/3 ならエルミート、そうでなければ重み付きベジェ。
      回転は 4 成分を別々に評価してから正規化する。
 ■ 傾きの求め方
   tan を持たないキー / Linear … 隣のキーへの直線の傾き（保存値は使わない）。
   Auto / ClampedAuto / Free  … 保存値（inTangent / outTangent）があればそれを使う。無いときだけ
     Auto        : 前後キーを結ぶ直線の傾き。端のキーは 0。
     ClampedAuto : 前後の区間の傾きの符号が揃わなければ 0、揃うなら区間の傾きの小さい方の 3 倍まで。
     Free        : ClampedAuto と同じ。
 ■ 値の形
   t   … キー時刻（秒）の配列（昇順）
   v   … 値の配列（スカラーは数、ベクトル・回転は配列。回転は Unity の [x,y,z,w]）
   tan … 接線の配列。スカラーはキーごとに接線オブジェクトか null、
         ベクトル・回転はキーごとに成分ごとの接線オブジェクトの配列か null（posTan / rotTan / sclTan と同じ）
   接線オブジェクト … { inTangent, outTangent, inWeight, outWeight, weightedMode, leftTangentMode, rightTangentMode }
 使い方
   PLCurve.evaluate(t, v, tan, pre, post, time)              // スカラー
   PLCurve.evaluateVector(t, v, tan, pre, post, time, 3)     // 位置・スケール
   PLCurve.evaluateRotation(t, v, tan, pre, post, time)      // 回転（正規化済み）
   PLCurve.fromTrack(trackDto, 'rot' | 'pos' | 'scl' | 'v')  // .plmotion.json のトラック → {t, v, tan}
   PLCurve.resolveOut(t, v, tan, i) / resolveIn(...)         // 1 成分のキー i の出側／入側の傾き（値/秒）
================================================================================
*/
(function (root) {
  'use strict';

  const DEFAULT_WEIGHT = 1 / 3;
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  const is = (s, mode) => typeof s === 'string' && s.toLowerCase() === mode.toLowerCase();
  const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
  // Mathf.Approximately
  const approx = (a, b) => Math.abs(b - a) < Math.max(1e-6 * Math.max(Math.abs(a), Math.abs(b)), 1.1210388e-44);
  // Mathf.Repeat / Mathf.PingPong。C# と同じく float（32 ビット）で計算する。
  // 周期の境目（1.8 / 0.6 など）で double と float の切り捨てが食い違い、ループの先頭と末尾のどちらになるかが変わるため。
  const f32 = Math.fround;
  const repeat = (t, len) => { const r = f32(t - f32(Math.floor(f32(t / len)) * len)); return Math.min(Math.max(r, 0), len); };
  const pingPong = (t, len) => { const r = repeat(t, f32(len * 2)); return f32(len - Math.abs(f32(r - len))); };
  const tanObj = x => (x && typeof x === 'object' && !Array.isArray(x)) ? x : null;

  // ============================================================ 規則 1
  /** 時刻を先頭～末尾キーの範囲へ写す。 */
  function wrapTime(t, pre, post, time) {
    const n = t.length;
    if (n <= 0) return time;
    const a = t[0], b = t[n - 1], len = b - a;
    if (time >= a && time <= b) return time;
    if (n < 2 || len <= 0) return a;
    const mode = time < a ? pre : post;
    const fa = f32(a), fl = f32(f32(b) - fa), d = f32(f32(time) - fa);
    if (is(mode, 'Loop')) return f32(fa + repeat(d, fl));
    if (is(mode, 'PingPong')) return f32(fa + pingPong(d, fl));
    return Math.min(Math.max(time, a), b);
  }

  // ============================================================ 規則 2～5
  // time を挟む区間の左端の番号（0～n-2）。t[0] < time < t[n-1] を前提とする。
  // C# の「while (i < n-2 && t[i+1] <= time) i++」と同じ結果を二分探索で求める。
  function findSegment(t, time) {
    let lo = 0, hi = t.length - 2;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (t[mid + 1] > time) hi = mid; else lo = mid + 1; }
    return lo;
  }
  const hasOutWeight = k => !!k && (is(k.weightedMode, 'Out') || is(k.weightedMode, 'Both'));
  const hasInWeight = k => !!k && (is(k.weightedMode, 'In') || is(k.weightedMode, 'Both'));
  function slope(t, v, a, b) { const dt = t[b] - t[a]; return dt > 0 ? (v[b] - v[a]) / dt : 0; }
  function smooth(t, v, i, clamped) {
    const n = t.length;
    if (n < 3 || i <= 0 || i >= n - 1) return 0;
    const span = t[i + 1] - t[i - 1];
    let m = span > 0 ? (v[i + 1] - v[i - 1]) / span : 0;
    if (!clamped) return m;
    const s0 = slope(t, v, i - 1, i), s1 = slope(t, v, i, i + 1);
    if (s0 * s1 <= 0) return 0;
    const limit = 3 * Math.min(Math.abs(s0), Math.abs(s1));
    if (Math.abs(m) > limit) m = Math.sign(m) * limit;
    return m;
  }
  function resolveOut(t, v, tan, i) {
    const n = t.length, k = tanObj(tan[i]);
    if (!k || is(k.rightTangentMode, 'Linear'))
      return i < n - 1 ? slope(t, v, i, i + 1) : (i > 0 ? slope(t, v, i - 1, i) : 0);
    if (finite(k.outTangent)) return k.outTangent;
    return smooth(t, v, i, !is(k.rightTangentMode, 'Auto'));
  }
  function resolveIn(t, v, tan, i) {
    const n = t.length, k = tanObj(tan[i]);
    if (!k || is(k.leftTangentMode, 'Linear'))
      return i > 0 ? slope(t, v, i - 1, i) : (i < n - 1 ? slope(t, v, i, i + 1) : 0);
    if (finite(k.inTangent)) return k.inTangent;
    return smooth(t, v, i, !is(k.leftTangentMode, 'Auto'));
  }
  function hermite(v0, m0, v1, m1, dt, u) {
    const u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * dt * m0 + (-2 * u3 + 3 * u2) * v1 + (u3 - u2) * dt * m1;
  }
  function bezier(p0, p1, p2, p3, s) {
    const r = 1 - s;
    return r * r * r * p0 + 3 * r * r * s * p1 + 3 * r * s * s * p2 + s * s * s * p3;
  }
  // 制御点: 時刻側 (0, w0, 1-w1, 1)、値側 (v0, v0+m0·w0·dt, v1-m1·w1·dt, v1)。媒介変数は二分法で求める。
  function weightedBezier(v0, m0, w0, v1, m1, w1, dt, u) {
    const x1 = w0, x2 = 1 - w1;
    let lo = 0, hi = 1, s = u;
    for (let it = 0; it < 40; it++) {
      s = 0.5 * (lo + hi);
      const x = bezier(0, x1, x2, 1, s);
      if (Math.abs(x - u) < 1e-6) break;
      if (x < u) lo = s; else hi = s;
    }
    return bezier(v0, v0 + m0 * w0 * dt, v1 - m1 * w1 * dt, v1, s);
  }
  /** 範囲内へ写した時刻で評価する（規則 2～5）。t・v は数の配列、tan は接線オブジェクトか null の配列。 */
  function evaluateMapped(t, v, tan, time) {
    const n = t.length;
    if (n <= 0) return 0;
    if (n === 1 || time <= t[0]) return v[0];
    if (time >= t[n - 1]) return v[n - 1];
    const i = findSegment(t, time), dt = t[i + 1] - t[i];
    if (dt <= 0) return v[i + 1];
    const a = tanObj(tan[i]), b = tanObj(tan[i + 1]);
    if ((a && is(a.rightTangentMode, 'Constant')) || (b && is(b.leftTangentMode, 'Constant'))) return v[i];   // 規則 3
    const u = (time - t[i]) / dt;
    if (!a && !b) return v[i] + (v[i + 1] - v[i]) * u;                                                     // 規則 4
    const m0 = resolveOut(t, v, tan, i), m1 = resolveIn(t, v, tan, i + 1);                                  // 規則 5
    const w0 = hasOutWeight(a) ? clamp01(finite(a.outWeight) ? a.outWeight : DEFAULT_WEIGHT) : DEFAULT_WEIGHT;
    const w1 = hasInWeight(b) ? clamp01(finite(b.inWeight) ? b.inWeight : DEFAULT_WEIGHT) : DEFAULT_WEIGHT;
    if (approx(w0, DEFAULT_WEIGHT) && approx(w1, DEFAULT_WEIGHT)) return hermite(v[i], m0, v[i + 1], m1, dt, u);
    return weightedBezier(v[i], m0, w0, v[i + 1], m1, w1, dt, u);
  }

  // ============================================================ トラック
  /** スカラー。キーが無ければ null。 */
  function evaluate(t, v, tan, pre, post, time) {
    if (!t.length) return null;
    return evaluateMapped(t, v, tan || [], wrapTime(t, pre, post, time));
  }
  // 成分 c の値と接線を取り出す。
  const compValues = (v, c) => v.map(x => x[c]);
  const compTans = (tan, n, c) => { const o = new Array(n); for (let j = 0; j < n; j++) { const a = tan && tan[j]; o[j] = Array.isArray(a) && a.length > c ? tanObj(a[c]) : null; } return o; };
  /** 位置・スケール（dim 成分）。キーが無ければ null。 */
  function evaluateVector(t, v, tan, pre, post, time, dim) {
    const n = t.length; if (!n) return null;
    dim = dim || 3;
    const mapped = wrapTime(t, pre, post, time), out = new Array(dim);
    for (let c = 0; c < dim; c++) out[c] = evaluateMapped(t, compValues(v, c), compTans(tan, n, c), mapped);
    return out;
  }

  // ---- クォータニオン
  const IDENTITY = [0, 0, 0, 1];
  function normalizeOr(q, fallback) {
    const len = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
    if (len < 1e-6 || Number.isNaN(len)) return fallback.slice();
    return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
  }
  // Quaternion.Slerp（近い向き側を回る。u は [0,1] に丸める）。
  // 本体（Unity 6000.3）の Quaternion.Slerp の出力を測った結果（2026-10-31、SandBox/curve_test/slerp_probe2）：
  // 2 キーの内積（float）が 0.95f 以上なら正規化した線形補間、未満なら球面線形補間と 1e-7 で一致する。それに合わせる。
  const NLERP_DOT = Math.fround(0.95);
  function slerp(a, b, u) {
    u = clamp01(u);
    a = normalizeOr(a, IDENTITY); b = normalizeOr(b, IDENTITY);
    let c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    if (c < 0) { b = [-b[0], -b[1], -b[2], -b[3]]; c = -c; }
    if (Math.fround(c) >= NLERP_DOT) return normalizeOr([a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1]), a[2] + u * (b[2] - a[2]), a[3] + u * (b[3] - a[3])], IDENTITY);
    const an = Math.acos(c), s = Math.sin(an), k0 = Math.sin((1 - u) * an) / s, k1 = Math.sin(u * an) / s;
    return normalizeOr([a[0] * k0 + b[0] * k1, a[1] * k0 + b[1] * k1, a[2] * k0 + b[2] * k1, a[3] * k0 + b[3] * k1], IDENTITY);
  }
  /** 回転。キーが無ければ null。結果は正規化済み。 */
  function evaluateRotation(t, v, tan, pre, post, time) {
    const n = t.length; if (!n) return null;
    const mapped = wrapTime(t, pre, post, time);
    if (n === 1 || mapped <= t[0]) return normalizeOr(v[0], IDENTITY);
    if (mapped >= t[n - 1]) return normalizeOr(v[n - 1], IDENTITY);
    const seg = findSegment(t, mapped), k0 = v[seg], k1 = v[seg + 1];
    const t0 = tan && Array.isArray(tan[seg]) ? tan[seg] : null, t1 = tan && Array.isArray(tan[seg + 1]) ? tan[seg + 1] : null;
    if (!t0 && !t1) {   // 規則 4: Slerp
      const dt = t[seg + 1] - t[seg];
      if (dt <= 0) return normalizeOr(k1, IDENTITY);
      return slerp(k0, k1, (mapped - t[seg]) / dt);
    }
    const q = new Array(4);   // 規則 5: 成分ごとに評価して正規化
    for (let c = 0; c < 4; c++) q[c] = evaluateMapped(t, compValues(v, c), compTans(tan, n, c), mapped);
    return normalizeOr(q, normalizeOr(k0, IDENTITY));
  }
  /** 回転キーの符号を隣と揃えた写しを返す（MotionCurveMath.EnsureQuaternionContinuity と同じ）。
      前のキーとの内積が負なら 4 成分とそのキーの回転接線の in / out の傾きを反転する。 */
  function ensureQuaternionContinuity(v, tan) {
    const ov = new Array(v.length), ot = tan ? tan.slice() : null;
    let prev = null;
    for (let j = 0; j < v.length; j++) {
      let q = v[j].slice();
      if (prev && prev[0] * q[0] + prev[1] * q[1] + prev[2] * q[2] + prev[3] * q[3] < 0) {
        q = q.map(x => -x);
        if (ot && Array.isArray(ot[j])) ot[j] = ot[j].map(tn => {
          if (!tn || typeof tn !== 'object') return tn;
          const o = Object.assign({}, tn);
          if (finite(o.inTangent)) o.inTangent = -o.inTangent;
          if (finite(o.outTangent)) o.outTangent = -o.outTangent;
          return o;
        });
      }
      ov[j] = q; prev = q;
    }
    return { v: ov, tan: ot };
  }

  // ============================================================ .plmotion.json のトラック
  const TAN_OF = { pos: 'posTan', rot: 'rotTan', scl: 'sclTan' };
  /** トラック DTO の 1 チャンネル → {t, v, tan, pre, post}。ch は 'pos' / 'rot' / 'scl'（骨）か 'v'（スカラー）。
      時刻の昇順に並べる。回転は符号を隣と揃える（本体の読込 MotionClipSerializer と同じ）。 */
  function fromTrack(track, ch) {
    const dim = ch === 'rot' ? 4 : ch === 'v' ? 0 : 3, rows = [];
    (track && Array.isArray(track.keys) ? track.keys : []).forEach((k, idx) => {
      if (!k || !finite(+k.t)) return;
      if (ch === 'v') { if (finite(+k.v)) rows.push({ t: +k.t, v: +k.v, tan: tanObj(k.tan), idx }); return; }
      const a = k[ch];
      if (!Array.isArray(a) || a.length < dim || !a.slice(0, dim).every(x => finite(+x))) return;
      const tn = k[TAN_OF[ch]];
      rows.push({ t: +k.t, v: a.slice(0, dim).map(Number), tan: Array.isArray(tn) ? tn : null, idx });
    });
    rows.sort((a, b) => a.t - b.t || a.idx - b.idx);
    let out = { t: rows.map(r => r.t), v: rows.map(r => r.v), tan: rows.map(r => r.tan) };
    if (ch === 'rot') { const c = ensureQuaternionContinuity(out.v, out.tan); out.v = c.v; out.tan = c.tan; }
    out.pre = track ? track.preWrapMode || null : null;
    out.post = track ? track.postWrapMode || null : null;
    return out;
  }

  // resolveIn / resolveOut はタイムラインのグラフエディタが接線の向きを描き、Free へ切り替えるときの傾きを求めるのに使う。
  const api = { wrapTime, evaluateMapped, evaluate, evaluateVector, evaluateRotation, ensureQuaternionContinuity, fromTrack, slerp, resolveIn, resolveOut };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PLCurve = api;
})(typeof window !== 'undefined' ? window : globalThis);
