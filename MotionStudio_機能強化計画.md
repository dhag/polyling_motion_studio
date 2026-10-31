# Motion Studio 機能強化計画

Motion Studio を、Maya・Blender と比べて足りない機能の順に強化する計画。この文書を正本にする。
`MotionStudio_再生一致計画.md` の内容はこの文書へ統合した（旧 段 1〜4 は下の段 1〜3・7）。

進め方：1 段＝1 会話。着手前にコードを読み直して変更計画を出し、承認を得てから実装する。終えたら「状態」を更新する。

作成: 2026-10-31。状態：段 1〜段 7 完了（2026-10-31）。

優先順位（2026-10-31 決定）：表情 → カーブ・補間 → アニメーションレイヤー → モーションパス。

## 1. 確認した事実

### 1.1 Maya・Blender と比べて足りないもの（2026-10-31、コードで確認）

| 項目 | 現状 | 根拠 |
| --- | --- | --- |
| 表情プレビュー | VRM 表示に出ない | `timeline.html:1620` `sendPose` は骨だけ送る。`vrm_viewer.html` に表情を当てる処理が無い |
| 接線を使った再生 | 使わない（位置・表情は線形、回転は Slerp） | `timeline.html:390` `Clip.sampleChannel`、`:1784` |
| グラフエディタ・接線編集 | ~~無い。キーはドープシートだけ~~ → 段 4 で追加（値カーブ表示・接線ハンドル・インスペクタの接線欄） | `timeline.html` `drawCurve`・`tanHtml` |
| アニメーションレイヤー | ~~無い。クリップの重なりとウェイトはトラック内だけ。トラックをまたいでクリップを束ねるバンドルは入れ子（親子）にできるが、評価には関わらない（配置・移動・複製・折りたたみ表示だけ）~~ → 段 5 で追加（バンドルに `layer` を持たせる。override／additive・重み・ミュート・ソロ・入れ子・重ねる順。保存は標本化） | `timeline.html` `Track.sampleCh`・`layerInfo`・`Bundle.layer`・`plNeedsBake` |
| モーションパス | ~~無い~~ → 段 6 で追加（タイムラインで選んだ骨のワールド位置の軌跡を `bone_editor` に描く。キーのあるフレームは大きい点） | `timeline.html` `poseBones`・`pathUpdate`、`bone_editor.html` `pathEnsure`・`drawPath` |
| IK・ミラーポーズ・オニオンスキン・コンストレイント | 無い | `bone_editor.html:412` `solve` は FK だけ。今回の優先順位の対象外 |

### 1.2 本体と Motion Studio の評価の差（2026-10-28 確認、旧 再生一致計画 1.3）

本体の評価の正本は `Packages/com.haglib.polyling/Runtime/Poly_Ling_Main/Motion/MotionCurveMath.cs`。パネル再生（`MotionClipApplier`）・焼き込み（`CanonBoneMotion`）・VRMA 書き出し（`VrmaCodec.cs:205`）が通る。

| 項目 | Motion Studio | 本体 | 根拠（Studio 側） |
| --- | --- | --- | --- |
| 接線 | ~~無視（位置・表情は線形、回転は Slerp）~~ → 段 2 で一致 | Constant（階段）・エルミート・重み付きベジェ・Auto／ClampedAuto | `timeline.html:390-398` |
| 最初のキーより前 | ~~レスト姿勢~~ → 段 2 で一致 | ラップモード（既定 Clamp は先頭キーの値） | `timeline.html:427` |
| ラップモード | ~~保持するだけで評価に使わない~~ → 段 2 で一致 | Clamp・Loop・PingPong で時刻を写す | `timeline.html:409` |
| ループの周期 | ~~クリップ長~~ → 段 2 で一致 | 先頭キー～末尾キー | `timeline.html:393` |
| キー時刻 | ~~フレームへ丸めて評価~~ → 段 2 で一致（元の秒 `t0`） | 元の秒 | `timeline.html:1800` |
| VRMA 書き出し | ~~`evalKeys` が線形だけ~~ → 段 2 で一致 | `MotionCurveMath` | `plmotion_vrma.js:125-133` |
| 保存 | ~~キーの生の値を書く。クリップの重みを掛けず、重なったクリップは同じフレームで後のクリップが上書き~~ → 段 3 で一致（クリップ 2 本以上か重み 1 未満のトラックは再生の評価を標本化して書く） | （保存したファイルをそのまま評価） | `timeline.html` `plNeedsBake`・`plMakeTrack` |

保存の行の結果（段 3 の前）：重み・重なり・ループを使うと、Studio の再生と保存したファイルの中身が一致しなかった。

### 1.3 保存形式

- `.plmotion.json`（`MotionClipDTO.cs`、version 4）にレイヤーの項目は無い
- Studio 独自の「JSON保存」は `MotionTimeline.toJSON`（`timeline.html:470`）をそのまま書く

## 2. 変更計画

### 段 1（Phase 1）：表情プレビュー — 状態：完了（2026-10-31）

- `sendPose`（`timeline.html:1620`）で表情トラックの値も送る
- `vrm_viewer.html` で `expressionManager.setValue` を使って当てる。名前の引き当ては `plmotion_vrma.js` の `tryResolvePreset`（`:156`、VRMA 書き出しと同じ表）を使う
- `reset` のときは全部の表情を 0 に戻す

