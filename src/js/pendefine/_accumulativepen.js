// @description ペン定義：描画ペン共通＞蓄積系ペン共通クラス
//
// 共通パイプライン (手ブレ補正・筆圧) を通さず、入力座標をそのまま蓄積して
// 描画するペン (ドット/筆/エアブラシ等) の共通基底。
// 各ペンは move()/draw() を override して独自の描画モデルを実装する。
//
// ※ 将来的には StampPenBase と同じ確定点群を入力に切り替える余地があるが、
//    現状は配管 (Round 継承からの切り離し) のみで、描画挙動は従来どおり。

import { DrawingPenBase } from './_drawingpen.js';

export class AccumulativePenBase extends DrawingPenBase {
    // 描画開始 (パイプラインは使わず共通前段のみ)
    start(x, y, e, option) {
        this._startCommon(x, y, option);
    }

    // 描画中 (既定: 入力座標を蓄積して draw()。各ペンで override 可)
    move(x, y) {
        if (this.axpObj.isDrawing && !this.axpObj.isDrawCancel) {
            this.axpObj.isDrawn = true;
            this.input_position.push({ x, y });
            this.draw();
        }
    }

    // 描画終了
    end(x, y) {
        if (this.axpObj.isDrawing && !this.axpObj.isDrawCancel) {
            this.isLastDrawing = true;
            this.input_position.push({ x, y });
            this.draw();
        }
        this.end_common();
    }
}
