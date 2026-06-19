// @description ペン定義：描画ペン共通＞スタンプ系ペン共通クラス
//
// 共通パイプライン (StrokePipeline) が出力する確定点群を受け取り、
// 「各確定点にニブを打ち (_drawStamp)、確定点間を塗る (_drawSegment)」描画を行う。
// ニブ形状は _drawStamp / _drawSegment の override で差し替える (既定は円スタンプ)。
// 筆圧採用のありなしは usePressure フラグで切り替わる (_radiusAt がフラグ駆動)。

import { DrawingPenBase } from './_drawingpen.js';
import { calcDistance } from '../etc.js';
import { StrokePipeline, readStrokeSettings } from '../stabilizer/strokePipeline.js';

export class StampPenBase extends DrawingPenBase {
    constructor(option) {
        super(option);
        // ピクセル単位の調節パラメータ (ペンごとに override 可)
        this.startRawPx = 2;   // 開幕この距離まで筆圧フィルタを素通し
        this.subPxFloor = 0.5; // サブピクセル幅の形状下限
        // 終端ハライ/ハネ (速度依存・筆圧テーパー)。筆圧ペンのみ有効。具体ペンで上書き可。
        this.flickTaper = {
            enabled: true,
            thresholdBase: 0.1,   // ハライ判定速度 [canvas px/ms] (Z^-0.5 補正前)
            taperFactor: 40,      // テーパ長[px] = v[px/ms] × factor[ms] (実質ルックアヘッドms)
            minTaperRatio: 2.0,   // 下限 = ブラシ幅 × この倍率
            maxTaperRatio: 7.0,   // 上限 = (ブラシ幅 + 4px) × この倍率 (細ペンでもハライ出るよう+4)
            extrapRatio: 0.15,    // テーパ距離のうち外挿(進行方向への延長)が占める比率 (0〜0.8)
        };
    }

    // 描画開始
    start(x, y, e, option) {
        if (!this._startCommon(x, y, option)) return;

        // ハライは筆圧ペン入力時のみ。マウス/タッチは筆圧一定のため誤発火させない。
        const isPenInput = !!(e && e.pointerType === 'pen');
        this.pipeline = new StrokePipeline();
        this.pipeline.configure({
            ...readStrokeSettings(),
            usePressure: this.usePressure,
            startPx: this.startRawPx,
            flickTaper: this.flickTaper,
            zoom: this.axpObj.scale / 100,
            brushWidth: this.size,
            // 非筆圧ペンは半径が筆圧非依存のため、延長すると等幅で伸びてしまう → usePressure と pen で gate
            enableFlickTaper: this.usePressure && this.flickTaper.enabled && isPenInput,
        });
        this.lastCommitted = null;

        if (this.drawmode === this.axpObj.CONST.DRAW_FREEHAND && !this.axpObj.isLine) {
            const commits = this.pipeline.onStart(this._toInput(x, y, e));
            for (const cp of commits) {
                this._drawStamp(cp);
                this.lastCommitted = cp;
            }
        }
    }

    // 描画中
    move(x, y, e) {
        if (!this.axpObj.isDrawing || this.axpObj.isDrawCancel) return;
        this.axpObj.isDrawn = true;
        this.input_position.push({ x, y });

        if (this.drawmode === this.axpObj.CONST.DRAW_FREEHAND && !this.axpObj.isLine) {
            // FREEHAND: 累積描画 (ブラシキャンバスは clear せず、新しい区間のみ追加)
            const commits = this.pipeline.onMove(this._toInput(x, y, e), this._gap());
            for (const cp of commits) {
                this._drawSegment(this.lastCommitted, cp);
                this.lastCommitted = cp;
            }
            this.write();
        } else {
            // RECT/CIRCLE/直線モード: 従来通り全体再描画
            this._drawShapeFull();
        }
    }

    // 描画終了
    end(x, y, e) {
        if (this.axpObj.isDrawing && !this.axpObj.isDrawCancel) {
            this.isLastDrawing = true;
            this.input_position.push({ x, y });

            if (this.drawmode === this.axpObj.CONST.DRAW_FREEHAND && !this.axpObj.isLine) {
                const commits = this.pipeline.onEnd(this._toInput(x, y, e), this._gap());
                for (const cp of commits) {
                    this._drawSegment(this.lastCommitted, cp);
                    this.lastCommitted = cp;
                }
                // 終端ハライ/ハネ・テーパー: 既存終端の筆圧を遡って下げる必要があるため、
                // ブラシキャンバスを clear し、テーパー後の全確定点を再描画する (write が
                // レイヤー再ロード後にブラシ全体を1回合成するため二重濃化は起きない)。
                const rebuild = this.pipeline.consumeRebuild();
                if (rebuild && rebuild.length > 0) {
                    this.CANVAS.brush_ctx.clearRect(0, 0, this.axpObj.x_size, this.axpObj.y_size);
                    this.lastCommitted = null;
                    for (const cp of rebuild) {
                        this._drawSegment(this.lastCommitted, cp);
                        this.lastCommitted = cp;
                    }
                }
                this.write();
            } else {
                this._drawShapeFull();
            }
        }
        this.end_common();
    }

    // ── 内部ヘルパ ───────────────────────────────

    // 入力イベント → パイプライン入力 (生筆圧のまま。カーブ変換はパイプライン側)
    _toInput(x, y, e) {
        const rawPressure = (e && typeof e.pressure === 'number') ? e.pressure : 1.0;
        const pointerType = e ? e.pointerType : 'mouse';
        const t = (e && typeof e.timeStamp === 'number') ? e.timeStamp : performance.now();
        return { x, y, rawPressure, pointerType, t };
    }