実施結果：
- `timeline.html` `sendPose`：表情トラック（`type==='morph'`）を `t.sample(ph).w` で評価し、pose に `expressions:[{name, provider, w}]` を載せる。骨が無く表情だけでも送る
- `vrm_viewer.html`：`plmotion_vrma.js` を読み、`resolveExpressions` で VRMA 書き出し（`plmotion_vrma.js:234-245`）と同じ規則で VRM の表情名に引き当てる（`provider==='vrm1'` は `tryGetPreset`、他は `tryResolvePreset(name, null)`、当たらなければ元の名前を custom、preset の重複は元の名前へ、視線の preset は当てない）。値は [0,1] に丸め、モデルに無い表情は飛ばす。最後の値を `lastExpr` に持ち VRM 読み直し時に掛け直す。`reset` で全表情を 0 にする
- 外側（`polyling_motion_studio.html:154`）とボーン編集（`bone_editor.html:1182`）は変更なし（payload をそのまま中継／`bones` だけ読む）
- 確認：内蔵ブラウザで Zunko_VRM10K.vrm（VRM 1.0）と `SandBox/さ/BlenderIO/stage4/b36/fresh_Z.plmotion.json`（表情 あ・まばたき）を読み、フレーム 30（あ=1.00、まばたき=0.60）で口が開き目が半分閉じること、フレーム 0（どちらも 0）で無表情なことを目視。別のモーション（pl_mocopi_bl）を読み直すと reset が届き無表情に戻ること、コンソールにエラーが無いことを確認
- 確認用サーバ：`データとツール/verify1031/serve_root.py`（プロジェクト直下を http://127.0.0.1:8765/ で配る）

### 段 2（Phase 2）：評価の共通化 — 状態：完了（2026-10-31）

- `plmotion_curve.js` を新しく作る。`MotionCurveMath.cs` の規則（ラップ・Constant・線形／Slerp・エルミート・重み付きベジェ）と傾きの求め方（Linear・Auto・ClampedAuto・Free）を JS に移す。先頭のコメントに、正本が `MotionCurveMath.cs` であることを書く
- `timeline.html` の `Clip.sampleChannel`（`:390`）と `Track.sampleContinuous`（`:415`）を、新しい評価関数に通す
  - キー時刻は `plKeyMap` と同じ規則（元の秒 `t0` がそのフレームにあれば `t0`、なければ f/fps）
  - ラップは、保存で書く値（`plWrap` の既定と同じ）で評価する。最初のキーより前は先頭キーの値になる（今の「レスト姿勢」から変わる）
- `plmotion_vrma.js` の `evalKeys`（`:125`）を `plmotion_curve.js` に置き換える

実施結果：
- `plmotion_curve.js`（新規、`PLCurve`）：`wrapTime`・`evaluateMapped`・`evaluate`／`evaluateVector`／`evaluateRotation`・`ensureQuaternionContinuity`・`fromTrack`（.plmotion.json のトラック → 時刻順の列。回転は本体の読込と同じく符号をそろえる）。区間探索は C# の `FindSegment` と同じ結果の二分探索
- 本体に合わせるために測って決めた 2 点（C# のコードからは読めない、Unity の float 計算と `Quaternion.Slerp` の振る舞い）
  - ラップ（`Mathf.Repeat`／`PingPong`）は float で計算する。double だと周期の境目（例 1.8 秒 ÷ 0.6 秒）で切り捨てが食い違い、ループの先頭と末尾の値が入れ替わった（差 0.2）
  - 規則 4 の Slerp は、2 キーの内積（float）が 0.95f 以上なら正規化した線形補間、未満なら球面線形補間。本体の出力とこの規則が 1e-7 で一致した（`SandBox/curve_test/slerp_probe.plmotion.json`・`slerp_probe2.plmotion.json` を `convertMotionToVrma` に通して測定。内積 0.9499 は球面、0.95 は線形）
- `timeline.html`：`plmotion_curve.js` を読む。`trackWrap`（pre＝`preWrapMode`||Clamp、post＝`postWrapMode`、無ければ loop クリップがあれば Loop）・`keySec`（`t0` がそのフレームにあれば `t0`、無ければ フレーム／fps）・`evalRows` を足し、`Clip.sampleChannel` と `Track.sampleContinuous` をこれで評価する。`sampleContinuous` は保存（`plKeyMap`）と同じく同じフレームのキーは開始の遅いクリップが勝つ。重み 1 未満のクリップのキーは重みを掛けた値を接線なしで並べる。`plMakeTrack` のラップも `trackWrap` を使い、`plWrap` は削除。説明コメントと読込トーストの「再生は線形」を直した
- `plmotion_vrma.js`：`keysWith`／`evalKeys`／`mixRot`／`mixVec`／`mixNum` を削り、`PLCurve` で評価する（`curve()` で使うときに引く。node は `require('./plmotion_curve.js')`。`vrm_viewer.html` は変更なし）。「接線は使わず線形」「ラップモードは使わず」の notes を削除
- 確認（試験用 `SandBox/curve_test/curve_test.plmotion.json`：Hips の pos／回転に Auto・ClampedAuto・Free・重み Both／In、Linear、pre PingPong・post Loop、先頭キー 0.2 秒、Spine に Constant、Chest に post PingPong、LeftUpperArm に重み Out と成分ごとに null／Linear の rotTan、表情 あ（post Loop、重み Out）・まばたき（Constant）。本体側は `convertMotionToVrma` で `curve_test_cs.vrma` を出した）
  - node：`PLVrma.encode` の出力と本体の .vrma の全チャンネル・全 61 フレーム（3355 標本）の差は最大 9.8e-7。測定用の 2 本も最大 1.2e-7
  - ブラウザ（内蔵ブラウザ、serve_root.py）：Zunko_VRM10K.vrm と試験用モーションを読み、タイムラインの再生評価（`Track.sample`）と本体の .vrma の差は全トラック最大 1.0e-6（最初のキーより前のフレームを含む）。再生でプレイヘッドが進むこと、画面の「VRMA保存」（`vrmaSave`）でファイルが作られ、`MotionStudioVrma.export()` の出力と本体の差が 1.0e-6 であることを確認。pl_mocopi_bl.plmotion.json（72 トラック・59348 キー・803 フレーム）でも再生と VRMA 保存が動き、1 フレームの評価 3.6 ms、VRMA 書き出し 73 ms。コンソールにエラーなし

