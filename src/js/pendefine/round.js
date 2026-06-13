// @description ペン定義：親クラス＞丸ペン

import { PenObj } from './_penobj.js';
import { range_index } from './rangeindex.js';
import { createTonePattern, calcDistance, getAdjustedPressure } from '../etc.js';
import { OneEuroStabilizer } from '../stabilizer/oneEuro.js';

// 丸ペン
export class Round extends PenObj {
    constructor(option) {
        super();
        this.axpObj = option.axpObj;
        this.CANVAS = option.CANVAS;
        // 値（PenObjからの差分）
        this.name = this.axpObj._('@PENNAME.ROUND');
        this.type = 'draw';
        this.size = 1;
        this.index = range_index(this.size);
        this.alpha = 100;
        this.toneLevel = 16;
        this.blurLevel = 0;
        // 制御
        this.usePenGuide = true;
        this.usePenPreview = true;
        this.usePenLock = true;
        this.usePenStyle = true;
        this.canUndo = true;
        this.usePressure = true;
        // Phase A: Round/Square/Eraser のみ新 Stabilizer + 円スタンプ系で描画する。
        // 累積系 (Brush/Fude/Dot/Crayon/EraserDot) は constructor で false に上書きする。
        this.useStabilizerPipeline = true;
        // 描画
        this.borderRadius = 50;
        this.borderStyle = 'normal';
        this.lineCap = 'round';
        this.lineJoin = 'round';

        this.init_save();
    }

    init_brush(option) {
        // 合成モードと不透明度
        this.init_globalCompositeOperation(option);
        this.CANVAS.draw_ctx.globalAlpha = this.alpha / 100;
        // ブラシ
        this.CANVAS.brush_ctx.globalCompositeOperation = 'source-over';
        this.CANVAS.brush_ctx.globalAlpha = 1; // 先に不透明度100%の描画データを作成する
        this.CANVAS.brush_ctx.lineWidth = this.size - 0.25;
        let style;
        if (this.axpObj.config('axp_config_form_ToneLevel') === 'on' &&
            this.toneLevel !== null &&
            this.toneLevel !== 16) {
            // トーン濃度使用時トーンパターン生成して色指定
            style = createTonePattern(this.toneLevel, this.getColor());
        } else {
            // 通常時の色指定
            style = this.getColor();
        }
        this.CANVAS.brush_ctx.strokeStyle = style;
        this.CANVAS.brush_ctx.fillStyle = style;
        this.CANVAS.brush_ctx.lineCap = this.lineCap;
        this.CANVAS.brush_ctx.lineJoin = this.lineJoin;
        this.CANVAS.brush_ctx.clearRect(0, 0, this.axpObj.x_size, this.axpObj.y_size);
        this.blur();
    }

    // 描画開始
    start(x, y, e, option) {
        // 書き込み禁止状態
        if (this.axpObj.layerSystem.isWriteProtection()) {
            return;
        }
        // モード設定
        this.set_modeflag();

        // 入力座標の記憶
        this.input_position = [];
        this.input_position.push({ x, y });

        // 描画開始時のイメージ記憶
        this.axpObj.layerSystem.save();

        this.init_brush(option);
        this.start_draw(x, y); // 累積系の子クラス用フック (Dot/Fude が override)

        if (this.useStabilizerPipeline) {
            this.stabilizer = new OneEuroStabilizer();
            this.stabilizer.setStabilizerValue(this._getStabilizerValue());
            this.lastCommitted = null;

            if (this.drawmode === this.axpObj.CONST.DRAW_FREEHAND && !this.axpObj.isLine) {
                const raw = this._toRaw(x, y, e);
                const commits = this.stabilizer.onStart(raw);
                for (const cp of commits) {
                    this._drawStamp(cp);
                    this.lastCommitted = cp;
                }
            }
        }
    }

    // 累積系子クラスのみ意味あり (Dot: ImageData 初期化、Fude: lineWidth 初期化など)。
    // Round/Square/Eraser では何もしない。
    start_draw() { }

