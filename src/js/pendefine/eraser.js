// @description ペン定義：スタンプ系共通＞消しゴム
//
// 丸ニブの消しゴム。形状は StampPenBase 既定の円スタンプをそのまま使い、
// 合成のみ destination-out にする。筆圧対応（丸ペン同様の可変幅消去）。

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
        this.usePressure = true;
        this.usePressureControl = true;
        this.useSubPxAlpha = false;
        this.flickTaper = null;
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