### 段 3（Phase 3）：保存を再生と一致させる — 状態：完了（2026-10-31）

- 重み 1 未満・クリップの重なり・ループクリップ・レイヤー（段 5）のどれかを持つトラックだけ、保存時に Studio の評価でフレームごとに標本化して書く
- それ以外のトラックは、今どおりキーと接線をそのまま書く

実施結果：
- 着手時にコードで確かめた条件の見直し（段 2 の後の状態）
  - 1 クリップ・重み 1 のトラックは、ループでも保存がすでに再生と一致する。再生 `Clip.sampleChannel` と保存 `plKeyMap` が同じキー列・同じ `trackWrap` で評価されるため
  - クリップが 2 本以上のトラックは、重なりが無くても一致しない。再生はクリップごとのキーで評価し、保存は全クリップのキーを 1 列にするので、保存値の無い Auto／ClampedAuto／Free の傾き（前後キーで求める）とループの周期がクリップの端で変わる
  - 以上から、標本化の条件を「キーを持つクリップが 2 本以上、またはキーを持つクリップに重み 1 未満がある」とした（重なり・他のクリップと並ぶループクリップはこれに含まれる。レイヤーは段 5 でこの条件に足す）
- `timeline.html`
  - `plMaxFrame`（保存の最終フレーム）・`plNeedsBake`（上の条件）・`plBakeKeys`（フレーム 0〜最終フレームで `Track.sample` を評価し、キーのあるチャンネルだけ書く。接線・t0 なし、時刻 f/fps）を足した
  - `plMakeTrack(t,fps,targetKind,maxF)`：標本化の対象なら `plBakeKeys`、ラップは Clamp／Clamp。対象でなければ従来どおり
  - `exportPolyLing` と `plBakedSig` は同じ `maxF` で `plMakeTrack` を呼ぶ。bakedBones の署名も標本化した形になり、重みやクリップだけ変えた場合も muscles／body を書かない判定が働く（従来は生のキーで比べていたので、重みだけの変更を見逃した）
  - 先頭の保存の決まりのコメントと `sampleContinuous` の注記を直した
- 確認（内蔵ブラウザ、serve_root.py、Zunko_VRM10K.vrm）
  - `curve_test.plmotion.json` を読み、Spine（bakedBones）を重み 0.5、まばたきを重み 0.7、Chest に重なるクリップ（Auto 接線・保存値なし）を追加、LeftUpperArm を単独のループクリップ、あ に別のループクリップを追加、Hips は変更なし。保存結果を `SandBox/curve_test/stage3_test.plmotion.json` に置き（画面の出力と同一の文字列）、本体の `convertMotionToVrma` で `stage3_test_cs.vrma` を出した
  - 本体の .vrma と Studio の再生（`Track.sample`）の差は、全フレーム（0〜60）で Hips 1.3e-7、Spine 2.2e-7、Chest 2.0e-7、LeftUpperArm 1.2e-6、あ 4.7e-7、まばたき 6.0e-7
  - 標本化されたのは Spine・Chest・あ・まばたき（61 キー、Clamp／Clamp）。Hips と LeftUpperArm はキー・接線・t0 が読込直後の保存と同一（値は読込時の正規化による差 3.2e-7 のみ）。LeftUpperArm のラップは単独ループで Clamp／Loop
  - bakedSig（muscles と body を足した試験データ）：変更なし／表情に 2 本目のクリップ／bakedBones にキーの無いクリップを足す／重みを 0.5 にして 1 に戻す → muscles・body を書く。bakedBones の重みだけ 0.5／bakedBones に 2 本目のクリップ → 書かない
  - 画面操作：VRM とモーションを読み、再生でフレームが 0→60 へ進むこと、`plSave`（31364 文字）と `vrmaSave`（70936 バイト）でファイルが作られること、その VRMA と再生の差が最大 2.2e-7 であること、コンソールにエラーが無いことを確認

### 段 4（Phase 4）：接線の編集とグラフエディタ — 状態：完了（2026-10-31）

- トラックを開いたときに、ドープシート（`drawDope`、`timeline.html:719`）と切り替えて値カーブを表示する
- キーの値・接線（in／out・重み）・補間の種類（Constant／線形／Auto／ClampedAuto／Free）を編集し、キーの `tan` に書く
- カーブの表示と評価は段 2 の `plmotion_curve.js` を使う

実施結果：
- 着手時にコードで確かめた事実
  - 本体は接線の配列の長さが成分数と同じであることを求め、要素の null は許す（`MotionClipSerializer.cs:650-661`）。モード null は Free（`MotionClipDTO.cs:262`）。Free・Auto・ClampedAuto は保存値が無ければ前後のキーから傾きを求める（Free で値が無いときは ClampedAuto と同じ）
  - 元に戻すの控え（`tl.toJSON`）はキーの `tan`・`t0` を含むので、`tan` を書けばそのまま元に戻す／やり直すに乗る。保存（`plKeyMap`）も `tan` をそのまま書く
  - 回転は評価の前に符号を隣と揃える（`evalRows`）ので、画面に出す成分値と保存値は符号が逆のキーがある
