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
}
