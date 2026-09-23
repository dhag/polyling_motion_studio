/*
================================================================================
 PolyLing と同じ視点操作  polyling_camera.js
 （bone_editor.html と vrm_viewer.html が <script src> で読む共通部品）
--------------------------------------------------------------------------------
 PolyLing の OrbitCameraController.cs を写したもの。値はすべて Unity 座標（左手系・Y 上・キャラは +Z 向き）。
   注視点 target、距離 distance、角度 rotX（上下）/ rotY（左右）/ rotZ（視線まわり）［度］
   カメラの位置 = target + Euler(rotX, rotY, 0) · (0, 0, -distance)
   カメラの上   = Euler(rotX, rotY, rotZ) · (0, 1, 0)、target を向く
   既定 rotX=20, rotY=180 … 正面のやや上から（カメラは +Z 側）
 操作（PolyLing と同じ）
   右ドラッグ      回転   rotY += 横 × 0.5 度/px、rotX −= 上向き移動 × 0.5 度/px（±89 度まで）
   Alt + 右ドラッグ 視線まわりの回転  rotZ += 横 × 0.5 度/px
   中ドラッグ      平行移動  target −= 右 × 横 × 距離 × 0.002、target −= 上 × 上向き移動 × 距離 × 0.002
   ホイール        拡大縮小  距離 ×= max(0.01, 1 − 手前回し量 × 0.05)
                   手前回し量は PolyLing（Unity の Mouse ScrollWheel）と同じく 1 目盛 = 0.1 とした
                   （ブラウザの deltaY 100 px、または 3 行 = 1 目盛として換算）
   Shift で 4 倍、Ctrl で 0.2 倍（両方押しは等倍）。PolyLing の設定の既定値。
 全体表示（fit）は PolyLing の ResetToMesh と同じ：target = 中心、distance = 大きさ × 1.5。
================================================================================
*/
(function () {
  const D2R = Math.PI / 180;
  const ORBIT = 0.5, PAN = 0.002, ZOOM = 0.05, ZOOM_MIN = 0.001, ZOOM_MAX = 100, COARSE = 4, FINE = 0.2;

  // Unity の Quaternion.Euler(x, y, z)（度）= qY · qX · qZ
  function euler(x, y, z) {
    const h = a => a * D2R / 2;
    const qx = [Math.sin(h(x)), 0, 0, Math.cos(h(x))], qy = [0, Math.sin(h(y)), 0, Math.cos(h(y))], qz = [0, 0, Math.sin(h(z)), Math.cos(h(z))];
    return qmul(qmul(qy, qx), qz);
  }
  function qmul(a, b) {
    return [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1], a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
            a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3], a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
  }
  function rot(q, v) {
    const [x, y, z, w] = q, ix = w*v[0]+y*v[2]-z*v[1], iy = w*v[1]+z*v[0]-x*v[2], iz = w*v[2]+x*v[1]-y*v[0], iw = -x*v[0]-y*v[1]-z*v[2];
    return [ix*w+iw*-x+iy*-z-iz*-y, iy*w+iw*-y+iz*-x-ix*-z, iz*w+iw*-z+ix*-y-iy*-x];
  }
  const normDeg = d => { d -= 360 * Math.floor((d + 180) / 360); return d <= -180 ? d + 360 : d; };
  const speedOf = e => (!!e.shiftKey === (!!e.ctrlKey || !!e.metaKey)) ? 1 : (e.shiftKey ? COARSE : FINE);

  class PLCamera {
    constructor() { this.rotX = 20; this.rotY = 180; this.rotZ = 0; this.target = [0, 1, 0]; this.distance = 3; this.fov = 60; }

    /** カメラの位置と向き（Unity 座標）。right / up は画面の右 / 上、fwd は奥向き。 */
    basis() {
      const r = euler(this.rotX, this.rotY, 0), rr = euler(this.rotX, this.rotY, this.rotZ);
      const fwd = rot(r, [0, 0, 1]), up = rot(rr, [0, 1, 0]), right = rot(rr, [1, 0, 0]);
      const t = this.target, d = this.distance;
      return { pos: [t[0] - fwd[0]*d, t[1] - fwd[1]*d, t[2] - fwd[2]*d], right, up, fwd };
    }
    orbit(dx, dyUp, speed, alt) {
      if (alt) { this.rotZ = normDeg(this.rotZ + dx * ORBIT * speed); return; }
      this.rotY = normDeg(this.rotY + dx * ORBIT * speed);
      this.rotX = Math.max(-89, Math.min(89, this.rotX - dyUp * ORBIT * speed));
    }
    pan(dx, dyUp, speed) {
      const r = euler(this.rotX, this.rotY, 0), R = rot(r, [1, 0, 0]), U = rot(r, [0, 1, 0]), s = this.distance * PAN * speed;
      for (let i = 0; i < 3; i++) this.target[i] -= R[i] * dx * s + U[i] * dyUp * s;
    }
    /** scroll：手前回しが正、1 目盛 0.1（PolyLing と同じ）。 */
    zoom(scroll, speed) {
      this.distance = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.distance * Math.max(0.01, 1 - scroll * ZOOM * speed)));
    }
    fit(center, size) {
      this.target = center.slice();
      this.distance = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, size * 1.5));
    }
    setView(rotX, rotY, rotZ) { this.rotX = rotX; this.rotY = normDeg(rotY); this.rotZ = normDeg(rotZ || 0); }

    /**
     * 要素にマウス操作を付ける（右＝回転、中＝平行移動、ホイール＝拡大縮小）。左ボタンには触れない。
     * onChange はカメラが変わるたびに呼ばれる。
     */
    attach(el, onChange) {
      let btn = -1, lx = 0, ly = 0, id = null;
      el.addEventListener('pointerdown', e => {
        if (e.button !== 1 && e.button !== 2) return;
        btn = e.button; lx = e.clientX; ly = e.clientY; id = e.pointerId;
        try { el.setPointerCapture(id); } catch (_) {}
        e.preventDefault();
      });
      el.addEventListener('pointermove', e => {
        if (btn < 0 || e.pointerId !== id) return;
        const dx = e.clientX - lx, dyUp = -(e.clientY - ly); lx = e.clientX; ly = e.clientY;
        if (btn === 2) this.orbit(dx, dyUp, speedOf(e), e.altKey); else this.pan(dx, dyUp, speedOf(e));
        onChange && onChange();
      });
      const end = e => { if (e.pointerId !== id) return; btn = -1; try { el.releasePointerCapture(id); } catch (_) {} id = null; };
      el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
      el.addEventListener('contextmenu', e => e.preventDefault());
      el.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
      el.addEventListener('wheel', e => { e.preventDefault(); this.zoom(PLCamera.scrollOf(e), speedOf(e)); onChange && onChange(); }, { passive: false });
    }
    /** ブラウザのホイール量 → PolyLing の手前回し量（1 目盛 = 0.1）。 */
    static scrollOf(e) { const notches = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaMode === 2 ? e.deltaY : e.deltaY / 100; return -notches * 0.1; }
    static speedOf(e) { return speedOf(e); }
  }
  window.PLCamera = PLCamera;
})();