- `timeline.html`
  - `Track` に `view`（`dope`／`curve`）と `curveCh` を足した。元に戻すの控えからは外し、戻すときは今の値を保つ。`Track.sample` を 1 チャンネルの `sampleCh` に分け、`sample` はそれを呼ぶ（中身は同じ）
  - ヘッダの 〰 で切り替え、カーブ表示ではチャンネルを選ぶ（rot／pos／scl）。カーブ表示の行は高さ 220px（`ROW_G`）
  - `drawCurve`：線は見えている範囲を 2px ごとに `Track.sampleCh`（再生と同じ評価）で引く。成分ごとに色を分け（x 赤・y 緑・z 青・w 灰）、縦の範囲は見えている値に合わせ（ドラッグ中は止める）、目盛りを出す。キーは `chanData`（`Clip.sampleChannel` と同じ並べ方・符号の揃え）の値に置く。選んだキーの選んだ成分に入・出の接線ハンドル（重み無しは 40px、重みありは制御点の位置。Constant の側と端の外側は出さない）。キーが密なときは点とハンドルを出さない
  - マウス：ハンドルのドラッグで傾き（Auto／ClampedAuto／Linear の側は Free にする）、重みのある側は横の長さで重みも変える。キーの点の横ドラッグはフレーム（`moveKey`）、縦ドラッグは値（回転以外、3px 動くまでは変えない）。空きは今と同じ矩形選択（時刻の範囲）
  - 接線の書き込み（`tanSlot`・`setSlope`・`setWeight`・`setWeightedMode`・`setMode`）：`tan` が無いキーは編集したときだけ両側 Linear で作る（作っただけでは傾きは変わらない）。符号を反転して表示しているキーは傾きの符号を戻して書く。Free は今求まる傾きを書き、Auto／ClampedAuto／Linear は保存値を消し、Constant はモードだけ書く。重みを使い始める側に値が無ければ 1/3 を書く
  - インスペクタ：キーのチャンネルごとに接線の欄（成分、入・出のモード、入・出の傾き、重み方式、入・出の重み。空欄は求まる値を薄字で出す）。モードは全成分、傾き・重みは選んだ成分に当てる。複数キーの選択では入・出のモードを全キーの全チャンネル・全成分に当てる
  - 説明文と先頭のコメント（「接線の編集は未対応」）を直した
- `plmotion_curve.js`：`resolveIn`／`resolveOut` を公開した（ハンドルの向きと Free へ切り替えるときの傾きを、評価と同じ求め方で得るため。規則は変えていない）。変更計画では「変えない」としていたが、同じ規則を timeline.html に写すのを避けるためにこれだけ足した
- 確認（内蔵ブラウザ、serve_root.py、Zunko_VRM10K.vrm、`curve_test.plmotion.json`）
  - 全トラック・全チャンネルで、小数のフレーム（0〜70、0.37 刻み）の `sampleCh` と `sample` が同一（2660 件）。カーブの線はこの `sampleCh` で引く
  - 画面操作：Hips の 〰 でカーブを開き、回転のキー（17f の y）を選んで出側のハンドルをドラッグ → `rightTangentMode` Free・`outTangent` が書かれ、元に戻す／やり直すで戻る・やり直せる（表示の切り替えは保たれる）。チャンネルを pos に替え、27f の y をドラッグで上げる → 値だけ変わり、フレームと t0 はそのまま
  - インスペクタ：Hips 回転 27f（成分 x に重み Both・0.6／0.2・出の傾き -0.5）、6f（出を Free）、Hips 位置 17f（入出を Free。前後の評価の差 0）、あ（0f の出を Constant、9f の入を Auto・重み In 0.8）、Spine（全キーを選んで入出 Constant）、Chest（12f の回転を同じ回転の符号反転に置き換え（評価の差 0）、成分 w の入の傾き 0.7 → 保存値は -0.7、表示の傾きは 0.7）。LeftUpperArm・まばたきは触らない
  - 保存：`MotionStudioPolyLing.export` の出力を `SandBox/curve_test/stage4_test.plmotion.json` に置き、fetch した中身が画面の出力と同一。本体の `convertMotionToVrma` で `stage4_test_cs.vrma` を出し、全フレーム（0〜60）で Studio の `Track.sample` との差は Hips 回転 1.5e-7・位置 1.3e-7、Spine 4.2e-7、Chest 9.3e-8、LeftUpperArm 9.9e-7、あ 7.0e-7、まばたき 8.3e-7。Studio の VRMA 書き出しと本体の .vrma の差は 9.8e-7
  - 触っていないトラック（LeftUpperArm・まばたき）は、キー・接線・t0・ラップが読込直後の保存と同一で、元のファイルとは値の差が回転の正規化の 3.2e-7 だけ
  - 画面：再生でフレームが進む（1.5 秒で 0→44）、`plSave`（13238 文字）と `vrmaSave`（70936 バイト）でファイルが作られる。読み直し後も含めコンソールにエラーなし

### 段 5（Phase 5）：アニメーションレイヤー — 状態：完了（2026-10-31。2026-10-31 改訂：レイヤーをバンドルに持たせる）

改訂の理由：旧案（`MotionTimeline.layers` の平らな一覧と `Track` のレイヤー ID）は、既存のバンドルの入れ子（親子）を考えずに書いていた。
- バンドルは `parentId`・`childIds` で入れ子になり、複数トラックのクリップを束ねる。1 つのクリップが直接属するバンドルは 1 つ（`bMakeFrom`）
- バンドルは評価に関わらない。「JSON保存」（`toJSON`）と元に戻すの控えには入り（控えから外すのは `collapsed` だけ）、`.plmotion.json`・VRMA には入らない
- Maya のレイヤーは階層を持ち、子の実効の重みは子 × 親、親のミュートは子もミュート、ソロは同じ親の兄弟（とその子）をミュートする（Autodesk のヘルプで確認）。バンドルの入れ子はこれにそのまま対応する

