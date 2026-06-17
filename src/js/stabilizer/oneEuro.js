// @description Stage 2: ストローク平滑化
//
// 位置: 1€フィルタ (時間基準)
// 筆圧: 窓5メディアン → 空間LPF (波長 λ = stabilizer 値 [px])
// 補間: 確定点間隔 > gapPx で線形補間
//
// 1€ 参照: Casiez et al. (2012) "1€ Filter: A Simple Speed-based Low-pass Filter
// for Noisy Input in Interactive Systems"

// 1ポール時間LPF α 係数 (cutoff Hz, dt 秒)
function timeLowPassAlpha(cutoff, dt) {
    const tau = 1.0 / (2.0 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
}

class LowPass {
    constructor() { this.y = null; }
    reset() { this.y = null; }
    filter(x, alpha) {
        if (this.y === null) this.y = x;
        else this.y = alpha * x + (1 - alpha) * this.y;
        return this.y;
    }
    last() { return this.y; }
}

// 窓5の causal なランニング・メディアン
class Median5 {
    constructor() { this.buf = []; }
    reset() { this.buf = []; }
    push(x) {
        this.buf.push(x);
        if (this.buf.length > 5) this.buf.shift();
        const sorted = [...this.buf].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)];
    }
}

// 空間1ポールLPF: α = ds / (λ + ds)。ds=0 → α=0 (保持)、λ=0 → α=1 (素通し)
class SpatialLowPass {
    constructor() { this.y = null; }
    reset() { this.y = null; }
    filter(x, ds, lambda) {
        if (this.y === null) { this.y = x; return this.y; }
        if (lambda <= 0) { this.y = x; return this.y; }
        const a = ds / (lambda + ds);
        this.y = a * x + (1 - a) * this.y;
        return this.y;
    }
}

// スライダー値 (0-10) → 内部パラメータ
function mapStabilizerToParams(v) {
    const vClamped = Math.max(0, Math.min(10, v));
    // 位置: 0 → ほぼ素通し (min_cutoff=30Hz), 10 → 強く平滑 (1.0Hz)
    const min_cutoff = 30.0 * Math.pow(0.45, vClamped);
    const beta = 0.05;
    // 筆圧: 空間LPFの波長 (px)。0=素通し、10=波長10px
    const pressureLambda = vClamped;
    return { min_cutoff, beta, pressureLambda };
}

export class OneEuroStabilizer {
    constructor() {
        this.xPos = new LowPass();
        this.yPos = new LowPass();
        this.dxFilt = new LowPass();
        this.dyFilt = new LowPass();
        this.pressMed = new Median5();
        this.pressLpf = new SpatialLowPass();
        this.prevT = null;
        this.prevX = null;
        this.prevY = null;
        this.prevFiltX = null;
        this.prevFiltY = null;
        this.cumDist = 0; // ストローク開始からの累積距離 (筆圧 LPF の起動遅延に使用)
        this.lastCommitted = null;
        this.params = mapStabilizerToParams(0);
        this.d_cutoff = 1.0;
        // ペンごとに調節できるピクセル単位パラメータ (StrokePipeline 経由で設定)
        this.startPx = 2.0;  // 開幕この距離までは筆圧 LPF を素通し
    }

    // ストローク開始時に一括設定する。
    // stabilizerValue: 0-10 スライダー値 / startPx: px 単位
    configure({ stabilizerValue = 0, startPx = 2.0 } = {}) {
        this.params = mapStabilizerToParams(stabilizerValue);
        this.startPx = startPx;
    }

