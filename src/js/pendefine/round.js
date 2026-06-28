// @description ペン定義：スタンプ系共通＞丸ペン
//
// いまのところ唯一の筆圧反応ペン。フィルタ後筆圧に比例して半径を増減し、
// 半径 0.5px 未満は半径 0.5 の透過線に変換する (実装は StampPenBase 側)。

import { StampPenBase } from './_stamppen.js';
import { range_index } from './rangeindex.js';

// 丸ペン
export class Round extends StampPenBase {
    constructor(option) {
        super(option);
        // 値（StampPenBase からの差分）
        this.name = this.axpObj._('@PENNAME.ROUND');
        this.size = 1;
        this.index = range_index(this.size);
        // 制御
        this.usePressure = true;
        this.usePressureControl = true;
        this.useSubPxAlphaControl = true;

        this.init_save();
    }

    // 芯/輪郭の二重描画: 輪郭を半透明で描いた上に縮小半径の芯を重ねる
    _drawCommits(commits, prevPoint) {
        if (commits.length === 0) return prevPoint;
        this._drawPointSequence(commits, 0.3, prevPoint);
        return this._drawPointSequence(commits, 1.0, prevPoint,
            r => this._coreRadiusXform(r));
    }

    _coreRadiusXform(r) {
        if (r > 1.4) return r - 0.7;
        if (r > 0.5) return (2 * r - 1) / 9 + 0.5;
        return r;
    }
}