内容：
- `Bundle` に任意の `layer`（方式 override／additive・重み・ミュート・ソロ）を持たせる。`layer` を持つバンドルがレイヤー。どのレイヤーバンドルにも属さないクリップは基底レイヤー
- クリップの所属レイヤーは、直接属するバンドルから親をたどって最初のレイヤーバンドル。レイヤーの親子も同じたどり方で決める（間のレイヤーでないバンドルは飛ばす）
- 同じ骨のトラックに基底とレイヤーのクリップを並べる（レイヤー用にトラックを複製しない）
- 評価（`Track.sampleCh`）
  - 基底：レイヤーに属さないクリップだけで、今の評価（クロスフェード・`sampleContinuous`）
  - レイヤーを重ねる順：根のレイヤーは `tl.bundles` の並び、子は親の `childIds` の順で、親のクリップの後に子
  - 実効の重み＝自分 × 祖先のレイヤーの重み。親のミュートは子もミュート。ソロは同じ親の兄弟レイヤーとその子をミュート
  - レイヤー内のクリップの重なりは基底と同じクロスフェード。クリップの重み・ループ・有効範囲も今と同じ
  - override：`mix(下, 値, w)`。additive：回転 `q_下 · slerp(I, q, w)`、位置・スカラー `下 + w·値`、スケール 成分ごとに `下 × lerp(1, s, w)`。そのレイヤーのクリップにキーの無いチャンネルは何もしない
- 画面：バンドルのインスペクタに「レイヤーにする」・方式・重み・ミュート・ソロ・重ねる順の上下。バンドルのタブにレイヤーであることとミュート・ソロの状態を出す
- 保存：`Bundle.toJSON` にレイヤーの項目を足す（「JSON保存」と元に戻すに入る）。段 3 の `plNeedsBake` に「キーを持つクリップがレイヤーバンドルに属する」を足し、そのトラックは標本化して `.plmotion.json`・VRMA に書く
- 対象外：レイヤーの重みのキー、`.plmotion.json` へのバンドル・レイヤーの構造の書き込み（本体の形式に項目が無い）
- 確認：入れ子のレイヤー（override・additive、重み・ミュート・ソロ）を含む状態を保存し、本体の `convertMotionToVrma` に通して全フレームで Studio の再生と比べる。レイヤーを含まないトラックは今までどおりキー・接線・t0 のまま書かれること

実施結果：
- `timeline.html`
  - `Bundle.layer`（`{mode:'override'|'additive', weight 0〜1, mute, solo}`、無ければ null）。`normLayer` で読み、`toJSON` は `layer` があるときだけ書く（レイヤーの無いバンドルの JSON は従来と同じ）。「JSON保存」と元に戻すの控えに入る。`bClone` は `layer` も写す
  - `layerInfo(m)`：`layer` を持つバンドルが無ければ null。あれば `clipLayer`（クリップ → 所属レイヤー。直接属するバンドルから親をたどって最初のレイヤー）、`parent`（レイヤーの親。間のレイヤーでないバンドルは飛ばす）、`order`（上位バンドルを `tl.bundles` の並びに、子を `childIds` の順に深さ優先でたどった順。親の後に子）、`eff`（実効の重み＝自分×祖先、実効のミュート＝自分か祖先のミュート、または同じ親の兄弟にソロがあり自分はソロでない。根どうしが兄弟。基底はソロの影響を受けない）
  - `Track.sampleCh`：`layerInfo` が null なら全クリップで従来の評価（レイヤーを使わない状態は従来と同一）。あれば基底（レイヤーに属さないクリップ）を評価し、`order` の順にレイヤーを合成（実効ミュートと重み 0 は飛ばす。そのレイヤーのクリップにそのチャンネルのキーが無ければ何もしない）。override `KIND.mix(下, 値, w)`、additive 回転 `Q.norm(Q.mul(下, KIND.quat.weight(値, w)))`・位置とスカラー `下 + w·値`・スケール 成分ごとに `下 × lerp(1, 値, w)`。クリップの集合ごとの評価は `sampleClips`（従来の `sampleCh` の中身）に分け、`sampleContinuous` は対象クリップを引数で受ける（ラップはトラックの `trackWrap` のまま）
  - `plNeedsBake` に「キーを持つクリップがレイヤーに属する」を足した（VRMA 保存も `exportPolyLing` を通るので同じく標本化される）。保存の決まり・`sampleContinuous`・Undo の説明コメントを直した
  - 画面：バンドルのインスペクタに「レイヤー」チェック・方式・重み（スライダー。離したときに 1 件の元に戻すになる）・ミュート・ソロ・重ねる順 ↑↓（`layerSwapTarget`／`layerSwap`：同じ入れ物の中で隣のレイヤーと入れ替える）。タブに `[OVR 0.60 M S]` の形で方式・重み・ミュート・ソロを出し、実効ミュートのタブは薄くする。レイヤーの設定は `dataSignature` に入らないので、変えたときに `sendPose` を呼ぶ。何も選んでいないときの説明文にレイヤーの説明を足した
  - 計画外の修正 1 件：`window` の `mouseup` が、ドラッグでないときも `refresh` してインスペクタを作り直していたため、インスペクタのチェックボックスを実際にクリックしても切り替わらなかった（既存のクリップの「ループ」も同じ。内蔵ブラウザのクリックで確認）。ドラッグ中だけ `refresh` するようにした
