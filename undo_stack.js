/*
================================================================================
 Undo スタック  undo_stack.js
 （timeline.html が <script src> で読む共通部品）
--------------------------------------------------------------------------------
 PolyLing の UndoSystem（Runtime/UndoSystem/Core/UndoStack.cs）と同じ考え方の、汎用の Undo 記録の箱。
   ・記録（record）は「元に戻す」「やり直す」の 2 つを持つ物。中身（何をどう戻すか）はスタックは知らない。
       { undo(ctx), redo(ctx) }   ctx は performUndo / performRedo に渡した相手（操作対象）
   ・record で積むとやり直し側は捨てる。上限（既定 50 件）を超えた古い記録から捨てる。
 PolyLing から省いたもの
   ・別スレッドからの記録を受ける待ち行列：JS は単一スレッドなので要らない。
   ・複数スタックの調停（UndoGroup の OperationLog）：編集データを持つのはタイムラインだけなので 1 本でよい。
   ・グループ ID（BeginGroup / EndGroup）：まとめたい操作は、記録する側が一時停止と再開で 1 件にまとめる
     （PolyLing の SuspendRecording / ResumeRecording 相当。timeline.html の TimelineUndoController）。
 使い方
   const st = new PolyLingUndo.UndoStack({ maxSize: 50, onChanged: () => … });
   st.record(rec, '説明');  st.performUndo(ctx);  st.performRedo(ctx);  st.clear();
================================================================================
*/
(function () {
  class UndoStack {
    constructor(opt) {
      opt = opt || {};
      this.maxSize = opt.maxSize > 0 ? opt.maxSize : 50;
      this.onChanged = opt.onChanged || null;   // 積む・戻す・やり直す・消去のたびに呼ぶ（表示の更新用）
      this._undo = [];
      this._redo = [];
    }
    get canUndo() { return this._undo.length > 0; }
    get canRedo() { return this._redo.length > 0; }
    get undoCount() { return this._undo.length; }
    get redoCount() { return this._redo.length; }

    /** 記録を積む。やり直し側は捨てる。 */
    record(rec, description) {
      if (!rec || typeof rec.undo !== 'function' || typeof rec.redo !== 'function')
        throw new Error('UndoStack.record: undo / redo を持つ記録が必要です');
      rec.info = { description: description || 'Operation' };
      this._undo.push(rec);
      this._redo.length = 0;
      while (this._undo.length > this.maxSize) this._undo.shift();
      this._changed();
    }

    /** 最新の記録を 1 件戻す。戻せたら true。 */
    performUndo(ctx) {
      if (!this._undo.length) return false;
      const rec = this._undo.pop();
      rec.undo(ctx);
      this._redo.push(rec);
      this._changed();
      return true;
    }

    /** 最後に戻した記録を 1 件やり直す。やり直せたら true。 */
    performRedo(ctx) {
      if (!this._redo.length) return false;
      const rec = this._redo.pop();
      rec.redo(ctx);
      this._undo.push(rec);
      this._changed();
      return true;
    }

    /** 履歴をすべて消す。 */
    clear() {
      this._undo.length = 0;
      this._redo.length = 0;
      this._changed();
    }

    _changed() { if (this.onChanged) { try { this.onChanged(); } catch (e) { console.error(e); } } }
  }

  window.PolyLingUndo = { UndoStack };
})();
