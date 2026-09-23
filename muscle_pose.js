/*
================================================================================
 マッスル → Humanoid の骨の回転  muscle_pose.js
 （vrm_viewer.html と timeline.html が <script src> で読む共通部品）
--------------------------------------------------------------------------------
 Unity の Humanoid クリップは体の動きを「マッスル」（関節ごとの -1〜+1 の値）で持つ。
 それを T ポーズ基準の骨の回転（Unity 左手系・キャラは +Z 向き・+X がキャラの右）に直す。
 式は PolyLing の UnityClipApplier.TryGetCanonLocalRotation と同じ（モデル非依存）:
   骨ごとに dof 0,1,2 について  d = AngleAxis((値>=0 ? 最大度 : 最小度) × min(1,|値|), 軸)
   回転 = Zero · d0 · d1 · d2
 CANON_ROWS : Zero・軸・最小/最大度。PolyLing の CanonMuscleTable をそのまま写した。
              書式「Humanoid名|Zero x y z w|dof0|dof1|dof2」、dof は「軸x 軸y 軸z 最小度 最大度」か「-」。
 MUSCLE_DOF : 骨ごとの dof 0,1,2 → マッスル名。Unity の HumanTrait の対応で、
              Unity クリップ書き出しが出した unitychan_limits.csv から写した。
              その CSV に無い UpperChest・左右の目は入っていない（動かさない）。
 腰        : 回転 = RootQ。位置は RootT を返すだけ（倍率は使う側が決める）。
================================================================================
*/
(function () {
  const CANON_ROWS = ["Hips|0 0 0 1|-|-|-", "Spine|0 0 0 1|0 1 0 -40 40|0 0 -1 -40 40|-1 0 0 -40 40", "Chest|0 0 0 1|0 1 0 -40 40|0 0 -1 -40 40|-1 0 0 -40 40", "UpperChest|0 0 0 1|0 1 0 -20 20|0 0 -1 -20 20|-1 0 0 -20 20", "Neck|0 0 0 1|0 1 0 -40 40|0 0 -1 -40 40|-1 0 0 -40 40", "Head|0 0 0 1|0 1 0 -40 40|0 0 -1 -40 40|-1 0 0 -40 40", "LeftEye|0 0 0 1|-|0 -1 0 -20 20|-1 0 0 -10 15", "RightEye|0 0 0 1|-|0 1 0 -20 20|-1 0 0 -10 15", "LeftShoulder|0 0 0 1|-|-0.0373 -0.9993 0 -15 15|0 0 -1 -15 30", "LeftUpperArm|0 0.24421 0.331689 0.911232|-1 0 0 -45 45|0 -1 0 -100 100|0 0 -1 -60 100", "LeftLowerArm|0 0.642743 0 0.766082|-1 0 0 -45 45|-|0 -1 0 -80 80", "LeftHand|0 0 0 1|-|0 -1 0 -40 40|0 0 -1 -80 80", "RightShoulder|0 0 0 1|-|-0.0373 0.9993 0 -15 15|0 0 1 -15 30", "RightUpperArm|0 -0.24421 -0.331689 0.911232|-1 0 0 -45 45|0 1 0 -100 100|0 0 1 -60 100", "RightLowerArm|0 -0.642743 0 0.766082|-1 0 0 -45 45|-|0 1 0 -80 80", "RightHand|0 0 0 1|-|0 1 0 -40 40|0 0 1 -80 80", "LeftUpperLeg|-0.258865 0 0 0.965914|-0.025 -0.9997 0 -30 30|0 0 -1 -60 60|0.9997 -0.025 0 -90 50", "LeftLowerLeg|0.642743 0 0 0.766082|0 -1 0 -45 45|-|-1 0 0 -80 80", "LeftFoot|0 0 0 1|-|0 0 -1 -30 30|1 0 0 -50 50", "LeftToes|0 0 0 1|-|-|1 0 0 -50 50", "RightUpperLeg|-0.258865 0 0 0.965914|-0.025 0.9997 0 -30 30|0 0 1 -60 60|0.9997 0.025 0 -90 50", "RightLowerLeg|0.642743 0 0 0.766082|0 1 0 -45 45|-|-1 0 0 -80 80", "RightFoot|0 0 0 1|-|0 0 1 -30 30|1 0 0 -50 50", "RightToes|0 0 0 1|-|-|1 0 0 -50 50", "LeftThumbProximal|1e-06 0.123091 0.123092 0.984732|-|-0.6357 0 -0.772 -25 25|-0.2485 0.9468 0.2047 -20 20", "LeftThumbIntermediate|0 -0.196116 0 0.980581|-|-|-0.2502 0.9461 0.2057 -40 35", "LeftThumbDistal|0 -0.196116 0 0.980581|-|-|-0.2502 0.9461 0.2057 -40 35", "LeftIndexProximal|1e-06 0.076402 0.286508 0.955027|-|0.0235 0.9997 0 -20 20|0 0 -1 -50 50", "LeftIndexIntermediate|0 0 0.313378 0.949629|-|-|-0.0001 0 -1 -45 45", "LeftIndexDistal|0 0 0.313378 0.949629|-|-|-0.0001 0 -1 -45 45", "LeftMiddleProximal|0 0.038285 0.287137 0.957124|-|0.0235 0.9997 0 -7.5 7.5|0 0 -1 -50 50", "LeftMiddleIntermediate|0 0 0.313378 0.949629|-|-|-0.0001 0 -1 -45 45", "LeftMiddleDistal|0 0 0.313378 0.949629|-|-|-0.0001 0 -1 -45 45", "LeftRingProximal|0 -0.038285 0.287137 0.957124|-|-0.0235 -0.9997 0 -7.5 7.5|0 0 -1 -50 50", "LeftRingIntermediate|0 0 0.313378 0.949629|-|-|-0.0002 0 -1 -45 45", "LeftRingDistal|0 0 0.313378 0.949629|-|-|-0.0002 0 -1 -45 45", "LeftLittleProximal|-1e-06 -0.076402 0.286508 0.955027|-|-0.0235 -0.9997 0 -20 20|0 0 -1 -50 50", "LeftLittleIntermediate|0 0 0.313378 0.949629|-|-|-0.0001 0 -1 -45 45", "LeftLittleDistal|0 0 0.313378 0.949629|-|-|-0.0001 0 -1 -45 45", "RightThumbProximal|1e-06 -0.123091 -0.123092 0.984732|-|-0.6357 0 0.772 -25 25|-0.2485 -0.9468 -0.2047 -20 20", "RightThumbIntermediate|0 0.196116 0 0.980581|-|-|-0.2502 -0.9461 -0.2057 -40 35", "RightThumbDistal|0 0.196116 0 0.980581|-|-|-0.2502 -0.9461 -0.2057 -40 35", "RightIndexProximal|1e-06 -0.076402 -0.286508 0.955027|-|0.0235 -0.9997 0 -20 20|0 0 1 -50 50", "RightIndexIntermediate|0 0 -0.313378 0.949629|-|-|-0.0001 0 1 -45 45", "RightIndexDistal|0 0 -0.313378 0.949629|-|-|-0.0001 0 1 -45 45", "RightMiddleProximal|0 -0.038285 -0.287137 0.957124|-|0.0235 -0.9997 0 -7.5 7.5|0 0 1 -50 50", "RightMiddleIntermediate|0 0 -0.313378 0.949629|-|-|-0.0001 0 1 -45 45", "RightMiddleDistal|0 0 -0.313378 0.949629|-|-|-0.0001 0 1 -45 45", "RightRingProximal|0 0.038285 -0.287137 0.957124|-|-0.0235 0.9997 0 -7.5 7.5|0 0 1 -50 50", "RightRingIntermediate|0 0 -0.313378 0.949629|-|-|-0.0002 0 1 -45 45", "RightRingDistal|0 0 -0.313378 0.949629|-|-|-0.0002 0 1 -45 45", "RightLittleProximal|-1e-06 0.076402 -0.286508 0.955027|-|-0.0235 0.9997 0 -20 20|0 0 1 -50 50", "RightLittleIntermediate|0 0 -0.313378 0.949629|-|-|-0.0001 0 1 -45 45", "RightLittleDistal|0 0 -0.313378 0.949629|-|-|-0.0001 0 1 -45 45"];
  const MUSCLE_DOF = {"Hips":["","",""],"LeftUpperLeg":["Left Upper Leg Twist In-Out","Left Upper Leg In-Out","Left Upper Leg Front-Back"],"RightUpperLeg":["Right Upper Leg Twist In-Out","Right Upper Leg In-Out","Right Upper Leg Front-Back"],"LeftLowerLeg":["Left Lower Leg Twist In-Out","","Left Lower Leg Stretch"],"RightLowerLeg":["Right Lower Leg Twist In-Out","","Right Lower Leg Stretch"],"LeftFoot":["","Left Foot Twist In-Out","Left Foot Up-Down"],"RightFoot":["","Right Foot Twist In-Out","Right Foot Up-Down"],"Spine":["Spine Twist Left-Right","Spine Left-Right","Spine Front-Back"],"Chest":["Chest Twist Left-Right","Chest Left-Right","Chest Front-Back"],"Neck":["Neck Turn Left-Right","Neck Tilt Left-Right","Neck Nod Down-Up"],"Head":["Head Turn Left-Right","Head Tilt Left-Right","Head Nod Down-Up"],"LeftShoulder":["","Left Shoulder Front-Back","Left Shoulder Down-Up"],"RightShoulder":["","Right Shoulder Front-Back","Right Shoulder Down-Up"],"LeftUpperArm":["Left Arm Twist In-Out","Left Arm Front-Back","Left Arm Down-Up"],"RightUpperArm":["Right Arm Twist In-Out","Right Arm Front-Back","Right Arm Down-Up"],"LeftLowerArm":["Left Forearm Twist In-Out","","Left Forearm Stretch"],"RightLowerArm":["Right Forearm Twist In-Out","","Right Forearm Stretch"],"LeftHand":["","Left Hand In-Out","Left Hand Down-Up"],"RightHand":["","Right Hand In-Out","Right Hand Down-Up"],"LeftToes":["","","Left Toes Up-Down"],"RightToes":["","","Right Toes Up-Down"],"LeftThumbProximal":["","Left Thumb Spread","Left Thumb 1 Stretched"],"LeftThumbIntermediate":["","","Left Thumb 2 Stretched"],"LeftThumbDistal":["","","Left Thumb 3 Stretched"],"LeftIndexProximal":["","Left Index Spread","Left Index 1 Stretched"],"LeftIndexIntermediate":["","","Left Index 2 Stretched"],"LeftIndexDistal":["","","Left Index 3 Stretched"],"LeftMiddleProximal":["","Left Middle Spread","Left Middle 1 Stretched"],"LeftMiddleIntermediate":["","","Left Middle 2 Stretched"],"LeftMiddleDistal":["","","Left Middle 3 Stretched"],"LeftRingProximal":["","Left Ring Spread","Left Ring 1 Stretched"],"LeftRingIntermediate":["","","Left Ring 2 Stretched"],"LeftRingDistal":["","","Left Ring 3 Stretched"],"LeftLittleProximal":["","Left Little Spread","Left Little 1 Stretched"],"LeftLittleIntermediate":["","","Left Little 2 Stretched"],"LeftLittleDistal":["","","Left Little 3 Stretched"],"RightThumbProximal":["","Right Thumb Spread","Right Thumb 1 Stretched"],"RightThumbIntermediate":["","","Right Thumb 2 Stretched"],"RightThumbDistal":["","","Right Thumb 3 Stretched"],"RightIndexProximal":["","Right Index Spread","Right Index 1 Stretched"],"RightIndexIntermediate":["","","Right Index 2 Stretched"],"RightIndexDistal":["","","Right Index 3 Stretched"],"RightMiddleProximal":["","Right Middle Spread","Right Middle 1 Stretched"],"RightMiddleIntermediate":["","","Right Middle 2 Stretched"],"RightMiddleDistal":["","","Right Middle 3 Stretched"],"RightRingProximal":["","Right Ring Spread","Right Ring 1 Stretched"],"RightRingIntermediate":["","","Right Ring 2 Stretched"],"RightRingDistal":["","","Right Ring 3 Stretched"],"RightLittleProximal":["","Right Little Spread","Right Little 1 Stretched"],"RightLittleIntermediate":["","","Right Little 2 Stretched"],"RightLittleDistal":["","","Right Little 3 Stretched"]};

  const qmul = (a, b) => [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1], a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
                          a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3], a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
  const qnorm = q => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return q.map(v => v / l); };

  const CANON = CANON_ROWS.map(r => {
    const c = r.split('|');
    return { name: c[0], zero: qnorm(c[1].split(' ').map(Number)),
      dof: [2, 3, 4].map(i => { if (c[i] === '-') return null; const p = c[i].split(' ').map(Number), l = Math.hypot(p[0], p[1], p[2]) || 1;
        return { x: p[0] / l, y: p[1] / l, z: p[2] / l, min: p[3], max: p[4] }; }) };
  });

  /**
   * muscles（{マッスル名: 値}）→ {Humanoid名: {rot:[x,y,z,w]}}。
   * 腰は {rot: RootQ, rootT?: RootT}。skip に名前がある骨は作らない（ボーントラック優先に使う）。
   */
  function musclesToBones(muscles, skip) {
    skip = skip || {};
    const out = {};
    for (const c of CANON) {
      if (skip[c.name]) continue;
      const names = MUSCLE_DOF[c.name]; if (!names) continue;
      let d = [0, 0, 0, 1], hit = false;
      for (let k = 0; k < 3; k++) {
        const ax = c.dof[k], mn = names[k];
        if (!ax || !mn || !(mn in muscles)) continue;
        const v = muscles[mn], a = (v >= 0 ? ax.max : ax.min) * Math.min(1, Math.abs(v)) * Math.PI / 180, s = Math.sin(a / 2);
        d = qmul(d, [ax.x * s, ax.y * s, ax.z * s, Math.cos(a / 2)]); hit = true;
      }
      if (hit) out[c.name] = { rot: qnorm(qmul(c.zero, d)) };
    }
    if (!skip.Hips) {
      const has = k => k in muscles, h = {};
      if (['RootQ.x', 'RootQ.y', 'RootQ.z', 'RootQ.w'].every(has))
        h.rot = qnorm([muscles['RootQ.x'], muscles['RootQ.y'], muscles['RootQ.z'], muscles['RootQ.w']]);
      if (['RootT.x', 'RootT.y', 'RootT.z'].every(has)) h.rootT = [muscles['RootT.x'], muscles['RootT.y'], muscles['RootT.z']];
      if (h.rot || h.rootT) { if (!h.rot) h.rot = [0, 0, 0, 1]; out.Hips = h; }
    }
    return out;
  }

  window.MusclePose = { musclesToBones };
})();