- 確認（内蔵ブラウザ、serve_root.py、Zunko_VRM10K.vrm、`curve_test.plmotion.json` を読み、次の状態を作った）
  - Hips：additive レイヤー H（0.75、回転と位置）。Spine・あ：override レイヤー A（0.6）の下に、レイヤーでないバンドル N を挟んで additive レイヤー B（0.5、実効 0.3。あ の B のクリップは重み 0.7）。Chest：additive レイヤー C（0.8）の子に override D（0.5、ソロ、ループクリップ）と additive E（ソロの兄弟なので実効ミュート）。まばたき：ミュートの override F（0.9）とその子 G（親のミュートで実効ミュート）。LeftUpperArm：レイヤーなし
  - `Track.sampleCh` を、基底とレイヤーごとの `sampleClips` から計画の式で組んだ期待値と比べた（全トラック・全チャンネル、0〜64 フレーム 0.25 刻み）：差 0。さらに H をソロ（根の兄弟 A・C・F とその子がミュート）、F のミュートを外し D のソロを外す、C をミュート（D・E もミュート）・A の重み 0.25（B は 0.125）、D と E の順の入れ替え、の 4 通りでも差 0。重ねる順は A,B,H,C,D,E,F,G（入れ替え後も期待どおり）
  - 「JSON保存」の中身（`tl.toJSON`）に 8 個のレイヤーの設定が入り、それを `fromJSON` で作り直した再生と差 0。画面の操作（実クリック）でミュート・ソロ・↓・重みのドラッグ・レイヤーのオフ／オンを行い、それぞれ 1 件ずつ元に戻す／やり直すで戻る・やり直せることを確認
  - 保存：`MotionStudioPolyLing.export` の出力を `SandBox/curve_test/stage5_test.plmotion.json` に置き、fetch した中身が画面の出力と同一。本体の `convertMotionToVrma` で `stage5_test_cs.vrma` を出し、全フレーム（0〜60）で Studio の `Track.sample` との差は Hips 回転 2.5e-7・位置 8.2e-8、Spine 2.9e-8、Chest 1.2e-7、LeftUpperArm 9.8e-7、あ 1.3e-6、まばたき 1.8e-7。Studio の VRMA 書き出しと本体の .vrma の差は 9.8e-7
  - レイヤーを含まない LeftUpperArm は、キー・接線・t0・ラップが読込直後の保存と同一（3 キー）。レイヤーを含むトラック（Hips・Spine・Chest・あ・まばたき）は 61 キーに標本化（Clamp／Clamp）
  - 画面：作り直した状態（ページ再読込後に同じ手順で作り、保存が `stage5_test.plmotion.json` と同一）で、再生でフレームが進む（1.5 秒で 0→45）、「PolyLingモーション保存」（56269 バイト）・「VRMAモーション保存」（70936 バイト）でファイルが作られる、「JSON保存」が開く。コンソールにエラーなし

### 段 6（Phase 6）：モーションパス — 状態：完了（2026-10-31）

- 選んだ骨のワールド位置の軌跡を `bone_editor.html` に描く
- タイムラインが指定範囲の姿勢をまとめて送り、`bone_editor` の FK（`solve`、`bone_editor.html:412`）で位置を求める
- キーのあるフレームを点で区別する

実施結果：
- 着手時にコードで確かめた事実
  - `sendPose` は `Math.round(playhead)` の整数フレームだけを送る。そのため軌跡も整数フレームで求め、小数のフレームは使わない
  - ボーン編集の `applyRemotePose` は回転を `quatToEuler` でオイラー角に直し、`solve` が `eulerToQuat` で戻して FK する。pose に無い骨は今の値のまま残る
  - 外側は timeline の payload を種類を問わず bone へ中継する（外側のコードは変更不要）
  - データの変更は、すべて `refresh` 末尾の `tlUndo.commit` で控えの差として拾われる（クリップの重みやレイヤーの設定など、`dataSignature` に入らないものも含む）
  - 測定：pl_mocopi_bl（803 フレーム）で `sendPose` と同じ骨トラック 22 本を `Track.sample` すると 894 ms かかった。このため区切って計算する
- `timeline.html`
  - `poseTracks`・`poseBones(ph, tracks)`：`sendPose` の骨の部分を分けた（`sendPose` の出力は変えていない）。軌跡もこれを使う
  - `TimelineUndoController.ver`：控え `_base` が変わるときに増やす（commit で積んだとき・初回・`clearHistory`・`restore`）
  - モーションパスの節（`pathTargetName`・`pathKeys`・`pathUpdate`）
    - 対象は選択（`selectedBoneIds`）の最初の骨トラック。無ければ null
    - `ver` が変わったら 0〜最終フレーム（`plMaxFrame` と同じ式）の `poseBones` を 12 ms ずつ `setTimeout` で区切って求める。途中で `ver` が変われば計算をやり直す。終わったら `{type:'pathData', start, poses, keys, bone}` を送る
    - キー＝そのトラックの全クリップ（基底・レイヤーとも）・全チャンネルの `start+k.f`。ループの繰り返しは含めない
    - 対象だけが変わったときは計算し直さず、`{type:'pathTarget', bone}` を送る
    - 呼ぶ場所は `refresh` の末尾（選択の変更もここを通る）・`restore` と `clearHistory` の後
    - 送り先は `pathSink`（外側への postMessage。WebSocket には流さない）。最後の計算時間は `window.tlPathStats` に入る
  - 計画外の追加 1 件：`pathRequest` を受けたら軌跡を送り直す。ボーン編集がタイムラインより後に起動すると、先に送った `pathData` が届かないため
  - 先頭のコメントに `pathData`・`pathTarget`・`pathRequest` を足した
- `bone_editor.html`
  - モーションパスの節（`path`・`pathInvalidate`・`pathEnsure`・`drawPath`）
    - 各フレームの位置の求め方：今の骨の値を起点にする。姿勢は `applyRemotePose` と同じく、回転を `quatToEuler` で直し、pos は root だけ当てる。root から対象までの鎖を、`solve` と同じ式・同じ順で掛ける。骨の状態は書き換えない
    - 計算し直すとき：データ・対象・骨格が変わったとき（`path.rev`）、または姿勢で上書きされない鎖の骨の今の値・レスト位置が変わったとき（`draw` の中で署名を比べる）
  - `draw` で、地面の格子の後・骨の前に描く。線と各フレームの小さい点、キーのあるフレームは大きい点
  - ビューバーに「軌跡」ボタン（既定オン）を足した
  - `pathData`／`pathTarget` を受ける。骨格を受けたときも計算し直す。起動時に `pathRequest` を送る
  - 先頭のコメントを直した