    _filterPoint(raw) {
        const { x, y, pressure, t } = raw;
        const dt = (this.prevT === null) ? (1.0 / 60.0) : Math.max(0.001, (t - this.prevT) / 1000.0);

        // 筆圧: 窓5メディアン → 空間LPF
        const pMed = this.pressMed.push(pressure);

        if (this.prevT === null) {
            // 初回サンプル: フィルタ初期化
            this.xPos.filter(x, 1);
            this.yPos.filter(y, 1);
            this.dxFilt.filter(0, 1);
            this.dyFilt.filter(0, 1);
            this.pressLpf.filter(pMed, 0, 0);
            this.prevT = t;
            this.prevX = x;
            this.prevY = y;
            this.prevFiltX = x;
            this.prevFiltY = y;
            return { x, y, pressure: pMed, t };
        }

        // 位置: 1€フィルタ (時間基準)
        const dx = (x - this.prevX) / dt;
        const dy = (y - this.prevY) / dt;
        const aD = timeLowPassAlpha(this.d_cutoff, dt);
        const dxHat = this.dxFilt.filter(dx, aD);
        const dyHat = this.dyFilt.filter(dy, aD);
        const speed = Math.hypot(dxHat, dyHat);
        const cutoff = this.params.min_cutoff + this.params.beta * speed;
        const aP = timeLowPassAlpha(cutoff, dt);
        const xHat = this.xPos.filter(x, aP);
        const yHat = this.yPos.filter(y, aP);

        // 筆圧: 空間LPF (フィルタ後の位置を基準に進行距離を測る)
        const ds = Math.hypot(xHat - this.prevFiltX, yHat - this.prevFiltY);
        this.cumDist += ds;
        let pHat;
        // ストローク開始 startPx は LPF を素通し: ペンタブ初動の段付きを残すと
        // 高筆圧の書き出しが入らないため、生の median をそのまま採用しつつ
        // LPF 状態は追従させておく (startPx 通過後に滑らかに引き継ぐ)。
        if (this.cumDist < this.startPx) {
            pHat = pMed;
            this.pressLpf.y = pMed;
        } else {
            pHat = this.pressLpf.filter(pMed, ds, this.params.pressureLambda);
        }

        this.prevT = t;
        this.prevX = x;
        this.prevY = y;
        this.prevFiltX = xHat;
        this.prevFiltY = yHat;

        return { x: xHat, y: yHat, pressure: pHat, t };
    }

    onStart(raw) {
        this.xPos.reset();
        this.yPos.reset();
        this.dxFilt.reset();
        this.dyFilt.reset();
        this.pressMed.reset();
        this.pressLpf.reset();
        this.prevT = null;
        this.prevX = null;
        this.prevY = null;
        this.prevFiltX = null;
        this.prevFiltY = null;
        this.cumDist = 0;
        this.lastCommitted = null;

        const fp = this._filterPoint(raw);
        this.lastCommitted = fp;
        return [fp];
    }

    onMove(raw, gapPx) {
        if (this.lastCommitted === null) return this.onStart(raw);
        const fp = this._filterPoint(raw);
        return this._emit(fp, gapPx);
    }

    onEnd(raw, gapPx) {
        // pointerup は筆圧0 を報告しがち。終端サンプルは位置のみ採用し、
        // 筆圧は直前の確定値を引き継いで median を汚さない (末端が不自然に細るのを防ぐ)。
        const endRaw = (this.lastCommitted !== null)
            ? { ...raw, pressure: this.lastCommitted.pressure }
            : raw;
        const fp = this._filterPoint(endRaw);
        if (this.lastCommitted === null) {
            this.lastCommitted = fp;
            return [fp];
        }
        return this._emit(fp, gapPx);
    }

    // 確定点を出力 (必要なら線形補間で挿入)
    _emit(fp, gapPx) {
        const out = [];
        const prev = this.lastCommitted;
        const dist = Math.hypot(fp.x - prev.x, fp.y - prev.y);
        const gap = (gapPx && gapPx > 0) ? gapPx : 6.0;

        if (dist > gap) {
            const n = Math.max(1, Math.ceil(dist / gap));
            for (let i = 1; i < n; i++) {
                const tt = i / n;
                out.push({
                    x: prev.x + (fp.x - prev.x) * tt,
                    y: prev.y + (fp.y - prev.y) * tt,
                    pressure: prev.pressure + (fp.pressure - prev.pressure) * tt,
                    t: prev.t + (fp.t - prev.t) * tt,
                });
            }
        }
        out.push(fp);
        this.lastCommitted = fp;
        return out;
    }
}