    // 確定点間隔: 太いほど粗く打てる (細部の取りこぼし防止に下限 2px)
    _gap() {
        return Math.max(2, this._halfWidth());
    }

    // 描画半径: usePressure のとき筆圧に比例、それ以外は固定半幅。
    _radiusAt(cp) {
        const half = this._halfWidth();
        // 筆圧をそのまま半径に乗算 (下限なし → curve の不感地帯と終端テーパが機能)
        return this.usePressure ? half * cp.pressure : half;
    }

    // サブピクセル幅 (直径 < 1px) のエミュレーション:
    // 形状は subPxFloor にクランプし、不透明度を真半径/subPxFloor で減衰させる
    _subPxAlpha(rTrue) {
        const f = this.subPxFloor;
        return (rTrue < f) ? Math.max(0, rTrue) / f : 1.0;
    }

    // 円スタンプ (既定ニブ)
    _drawStamp(cp) {
        const rTrue = this._radiusAt(cp);
        if (rTrue <= 0) return;
        const r = Math.max(rTrue, this.subPxFloor);
        const alphaScale = this._subPxAlpha(rTrue);
        const ctx = this.CANVAS.brush_ctx;
        const saved = ctx.globalAlpha;
        ctx.globalAlpha = saved * alphaScale;
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = saved;
    }

    // ２点間の塗り (半径可変の外接共通接線で構成した凸多角形)
    _drawSegment(p1, p2) {
        if (!p1) {
            this._drawStamp(p2);
            return;
        }
        const r1True = this._radiusAt(p1);
        const r2True = this._radiusAt(p2);
        // 両端ともゼロ → 何も描けない
        if (r1True <= 0 && r2True <= 0) return;
        // サブピクセル幅対応: 形状は >= subPxFloor にクランプ、不透明度で減衰
        const r1 = Math.max(r1True, this.subPxFloor);
        const r2 = Math.max(r2True, this.subPxFloor);
        const segAlpha = (this._subPxAlpha(r1True) + this._subPxAlpha(r2True)) / 2;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const d = Math.hypot(dx, dy);
        if (d < 0.5) {
            this._drawStamp(p2);
            return;
        }
        // 外接共通接線の傾き: sin α = (r2 - r1) / d
        const sinA = (r2 - r1) / d;
        if (Math.abs(sinA) >= 0.999) {
            // 一方の円が他方を完全に包含 → 大きい方だけ塗って終わり
            const big = (r1 > r2) ? p1 : p2;
            this._drawStamp(big);
            // big が p2 のときは二重描画になる (サブピクセルα/消しゴムで濃くなる) ため回避
            if (big !== p2) this._drawStamp(p2);
            return;
        }
        const cosA = Math.sqrt(1 - sinA * sinA);
        const ux = dx / d;
        const uy = dy / d;
        // 上側接線における外向き垂線 (p_up = (-uy, ux) を α 回転)
        const nUx = -uy * cosA - ux * sinA;
        const nUy =  ux * cosA - uy * sinA;
        // 下側接線における外向き垂線 (p_down = (uy, -ux) を α 回転)
        const nLx =  uy * cosA + ux * sinA;
        const nLy =  uy * sinA - ux * cosA;
        const ctx = this.CANVAS.brush_ctx;
        const saved = ctx.globalAlpha;
        ctx.globalAlpha = saved * segAlpha;
        ctx.beginPath();
        ctx.moveTo(p1.x + r1 * nUx, p1.y + r1 * nUy);
        ctx.lineTo(p2.x + r2 * nUx, p2.y + r2 * nUy);
        ctx.lineTo(p2.x + r2 * nLx, p2.y + r2 * nLy);
        ctx.lineTo(p1.x + r1 * nLx, p1.y + r1 * nLy);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = saved;
        // 終端のキャップ円 (こちらは p2 自身の真半径でアルファ補正)
        this._drawStamp(p2);
    }

    // RECT / CIRCLE / 直線モード: 毎フレーム全体を再描画
    _drawShapeFull() {
        const ctx = this.CANVAS.brush_ctx;
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, this.axpObj.x_size, this.axpObj.y_size);

        const firstPoint = this.input_position[0];
        const currentPoint = this.input_position[this.input_position.length - 1];

        switch (this.drawmode) {
            case this.axpObj.CONST.DRAW_FREEHAND: {
                // ここに来るのは isLine モードのみ
                if (this.axpObj.isLine) {
                    this._drawStraight(firstPoint, currentPoint);
                }
                break;
            }
            case this.axpObj.CONST.DRAW_RECT:
                ctx.strokeRect(
                    firstPoint.x,
                    firstPoint.y,
                    currentPoint.x - firstPoint.x,
                    currentPoint.y - firstPoint.y
                );
                break;
            case this.axpObj.CONST.DRAW_CIRCLE: {
                const r = calcDistance(
                    firstPoint.x,
                    firstPoint.y,
                    currentPoint.x,
                    currentPoint.y
                );
                ctx.beginPath();
                ctx.arc(firstPoint.x, firstPoint.y, r, 0, Math.PI * 2, true);
                ctx.stroke();
                break;
            }
        }
        this.write();
    }

    // 直線モードの描画 (始点→終点を 1 区間として円スタンプ＋多角形塗り)
    _drawStraight(p1, p2) {
        const a = { x: p1.x, y: p1.y, pressure: 1.0 };
        const b = { x: p2.x, y: p2.y, pressure: 1.0 };
        this._drawStamp(a);
        this._drawSegment(a, b);
    }
}