- `polyling_motion_studio.html`：先頭のメッセージ一覧に `pathData`・`pathTarget`・`pathRequest` を足した（コードは変更なし）
- 確認（内蔵ブラウザ、serve_root.py、Zunko_VRM10K.vrm）
  - 試験の状態：`curve_test.plmotion.json` から段 5 と同じ手順で作った。保存が `stage5_test.plmotion.json` と同一であることを確かめてから使った
  - 軌跡と `sendPose` の一致：全フレーム（0〜60）で、各フレームへ移動して `sendPose` を送った後の `bone[対象].pos` と比べた。Chest（鎖 Hips>Spine>Chest、レイヤー A・B・C・D・H を含む）・LeftUpperArm（鎖に姿勢の無い UpperChest・LeftShoulder を含む）・Hips のどれも差 0
  - 再生との一致：`Track.sample` から直接作った姿勢で同じ計算をすると、軌跡との差 0（Chest）
  - キーの点：Chest は 0,3,5,10,12,19,21,44,60、Hips は 6,10,17,25,27,33,39。トラックのキーのフレームと同じ
  - 更新：対象 Chest で次の操作の後に軌跡が変わり、どれもその時点の `poseBones` から求めた軌跡と同一だった
    - 親の Spine のキーの値の変更、Spine のクリップの移動、元に戻す（変更前と同一に戻る）、やり直す（変更後と同一）
    - レイヤー H のミュート（インスペクタを実際にクリック。対象 Hips）、外側の ↶（ミュート前と同一に戻る）
    - なお Chest 自身のキーを変えても Chest の位置は変わらない（位置は祖先の回転と位置だけで決まる）
  - 選択：タイムラインの選択を替えると対象が替わる。ボーン編集で関節をクリックするとタイムラインの選択が替わり、軌跡の対象もその骨になる。選択なし（元に戻す／やり直すの後も選択は解除される）では何も描かない
  - 長いモーション（pl_mocopi_bl、803 フレーム、骨トラック 22 本、対象 LeftHand）
    - 軌跡の計算：1255 ms（区切って計算した合計。開始から送るまで 1739 ms）。区切っているので、その間も画面は止まらない
    - ボーン編集側の位置の計算（鎖 8 本×803 フレーム）：3.6 ms
    - 対象だけの切り替えでは計算し直さない
    - 全 803 フレームで `sendPose` 後の位置との差 0
    - フレーム 0 の点だけが離れている。モーションの最初のキー（t=0）がほぼ T ポーズ（Hips の回転が単位）のためで、`sendPose` との差は 0
  - 画面：ページ再読込後に VRM と pl_mocopi_bl を読み、次の操作がすべて動いた。コンソールにエラーなし
    - 再生（▶ でフレームが進み、⏸ で止まる）
    - ボーン編集で右手首をクリックすると、タイムラインの選択・軌跡の対象が RightHand になる
    - 軌跡の表示、「軌跡」ボタンでの消去と再表示
    - 「PolyLingモーション保存」（6828884 バイト）・「VRMAモーション保存」（698372 バイト）

### 段 7（Phase 7）：検証とマニュアル — 状態：完了（2026-10-31）

- 接線・Constant・Loop・レイヤーを含む `.plmotion.json` を用意し、本体と `plmotion_curve.js`（node で実行）で同じ時刻の値を比べる
- Studio で保存し、本体で読み込んだ結果と比べる
- マニュアル `polyling_motion_studio_manual.html:232-233` の「表情は出ない」「再生は直線」「接線の編集はできない」を書き換え、レイヤー・グラフエディタ・モーションパスの説明を足す
- `polyling_motion_studio.html:128` の説明文（「線形補間」「接線の編集と、接線を使った再生はまだできない」）も段 2・段 4 の後の状態と食い違うので書き換える（段 4 で確認）

実施結果：
- 試験ファイル：`curve_test`・`stage4_test` に無かった pre Loop（RightUpperArm、先頭キー 0.45 秒、Auto・ClampedAuto・Free 重み Both・成分ごとに null／Constant／Linear）と pre PingPong の表情（い、先頭キー 0.5 秒、Auto・ClampedAuto・Free 重み Both）だけを `SandBox/curve_test/stage7_test.plmotion.json` に足した。ほかの項目（Auto・ClampedAuto・Free・重み・Constant・post Loop／PingPong・pre PingPong の骨）は既存の `curve_test`・`stage4_test`、レイヤーは `stage5_test` の状態を使った
- node の実行方法：手元の PC の node（`C:\Program Files\nodejs\node.EXE`、v24.12.0）で `SandBox/curve_test/stage7_cmp.js` を実行した（`player_launch` で `poly_ling_py/.venv` の python を起動し、`subprocess` で node を呼ぶ。結果は `stage7_cmp_out.txt`）。段 2 のように .vrma を会話経由でクラウドの作業場所へ移す方法は、ファイルが大きいと読み込みが途中で切れるため使わなかった
- 本体と `plmotion_curve.js`（node、`PLVrma.encode` 経由）の比較：本体の `convertMotionToVrma` で fps 30 と fps 97（キーと揃わない小数の時刻。標本の時刻は両方とも `i/fps`、`VrmaCodec.cs:162-169`・`plmotion_vrma.js:184-187`）の .vrma（`*_cs_f30.vrma`・`*_cs_f97.vrma`）を出し、全チャンネル・全標本を比べた。時刻の差は 0。チャンネルごとの差の最大：
  - `curve_test` fps 30（3355 標本）：Hips 回転 1.2e-7・位置 1.3e-7、Spine 1.2e-7、Chest 1.2e-7、LeftUpperArm 9.8e-7、あ 1.2e-7、まばたき 1.2e-7
  - `curve_test` fps 97（10725 標本）：Hips 回転 6.0e-7・位置 3.9e-7、Spine 1.2e-7、Chest 1.2e-7、LeftUpperArm 9.5e-7、あ 8.9e-7、まばたき 8.9e-8
  - `stage4_test` fps 30：Hips 回転 1.7e-7・位置 1.3e-7、Spine 0、Chest 7.5e-8、LeftUpperArm 9.8e-7、あ 1.2e-7、まばたき 1.2e-7
  - `stage4_test` fps 97：Hips 回転 5.7e-7・位置 3.9e-7、Spine 0、Chest 1.2e-7、LeftUpperArm 9.2e-7、あ 1.8e-7、まばたき 8.9e-8
  - `stage7_test` fps 30：RightUpperArm 1.2e-7、い 2.1e-7。fps 97：RightUpperArm 2.2e-7、い 1.2e-7
