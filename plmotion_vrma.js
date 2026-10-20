/*
================================================================================
 PolyLing モーション ⇄ VRM アニメーション（.vrma）  plmotion_vrma.js
 （timeline.html が <script src> で読む。DOM を使わないので Node でもそのまま動く）
--------------------------------------------------------------------------------
 規則の正本は PolyLing 本体の C#（Runtime/Poly_Ling_Main/Motion/VrmaCodec.cs・VrmaCodec.Read.cs）と
 PolyLing_VRMA整備計画.md の 2.2・2.4・5。ここはそれを JS に写したもの。違いは次の 2 点だけ。
   ・書き出しの回転は bakedBones だけから作る（マッスルから骨を解くのは Unity にしかできないため）。
     bakedBones の無いクリップは書き出せない（PolyLing で .plmotion を書き直すと bakedBones が付く）。
     視線は lookAt トラック、無ければ bakedBones の LeftEye / RightEye の向きから作る
     （C# は目のマッスルから Unity で解いた目の向きを使う。bakedBones の目はそれと同じ値）。
   ・読込は muscles と body を作らない（同じ理由）。bakedBones・表情・lookAt だけの DTO を返す。
     そのファイルを PolyLing が読むと、bakedBones からマッスル＋body を焼く（整備計画 段 ⑤）。
 値の意味
   bakedBones … 正準骨格（VRM T ポーズ、+Z 正面、レストの全ローカル回転が単位）上の Humanoid ローカル回転。
                Unity 左手系 [x,y,z,w]。Hips の pos は「レスト位置からの差 ÷ レストの腰の高さ」。
   glTF ⇔ Unity は X 反転：位置 (-x, y, z)、回転 (x, -y, -z, w)。
 使い方
   const r = PLVrma.decode(arrayBuffer, 'name');   // → {dto, issues:[{code, message, error}]}
   const w = PLVrma.encode(dto, {fps});           // → {glb:Uint8Array, report}（失敗は例外）
================================================================================
*/
(function (root) {
  'use strict';

  // ============================================================ 正準骨格（CanonSkeleton.Table と同じ）
  const CANON_TABLE = [
    'Hips||0 1 0', 'Spine|Hips|0 0.1 0', 'Chest|Spine|0 0.12 0', 'UpperChest|Chest|0 0.12 0',
    'Neck|UpperChest|0 0.16 0', 'Head|Neck|0 0.1 0', 'LeftEye|Head|-0.03 0.07 0.08', 'RightEye|Head|0.03 0.07 0.08',
    'LeftUpperLeg|Hips|-0.09 -0.05 0', 'LeftLowerLeg|LeftUpperLeg|-0.0105 -0.419869 0', 'LeftFoot|LeftLowerLeg|0 -0.42 0', 'LeftToes|LeftFoot|0 0 0.12',
    'RightUpperLeg|Hips|0.09 -0.05 0', 'RightLowerLeg|RightUpperLeg|0.0105 -0.419869 0', 'RightFoot|RightLowerLeg|0 -0.42 0', 'RightToes|RightFoot|0 0 0.12',
    'LeftShoulder|UpperChest|-0.02 0.12 0', 'LeftUpperArm|LeftShoulder|-0.09993 0.00373 0', 'LeftLowerArm|LeftUpperArm|-0.26 0 0', 'LeftHand|LeftLowerArm|-0.24 0 0',
    'LeftThumbProximal|LeftHand|-0.02 -0.01 0.025', 'LeftThumbIntermediate|LeftThumbProximal|-0.029233 -0.012881 0.024073', 'LeftThumbDistal|LeftThumbIntermediate|-0.021926 -0.009717 0.018023',
    'LeftIndexProximal|LeftHand|-0.08 0 0.02', 'LeftIndexIntermediate|LeftIndexProximal|-0.039989 0.00094 0', 'LeftIndexDistal|LeftIndexIntermediate|-0.024994 0.000545 0.000002',
    'LeftMiddleProximal|LeftHand|-0.08 0 0', 'LeftMiddleIntermediate|LeftMiddleProximal|-0.044988 0.001058 0', 'LeftMiddleDistal|LeftMiddleIntermediate|-0.029993 0.000654 0.000003',
    'LeftRingProximal|LeftHand|-0.075 0 -0.02', 'LeftRingIntermediate|LeftRingProximal|-0.039989 0.00094 0', 'LeftRingDistal|LeftRingIntermediate|-0.024994 0.000545 0.000005',
    'LeftLittleProximal|LeftHand|-0.07 0 -0.04', 'LeftLittleIntermediate|LeftLittleProximal|-0.029992 0.000705 0', 'LeftLittleDistal|LeftLittleIntermediate|-0.019995 0.000436 0.000002',
    'RightShoulder|UpperChest|0.02 0.12 0', 'RightUpperArm|RightShoulder|0.09993 0.00373 0', 'RightLowerArm|RightUpperArm|0.26 0 0', 'RightHand|RightLowerArm|0.24 0 0',
    'RightThumbProximal|RightHand|0.02 -0.01 0.025', 'RightThumbIntermediate|RightThumbProximal|0.029233 -0.012881 0.024073', 'RightThumbDistal|RightThumbIntermediate|0.021926 -0.009717 0.018023',
    'RightIndexProximal|RightHand|0.08 0 0.02', 'RightIndexIntermediate|RightIndexProximal|0.039989 0.00094 0', 'RightIndexDistal|RightIndexIntermediate|0.024994 0.000545 0.000002',
    'RightMiddleProximal|RightHand|0.08 0 0', 'RightMiddleIntermediate|RightMiddleProximal|0.044988 0.001058 0', 'RightMiddleDistal|RightMiddleIntermediate|0.029993 0.000654 0.000003',
    'RightRingProximal|RightHand|0.075 0 -0.02', 'RightRingIntermediate|RightRingProximal|0.039989 0.00094 0', 'RightRingDistal|RightRingIntermediate|0.024994 0.000545 0.000005',
    'RightLittleProximal|RightHand|0.07 0 -0.04', 'RightLittleIntermediate|RightLittleProximal|0.029992 0.000705 0', 'RightLittleDistal|RightLittleIntermediate|0.019995 0.000436 0.000002',
  ];
  const ROWS = CANON_TABLE.map(line => {
    const c = line.split('|');
    return { bone: c[0], parent: c[1] || null, pos: c[2].split(' ').map(Number) };
  });
  const ROW_OF = {}; ROWS.forEach(r => { ROW_OF[r.bone] = r; });
  const HIPS_REST = ROWS[0].pos.slice();
  const HIPS_HEIGHT = HIPS_REST[1];
  /** .vrma に載せるボーンか（目・あごは載せない）。 */
  const isVrmaBone = b => b !== 'LeftEye' && b !== 'RightEye' && b !== 'Jaw';

  // Unity HumanBodyBones 名 ⇔ VRM 1.0 humanBones 名（親指だけ 1 段ずれる）
  const THUMB_U2V = { Proximal: 'Metacarpal', Intermediate: 'Proximal', Distal: 'Distal' };
  function vrmBoneName(u) {
    const m = /^(Left|Right)Thumb(Proximal|Intermediate|Distal)$/.exec(u);
    if (m) return m[1].toLowerCase() + 'Thumb' + THUMB_U2V[m[2]];
    return u[0].toLowerCase() + u.slice(1);
  }
  const BONE_BY_VRM = {};
  ROWS.map(r => r.bone).concat(['Jaw']).forEach(b => { BONE_BY_VRM[vrmBoneName(b)] = b; });

  // ============================================================ 数学（Unity と同じ掛け順：a*b は b のあとに a）
  const qmul = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  const qinv = q => [-q[0], -q[1], -q[2], q[3]];
  function qnorm(q) {
    const s = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3];
    if (!(s >= 1e-12)) return [0, 0, 0, 1];
    const k = 1 / Math.sqrt(s); return [q[0] * k, q[1] * k, q[2] * k, q[3] * k];
  }
  const qdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  function qslerp(a, b, t) {
    let c = qdot(a, b), bb = b;
    if (c < 0) { bb = [-b[0], -b[1], -b[2], -b[3]]; c = -c; }
    if (c > 0.9995) return qnorm([a[0] + t * (bb[0] - a[0]), a[1] + t * (bb[1] - a[1]), a[2] + t * (bb[2] - a[2]), a[3] + t * (bb[3] - a[3])]);
    const an = Math.acos(c), s = Math.sin(an), k0 = Math.sin((1 - t) * an) / s, k1 = Math.sin(t * an) / s;
    return [a[0] * k0 + bb[0] * k1, a[1] * k0 + bb[1] * k1, a[2] * k0 + bb[2] * k1, a[3] * k0 + bb[3] * k1];
  }
  function qrot(q, v) {   // q · v · q⁻¹
    const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
  }
  const qaxis = (x, y, z, deg) => { const h = deg * Math.PI / 360, s = Math.sin(h); return [x * s, y * s, z * s, Math.cos(h)]; };
  /** Unity の Quaternion.Euler(x, y, z)（Z → X → Y の順に回す）。 */
  const qeuler = (x, y, z) => qmul(qmul(qaxis(0, 1, 0, y), qaxis(1, 0, 0, x)), qaxis(0, 0, 1, z));
  /** Unity の Quaternion.LookRotation(forward, up)。 */
  function qlook(f, u) {
    const nz = Math.hypot(f[0], f[1], f[2]); if (nz < 1e-12) return [0, 0, 0, 1];
    const z = [f[0] / nz, f[1] / nz, f[2] / nz];
    let x = [u[1] * z[2] - u[2] * z[1], u[2] * z[0] - u[0] * z[2], u[0] * z[1] - u[1] * z[0]];
    const nx = Math.hypot(x[0], x[1], x[2]); if (nx < 1e-12) return [0, 0, 0, 1];
    x = [x[0] / nx, x[1] / nx, x[2] / nx];
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    const m00 = x[0], m01 = y[0], m02 = z[0], m10 = x[1], m11 = y[1], m12 = z[1], m20 = x[2], m21 = y[2], m22 = z[2], tr = m00 + m11 + m22;
    let q;
    if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]; }
    else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
    else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
    else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]; }
    return qnorm(q);
  }
  const posG = v => [-v[0], v[1], v[2]];             // Unity ⇔ glTF（自己逆）
  const rotG = q => [q[0], -q[1], -q[2], q[3]];
  const f32 = v => Math.fround(v);
  const round6 = v => Math.round(f32(v) * 1e6) / 1e6;   // C# の D()：float を 6 桁に

  // ============================================================ PolyLing モーションのキーの評価（線形・回転は Slerp）
  // 接線（tan / rotTan / posTan）とラップモードは使わない（先頭・末尾の外は端の値）。使っていれば issues に出す。
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  function keysWith(track, ch, n) {
    const ks = [];
    (track && Array.isArray(track.keys) ? track.keys : []).forEach(k => {
      if (!k || !finite(+k.t)) return;
      if (ch === 'v') { if (finite(+k.v)) ks.push({ t: +k.t, v: +k.v }); return; }
      const a = k[ch]; if (Array.isArray(a) && a.length === n && a.every(x => finite(+x))) ks.push({ t: +k.t, v: a.map(Number) });
    });
    ks.sort((a, b) => a.t - b.t); return ks;
  }
  function evalKeys(ks, t, mix) {
    if (!ks.length) return null;
    if (t <= ks[0].t) return ks[0].v;
    if (t >= ks[ks.length - 1].t) return ks[ks.length - 1].v;
    let lo = 0, hi = ks.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ks[mid].t <= t) lo = mid; else hi = mid; }
    const a = ks[lo], b = ks[hi], d = b.t - a.t;
    return d > 0 ? mix(a.v, b.v, (t - a.t) / d) : b.v;
  }
  const mixRot = (a, b, u) => qslerp(qnorm(a), qnorm(b), u);
  const mixVec = (a, b, u) => a.map((x, i) => x + (b[i] - x) * u);
  const mixNum = (a, b, u) => a + (b - a) * u;
  function maxKeyTime(dto) {
    let m = 0;
    const scan = tr => (tr && Array.isArray(tr.keys) ? tr.keys : []).forEach(k => { if (k && finite(+k.t)) m = Math.max(m, +k.t); });
    ['bones', 'bakedBones', 'muscles', 'expressions'].forEach(n => (Array.isArray(dto[n]) ? dto[n] : []).forEach(scan));
    scan(dto.body); scan(dto.lookAt); return m;
  }
  const clipLength = dto => Math.max(finite(+dto.duration) ? +dto.duration : 0, maxKeyTime(dto));

  // ============================================================ 表情名 → VRM の表情名（VrmExpressionNames と同じ表）
  const PRESETS = ['happy', 'angry', 'sad', 'relaxed', 'surprised', 'aa', 'ih', 'ou', 'ee', 'oh',
    'blink', 'blinkLeft', 'blinkRight', 'lookUp', 'lookDown', 'lookLeft', 'lookRight', 'neutral'];
  const PRESET_BY_LOWER = {}; PRESETS.forEach(p => { PRESET_BY_LOWER[p.toLowerCase()] = p; });
  const PRESET_BY_PMX = { 'あ': 'aa', 'い': 'ih', 'う': 'ou', 'え': 'ee', 'お': 'oh', 'まばたき': 'blink', 'ウィンク': 'blinkLeft', 'ウィンク右': 'blinkRight',
    '笑い': 'happy', '怒り': 'angry', '困る': 'sad', 'リラックス': 'relaxed', '驚き': 'surprised',
    '上': 'lookUp', '下': 'lookDown', '左': 'lookLeft', '右': 'lookRight', 'Neutral': 'neutral' };
  function tryGetPreset(name) {
    if (!name) return null;
    return PRESET_BY_LOWER[String(name).trim().toLowerCase()] || null;
  }
  function tryResolvePreset(name, nameEnglish) {
    return tryGetPreset(nameEnglish) || tryGetPreset(name) || (name ? PRESET_BY_PMX[String(name).trim()] || null : null);
  }
  const isLookPreset = p => p === 'lookUp' || p === 'lookDown' || p === 'lookLeft' || p === 'lookRight';

  // ============================================================ 視線
  /** 向き（Head から見た向き）→ yaw（Y 軸回り、+X へ向くと正）・pitch（X 軸回り、下へ向くと正）。度。 */
  function yawPitch(d) {
    const l = Math.hypot(d[0], d[1], d[2]); if (l < 1e-6) return [0, 0];
    return [Math.atan2(d[0], d[2]) * 180 / Math.PI, -Math.asin(Math.max(-1, Math.min(1, d[1] / l))) * 180 / Math.PI];
  }
  /** 左右の目のローカル回転 → lookAt の回転（CanonBoneMotion.TryGetLookAt と同じ）。 */
  function lookAtFromEyes(l, r) {
    const a = qrot(l, [0, 0, 1]), b = qrot(r, [0, 0, 1]), d = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    if (d[0] * d[0] + d[1] * d[1] + d[2] * d[2] < 1e-12) return [0, 0, 0, 1];
    const [yaw, pitch] = yawPitch(d); return qeuler(pitch, yaw, 0);
  }

  // ============================================================ 書き出し（DTO → .vrma）
  function encode(dto, opt) {
    opt = opt || {};
    if (!dto || typeof dto !== 'object') throw new Error('クリップがありません');
    const report = { frames: 0, duration: 0, humanBones: 0, lookAtSource: null, preset: [], custom: [], droppedLook: [], droppedOther: [], clamped: 0, notes: [] };

    const baked = {};
    (Array.isArray(dto.bakedBones) ? dto.bakedBones : []).forEach(tr => {
      if (tr && tr.id && Array.isArray(tr.keys) && tr.keys.length) baked[String(tr.id)] = tr;
    });
    if (!Object.keys(baked).length)
      throw new Error((Array.isArray(dto.muscles) && dto.muscles.length)
        ? 'bakedBones がありません。マッスルから骨を解けるのは PolyLing（Unity）だけなので、PolyLing で .plmotion を書き直してから読んでください'
        : 'bakedBones がありません');
    const usesTan = tr => (tr && Array.isArray(tr.keys) ? tr.keys : []).some(k => k && (k.tan || k.rotTan || k.posTan || k.sclTan));
    const usesWrap = tr => tr && ((tr.preWrapMode && tr.preWrapMode !== 'Clamp') || (tr.postWrapMode && tr.postWrapMode !== 'Clamp'));
    const all = Object.values(baked).concat(dto.lookAt ? [dto.lookAt] : [], Array.isArray(dto.expressions) ? dto.expressions : []);
    if (all.some(usesTan)) report.notes.push('接線は使わず線形で評価しました');
    if (all.some(usesWrap)) report.notes.push('ラップモード（Loop など）は使わず、端の外は端の値にしました');

    const lookFromTrack = !!(dto.lookAt && keysWith(dto.lookAt, 'rot', 4).length);
    const lookFromEyes = !lookFromTrack && !!(baked.LeftEye || baked.RightEye);
    report.lookAtSource = lookFromTrack ? 'lookAt' : lookFromEyes ? 'bakedBones の目' : null;

    // 時刻
    const fps = finite(opt.fps) && opt.fps > 0 ? opt.fps : (finite(+dto.frameRate) && +dto.frameRate > 0 ? +dto.frameRate : 30);
    const len = clipLength(dto);
    const n = Math.max(1, Math.round(len * fps) + 1);
    const times = []; for (let i = 0; i < n; i++) times.push(Math.min(i / fps, len));

    // 骨
    const bones = ROWS.filter(r => isVrmaBone(r.bone)).map(r => r.bone);
    const keyRot = {}; Object.keys(baked).forEach(id => { keyRot[id] = keysWith(baked[id], 'rot', 4); });
    const hipsPos = baked.Hips ? keysWith(baked.Hips, 'pos', 3) : [];
    const lookKeys = lookFromTrack ? keysWith(dto.lookAt, 'rot', 4) : null;
    const rot = bones.map(() => []), hips = [], look = report.lookAtSource ? [] : null;
    for (let f = 0; f < n; f++) {
      const t = times[f];
      bones.forEach((b, bi) => {
        let q = keyRot[b] ? evalKeys(keyRot[b], t, mixRot) : null;
        q = qnorm(q || [0, 0, 0, 1]);
        const prev = rot[bi][f - 1]; if (prev && qdot(prev, q) < 0) q = q.map(x => -x);
        rot[bi][f] = q;
      });
      const off = evalKeys(hipsPos, t, mixVec) || [0, 0, 0];
      hips[f] = [HIPS_REST[0] + off[0] * HIPS_HEIGHT, HIPS_REST[1] + off[1] * HIPS_HEIGHT, HIPS_REST[2] + off[2] * HIPS_HEIGHT];
      if (look) {
        let q;
        if (lookFromTrack) q = evalKeys(lookKeys, t, mixRot) || [0, 0, 0, 1];
        else {
          const ev = id => (keyRot[id] && evalKeys(keyRot[id], t, mixRot)) || [0, 0, 0, 1];
          q = lookAtFromEyes(qnorm(ev('LeftEye')), qnorm(ev('RightEye')));
        }
        q = qnorm(q); const prev = look[f - 1]; if (prev && qdot(prev, q) < 0) q = q.map(x => -x);
        look[f] = q;
      }
    }

    // 表情
    const exprs = [], used = new Set();
    (Array.isArray(dto.expressions) ? dto.expressions : []).forEach(tr => {
      if (!tr || !tr.name || !Array.isArray(tr.keys) || !tr.keys.length) return;
      let vrm = tr.provider === 'vrm1' ? tryGetPreset(tr.name) : tryResolvePreset(tr.name, null);
      let isPreset = !!vrm; if (!isPreset) vrm = String(tr.name);
      if (isPreset && isLookPreset(vrm)) { report.droppedLook.push(String(tr.name)); return; }
      if (used.has(vrm)) {   // preset が埋まっていれば元の名前で custom に落とす（.vrm 書き出しと同じ先勝ち）
        if (isPreset && !used.has(String(tr.name)) && !tryGetPreset(tr.name)) { vrm = String(tr.name); isPreset = false; }
        else { report.droppedOther.push(tr.name + '（名前の重複）'); return; }
      }
      used.add(vrm); exprs.push({ vrm, preset: isPreset, keys: keysWith(tr, 'v') });
      (isPreset ? report.preset : report.custom).push(vrm);
    });

    // ---- GLB ----
    const bin = [], views = [], accessors = []; let blen = 0;
    function addFloats(arr, type, count, min, max) {
      const b = new Uint8Array(new Float32Array(arr).buffer);
      views.push({ buffer: 0, byteOffset: blen, byteLength: b.length }); bin.push(b); blen += b.length;
      const a = { bufferView: views.length - 1, componentType: 5126, count, type };
      if (min) a.min = min.map(round6); if (max) a.max = max.map(round6);
      accessors.push(a); return accessors.length - 1;
    }
    const nodes = [], nodeOf = {};
    const addChild = (p, c) => { (nodes[p].children = nodes[p].children || []).push(c); };
    ROWS.forEach(r => {
      if (!isVrmaBone(r.bone)) return;
      nodeOf[r.bone] = nodes.length;
      nodes.push({ name: r.bone, translation: posG(r.pos).map(round6) });
      if (r.parent) addChild(nodeOf[r.parent], nodeOf[r.bone]);
    });
    const ofs = Array.isArray(dto.lookAtOffsetFromHeadBone) && dto.lookAtOffsetFromHeadBone.length === 3 && dto.lookAtOffsetFromHeadBone.every(x => finite(+x))
      ? dto.lookAtOffsetFromHeadBone.map(Number) : null;
    let lookNode = -1;
    if (look) {
      lookNode = nodes.length;
      const jo = { name: 'lookAt' }; if (ofs) jo.translation = posG(ofs).map(round6);
      nodes.push(jo); addChild(nodeOf.Head, lookNode);
    }
    const firstExpr = nodes.length;
    exprs.forEach(e => nodes.push({ name: e.vrm }));

    const tt = times.map(t => t - times[0]);
    const input = addFloats(tt, 'SCALAR', n, [tt[0]], [tt[n - 1]]);
    const samplers = [], channels = [];
    const channel = (node, path, output) => { channels.push({ sampler: samplers.length, target: { node, path } }); samplers.push({ input, output, interpolation: 'LINEAR' }); };
    bones.forEach((b, bi) => { const d = []; rot[bi].forEach(q => d.push(...rotG(q))); channel(nodeOf[b], 'rotation', addFloats(d, 'VEC4', n)); });
    { const d = []; hips.forEach(p => d.push(...posG(p))); channel(nodeOf.Hips, 'translation', addFloats(d, 'VEC3', n)); }
    if (look) { const d = []; look.forEach(q => d.push(...rotG(q))); channel(lookNode, 'rotation', addFloats(d, 'VEC4', n)); }
    exprs.forEach((e, ei) => {
      const d = [];
      times.forEach(t => { let w = evalKeys(e.keys, t, mixNum); if (w == null) w = 0; if (w < 0 || w > 1) { report.clamped++; w = Math.max(0, Math.min(1, w)); } d.push(w, 0, 0); });
      channel(firstExpr + ei, 'translation', addFloats(d, 'VEC3', n));
    });

    const humanBones = {}; bones.forEach(b => { humanBones[vrmBoneName(b)] = { node: nodeOf[b] }; });
    const ext = { specVersion: '1.0', humanoid: { humanBones } };
    if (exprs.length) {
      const preset = {}, custom = {};
      exprs.forEach((e, ei) => { (e.preset ? preset : custom)[e.vrm] = { node: firstExpr + ei }; });
      ext.expressions = {}; if (Object.keys(preset).length) ext.expressions.preset = preset; if (Object.keys(custom).length) ext.expressions.custom = custom;
    }
    if (look) { ext.lookAt = { node: lookNode }; if (ofs) ext.lookAt.offsetFromHeadBone = posG(ofs).map(round6); }
    const sceneNodes = [nodeOf.Hips]; exprs.forEach((e, ei) => sceneNodes.push(firstExpr + ei));
    const g = {
      asset: { version: '2.0', generator: 'Motion Studio (plmotion_vrma.js)' }, extensionsUsed: ['VRMC_vrm_animation'],
      scene: 0, scenes: [{ nodes: sceneNodes }], nodes,
      animations: [{ name: dto.name ? String(dto.name) : 'animation', samplers, channels }],
      extensions: { VRMC_vrm_animation: ext },
      buffers: [{ byteLength: blen }], bufferViews: views, accessors,
    };
    report.frames = n; report.duration = len; report.humanBones = bones.length;
    return { glb: buildGlb(g, bin, blen), report, name: g.animations[0].name };
  }

  function buildGlb(g, bin, blen) {
    let js = new TextEncoder().encode(JSON.stringify(g));
    const jpad = (4 - js.length % 4) % 4, bpad = (4 - blen % 4) % 4;
    const total = 12 + 8 + js.length + jpad + 8 + blen + bpad, out = new Uint8Array(total), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, js.length + jpad, true); dv.setUint32(16, 0x4E4F534A, true); out.set(js, 20);
    for (let i = 0; i < jpad; i++) out[20 + js.length + i] = 0x20;
    let o = 20 + js.length + jpad;
    dv.setUint32(o, blen + bpad, true); dv.setUint32(o + 4, 0x004E4942, true); o += 8;
    bin.forEach(b => { out.set(b, o); o += b.length; });
    return out;
  }

  /** 書き出しの報告の文。 */
  function reportText(r) {
    let s = `${r.frames} フレーム / ${r.duration.toFixed(3)} 秒 / Humanoid ${r.humanBones} 本 / 表情 preset ${r.preset.length}・custom ${r.custom.length}`;
    if (r.droppedLook.length) s += ` / 視線の表情を書かず ${r.droppedLook.length} 件（${r.droppedLook.join(', ')}）`;
    if (r.droppedOther.length) s += ` / ほかに書かなかった表情 ${r.droppedOther.length} 件（${r.droppedOther.join(', ')}）`;
    if (r.clamped) s += ` / 重みを [0,1] に丸めた ${r.clamped} 件`;
    s += r.lookAtSource ? ` / 視線あり（${r.lookAtSource}）` : ' / 視線なし';
    if (r.notes.length) s += ' / ' + r.notes.join(' / ');
    return s;
  }

  // ============================================================ 読込（.vrma → DTO）
  function decode(buffer, name) {
    const issues = [];
    const err = (code, message) => { issues.push({ code, message, error: true }); return { dto: null, issues }; };
    const warn = (code, message) => issues.push({ code, message, error: false });
    let r;
    try { r = openGltf(buffer); } catch (e) { return err('VRMA_INVALID', e.message); }
    try { return toMotion(r, name, issues, err, warn); } catch (e) { return err('VRMA_INVALID', e.message); }
  }

  function openGltf(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.length < 12) throw new Error('ファイルが短すぎます');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let json = null, bin = null;
    if (dv.getUint32(0, true) === 0x46546C67) {
      const ver = dv.getUint32(4, true); if (ver !== 2) throw new Error(`GLB の版が 2 ではありません（${ver}）`);
      const len = Math.min(dv.getUint32(8, true), bytes.length); let o = 12;
      while (o + 8 <= len) {
        const clen = dv.getUint32(o, true), ctype = dv.getUint32(o + 4, true); o += 8;
        if (o + clen > len) throw new Error('GLB のチャンクが壊れています');
        if (ctype === 0x4E4F534A && json == null) json = new TextDecoder().decode(bytes.subarray(o, o + clen));
        else if (ctype === 0x004E4942 && bin == null) bin = bytes.slice(o, o + clen);
        o += clen;
      }
      if (json == null) throw new Error('GLB に JSON チャンクがありません');
    } else json = new TextDecoder().decode(bytes);
    const root = JSON.parse(json), buffers = [];
    (Array.isArray(root.buffers) ? root.buffers : []).forEach((b, i) => {
      const uri = b && b.uri;
      if (uri == null) { if (i !== 0 || !bin) throw new Error(`buffers[${i}] の中身がありません`); buffers.push(bin); }
      else if (String(uri).startsWith('data:')) {
        const comma = uri.indexOf(',');
        if (comma < 0 || !uri.slice(0, comma).endsWith(';base64')) throw new Error(`buffers[${i}] の data URI が base64 ではありません`);
        buffers.push(b64ToBytes(uri.slice(comma + 1)));
      } else throw new Error(`buffers[${i}] は外部ファイル（${uri}）なので読めません`);
    });
    const nodes = Array.isArray(root.nodes) ? root.nodes : [], N = nodes.length;
    const parent = new Array(N).fill(-1), restT = [], restR = [], restS = [];
    nodes.forEach((n, i) => {
      if (Array.isArray(n.matrix) && n.matrix.length === 16) { const d = decompose(n.matrix.map(Number)); restT[i] = d.t; restR[i] = d.r; restS[i] = d.s; }
      else {
        restT[i] = vec3(n.translation, [0, 0, 0]);
        restR[i] = Array.isArray(n.rotation) && n.rotation.length === 4 ? qnorm(n.rotation.map(Number)) : [0, 0, 0, 1];
        restS[i] = vec3(n.scale, [1, 1, 1]);
      }
      (Array.isArray(n.children) ? n.children : []).forEach(c => { if (c >= 0 && c < N) parent[c] = i; });
    });
    return { root, buffers, N, parent, restT, restR, restS };
  }
  function b64ToBytes(s) {
    if (typeof atob === 'function') { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
    return new Uint8Array(Buffer.from(s, 'base64'));
  }
  const vec3 = (a, fb) => Array.isArray(a) && a.length === 3 ? a.map(Number) : fb.slice();
  function decompose(m) {   // glTF の matrix は列優先
    const c0 = [m[0], m[1], m[2]], c1 = [m[4], m[5], m[6]], c2 = [m[8], m[9], m[10]];
    const t = [m[12], m[13], m[14]];
    let sx = Math.hypot(...c0); const sy = Math.hypot(...c1), sz = Math.hypot(...c2);
    const cr = [c0[1] * c1[2] - c0[2] * c1[1], c0[2] * c1[0] - c0[0] * c1[2], c0[0] * c1[1] - c0[1] * c1[0]];
    if (cr[0] * c2[0] + cr[1] * c2[1] + cr[2] * c2[2] < 0) sx = -sx;
    const s = [sx, sy, sz];
    if (Math.abs(sx) < 1e-12 || sy < 1e-12 || sz < 1e-12) return { t, r: [0, 0, 0, 1], s };
    return { t, r: qlook(c2.map(v => v / sz), c1.map(v => v / sy)), s };
  }

  function readAccessor(G, index) {
    const acc = G.root.accessors[index]; if (!acc) throw new Error(`accessor ${index} がありません`);
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[acc.type];
    if (!comps) throw new Error(`accessor の type "${acc.type}" は読めません`);
    const count = acc.count | 0, ctype = acc.componentType, normalized = !!acc.normalized, data = new Float32Array(count * comps);
    if (acc.bufferView != null) readView(G, acc.bufferView, acc.byteOffset || 0, count, comps, ctype, normalized, data);
    if (acc.sparse) {
      const sp = acc.sparse, sc = sp.count | 0, idx = new Float32Array(sc), val = new Float32Array(sc * comps);
      readView(G, sp.indices.bufferView, sp.indices.byteOffset || 0, sc, 1, sp.indices.componentType, false, idx);
      readView(G, sp.values.bufferView, sp.values.byteOffset || 0, sc, comps, ctype, normalized, val);
      for (let i = 0; i < sc; i++) { const at = idx[i] | 0; if (at < 0 || at >= count) continue; for (let c = 0; c < comps; c++) data[at * comps + c] = val[i * comps + c]; }
    }
    return { data, comps };
  }
  function readView(G, viewIndex, accOffset, count, comps, ctype, normalized, into) {
    const view = G.root.bufferViews[viewIndex], buf = G.buffers[view.buffer | 0];
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const base = (view.byteOffset || 0) + accOffset;
    const cs = ctype === 5126 || ctype === 5125 ? 4 : (ctype === 5122 || ctype === 5123 ? 2 : 1);
    let stride = view.byteStride | 0; if (stride <= 0) stride = cs * comps;
    for (let i = 0; i < count; i++) for (let c = 0; c < comps; c++) {
      const o = base + i * stride + c * cs; let v;
      switch (ctype) {
        case 5126: v = dv.getFloat32(o, true); break;
        case 5125: v = dv.getUint32(o, true); break;
        case 5123: { const x = dv.getUint16(o, true); v = normalized ? x / 65535 : x; break; }
        case 5122: { const x = dv.getInt16(o, true); v = normalized ? Math.max(x / 32767, -1) : x; break; }
        case 5121: { const x = dv.getUint8(o); v = normalized ? x / 255 : x; break; }
        case 5120: { const x = dv.getInt8(o); v = normalized ? Math.max(x / 127, -1) : x; break; }
        default: throw new Error(`componentType ${ctype} は読めません`);
      }
      into[i * comps + c] = v;
    }
  }
  function readSampler(G, sj, comps) {
    const inp = readAccessor(G, sj.input), out = readAccessor(G, sj.output);
    const s = { input: inp.data, output: out.data, comps, interp: sj.interpolation || 'LINEAR' };
    if (out.comps !== comps) throw new Error(`サンプラの出力の成分数が ${out.comps} です（${comps} のはず）`);
    const per = s.interp === 'CUBICSPLINE' ? 3 * comps : comps;
    if (s.output.length < s.input.length * per) throw new Error('サンプラの出力がキーの数より少ない');
    return s;
  }
  function evalSampler(s, t, rotation) {
    const n = s.input.length, c = s.comps, cubic = s.interp === 'CUBICSPLINE', stride = cubic ? 3 * c : c, vo = cubic ? c : 0;
    const take = o => Array.from(s.output.subarray(o, o + c));
    if (n === 0) return rotation ? [0, 0, 0, 1] : new Array(c).fill(0);
    if (n === 1 || t <= s.input[0]) return take(vo);
    if (t >= s.input[n - 1]) return take((n - 1) * stride + vo);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s.input[mid] <= t) lo = mid; else hi = mid; }
    if (s.input[lo] === t) return take(lo * stride + vo);
    const k = lo, t0 = s.input[k], t1 = s.input[k + 1], td = t1 - t0;
    if (td <= 0) return take((k + 1) * stride + vo);
    const u = (t - t0) / td;
    if (s.interp === 'STEP') return take(k * stride + vo);
    if (cubic) {
      const u2 = u * u, u3 = u2 * u, h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
      const a = k * stride, b = (k + 1) * stride, o = [];
      for (let i = 0; i < c; i++) {
        const v0 = s.output[a + c + i], b0 = s.output[a + 2 * c + i], v1 = s.output[b + c + i], a1 = s.output[b + i];
        o.push(h00 * v0 + h10 * td * b0 + h01 * v1 + h11 * td * a1);
      }
      return o;
    }
    if (rotation) return qslerp(take(k * stride), take((k + 1) * stride), u);
    const o = []; for (let i = 0; i < c; i++) { const a = s.output[k * stride + i], b = s.output[(k + 1) * stride + i]; o.push(a + (b - a) * u); }
    return o;
  }

  function toMotion(G, name, issues, err, warn) {
    const root = G.root, N = G.N, parent = G.parent;
    const ext = root.extensions && root.extensions.VRMC_vrm_animation;
    if (!ext) return err('VRMA_INVALID', 'VRMC_vrm_animation 拡張がありません');
    if (ext.specVersion !== '1.0') warn('VRMA_NOT_READ', `specVersion が "${ext.specVersion}" です（1.0 として読みます）`);
    const otherExt = (Array.isArray(root.extensionsUsed) ? root.extensionsUsed : []).filter(e => e !== 'VRMC_vrm_animation');
    if (otherExt.length) warn('VRMA_NOT_READ', `未対応の拡張 ${otherExt.length} 件を読みません（${otherExt.join(', ')}）`);

    // Humanoid
    const boneNode = {}, ignored = [];
    const hb = (ext.humanoid && ext.humanoid.humanBones) || {};
    Object.keys(hb).forEach(vn => {
      const node = hb[vn] && Number.isInteger(hb[vn].node) ? hb[vn].node : -1;
      if (node < 0 || node >= N) { ignored.push(`${vn}（ノード ${node} が無い）`); return; }
      const b = BONE_BY_VRM[vn];
      if (!b) { ignored.push(`${vn}（名前を知らない）`); return; }
      if (!isVrmaBone(b)) { ignored.push(`${vn}（仕様外か正準骨格に無い）`); return; }
      boneNode[b] = node;
    });
    if (ignored.length) warn('VRMA_NOT_READ', `humanBones のうち ${ignored.length} 件を読みません（${ignored.join(', ')}）`);
    if (!('Hips' in boneNode)) return err('VRMA_INVALID', 'humanBones に hips がありません');
    const hipsNode = boneNode.Hips;

    // 表情
    const exprNode = [];
    const ex = ext.expressions || {};
    ['preset', 'custom'].forEach(kind => {
      const eo = ex[kind] || {};
      Object.keys(eo).forEach(nm => {
        const node = eo[nm] && Number.isInteger(eo[nm].node) ? eo[nm].node : -1;
        if (node < 0 || node >= N) { warn('VRMA_NOT_READ', `表情 ${nm} のノード ${node} がありません`); return; }
        exprNode.push({ name: nm, node });
      });
    });

    // 視線
    let lookNode = -1, lookOffset = null;
    if (ext.lookAt) {
      lookNode = Number.isInteger(ext.lookAt.node) ? ext.lookAt.node : -1;
      if (lookNode >= N) { warn('VRMA_NOT_READ', `lookAt のノード ${lookNode} がありません`); lookNode = -1; }
      const o = ext.lookAt.offsetFromHeadBone;
      if (Array.isArray(o) && o.length === 3) lookOffset = posG(o.map(Number)).map(f32);
    }

    // アニメーション
    const anims = Array.isArray(root.animations) ? root.animations : [];
    if (!anims.length) return err('VRMA_INVALID', 'animations がありません');
    if (anims.length > 1) warn('VRMA_NOT_READ', `animations は最初の 1 つだけ読みます（ほか ${anims.length - 1} 件）`);
    const anim = anims[0], samplersJ = Array.isArray(anim.samplers) ? anim.samplers : [], samplers = new Array(samplersJ.length);
    const exprIndexOfNode = {}; exprNode.forEach((e, i) => { exprIndexOfNode[e.node] = i; });
    const rotCh = {}, exprCh = {}; let hipsT = null, nScale = 0, nTrans = 0, nWeights = 0, nOther = 0;
    (Array.isArray(anim.channels) ? anim.channels : []).forEach(c => {
      const si = Number.isInteger(c.sampler) ? c.sampler : -1, tg = c.target || {}, node = Number.isInteger(tg.node) ? tg.node : -1;
      if (si < 0 || si >= samplers.length || node < 0 || node >= N) { nOther++; return; }
      const get = comps => samplers[si] || (samplers[si] = readSampler(G, samplersJ[si], comps));
      switch (tg.path) {
        case 'rotation': rotCh[node] = get(4); break;
        case 'translation':
          if (node === hipsNode) hipsT = get(3);
          else if (node in exprIndexOfNode) exprCh[exprIndexOfNode[node]] = get(3);
          else nTrans++;
          break;
        case 'scale': nScale++; break;
        case 'weights': nWeights++; break;
        default: nOther++;
      }
    });
    if (nScale) warn('VRMA_NOT_READ', `拡大縮小チャンネル ${nScale} 本を読みません`);
    if (nTrans) warn('VRMA_NOT_READ', `Hips・表情以外の translation チャンネル ${nTrans} 本を読みません`);
    if (nWeights) warn('VRMA_NOT_READ', `weights チャンネル ${nWeights} 本を読みません`);
    if (nOther) warn('VRMA_NOT_READ', `読めないチャンネル ${nOther} 本を読みません`);

    // Humanoid・視線に効く回転（自分か子孫に Humanoid があるノード、lookAt）
    const affects = new Array(N).fill(false);
    Object.values(boneNode).forEach(n0 => { for (let n = n0; n >= 0; n = parent[n]) affects[n] = true; });
    if (lookNode >= 0) affects[lookNode] = true;

    // 時刻の格子
    let ts = [];
    const addTimes = s => {
      if (!s) return; const t = s.input;
      for (let k = 0; k < t.length; k++) {
        ts.push(t[k]);
        if (s.interp === 'STEP' && k > 0) ts.push(f32(Math.max(t[k - 1], f32(t[k] - 1e-4))));
        if (s.interp === 'CUBICSPLINE' && k > 0) for (let q = 1; q < 4; q++) ts.push(f32(t[k - 1] + (t[k] - t[k - 1]) * (q / 4)));
      }
    };
    Object.keys(rotCh).forEach(n => { if (affects[n]) addTimes(rotCh[n]); });
    addTimes(hipsT);
    Object.keys(exprCh).forEach(i => addTimes(exprCh[i]));
    ts.sort((a, b) => a - b);
    let times = [];
    ts.forEach(t => { if (!times.length || t - times[times.length - 1] > 1e-6) times.push(t); });
    if (!times.length) times.push(0);
    if (times[0] < 0) {
      warn('VRMA_NOT_READ', `時刻が負のキー（最小 ${times[0]} 秒）は 0 秒より前なので捨てます`);
      times = times.filter(t => t >= 0); if (!times.length) times.push(0);
    }
    const nT = times.length;

    // 階層
    const worldRot = local => {
      const w = new Array(N), done = new Array(N).fill(false);
      const rec = (i, depth) => {
        if (done[i]) return w[i];
        const p = parent[i];
        w[i] = qnorm(p >= 0 && depth < N ? qmul(rec(p, depth + 1), local(i)) : local(i)); done[i] = true; return w[i];
      };
      for (let i = 0; i < N; i++) rec(i, 0);
      return w;
    };
    const worldPos = (i, t, r) => {
      let v = t(i).slice(), guard = N;
      for (let p = parent[i]; p >= 0 && guard-- > 0; p = parent[p]) {
        const s = G.restS[p], sv = [v[0] * s[0], v[1] * s[1], v[2] * s[2]], rv = qrot(r(p), sv), tp = t(p);
        v = [tp[0] + rv[0], tp[1] + rv[1], tp[2] + rv[2]];
      }
      return v;
    };
    // 自分の拡大縮小は自分の原点の位置に効かないので、最初の 1 段は t(i) のまま
    const restW = worldRot(n => G.restR[n]);
    const restHipsP = worldPos(hipsNode, n => G.restT[n], n => G.restR[n]);
    let hipsH = restHipsP[1];
    if (hipsH <= 1e-6) { warn('VRMA_NOT_READ', `Hips のレストの高さが ${hipsH} なので、腰の高さを 1 とみなして位置を正規化します`); hipsH = 1; }

    // 正準の親（ファイルにある一番近い祖先）
    const canonParent = {};
    Object.keys(boneNode).forEach(b => { let p = ROW_OF[b] && ROW_OF[b].parent; while (p) { if (p in boneNode) { canonParent[b] = p; break; } p = ROW_OF[p] && ROW_OF[p].parent; } });

    const bones = ROWS.map(r => r.bone).filter(b => b in boneNode);
    const baked = {}; bones.forEach(b => { baked[b] = { id: b, targetKind: 'humanoid', keys: [] }; });
    const lookTrack = lookNode >= 0 ? { id: 'lookAt', targetKind: 'lookAt', keys: [] } : null;
    const exprTracks = exprNode.map(e => ({ provider: 'vrm1', name: e.name, keys: [] }));
    let clamped = 0;
    const restT = G.restT, restR = G.restR;
    for (let f = 0; f < nT; f++) {
      const t = times[f], localNow = new Array(N);
      for (let n = 0; n < N; n++) localNow[n] = (n in rotCh) && (affects[n] || n === lookNode) ? qnorm(evalSampler(rotCh[n], t, true)) : restR[n];
      const w = worldRot(n => localNow[n]);
      const delta = {}; bones.forEach(b => { delta[b] = qmul(w[boneNode[b]], qinv(restW[boneNode[b]])); });
      bones.forEach(b => {
        let q = canonParent[b] ? qmul(qinv(delta[canonParent[b]]), delta[b]) : delta[b];
        q = qnorm(rotG(q));
        const ks = baked[b].keys; if (ks.length && qdot(ks[ks.length - 1].rot, q) < 0) q = q.map(x => -x);
        ks.push({ t, rot: q.map(f32) });
      });
      const hp = worldPos(hipsNode, n => n === hipsNode && hipsT ? evalSampler(hipsT, t, false) : restT[n], n => localNow[n]);
      const off = posG([(hp[0] - restHipsP[0]) / hipsH, (hp[1] - restHipsP[1]) / hipsH, (hp[2] - restHipsP[2]) / hipsH]).map(f32);
      const hk = baked.Hips.keys; hk[hk.length - 1].pos = off;
      if (lookTrack) {
        let q = qnorm(rotG(localNow[lookNode])); const ks = lookTrack.keys;
        if (ks.length && qdot(ks[ks.length - 1].rot, q) < 0) q = q.map(x => -x);
        ks.push({ t, rot: q.map(f32) });
      }
      exprNode.forEach((e, ei) => {
        let v = ei in exprCh ? evalSampler(exprCh[ei], t, false)[0] : restT[e.node][0];
        if (v < 0 || v > 1) { clamped++; v = Math.max(0, Math.min(1, v)); }
        exprTracks[ei].keys.push({ t, v: f32(v) });
      });
    }
    if (clamped) warn('VRMA_NOT_READ', `表情の重みを [0,1] に丸めました（${clamped} 件）`);

    const dto = {
      format: 'PolyLingMotion', version: 4, name: anim.name ? String(anim.name) : String(name || 'VRMA'),
      frameRate: estimateFps(times), duration: times[nT - 1], space: 'local', loop: false,
      bones: [], expressions: exprTracks, muscles: [], body: null,
      bakedBones: bones.map(b => baked[b]), metadata: { createdWith: 'Motion Studio (plmotion_vrma.js read)' },
    };
    if (lookTrack) dto.lookAt = lookTrack;
    if (lookOffset) dto.lookAtOffsetFromHeadBone = lookOffset;
    return { dto, issues };
  }
  function estimateFps(times) {
    if (times.length < 2) return 30;
    const d = []; for (let i = 1; i < times.length; i++) d.push(times[i] - times[i - 1]);
    d.sort((a, b) => a - b); const med = d[d.length >> 1];
    if (med <= 1e-5) return 30;
    return Math.max(1, Math.min(240, Math.round(1 / med)));
  }

  const API = {
    encode, decode, reportText,
    // timeline.html も使う部品
    ROWS, HIPS_REST, HIPS_HEIGHT, isVrmaBone, vrmBoneName, lookAtFromEyes, tryGetPreset, tryResolvePreset, isLookPreset,
    _test: { qmul, qnorm, qslerp, qeuler, decompose, evalSampler, keysWith, evalKeys },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.PLVrma = API;
})(typeof window !== 'undefined' ? window : globalThis);