    // 描画中
    move(x, y, e) {
        if (!this.axpObj.isDrawing || this.axpObj.isDrawCancel) return;
        this.axpObj.isDrawn = true;
        this.input_position.push({ x, y });

        if (!this.useStabilizerPipeline) {
            // 累積系の旧経路: 子クラス draw() に委譲
            this.draw();
            return;
        }

        if (this.drawmode === this.axpObj.CONST.DRAW_FREEHAND && !this.axpObj.isLine) {
            // FREEHAND: 累積描画（ブラシキャンバスは clear せず、新しい区間のみ追加）
            const raw = this._toRaw(x, y, e);
            const gap = Math.max(2, (this.size - 0.25) * 0.5);
            const commits = this.stabilizer.onMove(raw, gap);
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

            if (!this.useStabilizerPipeline) {
                this.draw();
            } else if (this.drawmode === this.axpObj.CONST.DRAW_FREEHAND && !this.axpObj.isLine) {
                const raw = this._toRaw(x, y, e);
                const gap = Math.max(2, (this.size - 0.25) * 0.5);
                const commits = this.stabilizer.onEnd(raw, gap);
                for (const cp of commits) {
                    this._drawSegment(this.lastCommitted, cp);
                    this.lastCommitted = cp;
                }
                this.write();
            } else {
                this._drawShapeFull();
            }
        }
        this.end_common();
    }

    // ── 内部ヘルパ ───────────────────────────────

    _getStabilizerValue() {
        const el = document.getElementById('axp_config_form_stabilizerValue');
        if (!el || !el.volume) return 0;
        return Number(el.volume.value) || 0;
    }

    _getPressureCurveParams() {
        // 設定 UI から a/b/c を取得。要素が無い場合は線形 (a=1, b=1, c=0)。
        const formA = document.getElementById('axp_config_form_pressureA');
        const formB = document.getElementById('axp_config_form_pressureB');
        const formC = document.getElementById('axp_config_form_pressureC');
        const aRaw = formA && formA.volume ? Number(formA.volume.value) : 0;
        const b = formB && formB.volume ? Number(formB.volume.value) : 1;
        const c = formC && formC.volume ? Number(formC.volume.value) : 0;
        const a = Math.pow(2, aRaw); // 内部値域 -2〜2 → 実値 0.25〜4
        return { a, b, c };
    }

    _toRaw(x, y, e) {
        let p = 1.0;
        // 筆圧は pen 系のみ採用する (mouse は 0.5 固定、touch はデバイス依存で信頼できないため)。
        if (this.usePressure && e && e.pointerType === 'pen'
            && typeof e.pressure === 'number' && e.pressure > 0) {
            const { a, b, c } = this._getPressureCurveParams();
            p = getAdjustedPressure(e.pressure, a, b, c);
        }
        const t = (e && typeof e.timeStamp === 'number') ? e.timeStamp : performance.now();
        return { x, y, pressure: p, t };
    }

    _radiusAt(cp) {
        const halfWidth = (this.size - 0.25) / 2;
        if (!this.usePressure) return halfWidth;
        // 筆圧をそのまま半径に乗算 (下限なし → curve の不感地帯と終端テーパが正しく機能)
        return halfWidth * cp.pressure;
    }

    // サブピクセル幅 (直径 < 1px) のエミュレーション:
    // 形状は半径 0.5 にクランプし、不透明度を真半径/0.5 で減衰させる
    _subPxAlpha(rTrue) {
        return (rTrue < 0.5) ? Math.max(0, rTrue) / 0.5 : 1.0;
    }

    // 円スタンプ
    _drawStamp(cp) {
        const rTrue = this._radiusAt(cp);
        if (rTrue <= 0) return;
        const r = Math.max(rTrue, 0.5);
        const alphaScale = this._subPxAlpha(rTrue);
        const ctx = this.CANVAS.brush_ctx;
        const saved = ctx.globalAlpha;
        ctx.globalAlpha = saved * alphaScale;
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = saved;
    }

    // ２点間の塗り（半径可変の外接共通接線で構成した凸多角形）
    _drawSegment(p1, p2) {
        if (!p1) {
            this._drawStamp(p2);
            return;
        }
        const r1True = this._radiusAt(p1);
        const r2True = this._radiusAt(p2);
        // 両端ともゼロ → 何も描けない
        if (r1True <= 0 && r2True <= 0) return;
        // サブピクセル幅対応: 形状は >= 0.5 にクランプ、不透明度で減衰
        const r1 = Math.max(r1True, 0.5);
        const r2 = Math.max(r2True, 0.5);
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
            this._drawStamp(p2);
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
        const fixed = { pressure: 1.0 };
        const a = { x: p1.x, y: p1.y, pressure: fixed.pressure };
        const b = { x: p2.x, y: p2.y, pressure: fixed.pressure };
        this._drawStamp(a);
        this._drawSegment(a, b);
    }
}