- Studio の保存を本体で読み、Studio の再生（`Track.sample`）と全フレーム（0〜60）で比べた（内蔵ブラウザ、serve_root.py、Zunko_VRM10K.vrm。本体の .vrma を glTF→Unity の変換（回転 (x,-y,-z,w)、腰の位置 (-x, y-1, z)）で戻して比べた）
  - (a) `curve_test` を読んだだけの状態（接線をそのまま書く経路）：保存を `SandBox/curve_test/stage7_save_a.plmotion.json` に置き（fetch した中身が画面の出力と同一）、`stage7_save_a_cs.vrma` を出した。差の最大：Hips 回転・位置とも 1.3e-7 以下、Spine 9.1e-8、Chest 1.1e-7、LeftUpperArm 9.8e-7、あ 1.1e-7、まばたき 1.0e-7
  - (b) 段 5 の状態（入れ子の override／additive・重み・ミュート・ソロ。標本化の経路）：前の会話のスクリプトで作り、保存が `stage5_test.plmotion.json` と同一であることを確かめた。そのファイルから `stage7_save_b_cs.vrma` を出した。差の最大：Hips 回転 2.2e-7・位置 8.2e-8、Spine 1.0e-7、Chest 1.2e-7、LeftUpperArm 9.8e-7、あ 1.3e-6、まばたき 1.8e-7
- マニュアル `polyling_motion_studio_manual.html`
  - 「準備」の表を、実際に読む 9 ファイル（`plmotion_curve.js`・`undo_stack.js`・`polyling_live.js` を足した）にした
  - ボーン編集の「表示の切り替え」に「軌跡」を足した
  - 「タイムライン」の節に「再生の補間」（接線・ラップモード、規則は PolyLing と同じ）と「表情のプレビュー」を足した
  - 「グラフエディタと接線」「アニメーションレイヤー」「モーションパス（軌跡）」の節を足し、目次に加えた
  - 「読み書きできるファイル」に保存の標本化の条件を書いた
  - 「注意と制限」の「VRM 表示に表情は出ません」「再生では直線…接線の編集はできません」を消し、表情はタイムラインのトラックから当てること（ライブ受信の表示では当てない。`polyling_live.js` は expressions を送らない）を書いた
- `polyling_motion_studio.html` のヘルプ：PolyLing 入出力の行に標本化の条件を足し、表情・グラフエディタ・レイヤー・軌跡の行を足した。表の下の「線形補間」「接線の編集と、接線を使った再生はまだできない（再生は線形）」を、接線とラップモードで補間する記述に直した
- `timeline.html`：何も選んでいないときの説明文に、軌跡の対象（選んだクリップ・キーの骨、無ければアクティブtrack）と、元に戻す／やり直すの後は選び直すことを足した
- `bone_editor.html`：#hint に「クリック=選択（タイムラインの選択と軌跡の対象も替わる）」、「軌跡」ボタンの title に「整数フレームごと」を足した
- 確認
  - `search_text` で「線形」「直線」「接線」「表情」「レイヤー」「軌跡」（と「未対応」「まだできない」「再生は線形」）を引き、マニュアルとヘルプに段 1〜6 の前の状態の記述が残っていないことを確かめた（残る「線形」はモード名の「線形」と補間の説明）。マニュアルの目次の全項目に節がある
  - 画面（ページを読み直したあと、VRM と `curve_test` を読み段 5 の状態を作った。保存が `stage5_test.plmotion.json` と同一）：再生（▶ でフレームが進み、もう一度押すと止まる）、タイムラインで Chest のクリップを選ぶと軌跡の対象が Chest（61 点、キーの点 0,3,5,10,12,19,21,44,60）、ボーン編集で腰の関節をクリックするとタイムラインの選択と軌跡の対象が Hips、「軌跡」ボタンで消去と再表示、Hips の 〰 で値カーブ（rot）に切り替え、17f のキーを選んで出側のハンドルをドラッグ → `rightTangentMode` Free・`outTangent` が書かれ、元に戻す／やり直すで戻る、レイヤー H のミュートと ↓ を実クリック → 設定と重ねる順が変わり、元に戻すで戻る（戻した後の保存は `stage5_test.plmotion.json` と同一）、「PolyLingモーション保存」56269 バイト・「VRMAモーション保存」70936 バイトの Blob が作られる、「JSON保存」でモーダルが開き 8 個のレイヤーの設定が入る
  - コンソールのエラー：試験の区切りごと（比較 (a) の後、(b) の後、読み直す前、画面操作の途中と最後）に読み、どれも 0 件

## 3. 対象外

- IK・ミラーポーズ・オニオンスキン・コンストレイント（1.1 の最後の行）
- motion.py の二次骨の整合確認（`データとツール/poly_ling_py/polyling_io/blender/motion.py`。旧 再生一致計画 1.2）
