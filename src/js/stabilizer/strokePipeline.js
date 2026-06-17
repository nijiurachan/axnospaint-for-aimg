// @description ストローク共通前処理パイプライン (ペン非依存)
//
//   raw 点群 {x, y, rawPressure, pointerType, t}
//     ↓ 筆圧カーブ変換 (入力筆圧 → 出力筆圧)
//     ↓ 手ブレ補正 (位置: 1€ / 筆圧: median5 + 空間LPF、開幕 startPx は素通し)
//     ↓ 確定点ストリーム {x, y, pressure, t} を emit (gap で線形補間)
//
// 設定 (手ブレ強度・筆圧カーブ) の DOM 読み取りは readStrokeSettings() に集約し、
// パイプライン本体・各ペンクラスからは document を触らないようにしている。

import { OneEuroStabilizer } from './oneEuro.js';
import { getAdjustedPressure } from '../etc.js';

// 設定 UI からストローク共通設定を読み取る。
// 要素が無い場合は無補正 (手ブレ 0 / 線形カーブ) を返す。
export function readStrokeSettings() {
    // 手ブレ補正スライダー (0-10)
    const elS = document.getElementById('axp_config_form_stabilizerValue');
    const stabilizerValue = (elS && elS.volume) ? (Number(elS.volume.value) || 0) : 0;
    // 筆圧カーブ a/b/c
    const formA = document.getElementById('axp_config_form_pressureA');
    const formB = document.getElementById('axp_config_form_pressureB');
    const formC = document.getElementById('axp_config_form_pressureC');
    const aRaw = formA && formA.volume ? Number(formA.volume.value) : 0;
    const bRaw = formB && formB.volume ? Number(formB.volume.value) : 1;
    // b は getAdjustedPressure() の分母。0/NaN だと筆圧が固定・無効化されるため防御
    const b = (Number.isFinite(bRaw) && bRaw > 0) ? bRaw : 1;
    const c = formC && formC.volume ? Number(formC.volume.value) : 0;
    const a = Math.pow(2, aRaw); // 内部値域 -2〜2 → 実値 0.25〜4
    return { stabilizerValue, pressureCurve: { a, b, c } };
}

export class StrokePipeline {
    constructor() {
        this.smoother = new OneEuroStabilizer();
        this.usePressure = false;
        this.pressureCurve = { a: 1, b: 1, c: 0 };
    }

    // ストローク開始時に一括設定。
    //   stabilizerValue / pressureCurve … readStrokeSettings() の戻り値
    //   usePressure … 筆圧を採用するか (ペン側のフラグ)
    //   startPx … 開幕の筆圧フィルタ素通し距離 (ペンごとに調節可能)
    configure({ stabilizerValue = 0, pressureCurve, usePressure = false, startPx = 2 } = {}) {
        this.usePressure = usePressure;
        if (pressureCurve) this.pressureCurve = pressureCurve;
        this.smoother.configure({ stabilizerValue, startPx });
    }

    // 入力筆圧 → 出力筆圧。
    // 筆圧は pen 系のみ採用する (mouse は 0.5 固定相当の 1.0、touch はデバイス依存で
    // 信頼できないため 1.0)。usePressure=false のペンも常に 1.0。
    _pressure(input) {
        // rawPressure === 0 もカーブに通す (deadzone 経由で 0 出力)。
        // > 0 で除外すると筆圧0のサンプルが 1.0 に跳ねて太さが急変するため >= 0 とする。
        if (this.usePressure && input.pointerType === 'pen'
            && typeof input.rawPressure === 'number' && input.rawPressure >= 0) {
            const { a, b, c } = this.pressureCurve;
            return getAdjustedPressure(input.rawPressure, a, b, c);
        }
        return 1.0;
    }

    _raw(input) {
        return { x: input.x, y: input.y, pressure: this._pressure(input), t: input.t };
    }

    // いずれも確定点 {x, y, pressure, t} の配列を返す
    onStart(input) { return this.smoother.onStart(this._raw(input)); }
    onMove(input, gapPx) { return this.smoother.onMove(this._raw(input), gapPx); }
    onEnd(input, gapPx) { return this.smoother.onEnd(this._raw(input), gapPx); }
}
