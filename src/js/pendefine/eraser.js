// @description ペン定義：スタンプ系共通＞消しゴム
//
// 丸ニブの消しゴム。形状は StampPenBase 既定の円スタンプをそのまま使い、
// 合成のみ destination-out にする。筆圧は使わない。

import { StampPenBase } from './_stamppen.js';

// 消しゴム
export class Eraser extends StampPenBase {
    constructor(option) {
        super(option);
        // 値（StampPenBase からの差分）
        this.name = this.axpObj._('@PENNAME.ERASER');
        this.type = 'eraser';
        this.size = 5;
        this.toneLevel = null;
        this.blurLevel = null;
        // 制御
        this.usePressure = false;        // 消しゴムは筆圧で太さを変えない
        this.usePressureControl = false; // 消しゴムにはペン別の筆圧チェックを表示しない
        // 描画
        this.borderStyle = 'dashed';

        this.init_save();
    }
    init_brush() {
        // 合成モードと不透明度
        this.CANVAS.draw_ctx.globalCompositeOperation = 'destination-out';
        this.CANVAS.draw_ctx.globalAlpha = this.alpha / 100;
        // ブラシ
        this.CANVAS.brush_ctx.globalCompositeOperation = 'source-over';
        this.CANVAS.brush_ctx.globalAlpha = 1; // 先に不透明度100%の描画データを作成する
        this.CANVAS.brush_ctx.lineWidth = this.size;
        // トーンパターンをリセット
        this.CANVAS.brush_ctx.strokeStyle = 'black';
        this.CANVAS.brush_ctx.fillStyle = 'black';
        this.CANVAS.brush_ctx.lineCap = this.lineCap;
        this.CANVAS.brush_ctx.lineJoin = this.lineJoin;
        this.CANVAS.brush_ctx.clearRect(0, 0, this.axpObj.x_size, this.axpObj.y_size);
        //this.blur();
    }
}
