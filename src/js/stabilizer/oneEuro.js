// @description Stage 2: ストローク平滑化
//
// 位置: 1€フィルタ (時間基準)
// 筆圧: 窓5メディアン → 空間LPF (波長 λ = stabilizer 値 [px])
// 補間: 確定点間隔 > gapPx で線形補間
// 終端: onEnd で 2px のテーパ (筆圧 0 まで線形に落とす)
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
    }

    setStabilizerValue(stabilizerValue) {
        this.params = mapStabilizerToParams(stabilizerValue);
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
        // ストローク開始 2px は LPF を素通し: ペンタブ初動の段付きを残すと
        // 高筆圧の書き出しが入らないため、生の median をそのまま採用しつつ
        // LPF 状態は追従させておく (2px 通過後に滑らかに引き継ぐ)。
        if (this.cumDist < 2.0) {
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
        if (this.lastCommitted === null) {
            const fp = this._filterPoint(raw);
            this.lastCommitted = fp;
            return [this._taperOnly(fp)];
        }
        const fp = this._filterPoint(raw);
        const out = this._emit(fp, gapPx);
        this._appendTaper(out);
        return out;
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

    // 終端 2px テーパ: 末尾点を「2px 手前 knee + 末尾 tip(pressure=0)」に展開
    _appendTaper(out) {
        const taperLen = 2.0;
        if (out.length === 0) return;
        const last = out[out.length - 1];
        // 方向ベクトル: out 内の直前点 → last。なければ stabilizer の lastCommitted 直前
        let dirX = 0, dirY = 0, d = 0;
        if (out.length >= 2) {
            const p = out[out.length - 2];
            dirX = last.x - p.x;
            dirY = last.y - p.y;
            d = Math.hypot(dirX, dirY);
        }
        if (d > taperLen) {
            const ux = dirX / d;
            const uy = dirY / d;
            // 2px 手前に knee (last の筆圧をそのまま採用)
            const knee = {
                x: last.x - ux * taperLen,
                y: last.y - uy * taperLen,
                pressure: last.pressure,
                t: last.t,
            };
            // last 自体を pressure=0 にして tip 化
            const tip = { x: last.x, y: last.y, pressure: 0, t: last.t };
            out[out.length - 1] = knee;
            out.push(tip);
            this.lastCommitted = tip;
        } else {
            // 区間が短い: 末尾点を pressure=0 にするだけ
            last.pressure = 0;
        }
    }

    // 開始即終了用 (stroke 内に確定点 1 つしかない時)
    _taperOnly(fp) {
        return { x: fp.x, y: fp.y, pressure: 0, t: fp.t };
    }
}
