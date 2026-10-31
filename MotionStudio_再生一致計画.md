# Motion Studio 再生一致計画

Motion Studio の再生・保存・VRMA 書き出しを、PolyLing 本体の評価（`MotionCurveMath.cs`）と一致させる計画。正本は `MotionStudio_機能強化計画.md` に移った。
進め方：着手前にコードを読み直して変更計画を出し、承認を得てから実装する。終えたら「状態」を更新する。

作成: 2026-10-28。状態：`MotionStudio_機能強化計画.md` へ統合（2026-10-31）。以後はそちらを正本にする。段 1〜4 はそちらの段 2・3・1・7。

## 1. 確認した事実（2026-10-28）

### 1.1 外部の評価文の主張

| 主張 | 結果 | 根拠 |
| --- | --- | --- |
| Motion Studio は接線を使って再生しない | 主張どおり | マニュアル `polyling_motion_studio_manual.html:233`、`timeline.html:1784`。`Clip.sampleChannel`（`timeline.html:390-398`）は `KIND.mix`（lerp・slerp）だけで `tan` を読まない |
| Motion Studio の VRM 表示に表情が出ない | 主張どおり | マニュアル `:232`。`sendPose`（`timeline.html:1620-1632`）は骨しか送らず、`vrm_viewer.html` に表情を当てる処理（`expressionManager`）が無い |
| 残件資料の不整合 | 一部は直っている | `project_bundle` の作業軸ライブラリの抜け、MQO の置換、UV の材質絞り込みは残る。PMX のインポートモードは直っている（`PolyLing_残件解決計画.md` で扱う） |
| motion.py は二次骨などを残して戻す | 主張どおり（整合の確認は無い） | 下の 1.2 |

### 1.2 motion.py（`データとツール/poly_ling_py/polyling_io/blender/motion.py`）

- muscles・body・bones（二次骨）は、読んだファイル全体をアクションに残し、書き出しでそのまま戻す（`:8-9`、`:908`）
- bakedBones が変わったときは muscles・body を書かず、`rotationSource="bakedBones"` にする（`:1054-1059`）
- `bones`（二次骨）は bakedBones が変わってもそのまま書き戻す。整合の確認も警告も無い（`:908` で元の写しから作り、`bones` には触れない）
- Blender への読込でも接線は使わず、線形として読む（`:38`）

### 1.3 本体と Motion Studio の差

本体の評価の正本は `Packages/com.haglib.polyling/Runtime/Poly_Ling_Main/Motion/MotionCurveMath.cs`。パネル再生（`MotionClipApplier`）・焼き込み（`CanonBoneMotion`）・VRMA 書き出し（`VrmaCodec.cs:205`）が通る。

| 項目 | Motion Studio | 本体 | 根拠（Studio 側） |
| --- | --- | --- | --- |
| 接線 | 無視（位置・表情は線形、回転は Slerp） | Constant（階段）・エルミート・重み付きベジェ・Auto／ClampedAuto | `timeline.html:390-398` |
| 最初のキーより前 | レスト姿勢 | ラップモード（既定 Clamp は先頭キーの値） | `timeline.html:427` |
| ラップモード | `preWrapMode`／`postWrapMode` を保持するだけで評価に使わない | Clamp・Loop・PingPong で時刻を写す | `timeline.html:409` |
| ループの周期 | クリップ長 | 先頭キー～末尾キー | `timeline.html:393` |
| キー時刻 | 読込時にフレームへ丸めて評価（元の秒 `t0` は保存にだけ使う） | 元の秒 | `timeline.html:1800` |
| VRMA 書き出し | `evalKeys` が線形だけ | `MotionCurveMath` | `plmotion_vrma.js:125-133` |
| 保存 | キーの生の値を書く。クリップの重みを掛けず、重なったクリップは同じフレームで後のクリップが上書き | （保存したファイルをそのまま評価） | `timeline.html:1844-1853` |
| 表情 | VRM 表示に出ない | パネル再生で当たる | `timeline.html:1620-1632`、`vrm_viewer.html` |

保存の行の結果：重み・重なり・ループを使うと、Studio の再生と保存したファイルの中身が一致しない。

## 2. 変更計画

### 段 1：評価の共通化 — 状態：未着手

- `plmotion_curve.js` を新しく作る。`MotionCurveMath.cs` の規則 1〜5（ラップ・Constant・線形／Slerp・エルミート・重み付きベジェ）と傾きの求め方（Linear・Auto・ClampedAuto・Free）を JS に移す。先頭のコメントに、正本が `MotionCurveMath.cs` であることを書く
- `timeline.html` の `Clip.sampleChannel` と `Track.sampleContinuous` を、新しい評価関数に通す
  - キー時刻は `plKeyMap` と同じ規則（元の秒 `t0` がそのフレームにあれば `t0`、なければ f/fps）
  - ラップは、保存で書く値（`plWrap` の既定と同じ）で評価する。これにより、最初のキーより前は先頭キーの値になる（今の「レスト姿勢」から変わる）
- `plmotion_vrma.js` の `evalKeys` を `plmotion_curve.js` に置き換える

### 段 2：保存を再生と一致させる — 状態：未着手

- 重み 1 未満・クリップの重なり・ループクリップのどれかを持つトラックだけ、保存時に Studio の評価でフレームごとに標本化して書く
- それ以外のトラックは、今どおりキーと接線をそのまま書く

### 段 3：表情プレビュー — 状態：未着手

- `sendPose` で表情トラックの値も送る
- `vrm_viewer.html` で `expressionManager.setValue` を使って当てる。名前の引き当ては `plmotion_vrma.js` の `tryResolvePreset`（VRMA 書き出しと同じ表）を使う
- `reset` のときは全部の表情を 0 に戻す

### 段 4：検証とマニュアル — 状態：未着手

- 接線・Constant・Loop を含む `.plmotion.json` を用意し、本体と `plmotion_curve.js`（node で実行）で同じ時刻の値を比べる
- Studio で保存し、本体で読み込んだ結果と比べる
- マニュアル `:232-233` の「表情は出ない」「再生は直線」を書き換える

## 3. 対象外

- 接線の編集 UI（強化案 3 の範囲）
- motion.py の二次骨の整合確認（強化案 2 の範囲）
